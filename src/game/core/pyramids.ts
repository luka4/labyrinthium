import { EGYPT_CAMPS } from './egypt';
import type { Pyramid } from './game';
import type { PowerId } from './powers';

/**
 * The pyramids of the first world. Rules (seed, floors, camps) are part of the
 * deterministic core: changing them changes every player's floors.
 * Artifact powers (powers.ts) are described here as display data.
 *
 * Recipe for tasks 07-09 (a pyramid gets its own floors): build `src/game/core/cultures/<id>.ts` with
 * `profileFromTable(id, TABLE, shape)`, add it to `CULTURE_PROFILES`, then here set
 * `floorCount: TABLE.rows.length, camps: TABLE.camps, architecture: '<profile id>'` and bump `rev`
 * (players keep the artifact and records, and replay the new floors from the top: state/progress.ts
 * `reconcileRevisions`). Add its kit in `src/kits/<id>.ts` and one line in `src/kits/index.ts`.
 */
export type PyramidId = 'egypt' | 'maya' | 'cambodia' | 'china' | 'black';

/** The shape on top of the side view: a capstone, a small temple, three towers or a flat roof. */
export type PyramidTop = 'capstone' | 'temple' | 'towers' | 'flat';

/** Where it stands on the globe (true coordinates; the Black Pyramid's island is fictional). */
export type Site = { label: string; lat: number; lon: number };

export type PyramidInfo = Pyramid & {
  id: PyramidId;
  /** data revision: bump when the pyramid's floors are rebuilt (progress.revs) */
  rev: number;
  /** the power its artifact gives, or null */
  powerId: PowerId | null;
  site: Site;
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

/** Display data of a power (the numbers live in powers.ts). `{s}` in `text` is the seconds. */
export const POWER_INFO: Record<PowerId, { artifact: string; name: string; verb: string; text: string; color: string }> = {
  scarab: { artifact: 'egypt', name: 'Golden Scarab', verb: 'Shows the way down', text: 'Gold motes run ahead of you along the way to the stairs for {s} s.', color: '#ffcf5a' },
  mirror: {
    artifact: 'maya',
    name: 'Obsidian Mirror',
    verb: 'Throws your light wide',
    text: 'The polished obsidian throws your flame back: your light reaches much farther for {s} s. Guardians see you from farther too.',
    color: '#cfd3f0',
  },
  naga: { artifact: 'cambodia', name: 'Naga Amulet', verb: 'Carries you through water', text: 'For {s} s you swim without tiring and can pass passages flooded to the ceiling.', color: '#6fd0bf' },
  jade: { artifact: 'china', name: 'Jade Seal', verb: 'Stops guardians and mechanisms', text: 'For {s} s guardians, traps and falling sand stand still. Your light still burns.', color: '#9fe0b4' },
};

const BASE = { floorCount: 5, architecture: 'generic', camps: [4], requires: [], rev: 1 } as const;

export const PYRAMIDS: Record<PyramidId, PyramidInfo> = {
  egypt: {
    ...BASE,
    id: 'egypt',
    powerId: 'scarab',
    site: { label: 'Giza plateau · Egypt', lat: 29.979, lon: 31.134 },
    seed: 1,
    name: 'Egypt',
    artifact: 'Golden Scarab',
    power: 'Briefly points the way to the stairs. Strongest in Cambodia.',
    color: '#d6b066',
    top: 'capstone',
    floorCount: 25,
    camps: EGYPT_CAMPS,
    architecture: 'egypt',
  },
  maya: {
    ...BASE,
    id: 'maya',
    powerId: 'mirror',
    site: { label: 'Petén lowlands · Guatemala', lat: 17.222, lon: -89.624 },
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
    powerId: 'naga',
    site: { label: 'Koh Ker · Cambodia', lat: 13.785, lon: 104.537 },
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
    powerId: 'jade',
    site: { label: "Near Xi'an · Shaanxi, China", lat: 34.381, lon: 109.254 },
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
    powerId: null,
    site: { label: 'Uncharted · Indian Ocean', lat: -9.5, lon: 83.0 },
    seed: 5,
    architecture: 'black',
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

/** Camp floors as 1-based numbers, for display ("camps at 5, 10 and 14"). */
export function campFloorNumbers(p: Pyramid): number[] {
  return p.camps.map((i) => i + 1);
}
