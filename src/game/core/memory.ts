/**
 * Fading memory: you remember what you saw during your last MEMORY_STEPS moves.
 * The unit is one successful move (`trail`), so standing still never makes you forget.
 */
export const MEMORY_STEPS = 20;
/** Full memory for this many moves, then a smooth fade to nothing at MEMORY_STEPS. */
export const MEMORY_HOLD = 6;
export const MEMORY_SEEN = 0.12;
export const MEMORY_WALKED = 0.26;

/** 1 while fresh, smoothstep to 0 at MEMORY_STEPS. `age` may be fractional (continuous). */
export function memoryLevel(age: number): number {
  if (age <= MEMORY_HOLD) return 1;
  if (age >= MEMORY_STEPS) return 0;
  const t = (MEMORY_STEPS - age) / (MEMORY_STEPS - MEMORY_HOLD);
  return t * t * (3 - 2 * t);
}
