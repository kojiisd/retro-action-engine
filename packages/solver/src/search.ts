import {
  type CharacterDef,
  type CollisionGrid,
  cloneWorld,
  type FeelProfile,
  type PackRuntime,
  type World,
} from '@retro-action-engine/core';
import { type FootholdIndex, standingOn } from './footholds';
import {
  type Budget,
  edgeMacros,
  isGrounded,
  type Macro,
  runMacro,
  type Sim,
  vxOf,
  xOf,
  yOf,
} from './macros';
import type { MacroKind } from './types';

/** What one party member does in the search: its feel and the macros tried for it. */
export interface MemberPlan {
  readonly character: CharacterDef;
  /** The active feel profile with the character's overrides. */
  readonly feel: FeelProfile;
  readonly holds: readonly number[];
  readonly ground: readonly Macro[];
}

/** Everything the search needs to know about the party (one member or more) in one room. */
export interface SearchContext {
  readonly runtime: PackRuntime;
  readonly grid: CollisionGrid;
  /** Footholds of every member. */
  readonly footholds: FootholdIndex;
  /** One plan per party member, in party order (index = `world.party.activeIndex`). */
  readonly members: readonly MemberPlan[];
  readonly xQuantum: number;
  readonly vQuantum: number;
  readonly maxMacroTicks: number;
  readonly maxNodes: number;
}

/** A landing state. `world` is exact; the key only decides which states share a node. */
export interface SearchNode {
  readonly id: number;
  readonly world: World;
  /** Buttons held on the last tick, so the next macro produces correct press edges. */
  readonly held: number;
  readonly parent: number;
  /** Held masks of the ticks that lead here from the parent (from the start for the root). */
  readonly helds: readonly number[];
  readonly depth: number;
  readonly footholds: readonly number[];
}

export interface SearchEdge {
  readonly from: number;
  readonly to: number;
  readonly kind: MacroKind;
  /** Footholds the macro actually landed on (the target node may be a merged neighbour). */
  readonly landedOn: readonly number[];
}

/** The first landing that satisfied the goal of a search. */
export interface GoalHit {
  /** Held masks of every tick from the start of this search to the landing. */
  readonly helds: number[];
  /** The exact state at the landing. */
  readonly world: World;
  readonly footholds: readonly number[];
  readonly depth: number;
}

export interface SearchResult {
  readonly nodes: SearchNode[];
  readonly edges: SearchEdge[];
  /** False when a limit stopped the search before the frontier was empty. */
  readonly complete: boolean;
  readonly macros: number;
  readonly timeouts: number;
  /** Set when a goal was given and a landing satisfied it; the search stopped there. */
  readonly goal?: GoalHit;
}

export interface SearchStart {
  readonly world: World;
  /** Buttons held on the tick before `world`. */
  readonly held: number;
  /** Stop at the first landing on footholds for which this is true. */
  readonly goal?: (footholds: readonly number[]) => boolean;
}

/** floor(a / b), exact for these integer ranges. */
const bucket = (value: number, quantum: number) => Math.floor(value / quantum);

function keyOf(context: SearchContext, world: World): string {
  // Velocity buckets are symmetric around 0, so that left and right merge alike.
  const vx = vxOf(world);
  const vBucket = Math.sign(vx) * Math.floor(Math.abs(vx) / context.vQuantum);
  // Who is active, and whether a switch is still cooling down, change what can happen next.
  const party = `${world.party.activeIndex}|${world.party.cooldownTicks > 0 ? 1 : 0}`;
  return `${party}|${yOf(world)}|${bucket(xOf(world), context.xQuantum)}|${vBucket}`;
}

const planOf = (context: SearchContext, world: World): MemberPlan =>
  context.members[world.party.activeIndex] as MemberPlan;

/** Footholds the active member stands on. */
const footholdsOf = (context: SearchContext, world: World): number[] =>
  standingOn(context.grid, context.footholds, world, planOf(context, world).character);

/**
 * Breadth-first search over landing states (ADR-0015). Each edge is a macro run with the real
 * `step` on a copy of the node's exact world. States with the same key are explored once: that
 * skips work but never invents a path, because nothing is simulated from a merged state.
 */
