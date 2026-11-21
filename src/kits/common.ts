import type { GameEvent, GameState } from '../game/core/game';
import { KIND_NAME } from '../game/core/lights';
import { PYRAMIDS, isPyramidId } from '../game/core/pyramids';
import { TREASURE_NAME, type TreasureKind } from '../game/core/secrets';
import type { PowerId } from '../game/core/powers';

/** Culture-free hints: powers and water (shown once per save). */
export const COMMON_HINTS: Record<string, string> = {
  power: 'Your artifacts are under the board. Tap one to use it; uses refill at camps.',
  water: 'Deep water tires you. Shallow water only slows you.',
  floodedNaga: 'Flooded to the ceiling. The Naga Amulet would carry you through.',
  flooded: 'Flooded to the ceiling. No breath would last that far.',
};

const POWER_CAPTION: Record<PowerId, string> = {
  scarab: 'The Scarab turns towards the way down.',
  mirror: 'The mirror throws your light wide.',
  naga: 'The naga coils around you. The water lets you pass.',
  jade: 'The Jade Seal holds everything still.',
};

/** The captions every pyramid shares. A culture's `caption` is asked first. */
export function commonCaption(e: GameEvent, s: GameState): string | null {
  const name = KIND_NAME[e.kind as keyof typeof KIND_NAME];
  switch (e.type) {
    case 'pickup':
      return `+ ${name}`;
    case 'refill':
      return 'Oil refilled';
    case 'lit':
      return e.kind === 'sconce' ? 'Sconce lit' : e.kind === 'brazier' ? 'Brazier lit' : 'Candles lit';
    case 'bagFull':
      return 'Bag full';
    case 'autoLight':
      return `Spare lit: ${name}`;
    case 'lowLight':
      return 'Light running low';
    case 'plate':
      return 'Click.';
    case 'hit':
      return 'The stone knocks the light from your hand';
    case 'guardianTouch':
      return 'It smothers your light';
    case 'guardianFollow':
      return 'Footsteps on the stairs behind you';
    case 'artifactTaken':
      return `The ${isPyramidId(s.pyramid.id) ? PYRAMIDS[s.pyramid.id].artifact : 'artifact'} is yours. The pyramid wakes.`;
    case 'exitOpened':
      return 'Far off, stone grinds open. Air moves.';
    case 'guardianHit':
      return 'The stone falls on the guardian';
    case 'secretKnock':
      return 'It sounds hollow.';
    case 'secretOpen':
      return 'A hidden chamber';
    case 'treasure':
      return `+ ${TREASURE_NAME[e.kind as TreasureKind]}`;
    case 'powerUsed':
      return POWER_CAPTION[e.kind as PowerId] ?? null;
    case 'powerEnded':
      return e.kind === 'jade' ? 'Everything moves again.' : null;
    case 'powerEmpty':
      return 'No uses left until the next camp.';
    case 'flooded':
      return 'Flooded to the ceiling.';
    case 'breathLow':
      return 'Out of breath soon.';
    case 'sunkItem':
      return 'The water took it.';
    default:
      return null;
  }
}

