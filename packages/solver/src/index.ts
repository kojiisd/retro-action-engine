export { type FootholdIndex, listFootholds, standingOn } from './footholds';
export { type Dir, jumpHolds, type Macro } from './macros';
export { measureRise, type Rise } from './probe';
export { solveRoom } from './solve';
export type {
  Foothold,
  FootholdReport,
  MacroKind,
  Scope,
  ScopeReport,
  SolveReport,
  SolverOptions,
  SolveStats,
} from './types';
export { replayFromHelds, verifyWitness, WitnessError } from './witness';