export function explore(context: SearchContext, from: SearchStart, budget: Budget): SearchResult {
  const start = from.world;
  const bucketOf = (x: number) => bucket(x, context.xQuantum);

  const nodes: SearchNode[] = [];
  const edges: SearchEdge[] = [];
  const byKey = new Map<string, number>();
  let macros = 0;
  let timeouts = 0;
  let complete = true;
  let goal: GoalHit | undefined;

  const newSim = (world: World, held: number): Sim => ({
    world: cloneWorld(world),
    runtime: context.runtime,
    held,
    helds: [],
    budget,
    maxTicks: context.maxMacroTicks,
  });

  const addNode = (sim: Sim, parent: number, depth: number): number => {
    const key = keyOf(context, sim.world);
    const existing = byKey.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const id = nodes.length;
    nodes.push({
      id,
      world: sim.world,
      held: sim.held,
      parent,
      helds: sim.helds,
      depth,
      footholds: footholdsOf(context, sim.world),
    });
    byKey.set(key, id);
    return id;
  };

  // The root is the first landing: a spawn in the air falls first.
  const root = newSim(start, from.held);
  if (!isGrounded(root.world)) {
    const outcome = runMacro(root, { kind: 'stop' }, bucketOf);
    if (outcome.status !== 'landed') {
      return { nodes, edges, complete: false, macros: 1, timeouts: 0 };
    }
  }
  addNode(root, -1, 0);
  const rootFootholds = (nodes[0] as SearchNode).footholds;
  if (from.goal?.(rootFootholds) === true) {
    goal = { helds: [...root.helds], world: root.world, footholds: rootFootholds, depth: 0 };
    return { nodes, edges, complete: true, macros, timeouts, goal };
  }

  /** Returns false when the search has to stop. */
  const tryMacro = (node: SearchNode, macro: Macro): { go: boolean; leftGround: boolean } => {
    const sim = newSim(node.world, node.held);
    const outcome = runMacro(sim, macro, bucketOf);
    macros++;
    if (outcome.status === 'budget') {
      return { go: false, leftGround: false };
    }
    if (outcome.status === 'timeout') {
      timeouts++;
    }
    if (outcome.status !== 'landed') {
      return { go: true, leftGround: false };
    }
    const landedOn = footholdsOf(context, sim.world);
    const to = addNode(sim, node.id, node.depth + 1);
    edges.push({ from: node.id, to, kind: macro.kind, landedOn });
    if (from.goal?.(landedOn) === true) {
      // The landing itself is exact (the macro ran from the node's exact state), even when its
      // key merged it with an older node.
      goal = {
        helds: [...pathHelds(nodes, node.id), ...sim.helds],
        world: sim.world,
        footholds: landedOn,
        depth: node.depth + 1,
      };
      return { go: false, leftGround: false };
    }
    return { go: true, leftGround: outcome.leftGround };
  };

  for (let next = 0; next < nodes.length; next++) {
    if (nodes.length >= context.maxNodes) {
      complete = false;
      break;
    }
    const node = nodes[next] as SearchNode;
    const plan = planOf(context, node.world);
    let stopped = false;
    for (const macro of plan.ground) {
      const { go, leftGround } = tryMacro(node, macro);
      if (!go) {
        stopped = true;
        break;
      }
      // Only a walk that reached an edge opens the edge macros (other falls, coyote jumps).
      if (macro.kind === 'walk' && leftGround) {
        for (const extra of edgeMacros(plan.feel, plan.holds, macro.dir)) {
          if (!tryMacro(node, extra).go) {
            stopped = true;
            break;
          }
        }
      }
      if (stopped) break;
    }
    if (stopped) {
      complete = goal !== undefined;
      break;
    }
  }

  return goal === undefined
    ? { nodes, edges, complete, macros, timeouts }
    : { nodes, edges, complete, macros, timeouts, goal };
}

/** Held masks of every tick from the start state to the node. */
export function pathHelds(nodes: readonly SearchNode[], id: number): number[] {
  const chain: SearchNode[] = [];
  for (let at = id; at >= 0; at = (nodes[at] as SearchNode).parent) {
    chain.push(nodes[at] as SearchNode);
  }
  const helds: number[] = [];
  for (const node of chain.reverse()) {
    for (const held of node.helds) {
      helds.push(held);
    }
  }
  return helds;
}
