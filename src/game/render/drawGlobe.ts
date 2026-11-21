import { ClipOp, PaintStyle, Skia, StrokeCap, TileMode, type SkCanvas, type SkPath } from '@shopify/react-native-skia';
import { geoInterpolate } from 'd3-geo';

import { PYRAMIDS, SEALS, type PyramidId } from '../core/pyramids';
import { arc, type LonLat } from '../world/geo';
import { landPath } from '../world/projectLand';
import { fill, glow, hash01, paint, rgba, stroke } from './art';

/**
 * The globe of the world map (plan 06): an orthographic view with true coastlines (Natural Earth 110m), the
 * four real pyramids where they are, the Black Pyramid on its fictional island under a haze, and gold great
 * circles from every artifact taken. One imperative draw call into the Globe component's canvas; the land is one
 * SVG path built by `landPath` (a single JSI call). Tidy vector art; task 14 may add relief on top.
 */
export type GlobeView = {
  center: LonLat;
  selected: PyramidId;
  collected: Partial<Record<PyramidId, true>>;
  /** a seal filling in: the arc is drawn up to `t` with a spark head */
  filling?: { id: PyramidId; t: number };
  /** 0..1 the Black Pyramid's haze thinning (1 = clear) */
  unlock: number;
  /** seconds, running time only (marker pulse, haze drift) */
  time: number;
  /** no pulsing and no drift */
  reducedMotion?: boolean;
};

const RAD = Math.PI / 180;

/** radius of the disc in a w x h canvas */
export const globeRadius = (w: number, h: number) => Math.min(w, h) / 2 - 14;

/** a place on the globe in canvas px, and whether it faces the viewer (z >= 0) */
export function project(center: LonLat, R: number, cx: number, cy: number, lon: number, lat: number): { x: number; y: number; z: number } {
  const l0 = center.lon * RAD;
  const p0 = center.lat * RAD;
  const l = lon * RAD;
  const p = lat * RAD;
  const px = Math.cos(p) * Math.cos(l);
  const py = Math.cos(p) * Math.sin(l);
  const pz = Math.sin(p);
  const ex = -Math.sin(l0);
  const ey = Math.cos(l0);
  const nx = -Math.sin(p0) * Math.cos(l0);
  const ny = -Math.sin(p0) * Math.sin(l0);
  const nz = Math.cos(p0);
  const fx = Math.cos(p0) * Math.cos(l0);
  const fy = Math.cos(p0) * Math.sin(l0);
  const fz = Math.sin(p0);
  return { x: cx + R * (px * ex + py * ey), y: cy - R * (px * nx + py * ny + pz * nz), z: px * fx + py * fy + pz * fz };
}

const STARS = Array.from({ length: 40 }, (_, i) => ({ x: hash01(i * 3 + 1), y: hash01(i * 3 + 2), a: 0.15 + 0.5 * hash01(i * 3 + 3), r: 0.5 + hash01(i * 7) * 0.9 }));

const rgbaShader = (cx: number, cy: number, r: number, colors: Array<[string, number]>, pos: number[] | null = null) =>
  Skia.Shader.MakeRadialGradient({ x: cx, y: cy }, r, colors.map(([c, a]) => rgba(c, a)), pos, TileMode.Clamp);

function shaded(shader: ReturnType<typeof rgbaShader>, draw: () => void) {
  paint.setPathEffect(null);
  paint.setStyle(PaintStyle.Fill);
  paint.setColor(rgba('#ffffff'));
  paint.setShader(shader);
  draw();
  paint.setShader(null);
}

function svgPath(d: string): SkPath | null {
  return d ? Skia.Path.MakeFromSVGString(d) : null;
}

