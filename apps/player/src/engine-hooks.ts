import type { GameSession, ReplayFile, UiState, WorldHash } from '@retro-action-engine/core';

declare global {
  interface Window {
    /** Test hooks; present only in dev and e2e builds. */
    __engine?: EngineHooks;
  }
}

export interface TickHash {
  readonly tick: number;
  readonly hash: WorldHash;
}

export interface ReplayResult {
  /** The hash after every tick, in order. */
  readonly ticks: readonly TickHash[];
  readonly final: TickHash;
}

export interface EngineStats {
  readonly tick: number;
  readonly resyncCount: number;
  readonly droppedFrames: number;
  readonly replaying: boolean;
  readonly feelProfile: string;
  /** The active character and every member's HP (ADR-0016; empty without HP). */
  readonly activeCharacter: string;
  readonly party: UiState['party'];
}

/** `window.__engine` (docs/input-and-feel.md 12). Only in dev and e2e builds. */
export interface EngineHooks {
  hash(): WorldHash;
  /**
   * Plays `file` in the running game, through the real frame loop and renderer, and resolves
   * with the hash of every tick once it ends. Live input is ignored until `restart`.
   */
  runReplay(file: ReplayFile): Promise<ReplayResult>;
  getStats(): EngineStats;
  /** Starts over with another feel profile of the pack. */
  setFeelProfile(id: string): void;
  /** Starts over with live input. */
  restart(): void;
  /** The live input since the last start, as a replay (what the devices produced). */
  recording(): ReplayFile;
}

export interface HookTargets {
  readonly session: GameSession;
  readonly feelProfiles: readonly string[];
  readonly resyncCount: () => number;
}

export function createEngineHooks({
  session,
  feelProfiles,
  resyncCount,
}: HookTargets): EngineHooks {
  let pending: { reject: (error: Error) => void } | undefined;

  const cancelPending = (reason: string) => {
    session.observeTicks(undefined);
    pending?.reject(new Error(reason));
    pending = undefined;
  };

  return {
    hash: () => session.hash(),

    runReplay(file) {
      cancelPending('replaced by another runReplay');
      return new Promise<ReplayResult>((resolve, reject) => {
        const ticks: TickHash[] = [];
        session.replay(file);
        pending = { reject };
        session.observeTicks((tick, hash) => {
          ticks.push({ tick, hash });
          if (session.replayDone) {
            session.observeTicks(undefined);
            pending = undefined;
            resolve({ ticks, final: { tick, hash } });
          }
        });
        if (session.replayDone) {
          // An empty replay has no ticks to wait for.
          session.observeTicks(undefined);
          pending = undefined;
          resolve({ ticks, final: { tick: session.tick, hash: session.hash() } });
        }
      });
    },

    getStats: () => ({
      tick: session.tick,
      resyncCount: resyncCount(),
      droppedFrames: session.droppedFrames,
      replaying: session.replaying,
      feelProfile: session.startState.feelProfile,
      activeCharacter: session.uiState.activeCharacterId,
      party: session.uiState.party,
    }),

    setFeelProfile(id) {
      if (!feelProfiles.includes(id)) {
        throw new RangeError(
          `feel profile "${id}" is not in the pack (${feelProfiles.join(', ')})`,
        );
      }
      cancelPending('the game was restarted');
      session.restart({ ...session.startState, feelProfile: id });
    },

    restart() {
      cancelPending('the game was restarted');
      session.restart();
    },

    recording: () => session.recording(),
  };
}
