import { CONTACT_GROUNDED, CONTACT_ONEWAY } from '../collision/move';
import { FX_ONE, type Fx, mul } from '../fx/fx';
import type { ActiveFeel, FeelProfile } from '../runtime/feel';
import { NEVER, type World } from '../world/world';
import type { Intent } from './intent';

/** Moves v toward target by at most rate (rate >= 0). Symmetric for negated inputs. */
function approach(v: Fx, target: Fx, rate: Fx): Fx {
  return v < target ? Math.min(v + rate, target) : Math.max(v - rate, target);
}

/**
 * The `controller` system for the active character (docs/input-and-feel.md 6, 8). Updates the
 * velocity only; the `movement` system moves the body afterwards. Ground state comes from the
 * contact flags of the previous tick's movement.
 *
 * Tick rules (t = world.tick):
 * - Coyote time: a jump is allowed while `(t - 1) - lastGroundedTick <= coyoteTicks`, unless the
 *   character already jumped since it last stood on the ground.
 * - Jump buffer: a press at tick p makes the character jump at the first tick t that allows a
 *   jump, if `t - p <= jumpBufferTicks`. With 0, only a press in the same tick counts.
 * - `down` + `jump` while standing only on oneway tiles drops through them for dropThroughTicks
 *   instead of jumping. On a full floor it is a normal jump.
 * - Velocity first, then position (8.3): gravity also applies on the take-off tick.
 * - In a medium with `swim` (ADR-0016), a jump needs no ground and no coyote time: each one is a
 *   stroke with the medium's `jumpVelocity`.
 */
export function controllerStep(world: World, intent: Intent, feel: FeelProfile | ActiveFeel): void {
  const swim = 'swim' in feel && feel.swim;
  const c = world.controller;
  const t = world.tick;
  const s = world.entities;
  const slot = s.slotOf(world.party.entityId);
  const contact = s.contact[slot] as number;
  const grounded = (contact & CONTACT_GROUNDED) !== 0;

  if (grounded) {
    const landed = c.lastGroundedTick !== t - 2 && t > 0;
    c.lastGroundedTick = t - 1;
    c.jumpedSinceGrounded = false;
    c.jumpStartTick = NEVER;
    if (landed && feel.landingLagTicks > 0) {
      c.landingLagUntilTick = t + feel.landingLagTicks;
    }
  }
  const locked = t < c.landingLagUntilTick;
  const moveDir = locked ? 0 : intent.moveDir;
  if (moveDir !== 0) {
    c.facing = moveDir;
  }

  // ---- Horizontal ----
  let vx = s.vx[slot] as number;
  const target = moveDir * feel.runSpeed;
  if (grounded) {
    if (moveDir === 0) {
      vx = approach(vx, 0, feel.groundDecel);
    } else {
      if (vx * moveDir < 0) {
        vx = approach(vx, 0, feel.turnDecel > 0 ? feel.turnDecel : feel.groundDecel);
      }
      if (vx * moveDir >= 0) {
        const overSpeed = Math.abs(vx) > feel.runSpeed;
        vx = approach(vx, target, overSpeed ? feel.groundDecel : feel.groundAccel);
      }
    }
  } else if (feel.airControl !== 0) {
    const rate = moveDir === 0 ? feel.airDecel : feel.airAccel;
    vx = approach(vx, target, mul(rate, feel.airControl));
  }

  // ---- Jump and drop-through ----
  let vy = s.vy[slot] as number;
  const onlyOneway = grounded && (contact & CONTACT_ONEWAY) !== 0;
  if (!locked && intent.jumpPressed && intent.downHeld && onlyOneway) {
    c.dropThroughUntilTick = t + feel.dropThroughTicks;
    c.jumpPressedTick = NEVER;
  } else if (!locked && t - c.jumpPressedTick <= feel.jumpBufferTicks) {
    const coyoteAge = t - 1 - c.lastGroundedTick;
    // In a medium with `swim`, every jump is a stroke, standing or not (ADR-0016).
    if (swim || (!c.jumpedSinceGrounded && coyoteAge <= feel.coyoteTicks)) {
      vy = -feel.jumpVelocity;
      c.jumpedSinceGrounded = true;
      c.jumpStartTick = t;
      c.jumpCut = false;
      c.jumpPressedTick = NEVER;
    }
  }

  // ---- Variable jump ----
  if (
    c.jumpStartTick !== NEVER &&
    !c.jumpCut &&
    !intent.jumpHeld &&
    vy < 0 &&
    t - c.jumpStartTick >= feel.minJumpTicks &&
    feel.jumpCutScale < FX_ONE
  ) {
    vy = mul(vy, feel.jumpCutScale);
    c.jumpCut = true;
  }

  // ---- Gravity ----
  let g = feel.gravity;
  if (Math.abs(vy) < feel.apexThreshold) {
    g = mul(g, feel.apexGravityScale);
  } else if (vy > 0) {
    g = mul(g, feel.fallGravityScale);
  }
  vy = Math.min(vy + g, feel.maxFallSpeed);

  s.vx[slot] = vx;
  s.vy[slot] = vy;
}
