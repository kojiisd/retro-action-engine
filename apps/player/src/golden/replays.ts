import {
  type PackRuntime,
  Recorder,
  type ReplayFile,
  type StartState,
  script,
} from '@retro-action-engine/core';

/**
 * The representative replay of the sample pack (ADR-0012 Golden, Determinism (c)): walk, jump
 * onto a one-way floor, drop through it, switch to the swimmer, and cross the water column,
 * jumping over the step on the way. The same inputs are played with each feel profile.
 */
export function representativeInputs() {
  const s = script()
    .hold('right', 24)
    .press('jump', { at: 10, ticks: 12 })
    .wait(40)
    .hold('down', 12)
    .tap('jump', { at: 70 })
    .wait(40)
    .tap('switch')
    .wait(30)
    .hold('right', 240);
  for (let at = 140; at < 380; at += 32) s.press('jump', { at, ticks: 12 });
  return s.wait(30).build();
}

/** The replay file for one feel profile, starting at the pack's entry. */
export function representativeReplay(runtime: PackRuntime, feelProfile: string): ReplayFile {
  const entry = runtime.entry as { roomId: string; spawnId: string };
  const start: StartState = { ...entry, seed: 1, feelProfile };
  const recorder = new Recorder();
  for (const frame of representativeInputs()) recorder.push(frame);
  return recorder.toFile(runtime, start);
}