/** meridians and parallels every 10 degrees, only where they face the viewer, as one path string */
function graticule(c: LonLat, R: number, cx: number, cy: number): string {
  const out: string[] = [];
  const line = (pts: Array<[number, number]>) => {
    let pen = false;
    for (const [lon, lat] of pts) {
      const q = project(c, R, cx, cy, lon, lat);
      if (q.z < 0) {
        pen = false;
        continue;
      }
      out.push(`${pen ? 'L' : 'M'}${Math.round(q.x * 10) / 10} ${Math.round(q.y * 10) / 10}`);
      pen = true;
    }
  };
  for (let lat = -80; lat <= 80; lat += 10) {
    const pts: Array<[number, number]> = [];
    for (let lon = -180; lon <= 180; lon += 6) pts.push([lon, lat]);
    line(pts);
  }
  for (let lon = -180; lon < 180; lon += 10) {
    const pts: Array<[number, number]> = [];
    for (let lat = -90; lat <= 90; lat += 6) pts.push([lon, lat]);
    line(pts);
  }
  return out.join('');
}

// ---- site silhouettes (about 18 dp) -----------------------------------------------------------------------------

function silhouette(canvas: SkCanvas, id: PyramidId, x: number, y: number, s: number) {
  const col = PYRAMIDS[id].color;
  const f = 1;
  const shade = (k: number) => rgba(col, 1, f * k);
  // ground shadow
  canvas.drawOval({ x: x - s * 0.62, y: y - s * 0.08, width: s * 1.24, height: s * 0.3 }, fill(rgba('#000000', 0.5)));
  const rect = (rx: number, ry: number, w: number, h: number, c: ReturnType<typeof shade>) => canvas.drawRect({ x: rx, y: ry, width: w, height: h }, fill(c));
  switch (id) {
    case 'egypt': {
      const p = Skia.PathBuilder.Make().moveTo(x - s * 0.55, y).lineTo(x, y - s * 0.95).lineTo(x + s * 0.55, y).close().build();
      canvas.drawPath(p, fill(shade(0.95)));
      canvas.drawPath(Skia.PathBuilder.Make().moveTo(x, y - s * 0.95).lineTo(x + s * 0.55, y).lineTo(x + s * 0.1, y).close().build(), fill(shade(0.65)));
      canvas.drawPath(Skia.PathBuilder.Make().moveTo(x - s * 0.12, y - s * 0.72).lineTo(x, y - s * 0.95).lineTo(x + s * 0.12, y - s * 0.72).close().build(), fill(rgba('#f3c55a')));
      break;
    }
    case 'maya': {
      for (let i = 0; i < 4; i++) rect(x - s * (0.55 - i * 0.11), y - s * 0.19 * (i + 1), s * (1.1 - i * 0.22), s * 0.19, shade(1 - i * 0.07));
      rect(x - s * 0.07, y - s * 0.76, s * 0.14, s * 0.76, shade(0.6));
      rect(x - s * 0.16, y - s * 0.93, s * 0.32, s * 0.17, shade(1.05));
      rect(x - s * 0.07, y - s * 1.1, s * 0.14, s * 0.17, shade(0.85));
      break;
    }
    case 'cambodia': {
      for (let i = 0; i < 7; i++) rect(x - s * (0.55 - i * 0.065), y - s * 0.115 * (i + 1), s * (1.1 - i * 0.13), s * 0.115, shade(0.9 - i * 0.03));
      rect(x - s * 0.06, y - s * 0.96, s * 0.12, s * 0.15, shade(1.05));
      break;
    }
    case 'china': {
      const p = Skia.PathBuilder.Make().moveTo(x - s * 0.62, y).lineTo(x - s * 0.34, y - s * 0.62).lineTo(x + s * 0.34, y - s * 0.62).lineTo(x + s * 0.62, y).close().build();
      canvas.drawPath(p, fill(shade(0.95)));
      rect(x - s * 0.2, y - s * 0.84, s * 0.4, s * 0.22, rgba('#8a2f22', 1, f));
      rect(x - s * 0.26, y - s * 0.9, s * 0.52, s * 0.07, rgba('#e0a845', 1, f));
      break;
    }
    case 'black': {
      for (let i = 0; i < 5; i++) rect(x - s * (0.52 - i * 0.1), y - s * 0.17 * (i + 1), s * (1.04 - i * 0.2), s * 0.17, rgba('#2b2833', 1, 0.8 + i * 0.12));
      break;
    }
  }
}

