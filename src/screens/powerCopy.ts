import { POWERS, freshPowers, type PowerId } from '../game/core/powers';
import { POWER_INFO, PYRAMIDS, type PyramidId } from '../game/core/pyramids';

/** The words about a power, with the numbers of one pyramid (attuned where it matches). */
export type PowerCopy = {
  id: PowerId;
  name: string;
  verb: string;
  /** the description with this pyramid's seconds */
  text: string;
  /** "2 uses · 8 s" */
  here: string;
  /** "Strongest in Cambodia: 3 uses, 8 s, the whole way." */
  strongest: string;
  attunedHere: boolean;
  color: string;
};

export function powerCopy(id: PowerId, pyramid: PyramidId | 'sandbox' = 'egypt'): PowerCopy {
  const info = POWER_INFO[id];
  const spec = POWERS[id];
  const run = freshPowers(pyramid, [id])[0];
  const where = PYRAMIDS[spec.attuned as PyramidId]?.name ?? spec.attuned;
  const whole = id === 'scarab' ? ', the whole way' : '';
  return {
    id,
    name: info.name,
    verb: info.verb,
    text: info.text.replace('{s}', String(run.seconds)),
    here: `${run.max} ${run.max === 1 ? 'use' : 'uses'} · ${run.seconds} s`,
    strongest: `Strongest in ${where}: ${spec.attunedUses} ${spec.attunedUses === 1 ? 'use' : 'uses'}, ${spec.attunedSeconds} s${whole}.`,
    attunedHere: run.attuned,
    color: info.color,
  };
}
