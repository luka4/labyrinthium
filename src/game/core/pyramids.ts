import type { Pyramid } from './game';

/**
 * The pyramids of the first world. Rules (seed, floors, camps) are part of the
 * deterministic core: changing them changes every player's floors.
 * Artifact powers are described here but not implemented yet.
 */
export type PyramidId = 'egypt' | 'maya' | 'cambodia' | 'china' | 'black';

/** The shape on top of the side view: a capstone, a small temple, three towers or a flat roof. */
export type PyramidTop = 'capstone' | 'temple' | 'towers' | 'flat';

export type PyramidInfo = Pyramid & {
  id: PyramidId;
  name: string;
  artifact: string;
  power: string;
  color: string;
  top: PyramidTop;
  /** artifacts needed to open it */
  requires: readonly PyramidId[];
};

/** The four pyramids whose artifacts fill the seals of the Black Pyramid's door, in door order. */
export const SEALS: readonly PyramidId[] = ['egypt', 'maya', 'cambodia', 'china'];

const BASE = { floorCount: 5, firstCells: 5, lastCells: 15, campEvery: 2, requires: [] } as const;

export const PYRAMIDS: Record<PyramidId, PyramidInfo> = {
  egypt: {
    ...BASE,
    id: 'egypt',
    seed: 1,
    name: 'Egypt',
    artifact: 'Golden Scarab',
    power: 'Briefly points the way to the stairs. Strongest in Cambodia.',
    color: '#d6b066',
    top: 'capstone',
  },
  maya: {
    ...BASE,
    id: 'maya',
    seed: 2,
    name: 'Maya',
    artifact: 'Obsidian Mirror',
    power: 'Reflects the torch for a wide light. Strongest in China.',
    color: '#8fae74',
    top: 'temple',
  },
  cambodia: {
    ...BASE,
    id: 'cambodia',
    seed: 3,
    name: 'Cambodia',
    artifact: 'Naga Amulet',
    power: 'Lets you pass through water and swim longer. Strongest in Maya.',
    color: '#aaa897',
    top: 'towers',
  },
  china: {
    ...BASE,
    id: 'china',
    seed: 4,
    name: 'China',
    artifact: 'Jade Seal',
    power: 'Freezes guardians and mechanisms. Strongest in Egypt.',
    color: '#c4654c',
    top: 'flat',
  },
  black: {
    ...BASE,
    id: 'black',
    seed: 5,
    firstCells: 7,
    lastCells: 17,
    name: 'The Black Pyramid',
    artifact: "Builder's Heart",
    power: 'The end of the story, and a crack in the basement floor.',
    color: '#8a80a0',
    top: 'capstone',
    requires: SEALS,
  },
};

export function isPyramidId(id: unknown): id is PyramidId {
  return typeof id === 'string' && id in PYRAMIDS;
}

/** Camp floors as 1-based numbers, for display ("camps at 3 and 5"). */
export function campFloorNumbers(p: Pyramid): number[] {
  const out: number[] = [];
  if (p.campEvery <= 0) return out;
  for (let i = p.campEvery; i < p.floorCount; i += p.campEvery) out.push(i + 1);
  return out;
}
