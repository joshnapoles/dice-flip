/**
 * spinMath.ts — Pure, deterministic math for dice-spin animations.
 *
 * No DOM.  No React.  No requestAnimationFrame.
 * Given the same inputs, every device computes the same angle at every instant.
 *
 * Designed for multiplayer where network lag is a factor:
 *   1. The roller creates a SettlePlan on release and broadcasts it.
 *   2. Spectators call settleAngle(plan, elapsed) each frame.
 *   3. Late-joining spectators compute progress from the elapsed time — no
 *      frame-by-frame simulation needed.
 */

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  Easing
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Variable-exponent ease-out: `1 - (1 - t)^n`.
 *
 * The exponent `n` controls how aggressively the curve decelerates.
 * Crucially, the derivative at t = 0 equals `n`, which lets us match any
 * incoming velocity for a seamless spin → settle transition.
 *
 * n = 1  → linear (no easing)
 * n = 2  → ease-out quadratic
 * n = 3  → ease-out cubic
 * n > 3  → increasingly aggressive deceleration
 */
export function easeOut(t: number, n: number = 3): number {
  return 1 - (1 - t) ** n
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  Spin phase (open-ended, local-only — NOT synced across devices)
 * ═══════════════════════════════════════════════════════════════════════════ */

const RAMP_MS = 400   // ms to reach max spin velocity
const MAX_VEL = 0.35  // deg/ms at full speed (≈ 1 rev/s)

/**
 * Compute the dice angle during the free-spin (pressing) phase.
 *
 * Uses a smooth quadratic ramp-up to max velocity, then constant speed.
 * This phase is purely cosmetic and local — it does not need to match
 * across devices.
 *
 * @param base       Angle (deg) when the spin started.
 * @param elapsedMs  Milliseconds since the press began.
 */
export function spinAngle(base: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return base

  if (elapsedMs <= RAMP_MS) {
    // Quadratic ramp: ∫(MAX_VEL · t/RAMP_MS) dt = MAX_VEL · t² / (2·RAMP_MS)
    return base + MAX_VEL * elapsedMs * elapsedMs / (2 * RAMP_MS)
  }

  // Past ramp → constant velocity
  const rampDeg = MAX_VEL * RAMP_MS / 2
  return base + rampDeg + MAX_VEL * (elapsedMs - RAMP_MS)
}

/**
 * Instantaneous spin velocity (deg/ms) at a given elapsed time.
 * Used internally to ensure velocity continuity at the spin → settle boundary.
 */
export function spinVelocity(elapsedMs: number): number {
  if (elapsedMs <= 0) return 0
  if (elapsedMs <= RAMP_MS) return MAX_VEL * elapsedMs / RAMP_MS
  return MAX_VEL
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  Settle plan — the synced, deterministic part
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A SettlePlan fully describes the deceleration animation after release.
 *
 * It is **deterministic**: the same plan produces the same angle on every
 * device at every point in time.
 *
 * For network sync, broadcast `{ targetValue, durationMs }` and let each
 * client create a local plan anchored to its own `currentAngle`.
 */
export interface SettlePlan {
  /** Angle (deg) when deceleration began. */
  startAngle: number
  /** Final resting angle (deg). Always a multiple of 360 (front face forward). */
  endAngle: number
  /** Total settle duration in ms. */
  durationMs: number
  /** Face value (1–6) shown when landed. */
  targetValue: number
  /**
   * Ease-out exponent for `1 - (1-t)^n`.
   * Computed automatically to match the spin velocity at release, ensuring
   * a seamless transition with no speed-up or discontinuity.
   */
  easePower: number
}

const MIN_SETTLE_MS  = 800
const MAX_SETTLE_MS  = 4500
const MIN_EXTRA_ROTS = 1
const MAX_EXTRA_ROTS = 2
const EASE_TARGET    = 1.5   // desired ease-out power for natural deceleration

/**
 * Build a settle plan from release parameters.
 *
 * Duration is derived from the spin velocity so the settle curve starts
 * at exactly the same speed the dice was spinning — no speed-up or
 * discontinuity.  The dice keeps its 3D flipping and gradually decelerates.
 *
 * @param currentAngle  Angle (deg) at the moment of release.
 * @param holdMs        How long the user held (0 – ∞ ms).  Clamped internally.
 * @param targetValue   Result to land on (1–6).  Random if omitted.
 */
export function createSettlePlan(
  currentAngle: number,
  holdMs: number,
  targetValue?: number,
): SettlePlan {
  const value     = targetValue ?? (Math.floor(Math.random() * 6) + 1)
  const v0        = spinVelocity(holdMs)
  const t         = Math.min(holdMs / 2000, 1)                       // hold factor 0–1
  const extraRots  = MIN_EXTRA_ROTS + t * (MAX_EXTRA_ROTS - MIN_EXTRA_ROTS)

  // endAngle = next multiple of 360 past (currentAngle + extra rotations).
  // A multiple of 360 means the front face is forward → shows targetValue.
  const minEnd   = currentAngle + extraRots * 360
  const endAngle = Math.ceil(minEnd / 360) * 360
  const sweep    = endAngle - currentAngle

  // Duration computed from velocity + desired ease power.
  // For ease-out 1-(1-t)^n, derivative at t=0 is n, so:
  //   initial velocity = n × sweep / duration
  //   duration = n × sweep / v0
  // This ensures the settle starts at exactly the spin velocity.
  // Duration is clamped; ease power adjusts if the clamp activates.
  const naturalMs  = v0 > 0.01 ? EASE_TARGET * sweep / v0 : 1500
  const durationMs = Math.max(MIN_SETTLE_MS, Math.min(MAX_SETTLE_MS, naturalMs))

  const easePower = v0 > 0.01
    ? Math.min(5, Math.max(1.0, v0 * durationMs / sweep))
    : EASE_TARGET

  return { startAngle: currentAngle, endAngle, durationMs, targetValue: value, easePower }
}

/**
 * Compute the angle at a given elapsed time during the settle phase.
 *
 * Uses a variable-exponent ease-out curve whose initial velocity matches
 * the spin phase — no speed discontinuity at the transition.
 * Fully deterministic — no per-frame accumulation.
 *
 * @param plan       The settle plan.
 * @param elapsedMs  Milliseconds since settle began.
 */
export function settleAngle(plan: SettlePlan, elapsedMs: number): number {
  if (elapsedMs <= 0) return plan.startAngle
  if (elapsedMs >= plan.durationMs) return plan.endAngle

  const p = easeOut(elapsedMs / plan.durationMs, plan.easePower)
  return plan.startAngle + (plan.endAngle - plan.startAngle) * p
}

/**
 * Half-rotation index used for face-swap timing.
 * Increments each time the dice passes a 180° boundary.
 */
export function halfRotation(angle: number): number {
  return Math.floor((angle + 90) / 180)
}
