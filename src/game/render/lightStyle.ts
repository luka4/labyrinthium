import type { FixtureKind, ItemKind } from '../core/lights';

/**
 * How each light looks: colour, tint strength and flicker. Render only; the core knows
 * nothing about colours and never reads these numbers.
 */
export type LightKind = ItemKind | FixtureKind;

export type LightStyle = {
  color: string;
  /** strength of the coloured tint on the lit floor */
  tint: number;
  /** flicker amplitude 0..1 and its three frequencies in Hz */
  amp: number;
  hz: readonly [number, number, number];
  /** flame height in tiles */
  flame: number;
};

export const LIGHT_STYLE: Record<LightKind | 'daylight', LightStyle> = {
  smallTorch: { color: '#ff8a2a', tint: 0.36, amp: 0.1, hz: [7.1, 11.3, 17.9], flame: 0.34 },
  torch: { color: '#ff9a3a', tint: 0.34, amp: 0.07, hz: [5.3, 8.9, 13.7], flame: 0.4 },
  bigTorch: { color: '#ffa040', tint: 0.32, amp: 0.05, hz: [3.1, 5.9, 9.3], flame: 0.5 },
  lamp: { color: '#ffc070', tint: 0.3, amp: 0.02, hz: [1.1, 2.3, 3.1], flame: 0.18 },
  candle: { color: '#ffd08a', tint: 0.28, amp: 0.035, hz: [2.7, 4.1, 6.3], flame: 0.2 },
  oilJar: { color: '#ffc070', tint: 0.3, amp: 0, hz: [1, 1, 1], flame: 0 },
  sconce: { color: '#ff9a3a', tint: 0.32, amp: 0.06, hz: [5.0, 8.3, 12.7], flame: 0.4 },
  brazier: { color: '#ff7a30', tint: 0.34, amp: 0.04, hz: [1.7, 3.3, 5.1], flame: 0.5 },
  shrineCandles: { color: '#ffc878', tint: 0.26, amp: 0.025, hz: [1.9, 3.1, 4.9], flame: 0.22 },
  /** daylight falling down the escape shaft (plan 04): cool and nearly steady */
  daylight: { color: '#cfd8e6', tint: 0.35, amp: 0.02, hz: [0.6, 1.3, 2.1], flame: 0 },
};

/** The dying coal of an empty hand. */
export const EMBER_STYLE: LightStyle = { color: '#c0401a', tint: 0.3, amp: 0.15, hz: [0.8, 1.7, 2.9], flame: 0.1 };

const TAU = Math.PI * 2;

/** Brightness multiplier around 1: a slow wave, a faster one and a fast crackle. */
export function flicker(style: LightStyle, timeS: number, phase = 0): number {
  const [a, b, c] = style.hz;
  return 1 + style.amp * (0.6 * Math.sin(TAU * a * timeS + phase) + 0.3 * Math.sin(TAU * b * timeS + 2 * phase) + 0.1 * Math.sin(TAU * c * timeS));
}
