import type { PyramidId } from '../../game/core/pyramids';
import { drawSealDoor } from '../../game/render/drawSealDoor';
import { ArtCanvas } from '../../ui/ArtCanvas';

/** The Black Pyramid's door with its four sockets (220 x 132 on the card, 280 x 168 on the pyramid page). */
export function SealDoor({
  collected,
  unlock,
  filling,
  time,
  size = 'card',
}: {
  collected: Partial<Record<PyramidId, true>>;
  unlock: number;
  filling?: { id: PyramidId; t: number } | null;
  time: number;
  size?: 'card' | 'page';
}) {
  const w = size === 'card' ? 220 : 280;
  const h = size === 'card' ? 132 : 168;
  return <ArtCanvas width={w} height={h} deps={[collected, unlock, filling?.id, filling?.t, time]} draw={(c, cw, ch) => drawSealDoor(c, cw, ch, { collected, unlock, filling: filling ?? undefined, time })} />;
}
