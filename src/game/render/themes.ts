import type { RoomKind } from '../core/floor';
import type { PyramidId } from '../core/pyramids';

/**
 * Colors of a floor's architecture, as hex strings. Egypt is hand-tuned (Tura limestone
 * casing, warm sandstone paving, granite for the burial chamber, gold and lapis ornament);
 * the other pyramids get a palette-only fallback derived from their map color until
 * their own architecture arrives (tasks 07-09, 13).
 */
export type FloorTheme = {
  /** unseen rock mass */
  rock: string;
  /** wall top seen from above */
  cap: string;
  capEdge: string;
  /** south-facing wall face, top and bottom (ambient occlusion) */
  faceTop: string;
  faceBottom: string;
  joint: string;
  floor: Record<RoomKind, string>;
  floorJoint: string;
  pillar: string;
  pillarDark: string;
  /** gold ornament */
  gold: string;
  /** lapis ornament */
  lapis: string;
  /** rooms whose wall faces carry a painted frieze */
  royal: ReadonlySet<RoomKind>;
};

const ROYAL: ReadonlySet<RoomKind> = new Set<RoomKind>(['burial', 'antechamber', 'shrine', 'stairsDown']);

const EGYPT: FloorTheme = {
  rock: '#15110b',
  cap: '#d2c8a8',
  capEdge: '#f4ecd0',
  faceTop: '#ddd3b4',
  faceBottom: '#8d8062',
  joint: '#5a4f3a',
  floor: {
    passage: '#9a7646',
    chamber: '#a8814c',
    hall: '#b08a54',
    gallery: '#917453',
    magazines: '#8f7248',
    shrine: '#ac8650',
    antechamber: '#7d655a',
    stairsUp: '#9c7a49',
    stairsDown: '#9c7a49',
    burial: '#6e5853',
  },
  floorJoint: '#5e4626',
  pillar: '#cfb98a',
  pillarDark: '#7a6743',
  gold: '#e3b449',
  lapis: '#2f5fa8',
  royal: ROYAL,
};

function scale(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
}

function derived(base: string): FloorTheme {
  const kinds: RoomKind[] = [
    'passage',
    'chamber',
    'hall',
    'gallery',
    'magazines',
    'shrine',
    'antechamber',
    'stairsUp',
    'stairsDown',
    'burial',
  ];
  const floor = {} as Record<RoomKind, string>;
  kinds.forEach((k, i) => (floor[k] = scale(base, 0.62 + (i % 4) * 0.04 - (k === 'burial' || k === 'antechamber' ? 0.12 : 0))));
  return {
    rock: scale(base, 0.1),
    cap: scale(base, 0.82),
    capEdge: scale(base, 1.2),
    faceTop: scale(base, 0.95),
    faceBottom: scale(base, 0.55),
    joint: scale(base, 0.35),
    floor,
    floorJoint: scale(base, 0.42),
    pillar: scale(base, 0.95),
    pillarDark: scale(base, 0.45),
    gold: '#e3b449',
    lapis: '#2f5fa8',
    royal: ROYAL,
  };
}

const cache: Partial<Record<PyramidId, FloorTheme>> = {};

export function themeFor(id: PyramidId, color: string): FloorTheme {
  if (id === 'egypt') return EGYPT;
  return (cache[id] ??= derived(color));
}
