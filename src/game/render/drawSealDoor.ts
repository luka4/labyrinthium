import { ClipOp, PaintStyle, Skia, TileMode, type SkCanvas } from '@shopify/react-native-skia';

import type { PowerId } from '../core/powers';
import { POWER_INFO, SEALS, type PyramidId } from '../core/pyramids';
import { fill, glow, hash01, paint, rgba, stroke } from './art';
import { drawEmblem } from './drawEmblems';

/**
 * The Black Pyramid's door (plan 06): a tall trapezoid of black polished basalt under a heavy lintel, four
 * sockets in a row in SEALS order, each cut in the shape of its artifact (oval scarab, round mirror, fanned
 * naga hood, square seal). A filled socket holds the emblem with a warm rim light. Opening: the sockets
 * light left to right, then the slab sinks and a line of light grows under the lintel. No inscriptions.
 */
export type SealDoorView = {
  collected: Partial<Record<PyramidId, true>>;
  /** a socket being filled right now: 0..1 (the emblem seats and the rim flares) */
  filling?: { id: PyramidId; t: number };
  /** 0..1 the opening: 0-0.5 sockets light, 0.5-1 the slab sinks */
  unlock: number;
  time: number;
};

const SOCKET_POWER: Record<string, PowerId> = { egypt: 'scarab', maya: 'mirror', cambodia: 'naga', china: 'jade' };

function socketShape(canvas: SkCanvas, id: PowerId, x: number, y: number, s: number, paintFn: () => ReturnType<typeof fill>) {
  switch (id) {
    case 'scarab':
      canvas.drawOval({ x: x - s * 0.42, y: y - s * 0.5, width: s * 0.84, height: s }, paintFn());
      break;
    case 'mirror':
      canvas.drawCircle(x, y, s * 0.5, paintFn());
      break;
    case 'naga': {
      // a fanned hood: a half disc on a narrow neck
      const p = Skia.PathBuilder.Make()
        .moveTo(x - s * 0.5, y + s * 0.1)
        .cubicTo(x - s * 0.55, y - s * 0.5, x + s * 0.55, y - s * 0.5, x + s * 0.5, y + s * 0.1)
        .lineTo(x + s * 0.16, y + s * 0.5)
        .lineTo(x - s * 0.16, y + s * 0.5)
        .close()
        .build();
      canvas.drawPath(p, paintFn());
      break;
    }
    case 'jade':
      canvas.drawRRect({ rect: { x: x - s * 0.44, y: y - s * 0.44, width: s * 0.88, height: s * 0.88 }, rx: s * 0.08, ry: s * 0.08 }, paintFn());
      break;
  }
}