/** the arc of a pyramid's artifact to the Black Pyramid, sampled once */
const arcCache = new Map<string, Array<[number, number]>>();
function arcPoints(a: LonLat, b: LonLat, key: string): Array<[number, number]> {
  let pts = arcCache.get(key);
  if (!pts) {
    const f = geoInterpolate([a.lon, a.lat], [b.lon, b.lat]);
    pts = Array.from({ length: 49 }, (_, i) => f(i / 48) as [number, number]);
    arcCache.set(key, pts);
  }
  return pts;
}

function drawArc(canvas: SkCanvas, g: GlobeView, R: number, cx: number, cy: number, id: PyramidId, upTo: number, collected: boolean) {
  const a = PYRAMIDS[id].site;
  const b = PYRAMIDS.black.site;
  const pts = arcPoints(a, b, id);
  const n = Math.max(1, Math.round(upTo * 48));
  const b2 = Skia.PathBuilder.Make();
  let pen = false;
  let drew = false;
  for (let i = 0; i <= n; i++) {
    const q = project(g.center, R, cx, cy, pts[i][0], pts[i][1]);
    if (q.z < 0.02) {
      pen = false;
      continue;
    }
    if (pen) b2.lineTo(q.x, q.y);
    else b2.moveTo(q.x, q.y);
    pen = true;
    drew = true;
  }
  if (!drew) return;
  const path = b2.build();
  if (collected) {
    canvas.drawPath(path, stroke(rgba('#f3c55a', 0.18), 5));
    const line = stroke(rgba('#f3c55a', 0.8), 1.6);
    line.setStrokeCap(StrokeCap.Round);
    canvas.drawPath(path, line);
    line.setStrokeCap(StrokeCap.Butt);
  } else {
    canvas.drawPath(path, stroke(rgba('#6a5a3c', 0.55), 1, [3, 5]));
  }
}

