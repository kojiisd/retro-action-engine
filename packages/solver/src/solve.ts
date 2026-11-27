import {
  activeCharacter,
  type CharacterDef,
  type CollisionGrid,
  canSwitch,
  closedCells,
  createWorld,
  effectiveTags,
  FX_ONE,
  type Fx,
  type PackRuntime,
  resolveFeel,
  roomGrid,
  type StartState,
  type World,
} from '@retro-action-engine/core';
import { FootholdIndex, mergeFootholds } from './footholds';
import { type Budget, groundMacros, jumpHolds } from './macros';
import { measureHighestJump, measureRise, measureRiseBound } from './probe';
import { Proofs } from './proofs';
import { explore, type MemberPlan, pathHelds, type SearchContext, type SearchNode } from './search';
import type {
  EstimatedBlocker,
  Foothold,
  FootholdReport,
  MacroKind,
  ReturnReport,
  Scope,
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
  maxSteps: 50_000_000,
} as const;

const sameCollider = (a: CharacterDef, b: CharacterDef) =>
  a.collider.w === b.collider.w &&
  a.collider.h === b.collider.h &&
  a.collider.ox === b.collider.ox &&
  a.collider.oy === b.collider.oy;

/**
 * Which proofs the scope may use, and the rise bound for the height proofs (ADR-0015,
 * "パーティでの証明"). Anything the ADR cannot argue for is left out: no proof rather than a
 * wrong one.
 */
function proofRules(
  runtime: PackRuntime,
  roomId: string,
  members: readonly CharacterDef[],
  feelProfile: string,
  switching: boolean,
): { region: boolean; riseBound: Fx } {
  const bounds = members.map((member) => measureRiseBound(runtime, member, feelProfile));
  // ADR-0016: a medium can change the jump and allow strokes without ground, and a party that
  // goes down in an HP-draining tile comes back at the entry. Neither has a height bound.
  const room = runtime.rooms[roomId];
  const media = Object.keys(runtime.feel[feelProfile]?.media ?? {}).length > 0;
  const comesBack =
    runtime.rules.hp !== undefined &&
    (room?.tileClasses.some((c) => c.hazard !== undefined) ?? false);
  // ADR-0019: the macros do not climb, and a ladder lifts the feet without a jump.
  const ladderIds = new Set(room?.tileClasses.filter((c) => c.ladder === true).map((c) => c.id));
  const ladders = room?.collision.some((id) => ladderIds.has(id)) ?? false;
  const riseBound = media || comesBack || ladders ? Number.POSITIVE_INFINITY : Math.max(...bounds);
  // ADR-0021: a gimmick that opens widens what can be reached; the proofs assume fixed walls.
  const opens = room?.gimmicks?.some((g) => g.type === 'breakable' || g.type === 'gate') ?? false;
  if (opens) return { region: false, riseBound: Number.POSITIVE_INFINITY };
  if (!switching) {
    return { region: true, riseBound };
  }
  const first = members[0] as CharacterDef;
  const region = members.every((member) => sameCollider(member, first));
  const rules = runtime.rules.party.switch;
  const height = region && rules.requireGrounded && rules.placement === 'same';
  return { region, riseBound: height ? riseBound : Number.POSITIVE_INFINITY };
}

/** Search plans and footholds for the members, as `explore` needs them. */
function prepare(
  runtime: PackRuntime,
  members: readonly CharacterDef[],
  scopeStart: StartState,
  switching: boolean,
  options: SolverOptions,
  limits: SolveReport['limits'],
): { context: SearchContext; footholds: FootholdIndex; rise: Fx } {
  const grid = roomGrid(runtime, scopeStart.roomId);
  const profile = runtime.feel[scopeStart.feelProfile];
  if (profile === undefined) {
    throw new RangeError(`feel profile "${scopeStart.feelProfile}" is not defined`);
  }
  let highest = 0;
  const plans: MemberPlan[] = members.map((character) => {
    const feel = resolveFeel(profile, character.feelOverrides);
    const rise = measureRise(runtime, character, scopeStart.feelProfile);
    highest = Math.max(highest, rise.height);
    const best = measureHighestJump(runtime, character, scopeStart.feelProfile).hold;
    const holds = jumpHolds(feel, rise.ticks, limits.jumpHoldSamples, best);
    return { character, feel, holds, ground: groundMacros(feel, holds, switching) };
  });
  // Closed gimmicks stay closed: the macros do not swing, and pickups are taken out.
  const blocked = closedCells(createWorld(runtime, scopeStart), runtime);
  const footholds = new FootholdIndex(grid, members, blocked);
  const context: SearchContext = {
    runtime,
    grid,
    footholds,
    members: plans,
    xQuantum: limits.xQuantum,
    vQuantum:
      options.vQuantum ??
      Math.max(1, Math.min(...plans.map((plan) => Math.floor(plan.feel.runSpeed / 2)))),
    maxMacroTicks: limits.maxMacroTicks,
    maxNodes: limits.maxNodes,
  };
  return { context, footholds, rise: highest };
}

