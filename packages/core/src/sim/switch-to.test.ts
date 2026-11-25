// Switching to a chosen member from the menu (ADR-0020): a command in the input frame, with the
// same rules as the switch button. Values come from the fixture's rules, not fixed numbers.
import { describe, expect, it } from 'vitest';
import { hashWorld } from '../hash/hash';
import { EMPTY_FRAME, type InputFrame, switchTarget, switchToCommand } from '../input/frame';
import { Player, Recorder, runReplayHeadless } from '../replay/replay';
import { script } from '../replay/script';
import type { PackRuntime, PartyRules } from '../runtime/pack';
import { GameSession, type InputSource } from '../session/session';
import { boxRoom, simRuntime, WALKER } from '../test-support';
import type { World } from '../world/world';
import { switchCheck } from './party';
import { createWorld, step } from './sim';

const MEMBERS = ['walker', 'swimmer', 'third'];

function runtimeWith(rules: Partial<PartyRules['switch']> = {}): PackRuntime {
  const base = simRuntime({
    rows: boxRoom(20, 10),
    spawn: [4, 8],
    members: MEMBERS,
    switchRules: rules,
  });
  return { ...base, characters: { ...base.characters, third: { ...WALKER, id: 'third' } } };
}

const start = { roomId: 'room', spawnId: 'start', seed: 3, feelProfile: 'modern' } as const;
const run = (world: World, runtime: PackRuntime, frames: readonly InputFrame[]) => {
  for (const frame of frames) step(world, frame, runtime);
};
const settled = (runtime: PackRuntime): World => {
  const world = createWorld(runtime, start);
  run(world, runtime, script().wait(5).build(5));
  return world;
};
const command = (index: number): InputFrame => ({
  ...EMPTY_FRAME,
  command: switchToCommand(index),
});

describe('switch-to command (ADR-0020)', () => {
  it('encodes the member index, and nothing else counts as a switch-to', () => {
    expect(switchTarget(switchToCommand(2))).toBe(2);
    expect(switchTarget(undefined)).toBeUndefined();
    expect(switchTarget(0)).toBeUndefined();
    expect(switchTarget((2 << 8) | 1)).toBeUndefined();
    expect(() => switchToCommand(256)).toThrow(RangeError);
  });

  it('switches straight to the chosen member, not the next one', () => {
    const runtime = runtimeWith();
    const world = settled(runtime);
    expect(switchCheck(world, runtime, 2)).toBe('ok');
    run(world, runtime, [command(2)]);
    expect(world.party.activeIndex).toBe(2);
    expect(world.party.cooldownTicks).toBeGreaterThan(0);
  });

  it('gives the reason it cannot switch, and then the command does nothing', () => {
    const cooldown = runtimeWith().rules.party.switch.cooldownTicks;
    // The active member.
    let runtime = runtimeWith();
    let world = settled(runtime);
    expect(switchCheck(world, runtime, 0)).toBe('active');
    // Right after a switch: the cooldown, until it has run out.
    run(world, runtime, [command(1)]);
    expect(switchCheck(world, runtime, 2)).toBe('cooldown');
    run(world, runtime, [command(2)]);
    expect(world.party.activeIndex).toBe(1);
    run(world, runtime, script().build(cooldown));
    expect(switchCheck(world, runtime, 2)).toBe('ok');
    // In the air when the rules want the ground.
    runtime = runtimeWith({ requireGrounded: true });
    world = settled(runtime);
    run(world, runtime, script().tap('jump').wait(4).build());
    expect(switchCheck(world, runtime, 1)).toBe('airborne');
    run(world, runtime, [command(1)]);
    expect(world.party.activeIndex).toBe(0);
    // A member who is down (HP 0).
    runtime = runtimeWith();
    world = settled(runtime);
    world.party.hp = [5, 0, 5];
    expect(switchCheck(world, runtime, 1)).toBe('down');
    // No switching in this pack, or no such member.
    runtime = runtimeWith({ mode: 'never' });
    world = settled(runtime);
    expect(switchCheck(world, runtime, 1)).toBe('never');
    run(world, runtime, [command(1)]);
    expect(world.party.activeIndex).toBe(0);
    expect(switchCheck(settled(runtimeWith()), runtimeWith(), 3)).toBe('never');
  });

  it('wins over the switch button in the same tick', () => {
    const runtime = runtimeWith();
    const world = settled(runtime);
    const [pressed] = script().tap('switch').build(1);
    run(world, runtime, [{ ...(pressed as InputFrame), command: switchToCommand(2) }]);
    expect(world.party.activeIndex).toBe(2);
  });

  it('records the command in the replay, and the replay gives the same hashes', () => {
    const runtime = runtimeWith();
    const frames: InputFrame[] = [
      ...script().hold('right', 10).build(10),
      command(2),
      ...script().hold('left', 10).build(11),
    ];
    const recorder = new Recorder();
    const world = createWorld(runtime, start);
    const hashes = frames.map((frame) => {
      recorder.push(frame);
      step(world, frame, runtime);
      return hashWorld(world);
    });
    const file = recorder.toFile(runtime, start);
    expect(file.version).toBe(2);
    // Only the run with the command carries a fifth value.
    expect(file.frames.filter((f) => f.length === 5)).toEqual([[1, 0, 0, 0, switchToCommand(2)]]);
    const player = new Player(file.frames);
    expect(frames.map(() => player.next().command ?? 0)).toEqual(frames.map((f) => f.command ?? 0));
    const replayed = runReplayHeadless(file, runtime, { checkpointEvery: 1 });
    expect(replayed.checkpoints.map((c) => c.hash)).toEqual(hashes);
    expect(world.party.activeIndex).toBe(2);
  });

  it('reads a version 1 replay as one without commands', () => {
    const runtime = runtimeWith();
    const frames = script().hold('right', 8).tap('switch', { at: 3 }).build(10);
    const recorder = new Recorder();
    for (const frame of frames) recorder.push(frame);
    const v2 = recorder.toFile(runtime, start);
    const v1 = { ...v2, version: 1 as const };
    expect(runReplayHeadless(v1, runtime).hash).toEqual(runReplayHeadless(v2, runtime).hash);
  });
});

describe('GameSession.queueCommand (ADR-0020)', () => {
  const idle: InputSource = { nextFrame: () => EMPTY_FRAME };

  it('sends the command with the next tick only, and records it', () => {
    const runtime = runtimeWith();
    const session = new GameSession(runtime, start, idle);
    session.frame(1000 / 60);
    expect(session.switchCheck(1)).toBe('ok');
    session.queueCommand(switchToCommand(1));
    // No time passes while the menu is open: nothing is sent yet.
    session.frame(0);
    expect(session.recording().frames.some((f) => f.length === 5)).toBe(false);
    session.frame(1000 / 60);
    session.frame(1000 / 60);
    const commands = session.recording().frames.filter((f) => f.length === 5);
    expect(commands).toEqual([[1, 0, 0, 0, switchToCommand(1)]]);
    expect(session.uiState.activeCharacterId).toBe('swimmer');
    expect(session.switchCheck(1)).toBe('active');
  });
});
