/**
 * Light sources: gameplay numbers only (no colours; those live in render/lightStyle.ts).
 * Hand-carried sources burn by time; an oil jar refills the hand light. Fixtures
 * (sconces, braziers, shrine candles) are lit by the player's flame and burn on.
 */
export type CarryKind = 'smallTorch' | 'torch' | 'bigTorch' | 'lamp' | 'candle';
export type FixtureKind = 'sconce' | 'brazier' | 'shrineCandles';
export type ItemKind = CarryKind | 'oilJar';

export type LightSpec = {
  /** full burn time in seconds */
  seconds: number;
  /** radius in tiles at full and at the last moment */
  rMax: number;
  rMin: number;
  /** fraction of burn left below which the radius shrinks towards rMin (1 = linear from full) */
  knee: number;
  /** exponent of the light curve 1 - (d / (r + 0.5)) ^ falloff */
  falloff: number;
};

export const CARRY: Record<CarryKind, LightSpec> = {
  smallTorch: { seconds: 40, rMax: 4.2, rMin: 1.6, knee: 1, falloff: 1.6 },
  torch: { seconds: 60, rMax: 5.0, rMin: 1.8, knee: 1, falloff: 1.6 },
  bigTorch: { seconds: 100, rMax: 6.0, rMin: 2.2, knee: 1, falloff: 1.4 },
  lamp: { seconds: 150, rMax: 3.4, rMin: 2.2, knee: 0.2, falloff: 2.0 },
  candle: { seconds: 90, rMax: 2.4, rMin: 1.8, knee: 0.1, falloff: 2.2 },
};

export const FIXTURE: Record<FixtureKind, LightSpec> = {
  sconce: { seconds: 180, rMax: 4.5, rMin: 2.0, knee: 0.1, falloff: 1.6 },
  brazier: { seconds: 300, rMax: 5.5, rMin: 2.5, knee: 0.1, falloff: 1.5 },
  shrineCandles: { seconds: 240, rMax: 2.8, rMin: 1.8, knee: 0.1, falloff: 2.0 },
};

/** Nothing burns: the coal you hold glows for a few seconds. */
export const EMBER = { seconds: 6, radius: 0.9, falloff: 1.6 } as const;
export const BAG_SIZE = 3;
/** An oil jar that would add less than this stays on the floor. */
export const OIL_MIN_GAIN = 5;
/** Walk cadence in seconds per tile, enforced in core. */
export const STEP_SECONDS = 0.15;
/** Warn once when the only light left drops under this many seconds. */
export const LOW_SECONDS = 10;

export type Carried = { kind: CarryKind; left: number };

export function isCarry(kind: ItemKind): kind is CarryKind {
  return kind !== 'oilJar';
}

export function radiusOf(spec: LightSpec, left: number): number {
  const f = Math.min(1, Math.max(0, left / spec.seconds) / spec.knee);
  return spec.rMin + (spec.rMax - spec.rMin) * f;
}

/** Radius snapped to 1/8 tile: relight only when this changes. */
export function radiusQ(r: number): number {
  return Math.round(r * 8) / 8;
}

/** Radius of a fixture with `left` seconds (Infinity = eternal = full). */
export function fixtureRadius(kind: FixtureKind, left: number): number {
  return left <= 0 ? 0 : radiusOf(FIXTURE[kind], Math.min(left, FIXTURE[kind].seconds));
}

export const KIND_NAME: Record<ItemKind, string> = {
  smallTorch: 'Small torch',
  torch: 'Torch',
  bigTorch: 'Big torch',
  lamp: 'Oil lamp',
  candle: 'Candle',
  oilJar: 'Oil jar',
};