/** Ability tags the room's tiles ask for, in name order. */
function roomTags(grid: CollisionGrid): string[] {
  const tags = new Set<string>();
  const seen = new Set<number>();
  for (const id of grid.collision) {
    if (seen.has(id)) continue;
    seen.add(id);
    for (const tag of grid.classById[id]?.requiresAnyTag ?? []) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}

/** True when a foothold of the hypothetical search lies on the same row, over the same columns. */
const overlaps = (a: Foothold, b: Foothold) =>
  a.row === b.row && a.colFrom <= b.colTo && b.colFrom <= a.colTo;

/**
 * The estimates for unreached footholds that have no proof (ADR-0015, in the order given
 * there). Hypothetical searches use the shared step budget, but never change `complete`: the
 * real search is what it is.
 */
function estimator(
  runtime: PackRuntime,
  grid: CollisionGrid,
  members: readonly CharacterDef[],
  scopeStart: StartState,
  switching: boolean,
  options: SolverOptions,
  limits: SolveReport['limits'],
  budget: Budget,
  complete: boolean,
  reached: readonly Foothold[],
  rise: Fx,
): ((targets: readonly Foothold[]) => EstimatedBlocker[]) & { tagSearches: () => number } {
  let searches = 0;
  const estimate = (targets: readonly Foothold[]): EstimatedBlocker[] => {
    if (!complete) {
      return targets.map(() => ({ certainty: 'estimated', reason: 'budget' }));
    }
    const result: Array<EstimatedBlocker | undefined> = targets.map(() => undefined);

    // needsTag: the first tag (by name) that, given to everyone, lets the search get there.
    const missing = roomTags(grid).filter(
      (tag) => !members.every((member) => effectiveTags(member).has(tag)),
    );
    for (const tag of missing) {
      const open = result.flatMap((blocker, i) => (blocker === undefined ? [i] : []));
      if (open.length === 0) break;
      const tagged = members.map((member) =>
        effectiveTags(member).has(tag)
          ? member
          : { ...member, abilityTags: [...member.abilityTags, tag] },
      );
      const taggedRuntime: PackRuntime = {
        ...runtime,
        characters: {
          ...runtime.characters,
          ...Object.fromEntries(tagged.map((member) => [member.id, member])),
        },
      };
      // No filter by the open region: a target without a proof is not walled off, and a tag
      // only opens more cells, so it would never skip anything.
      const world = createWorld(taggedRuntime, scopeStart);
      const { context, footholds } = prepare(
        taggedRuntime,
        tagged,
        scopeStart,
        switching,
        options,
        limits,
      );
      searches++;
      const search = explore(context, { world, held: 0 }, budget);
      const stood = new Set<number>();
      for (const node of search.nodes) {
        for (const index of node.footholds) stood.add(index);
      }
      const standing = [...stood].map((index) => footholds.all[index] as Foothold);
      for (const i of open) {
        if (standing.some((foothold) => overlaps(foothold, targets[i] as Foothold))) {
          result[i] = { certainty: 'estimated', reason: 'needsTag', tag };
        }
      }
    }

    return result.map((blocker, i) => {
      if (blocker !== undefined) return blocker;
      const target = targets[i] as Foothold;
      // A search that landed nowhere is incomplete, so `budget` came first. Kept as a guard.
      if (reached.length === 0) {
        return { certainty: 'estimated', reason: 'unknown' };
      }
      // y grows downward. A reached foothold at the target's height or above gives 0 or less:
      // then height is not the problem.
      const riseNeeded =
        Math.min(...reached.map((foothold) => foothold.topPx - target.topPx)) * FX_ONE;
      return riseNeeded > rise
        ? { certainty: 'estimated', reason: 'tooHigh', riseNeeded, rise }
        : { certainty: 'estimated', reason: 'tooFar' };
    });
  };
  return Object.assign(estimate, { tagSearches: () => searches });
}

function solveScope(
  runtime: PackRuntime,
  scopeStart: StartState,
  scope: Scope,
  members: readonly CharacterDef[],
  options: SolverOptions,
  limits: SolveReport['limits'],
  budget: Budget,
): ScopeReport {
  const grid = roomGrid(runtime, scopeStart.roomId);
  const world = createWorld(runtime, scopeStart);
  const switching = scope.kind === 'party';
  const { context, footholds, rise } = prepare(
    runtime,
    members,
    scopeStart,
    switching,
    options,
    limits,
  );
  const { runs, runOf } = mergeFootholds(
    footholds,
    members.map((member) => member.id),
  );
  const runsOf = (indexes: readonly number[]) =>
    [...new Set(indexes.map((index) => runOf[index] as number))].sort((a, b) => a - b);

  const rules = proofRules(runtime, scopeStart.roomId, members, scopeStart.feelProfile, switching);
  const riseBound = rules.riseBound;
  const proofs = rules.region ? Proofs.of(grid, members, world, riseBound) : undefined;
  const activeAt = (state: World) => activeCharacter(state, runtime);

  const stepsBefore = budget.steps;
  const search = explore(context, { world, held: 0 }, budget);
  const startRuns = runsOf(search.nodes[0]?.footholds ?? []);
  const startRun = runs[startRuns[0] ?? -1];
  let complete = search.complete;
  let returnSearches = 0;

  // The first node found on a run is the one with the fewest macros (breadth-first).
  const firstNode = new Map<number, SearchNode>();
  for (const node of search.nodes) {
    for (const run of runsOf(node.footholds)) {
      if (!firstNode.has(run)) {
        firstNode.set(run, node);
      }
    }
  }

  let replaysVerified = 0;

  /**
   * The way back from the first state found on a run to the start run. "It can" is only said
   * with a replay of the whole trip that passed the gate.
   */
  const returnFrom = (run: Foothold, node: SearchNode, there: number[]): ReturnReport => {
    if (startRun !== undefined) {
      const proof = proofs?.cannotClimb(run, startRun);
      if (proof !== undefined) {
        return { status: 'provenNo', ...proof };
      }
    }
    if (startRuns.length === 0) {
      return { status: 'notFound' };
    }
    const isStart = (landedOn: readonly number[]) =>
      landedOn.some((index) => startRuns.includes(runOf[index] as number));
    const back = explore(context, { world: node.world, held: node.held, goal: isStart }, budget);
    if (back.macros > 0) {
      returnSearches++;
    }
    if (back.goal === undefined) {
      complete &&= back.complete;
      return { status: 'notFound' };
    }
    const target = back.goal.footholds.find((index) =>
      startRuns.includes(runOf[index] as number),
    ) as number;
    const end = back.goal.world;
    const replay = replayFromHelds(runtime, scopeStart, [...there, ...back.goal.helds]);
    verifyWitness(runtime, grid, footholds, activeAt(end), replay, target, end);
    replaysVerified++;
    return {
      status: 'verified',
      witness: { replay, ticks: end.tick, macros: node.depth + back.goal.depth },
    };
  };

  const unproven: number[] = [];
  const reports: FootholdReport[] = runs.map((run, index) => {
    const node = firstNode.get(index);
    const blocker = proofs?.unreachable(run);
    if (node === undefined) {
      if (blocker === undefined) {
        unproven.push(index);
        return { ...run, status: 'unreached' };
      }
      return { ...run, status: 'unreached', blocker };
    }
    const there = pathHelds(search.nodes, node.id);
    const replay = replayFromHelds(runtime, scopeStart, there);
    const target = node.footholds.find((f) => runOf[f] === index) as number;
    verifyWitness(runtime, grid, footholds, activeAt(node.world), replay, target, node.world);
    replaysVerified++;
    if (blocker !== undefined) {
      throw new ProofError(
        `foothold ${run.id} is reached by a verified replay, but "${blocker.reason}" claims it cannot be`,
      );
    }
    return {
      ...run,
      status: 'reached',
      witness: { replay, ticks: node.world.tick, macros: node.depth },
      return: returnFrom(run, node, there),
    };
  });

  // Estimates for what is neither reached nor proven out of reach. Proven runs keep their proof.
  let tagSearches = 0;
  if (unproven.length > 0) {
    const estimate = estimator(
      runtime,
      grid,
      members,
      scopeStart,
      switching,
      options,
      limits,
      budget,
      search.complete,
      runs.filter((_, index) => firstNode.has(index)),
      rise,
    );
    const estimates = estimate(unproven.map((index) => runs[index] as Foothold));
    tagSearches = estimate.tagSearches();
    unproven.forEach((index, i) => {
      reports[index] = { ...(reports[index] as FootholdReport), blocker: estimates[i] };
    });
  }

  // Foothold graph: which macro kinds were seen to lead from one run to another.
  const kindsByPair = new Map<string, Set<MacroKind>>();
  for (const edge of search.edges) {
    for (const from of runsOf((search.nodes[edge.from] as SearchNode).footholds)) {
      for (const to of runsOf(edge.landedOn)) {
        if (from === to) continue;
        // Every edge is a transition the simulation made from an exact state. A proof that
        // denies one of them is wrong.
        const fromRun = runs[from] as Foothold;
        const toRun = runs[to] as Foothold;
        if (proofs?.cannotClimb(fromRun, toRun) !== undefined) {
          throw new ProofError(
            `the simulation went from ${fromRun.id} to ${toRun.id}, against a proof`,
          );
        }
        const key = `${from}>${to}`;
        const kinds = kindsByPair.get(key) ?? new Set<MacroKind>();
        kinds.add(edge.kind);
        kindsByPair.set(key, kinds);
      }
    }
  }
  const idOf = (index: number) => (runs[index] as Foothold).id;
  const edges = [...kindsByPair.entries()]
    .map(([key, kinds]) => {
      const [from, to] = key.split('>').map(Number) as [number, number];
      return { from, to, kinds: [...kinds].sort() };
    })
    .sort((a, b) => a.from - b.from || a.to - b.to)
    .map((edge) => ({ from: idOf(edge.from), to: idOf(edge.to), kinds: edge.kinds }));

  const height = proofs !== undefined && riseBound !== Number.POSITIVE_INFINITY;
  return {
    scope,
    complete,
    startFootholds: startRuns.map(idOf),
    riseBound: height ? riseBound : null,
    proofs: { region: proofs !== undefined, height },
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
      tagSearches,
    },
  };
}

