import { describe, expect, it } from 'vitest';
import { CONTACT_GROUNDED } from '../collision/move';
import { mul } from '../fx/fx';
import type { FeelProfile } from '../runtime/feel';
import { MODERN, RETRO } from '../test-support';
import { newControllerState, newWorld, type World } from '../world/world';
import { controllerStep } from './controller';
import type { Intent } from './intent';

const IDLE: Intent = {
  moveDir: 0,
  jumpPressed: false,
  jumpHeld: false,
  downHeld: false,
  switchRequested: false,
  attackPressed: false,
  upPressed: false,
};

/** A world with one airborne (or grounded) entity, at tick 10. */
function worldWith(vx: number, vy: number, grounded = false): World {
  const world = newWorld({ seed: 1, roomId: 'room' });
  world.tick = 10;
  world.controller = newControllerState('test');
  world.party.entityId = world.entities.create({
    x: 0,
    y: 0,
    vx,
    vy,
    collider: { w: 256, h: 256, ox: -128, oy: -256 },
  });
  world.entities.contact[0] = grounded ? CONTACT_GROUNDED : 0;
  return world;
}

function vyAfter(feel: FeelProfile, vy: number): number {
  const world = worldWith(0, vy);
  controllerStep(world, IDLE, feel);
  return world.entities.vy[0] as number;
}

describe('controller: gravity rules (derived from the profile)', () => {
  it('uses apexGravityScale while |vy| < apexThreshold', () => {
    const near = MODERN.apexThreshold - 1;
    expect(vyAfter(MODERN, -near)).toBe(-near + mul(MODERN.gravity, MODERN.apexGravityScale));
    expect(vyAfter(MODERN, near)).toBe(near + mul(MODERN.gravity, MODERN.apexGravityScale));
  });

  it('uses fallGravityScale when falling faster than the apex threshold', () => {
    const v = MODERN.apexThreshold + 10;
    expect(vyAfter(MODERN, v)).toBe(v + mul(MODERN.gravity, MODERN.fallGravityScale));
  });

  it('uses plain gravity while rising faster than the apex threshold', () => {
    const v = -(MODERN.apexThreshold + 10);
    expect(vyAfter(MODERN, v)).toBe(v + MODERN.gravity);
  });

  it('clamps to maxFallSpeed', () => {
    expect(vyAfter(RETRO, RETRO.maxFallSpeed)).toBe(RETRO.maxFallSpeed);
    expect(vyAfter(MODERN, MODERN.maxFallSpeed - 1)).toBe(MODERN.maxFallSpeed);
  });
});

describe('controller: horizontal rules', () => {
  const vxAfter = (feel: FeelProfile, vx: number, moveDir: number, grounded: boolean) => {
    const world = worldWith(vx, 0, grounded);
    controllerStep(world, { ...IDLE, moveDir }, feel);
    return world.entities.vx[0] as number;
  };

  it('retro turns around at full speed in one tick (immediate rates)', () => {
    expect(vxAfter(RETRO, -RETRO.runSpeed, 1, true)).toBe(RETRO.runSpeed);
    expect(vxAfter(RETRO, RETRO.runSpeed, 0, true)).toBe(0);
  });

  it('modern decelerates by turnDecel when reversing', () => {
    expect(vxAfter(MODERN, -MODERN.runSpeed, 1, true)).toBe(-MODERN.runSpeed + MODERN.turnDecel);
  });

  it('keeps the take-off speed in the air with airControl 0', () => {
    expect(vxAfter(RETRO, RETRO.runSpeed, -1, false)).toBe(RETRO.runSpeed);
  });

  it('scales air acceleration by airControl', () => {
    const half: FeelProfile = { ...MODERN, airControl: 128 };
    expect(vxAfter(half, 0, 1, false)).toBe(mul(MODERN.airAccel, 128));
  });
});

describe('controller: variable jump', () => {
  it('cuts the rising speed once after minJumpTicks when jump is released', () => {
    const world = worldWith(0, -MODERN.jumpVelocity);
    world.controller.jumpStartTick = world.tick - MODERN.minJumpTicks;
    world.controller.jumpedSinceGrounded = true;
    controllerStep(world, IDLE, MODERN);
    const cut = mul(-MODERN.jumpVelocity, MODERN.jumpCutScale);
    expect(world.entities.vy[0]).toBe(cut + MODERN.gravity);
    expect(world.controller.jumpCut).toBe(true);
  });

  it('does not cut before minJumpTicks', () => {
    const world = worldWith(0, -MODERN.jumpVelocity);
    world.controller.jumpStartTick = world.tick - MODERN.minJumpTicks + 1;
    controllerStep(world, IDLE, MODERN);
    expect(world.entities.vy[0]).toBe(-MODERN.jumpVelocity + MODERN.gravity);
  });
});
