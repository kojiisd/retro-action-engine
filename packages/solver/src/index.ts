export { type FootholdIndex, listFootholds, standingOn } from './footholds';
export { type Dir, jumpHolds, type Macro } from './macros';
export { measureRise, measureRiseBound, type Rise } from './probe';
export { ProofError, solveRoom } from './solve';
export type {
  Blocker,
  Foothold,
  FootholdReport,
  MacroKind,
  ProvenBlocker,
  ReturnReport,
  Scope,
  ScopeReport,
  SolveReport,
  SolverOptions,
  SolveStats,
  Witness,
} from './types';
export { replayFromHelds, verifyWitness, WitnessError } from './witness';