/**
 * Reachability of one room (ADR-0015): each party member alone, then the whole party with
 * switching when the party can switch. For each scope it lists every foothold, whether a path
 * to it was found, a replay that proves each path, whether the party can get back to where it
 * started, and the footholds proven to be out of reach.
 *
 * Sound, not complete: "reached" and "can return" always come with a replay that was run and
 * checked; "proven" holds for every input sequence. Anything else means "not found within the
 * macros and limits", not that it cannot be done.
 */
/**
 * The runtime with the solved room's exits, pickups and event zones taken out: the solver
 * explores one room with what the party has at the start; a path that leaves it through an exit,
 * or that needs an item or a flag, belongs to A-3 (ADR-0018, ADR-0021). Gimmicks that make walls
 * stay, closed.
 */
function withoutExits(runtime: PackRuntime, roomId: string): PackRuntime {
  const room = runtime.rooms[roomId];
  if (room === undefined) return runtime;
  const { zones: _zones, gimmicks, ...rest } = room;
  const walls = gimmicks?.filter((g) => g.type === 'breakable' || g.type === 'gate') ?? [];
  return {
    ...runtime,
    rooms: {
      ...runtime.rooms,
      [roomId]: { ...rest, exits: [], ...(walls.length === 0 ? {} : { gimmicks: walls }) },
    },
  };
}

export function solveRoom(
  packRuntime: PackRuntime,
  start: StartState,
  options: SolverOptions = {},
): SolveReport {
  const runtime = withoutExits(packRuntime, start.roomId);
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
  const members = memberIds.map((id) => {
    const character = runtime.characters[id];
    if (character === undefined) {
      throw new RangeError(`party member "${id}" is not a defined character`);
    }
    return character;
  });
  const scopes = members.map((character) =>
    solveScope(
      runtime,
      { ...start, party: [character.id] },
      { kind: 'character', characterId: character.id },
      [character],
      options,
      limits,
      budget,
    ),
  );
  // The party scope exists only when switching does: decided from the pack data.
  const partyStart: StartState = { ...start, party: memberIds };
  if (canSwitch(createWorld(runtime, partyStart), runtime)) {
    scopes.push(
      solveScope(
        runtime,
        partyStart,
        { kind: 'party', members: memberIds },
        members,
        options,
        limits,
        budget,
      ),
    );
  }

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
