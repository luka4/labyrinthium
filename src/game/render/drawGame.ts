import { Skia, type SkCanvas } from '@shopify/react-native-skia';

import { isBasement, type GameState } from '../core/game';

/**
 * Prototype renderer: draws the whole floor imperatively into one Skia canvas
 * (no React element per tile). The performance test replaces the per-tile
 * darkness with a light shader.
 */
const COLORS = {
  void: Skia.Color('#000000'),
  wall: Skia.Color('#6e5535'),
  wallTop: Skia.Color('#8b6c44'),
  floorA: Skia.Color('#c9a96e'),
  floorB: Skia.Color('#b8975c'),
  stairs: Skia.Color('#5f86e8'),
  artifact: Skia.Color('#ffe7a3'),
  artifactRim: Skia.Color('#f3c55a'),
  oil: Skia.Color('#d9852b'),
  player: Skia.Color('#f3c55a'),
  playerCore: Skia.Color('#fff3c8'),
};

const paint = Skia.Paint();
paint.setAntiAlias(true);

/** Brightness of tiles you have seen (and walked) but that the torch does not reach now. */
const MEMORY_SEEN = 0.13;
const MEMORY_WALKED = 0.3;

export function drawGame(canvas: SkCanvas, s: GameState, tile: number, flicker: number) {
  const { size, walls, stairs } = s.floor;
  const basement = isBasement(s.pyramid, s.floorIndex);
  canvas.drawColor(COLORS.void);

  for (let i = 0; i < size * size; i++) {
    const lit = s.light[i] * flicker;
    if (lit <= 0 && !s.seen[i]) continue;
    const memory = s.seen[i] ? (s.walked[i] ? MEMORY_WALKED : MEMORY_SEEN) : 0;
    const light = Math.min(1, Math.max(lit, memory));
    const x = i % size;
    const y = (i - x) / size;
    const rect = Skia.XYWHRect(x * tile, y * tile, tile + 0.5, tile + 0.5);

    paint.setColor(walls[i] ? COLORS.wall : (x + y) % 2 ? COLORS.floorA : COLORS.floorB);
    paint.setAlphaf(1);
    canvas.drawRect(rect, paint);

    if (s.oil.has(i)) {
      paint.setColor(COLORS.oil);
      canvas.drawCircle((x + 0.5) * tile, (y + 0.5) * tile, tile * 0.3, paint);
    }
    if (i === stairs && basement) {
      // the basement keeps the artifact where the stairs would be
      drawArtifactTile(canvas, (x + 0.5) * tile, (y + 0.5) * tile, tile);
    } else if (i === stairs) {
      paint.setColor(COLORS.stairs);
      canvas.drawRect(Skia.XYWHRect(x * tile + tile * 0.12, y * tile + tile * 0.12, tile * 0.76, tile * 0.76), paint);
    }

    // darkness
    paint.setColor(COLORS.void);
    paint.setAlphaf(1 - light);
    canvas.drawRect(rect, paint);

    // warm torch tint, only where the light reaches
    if (lit > 0) {
      paint.setColor(Skia.Color('#ff8c28'));
      paint.setAlphaf(0.22 * lit);
      canvas.drawRect(rect, paint);
    }
  }

  const px = s.pos % size;
  const py = (s.pos - px) / size;
  paint.setAlphaf(1);
  paint.setColor(COLORS.player);
  canvas.drawCircle((px + 0.5) * tile, (py + 0.5) * tile, tile * 0.36, paint);
  paint.setColor(COLORS.playerCore);
  canvas.drawCircle((px + 0.62) * tile, (py + 0.36) * tile, tile * 0.12, paint);
}

function drawArtifactTile(canvas: SkCanvas, cx: number, cy: number, tile: number) {
  const outer = Skia.PathBuilder.Make()
    .moveTo(cx, cy - tile * 0.42)
    .lineTo(cx + tile * 0.3, cy)
    .lineTo(cx, cy + tile * 0.42)
    .lineTo(cx - tile * 0.3, cy)
    .close()
    .build();
  paint.setAlphaf(1);
  paint.setColor(COLORS.artifactRim);
  canvas.drawPath(outer, paint);
  paint.setColor(COLORS.artifact);
  canvas.drawCircle(cx, cy, tile * 0.13, paint);
}