export function drawSealDoor(canvas: SkCanvas, w: number, h: number, v: SealDoorView) {
  const cx = w / 2;
  const top = h * 0.12;
  const bottom = h - 2;
  const topHalf = w * 0.31;
  const botHalf = w * 0.4;
  const lintelH = h * 0.14;
  canvas.drawColor(rgba('#0a0907', 0));
  // the surround: a rough dark stone mass
  canvas.drawRRect({ rect: { x: 0, y: top - lintelH * 0.4, width: w, height: h - top + lintelH * 0.4 }, rx: 6, ry: 6 }, fill(rgba('#15130f')));

  const door = Skia.PathBuilder.Make().moveTo(cx - topHalf, top + lintelH).lineTo(cx + topHalf, top + lintelH).lineTo(cx + botHalf, bottom).lineTo(cx - botHalf, bottom).close().build();
  const sink = v.unlock > 0.5 ? (v.unlock - 0.5) * 2 : 0;

  // behind the slab: the light that grows under the lintel as it sinks
  canvas.save();
  canvas.clipPath(door, ClipOp.Intersect, true);
  paint.setStyle(PaintStyle.Fill);
  paint.setColor(rgba('#ffffff'));
  paint.setShader(Skia.Shader.MakeLinearGradient({ x: cx, y: top + lintelH }, { x: cx, y: bottom }, [rgba('#ffcf7a', 0.95), rgba('#ff9a3a', 0.6), rgba('#3a1a08', 0.9)], null, TileMode.Clamp));
  canvas.drawRect({ x: cx - botHalf, y: top + lintelH, width: botHalf * 2, height: (bottom - top - lintelH) * Math.min(1, sink * 1.2) }, paint);
  paint.setShader(null);
  canvas.restore();

  // the slab: polished black basalt, a fine speckle from a hash, chamfered jambs
  canvas.save();
  canvas.clipPath(door, ClipOp.Intersect, true);
  canvas.translate(0, sink * (bottom - top - lintelH) * 0.62);
  canvas.drawPath(door, fill(rgba('#0f0e12')));
  paint.setStyle(PaintStyle.Fill);
  paint.setColor(rgba('#ffffff'));
  paint.setShader(Skia.Shader.MakeLinearGradient({ x: cx - botHalf, y: top }, { x: cx + botHalf, y: bottom }, [rgba('#2a2a33'), rgba('#0c0c10'), rgba('#17171d')], [0, 0.55, 1], TileMode.Clamp));
  canvas.drawPath(door, paint);
  paint.setShader(null);
  for (let i = 0; i < 70; i++) {
    const sx = cx + (hash01(i * 2 + 1) * 2 - 1) * botHalf * 0.92;
    const sy = top + lintelH + hash01(i * 2 + 2) * (bottom - top - lintelH);
    canvas.drawCircle(sx, sy, 0.5 + hash01(i) * 0.5, fill(rgba('#8a8a9c', 0.12 + 0.12 * hash01(i + 40))));
  }

  // four sockets
  const s = Math.min(w * 0.115, 26);
  const pitch = Math.min(w * 0.15, 34);
  const sy = top + lintelH + (bottom - top - lintelH) * 0.34;
  SEALS.forEach((id, i) => {
    const sx = cx + (i - 1.5) * pitch;
    const power = SOCKET_POWER[id];
    const taken = !!v.collected[id];
    const t = v.filling?.id === id ? v.filling.t : 1;
    const lit = v.unlock > 0 ? Math.max(0, Math.min(1, v.unlock * 2 * 4 - i)) : 0;
    // the recess with its inner shadow
    socketShape(canvas, power, sx, sy, s + 3, () => fill(rgba('#050507')));
    socketShape(canvas, power, sx, sy + 0.6, s, () => fill(rgba('#16151b')));
    socketShape(canvas, power, sx, sy, s + 3, () => stroke(rgba('#33323c'), 1));
    if (taken && t > 0) {
      const seat = Math.min(1, t);
      const flare = v.filling?.id === id ? Math.sin(Math.min(1, t) * Math.PI) : 0;
      glow(canvas, sx, sy, s * (1.0 + flare * 0.7), 0.35 + 0.35 * flare + 0.35 * lit, POWER_INFO[power].color);
      drawEmblem(canvas, power, sx, sy - (1 - seat) * 4, s * 0.95, { lit: lit, dim: false });
      // a warm rim light on the socket's lower edge
      socketShape(canvas, power, sx, sy, s + 3, () => stroke(rgba('#f3c55a', 0.35 + 0.4 * lit), 1.2));
    }
  });
  canvas.restore();

  // jambs: a lighter chamfer on both sides, and the heavy lintel with a plain cornice
  canvas.drawLine(cx - topHalf, top + lintelH, cx - botHalf, bottom, stroke(rgba('#3a3945'), 2));
  canvas.drawLine(cx + topHalf, top + lintelH, cx + botHalf, bottom, stroke(rgba('#1f1e26'), 2));
  canvas.drawRRect({ rect: { x: cx - topHalf - w * 0.07, y: top, width: topHalf * 2 + w * 0.14, height: lintelH }, rx: 3, ry: 3 }, fill(rgba('#1b1a20')));
  canvas.drawRect({ x: cx - topHalf - w * 0.07, y: top, width: topHalf * 2 + w * 0.14, height: 2 }, fill(rgba('#3c3b48')));
  canvas.drawRect({ x: cx - topHalf - w * 0.07, y: top + lintelH - 2, width: topHalf * 2 + w * 0.14, height: 2 }, fill(rgba('#050507', 0.7)));
  // the lit line beneath the lintel as the slab sinks
  if (sink > 0) glow(canvas, cx, top + lintelH + 1, botHalf * (0.4 + sink), 0.5 * Math.min(1, sink * 2), '#ffcf7a');
}
