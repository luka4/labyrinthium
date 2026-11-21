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
  /** collapse sand: light and shadow side */
  sand: string;
  sandDark: string;
  /** trap plates: a darker stone set into the paving, and its lit edge */
  granite: string;
  graniteEdge: string;
  /** the guardian (plan 04): resin-dark linen wrappings, their shadow and highlight, and the gilded cartonnage mask */
  /** smooth gypsum plaster of a sealed doorway, the rough bedrock of a secret chamber, ochre ground of a painted wall (plan 05) */
  plaster: string;
  bedrock: string;
  ochre: string;
  linen: string;
  linenDark: string;
  linenLight: string;
  mask: string;
  maskLight: string;
  /** water colours (plan 06); absent = WATER_COLORS in drawWater.ts */
  water?: { shallow: string; deep: string; flooded: string; edge: string };
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
  sand: '#dcc189',
  sandDark: '#a88a52',
  granite: '#5f4b48',
  graniteEdge: '#a48c82',
  plaster: '#d9cdb4',
  bedrock: '#6b5c43',
  ochre: '#c98a3c',
  linen: '#6b5a43',
  linenDark: '#3a2c1e',
  linenLight: '#a08a68',
  mask: '#c49a3f',
  maskLight: '#e8c66a',
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
    sand: scale(base, 1.05),
    sandDark: scale(base, 0.7),
    granite: scale(base, 0.38),
    graniteEdge: scale(base, 0.8),
    plaster: scale(base, 1.02),
    bedrock: scale(base, 0.5),
    ochre: '#c98a3c',
    linen: '#6b5a43',
    linenDark: '#3a2c1e',
    linenLight: '#a08a68',
    mask: '#c49a3f',
    maskLight: '#e8c66a',
  };
}

const cache: Partial<Record<PyramidId, FloorTheme>> = {};

export function themeFor(id: PyramidId, color: string): FloorTheme {
  if (id === 'egypt') return EGYPT;
  return (cache[id] ??= derived(color));
}
