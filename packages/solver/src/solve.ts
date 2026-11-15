import {
  type CharacterDef,
  createWorld,
  currentFeel,
  FX_ONE,
  type PackRuntime,
  roomGrid,
  type StartState,
} from '@retro-action-engine/core';
import { FootholdIndex } from './footholds';
import { type Budget, jumpHolds } from './macros';
import { measureRise } from './probe';
import { explore, pathHelds, type SearchContext, type SearchNode } from './search';
import type { FootholdReport, MacroKind, ScopeReport, SolveReport, SolverOptions } from './types';
import { replayFromHelds, verifyWitness } from './witness';

const DEFAULTS = {
  jumpHoldSamples: 4,
  maxMacroTicks: 600,
  maxNodes: 20_000,
  maxSteps: 20_000_000,
} as const;

function solveCharacter(
  runtime: PackRuntime,
  start: StartState,
  character: CharacterDef,
  options: SolverOptions,
  limits: SolveReport['limits'],
  budget: Budget,
): ScopeReport {
  const scopeStart: StartState = { ...start, party: [character.id] };
  const grid = roomGrid(runtime, start.roomId);
  const world = createWorld(runtime, scopeStart);
  const feel = currentFeel(world, runtime);
  const footholds = new FootholdIndex(grid, [character]);
  const rise = measureRise(runtime, character, start.feelProfile);
  const context: SearchContext = {
    runtime,
    grid,
    character,
    footholds,
    holds: jumpHolds(feel, rise.ticks, limits.jumpHoldSamples),
    xQuantum: limits.xQuantum,
    vQuantum: options.vQuantum ?? Math.max(1, Math.floor(feel.runSpeed / 2)),
    maxMacroTicks: limits.maxMacroTicks,
    maxNodes: limits.maxNodes,
  };

  const stepsBefore = budget.steps;
  const search = explore(context, world, budget);

  // The first node found on a foothold is the one with the fewest macros (breadth-first).
  const firstNode = new Map<number, SearchNode>();
  for (const node of search.nodes) {
    for (const foothold of node.footholds) {
      if (!firstNode.has(foothold)) {
        firstNode.set(foothold, node);
      }
    }
  }

  let replaysVerified = 0;
  const reports: FootholdReport[] = footholds.all.map((foothold, index) => {
    const node = firstNode.get(index);
    if (node === undefined) {
      return { ...foothold, status: 'unreached' };
    }
    const replay = replayFromHelds(runtime, scopeStart, pathHelds(search.nodes, node.id));
    verifyWitness(runtime, grid, footholds, character, replay, index, node.world);
    replaysVerified++;
    return {
      ...foothold,
      status: 'reached',
      witness: { replay, ticks: node.world.tick, macros: node.depth },
    };
  });

  // Foothold graph: which macro kinds were seen to lead from one foothold to another.
  const kindsByPair = new Map<string, Set<MacroKind>>();
  for (const edge of search.edges) {
    for (const from of (search.nodes[edge.from] as SearchNode).footholds) {
      for (const to of edge.landedOn) {
        if (from === to) continue;
        const key = `${from}>${to}`;
        const kinds = kindsByPair.get(key) ?? new Set<MacroKind>();
        kinds.add(edge.kind);
        kindsByPair.set(key, kinds);
      }
    }
  }
  const idOf = (index: number) => (footholds.all[index] as FootholdReport).id;
  const edges = [...kindsByPair.entries()]
    .map(([key, kinds]) => {
      const [from, to] = key.split('>').map(Number) as [number, number];
      return { from, to, kinds: [...kinds].sort() };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map((edge) => ({ from: idOf(edge.from), to: idOf(edge.to), kinds: edge.kinds }));

  return {
    scope: { kind: 'character', characterId: character.id },
    complete: search.complete,
    startFootholds: (search.nodes[0]?.footholds ?? []).map(idOf),
    footholds: reports,
    edges,
    stats: {
      nodes: search.nodes.length,
      edges: search.edges.length,
      macros: search.macros,
      steps: budget.steps - stepsBefore,
      timeouts: search.timeouts,
      replaysVerified,
    },
  };
}

/**
 * Reachability of one room, one character at a time (ADR-0015, stage 1). For each party member
 * it lists every foothold, whether a path to it was found, and a replay that proves each path.
 *
 * Sound, not complete: a reached foothold always comes with a replay that was run and checked;
 * an unreached one means no path was found within the macros and limits, not that none exists.
 */
export function solveRoom(
  runtime: PackRuntime,
  start: StartState,
  options: SolverOptions = {},
): SolveReport {
  const startedAt = options.now?.();
  const limits: SolveReport['limits'] = {
    xQuantum: options.xQuantum ?? Math.max(FX_ONE, Math.floor((runtime.tileSize * FX_ONE) / 8)),
    jumpHoldSamples: options.jumpHoldSamples ?? DEFAULTS.jumpHoldSamples,
    maxMacroTicks: options.maxMacroTicks ?? DEFAULTS.maxMacroTicks,
    maxNodes: options.maxNodes ?? DEFAULTS.maxNodes,
    maxSteps: options.maxSteps ?? DEFAULTS.maxSteps,
  };
  const budget: Budget = { steps: 0, maxSteps: limits.maxSteps, exhausted: false };

  const memberIds = [...new Set(start.party ?? runtime.rules.party.members)];
  const scopes = memberIds.map((id) => {
    const character = runtime.characters[id];
    if (character === undefined) {
      throw new RangeError(`party member "${id}" is not a defined character`);
    }
    return solveCharacter(runtime, start, character, options, limits, budget);
  });

  const elapsed =
    startedAt === undefined || options.now === undefined
      ? {}
      : {
          elapsedMs: options.now() - startedAt,
        };
  return {
    roomId: start.roomId,
    feelProfile: start.feelProfile,
    complete: scopes.every((scope) => scope.complete),
    scopes,
    limits,
    totals: { steps: budget.steps, ...elapsed },
  };
}
