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
import { measureRise, measureRiseBound } from './probe';
import { Proofs } from './proofs';
import { explore, pathHelds, type SearchContext, type SearchNode } from './search';
import type {
  Foothold,
  FootholdReport,
  MacroKind,
  ReturnReport,
  ScopeReport,
  SolveReport,
  SolverOptions,
} from './types';
import { replayFromHelds, verifyWitness } from './witness';

/**
 * Thrown when a proof says "impossible" about something a verified replay does. One of the two
 * is wrong, so nothing is reported: a solver bug, never a report entry.
 */
export class ProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProofError';
  }
}

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

  const riseBound = measureRiseBound(runtime, character, start.feelProfile);
  const proofs = Proofs.of(grid, character, world, riseBound);

  const stepsBefore = budget.steps;
  const search = explore(context, { world, held: 0 }, budget);
  const startFootholds: readonly number[] = search.nodes[0]?.footholds ?? [];
  const startFoothold = footholds.all[startFootholds[0] ?? -1];
  let complete = search.complete;
  let returnSearches = 0;

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

  /**
   * The way back from the first state found on a foothold to the start foothold. "It can" is
   * only said with a replay of the whole trip that passed the gate.
   */
  const returnFrom = (foothold: Foothold, node: SearchNode, there: number[]): ReturnReport => {
    if (startFoothold !== undefined) {
      const proof = proofs?.cannotClimb(foothold, startFoothold);
      if (proof !== undefined) {
        return { status: 'provenNo', ...proof };
      }
    }
    if (startFootholds.length === 0) {
      return { status: 'notFound' };
    }
    const isStart = (landedOn: readonly number[]) =>
      landedOn.some((index) => startFootholds.includes(index));
    const back = explore(context, { world: node.world, held: node.held, goal: isStart }, budget);
    if (back.macros > 0) {
      returnSearches++;
    }
    if (back.goal === undefined) {
      complete &&= back.complete;
      return { status: 'notFound' };
    }
    const target = back.goal.footholds.find((index) => startFootholds.includes(index)) as number;
    const replay = replayFromHelds(runtime, scopeStart, [...there, ...back.goal.helds]);
    verifyWitness(runtime, grid, footholds, character, replay, target, back.goal.world);
    replaysVerified++;
    return {
      status: 'verified',
      witness: { replay, ticks: back.goal.world.tick, macros: node.depth + back.goal.depth },
    };
  };

  const reports: FootholdReport[] = footholds.all.map((foothold, index) => {
    const node = firstNode.get(index);
    const blocker = proofs?.unreachable(foothold);
    if (node === undefined) {
      return blocker === undefined
        ? { ...foothold, status: 'unreached' }
        : { ...foothold, status: 'unreached', blocker };
    }
    const there = pathHelds(search.nodes, node.id);
    const replay = replayFromHelds(runtime, scopeStart, there);
    verifyWitness(runtime, grid, footholds, character, replay, index, node.world);
    replaysVerified++;
    if (blocker !== undefined) {
      throw new ProofError(
        `foothold ${foothold.id} is reached by a verified replay, but "${blocker.reason}" claims it cannot be`,
      );
    }
    return {
      ...foothold,
      status: 'reached',
      witness: { replay, ticks: node.world.tick, macros: node.depth },
      return: returnFrom(foothold, node, there),
    };
  });

  // Foothold graph: which macro kinds were seen to lead from one foothold to another.
  const kindsByPair = new Map<string, Set<MacroKind>>();
  for (const edge of search.edges) {
    for (const from of (search.nodes[edge.from] as SearchNode).footholds) {
      for (const to of edge.landedOn) {
        if (from === to) continue;
        // Every edge is a transition the simulation made from an exact state. A proof that
        // denies one of them is wrong.
        const fromFoothold = footholds.all[from] as Foothold;
        const toFoothold = footholds.all[to] as Foothold;
        if (proofs?.cannotClimb(fromFoothold, toFoothold) !== undefined) {
          throw new ProofError(
            `the simulation went from ${fromFoothold.id} to ${toFoothold.id}, against a proof`,
          );
        }
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
    complete,
    startFootholds: startFootholds.map(idOf),
    riseBound: riseBound === Number.POSITIVE_INFINITY ? null : riseBound,
    footholds: reports,
    edges,
    stats: {
      nodes: search.nodes.length,
      edges: search.edges.length,
      macros: search.macros,
      steps: budget.steps - stepsBefore,
      timeouts: search.timeouts,
      replaysVerified,
      returnSearches,
    },
  };
}

/**
 * Reachability of one room, one character at a time (ADR-0015). For each party member it lists
 * every foothold, whether a path to it was found, a replay that proves each path, whether the
 * character can get back to where it started, and the footholds proven to be out of reach.
 *
 * Sound, not complete: "reached" and "can return" always come with a replay that was run and
 * checked; "proven" holds for every input sequence. Anything else means "not found within the
 * macros and limits", not that it cannot be done.
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