export function drawGlobe(canvas: SkCanvas, w: number, h: number, g: GlobeView) {
  const cx = w / 2;
  const cy = h / 2;
  const R = globeRadius(w, h);
  canvas.drawColor(rgba('#07090c'));
  for (const s of STARS) canvas.drawCircle(s.x * w, s.y * h, s.r, fill(rgba('#cfd8e6', s.a)));

  // atmosphere: two soft rings outside the limb
  shaded(rgbaShader(cx, cy, R * 1.16, [['#3b6a8c', 0], ['#3b6a8c', 0.38], ['#3b6a8c', 0]], [R * 0.97 / (R * 1.16), R / (R * 1.16), 1]), () => canvas.drawCircle(cx, cy, R * 1.16, paint));
  // the ocean, lit from the upper left
  shaded(rgbaShader(cx - R * 0.4, cy - R * 0.4, R * 1.7, [['#16364a', 1], ['#081720', 1], ['#050d13', 1]], [0, 0.55, 1]), () => canvas.drawCircle(cx, cy, R, paint));

  canvas.save();
  canvas.clipPath(Skia.PathBuilder.Make().addCircle(cx, cy, R).build(), ClipOp.Intersect, true);
  // graticule
  const grat = svgPath(graticule(g.center, R, cx, cy));
  if (grat) canvas.drawPath(grat, stroke(rgba('#ffffff', 0.06), 0.8));
  // land
  const land = svgPath(landPath(g.center.lon, g.center.lat, R, cx, cy));
  if (land) {
    paint.setPathEffect(null);
    paint.setStyle(PaintStyle.Fill);
    paint.setColor(rgba('#ffffff'));
    paint.setShader(Skia.Shader.MakeLinearGradient({ x: cx - R * 0.7, y: cy - R * 0.7 }, { x: cx + R * 0.6, y: cy + R * 0.7 }, [rgba('#5a4a31'), rgba('#2a2318')], null, TileMode.Clamp));
    canvas.drawPath(land, paint);
    paint.setShader(null);
    // the coast, but not the limb arcs that close the polygons
    canvas.save();
    canvas.clipPath(Skia.PathBuilder.Make().addCircle(cx, cy, R - 1.6).build(), ClipOp.Intersect, true);
    canvas.drawPath(land, stroke(rgba('#a08758', 0.55), 0.8));
    canvas.restore();
  }
  // the night side: a darkening across the disc
  paint.setStyle(PaintStyle.Fill);
  paint.setColor(rgba('#ffffff'));
  paint.setShader(Skia.Shader.MakeLinearGradient({ x: cx - R * 0.5, y: cy - R * 0.5 }, { x: cx + R, y: cy + R }, [rgba('#000000', 0), rgba('#000000', 0), rgba('#000000', 0.45)], [0, 0.45, 1], TileMode.Clamp));
  canvas.drawCircle(cx, cy, R, paint);
  paint.setShader(null);
  canvas.restore();
  canvas.drawCircle(cx, cy, R - 0.5, stroke(rgba('#8fb8d0', 0.3), 1));

  // great circles from every artifact taken to the Black Pyramid; the others are dim and dashed
  for (const id of SEALS) {
    if (g.filling?.id === id) drawArc(canvas, g, R, cx, cy, id, g.filling.t, true);
    else drawArc(canvas, g, R, cx, cy, id, 1, !!g.collected[id]);
  }
  if (g.filling && g.filling.t < 1) {
    const head = arc(PYRAMIDS[g.filling.id].site, PYRAMIDS.black.site, g.filling.t);
    const q = project(g.center, R, cx, cy, head.lon, head.lat);
    if (q.z > 0) {
      glow(canvas, q.x, q.y, 16, 0.9, '#ffcf5a');
      canvas.drawCircle(q.x, q.y, 2.6, fill(rgba('#fff2c0')));
    }
  }

  // the markers, far ones first so the near ones overlap them
  const sites = (Object.keys(PYRAMIDS) as PyramidId[])
    .map((id) => ({ id, q: project(g.center, R, cx, cy, PYRAMIDS[id].site.lon, PYRAMIDS[id].site.lat) }))
    .filter((s) => s.q.z > 0.05)
    .sort((a, b) => a.q.z - b.q.z);
  const pulse = g.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin((g.time / 1.4) * Math.PI * 2);
  for (const { id, q } of sites) {
    // sites near the limb are squashed and faded
    const edge = Math.min(1, q.z * 4);
    canvas.save();
    canvas.translate(q.x, q.y);
    canvas.scale(1, 0.55 + 0.45 * edge);
    canvas.translate(-q.x, -q.y);
    if (id === 'black') {
      // an uncharted island: three overlapping dark ellipses
      canvas.drawOval({ x: q.x - 15, y: q.y - 5, width: 30, height: 11 }, fill(rgba('#14181c')));
      canvas.drawOval({ x: q.x - 9, y: q.y - 7, width: 22, height: 11 }, fill(rgba('#181d22')));
      canvas.drawOval({ x: q.x - 19, y: q.y - 2, width: 17, height: 7 }, fill(rgba('#101418')));
      canvas.drawOval({ x: q.x - 15, y: q.y - 5, width: 30, height: 11 }, stroke(rgba('#3a444c', 0.7), 0.8));
    }
    silhouette(canvas, id, q.x, q.y + (id === 'black' ? 1 : 0), 18);
    canvas.restore();
    if (id !== 'black' && g.collected[id]) glow(canvas, q.x, q.y - 9, 14, 0.5, '#f3c55a');
    if (id === 'black') {
      // the haze: six soft grey ellipses drifting round it while sealed, thinning as the door opens
      const haze = 1 - g.unlock;
      if (haze > 0.01) {
        for (let k = 0; k < 6; k++) {
          const a = (g.reducedMotion ? 0 : g.time * 0.12) + (k * Math.PI) / 3;
          const hx = q.x + Math.cos(a) * 13;
          const hy = q.y - 4 + Math.sin(a) * 6;
          glow(canvas, hx, hy, 14 + 3 * Math.sin(a * 2 + k), 0.4 * haze * edge, '#9aa3ad');
        }
        glow(canvas, q.x, q.y - 4, 22, 0.35 * haze * edge, '#7f8993');
      }
    }
    if (id === g.selected) {
      const r = 13 + 3 * pulse;
      canvas.drawCircle(q.x, q.y - 6, r, stroke(rgba('#f3c55a', 0.45 + 0.4 * (1 - pulse)), 1.4));
    }
  }
}
