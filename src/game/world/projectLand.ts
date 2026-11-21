import { landFeature } from './geo';

/**
 * A fast orthographic projector for the 110m land (5100 vertices), written because d3-geo's clipping
 * costs about 8 ms a frame on a desktop for this data (a budget phone is 5-10x slower) and the globe turns at
 * 60 fps. d3-geo still does everything else (single points, great circles; `geoContains` in the checks).
 *
 * Per ring: vertices are unit vectors; the view frame gives the east / north / forward dot products. A ring fully on
 * the near side is a plain polyline; a ring that crosses the horizon is cut where its edges cross it, and the hidden
 * stretch between an exit and the next entry is replaced by an arc along the limb. The arc runs clockwise on the screen
 * (rings are wound like d3's: the interior stays on the right, so the filled side is the disc side), except for a
 * grazing excursion (exit and entry within 0.5 rad), where the short way round is the only sensible one. The result is
 * one SVG path string (a single JSI call into Skia).
 */
type LandData = {
  /** unit vectors, 3 floats per vertex */
  p: Float32Array;
  /** ring offsets in vertices: ring k is [start[k], start[k + 1]) (closing vertex dropped) */
  start: Int32Array;
  /** per ring: unit vector of its centre and its angular radius, to skip rings behind the globe */
  cap: Float32Array;
  /** per ring: +1 for a clockwise ring (land: interior on the right), -1 for a counter-clockwise one (a lake) */
  dir: Int8Array;
};

let data: LandData | null = null;

function landData(): LandData {
  if (data) return data;
  type Geom = { type: string; coordinates: unknown };
  const land = landFeature() as unknown as { features?: Array<{ geometry: Geom }>; geometry?: Geom };
  const geoms: Geom[] = land.features ? land.features.map((f) => f.geometry) : [land.geometry as Geom];
  const rings: number[][][] = [];
  for (const g of geoms) {
    const polys = (g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]) as number[][][][];
    for (const poly of polys) for (const ring of poly) {
        // specks under about 0.6 degrees (a pixel and a half) and the zero-area slivers the antimeridian cut leaves are not drawn
        let lo = [Infinity, Infinity];
        let hi = [-Infinity, -Infinity];
        for (const q of ring) {
          lo = [Math.min(lo[0], q[0]), Math.min(lo[1], q[1])];
          hi = [Math.max(hi[0], q[0]), Math.max(hi[1], q[1])];
        }
        if (ring.length >= 7 && Math.max(hi[0] - lo[0], hi[1] - lo[1]) > 0.6) rings.push(ring);
      }
  }
  let total = 0;
  for (const r of rings) total += r.length - 1;
  const p = new Float32Array(total * 3);
  const start = new Int32Array(rings.length + 1);
  const cap = new Float32Array(rings.length * 4);
  const dir = new Int8Array(rings.length);
  let at = 0;
  rings.forEach((ring, k) => {
    start[k] = at;
    // the winding in lon/lat (y up): clockwise = interior on the right
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    dir[k] = area > 0 ? -1 : 1;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const lon = (ring[i][0] * Math.PI) / 180;
      const lat = (ring[i][1] * Math.PI) / 180;
      const c = Math.cos(lat);
      p[3 * at] = c * Math.cos(lon);
      p[3 * at + 1] = c * Math.sin(lon);
      p[3 * at + 2] = Math.sin(lat);
      cx += p[3 * at];
      cy += p[3 * at + 1];
      cz += p[3 * at + 2];
      at++;
    }
    const n = Math.hypot(cx, cy, cz) || 1;
    cx /= n;
    cy /= n;
    cz /= n;
    let rad = 0;
    for (let i = start[k]; i < at; i++) rad = Math.max(rad, Math.acos(Math.min(1, Math.max(-1, p[3 * i] * cx + p[3 * i + 1] * cy + p[3 * i + 2] * cz))));
    cap[4 * k] = cx;
    cap[4 * k + 1] = cy;
    cap[4 * k + 2] = cz;
    // a ring that wraps the globe (Antarctica) has a radius over 90 degrees and is simply never skipped
    cap[4 * k + 3] = rad;
  });
  start[rings.length] = at;
  data = { p, start, cap, dir };
  return data;
}

/** parses and flattens the land once (about 15 ms), so the first frame does not */
export function warmLand(): void {
  landData();
}

const ARC_STEP = (5 * Math.PI) / 180;
let dist = new Float32Array(0);

/**
 * The land as SVG path data for a globe centred on (lonDeg, latDeg), radius `R` px around (cx, cy).
 * `rings` (optional) receives the polylines as well (tests).
 */
export function landPath(lonDeg: number, latDeg: number, R: number, cx: number, cy: number, rings?: number[][], only = -1): string {
  const { p, start, cap, dir } = landData();
  const lon0 = (lonDeg * Math.PI) / 180;
  const lat0 = (latDeg * Math.PI) / 180;
  const fx = Math.cos(lat0) * Math.cos(lon0);
  const fy = Math.cos(lat0) * Math.sin(lon0);
  const fz = Math.sin(lat0);
  const ex = -Math.sin(lon0);
  const ey = Math.cos(lon0);
  const nx = -Math.sin(lat0) * Math.cos(lon0);
  const ny = -Math.sin(lat0) * Math.sin(lon0);
  const nz = Math.cos(lat0);
  const out: string[] = [];
  let cur: number[] | null = null;
  const sx = (j: number) => cx + R * (p[j] * ex + p[j + 1] * ey);
  const sy = (j: number) => cy - R * (p[j] * nx + p[j + 1] * ny + p[j + 2] * nz);
  const f1 = (v: number) => Math.round(v * 10) / 10;
  const moveTo = (x: number, y: number) => {
    out.push(`M${f1(x)} ${f1(y)}`);
    if (rings) rings.push((cur = [x, y]));
  };
  const lineTo = (x: number, y: number) => {
    out.push(`L${f1(x)} ${f1(y)}`);
    if (cur) cur.push(x, y);
  };
  const rings_ = start.length - 1;
  if (dist.length < p.length / 3) dist = new Float32Array(p.length / 3);
  const d = dist;
  for (let k = 0; k < rings_; k++) {
    if (only >= 0 && k !== only) continue;
    // a ring wholly behind the globe is skipped
    const cdot = cap[4 * k] * fx + cap[4 * k + 1] * fy + cap[4 * k + 2] * fz;
    if (Math.acos(Math.max(-1, Math.min(1, cdot))) - cap[4 * k + 3] > Math.PI / 2) continue;
    const a = start[k];
    const n = start[k + 1] - a;
    let vis = 0;
    for (let i = 0; i < n; i++) {
      const j = 3 * (a + i);
      const v = p[j] * fx + p[j + 1] * fy + p[j + 2] * fz;
      d[i] = v;
      if (v >= 0) vis++;
    }
    if (vis === 0) continue;
    if (vis === n) {
      for (let i = 0; i < n; i++) {
        const j = 3 * (a + i);
        if (i === 0) moveTo(sx(j), sy(j));
        else lineTo(sx(j), sy(j));
      }
      out.push('Z');
      continue;
    }
    // the visible runs: each starts at an entry (hidden -> visible) and ends at an exit (visible -> hidden)
    type Run = { entry: [number, number]; exit: [number, number]; from: number; to: number; used: boolean };
    const runs: Run[] = [];
    /** where the edge i0 -> i1 crosses the horizon, projected (a point on the unit circle) */
    const horizon = (i0: number, i1: number): [number, number] => {
      const t = d[i0] / (d[i0] - d[i1]);
      const j0 = 3 * (a + i0);
      const j1 = 3 * (a + i1);
      let qx = p[j0] + (p[j1] - p[j0]) * t;
      let qy = p[j0 + 1] + (p[j1 + 1] - p[j0 + 1]) * t;
      let qz = p[j0 + 2] + (p[j1 + 2] - p[j0 + 2]) * t;
      const l = Math.hypot(qx, qy, qz) || 1;
      qx /= l;
      qy /= l;
      qz /= l;
      return [qx * ex + qy * ey, -(qx * nx + qy * ny + qz * nz)];
    };
    for (let i = 0; i < n; i++) {
      const prev = (i + n - 1) % n;
      if (!(d[prev] < 0 && d[i] >= 0)) continue;
      // walk to the exit
      let m = i;
      while (d[(m + 1) % n] >= 0) m = (m + 1) % n;
      runs.push({ entry: horizon(prev, i), exit: horizon(m, (m + 1) % n), from: i, to: m, used: false });
    }
    // Weiler-Atherton: after an exit, the boundary follows the limb clockwise (on screen) to the NEXT ENTRY
    // met on the circle, whichever run it belongs to (rings are wound like d3's, the interior on the right)
    const az = (q: [number, number]) => Math.atan2(q[1], q[0]);
    const sg = dir[k];
    for (const first of runs) {
      if (first.used) continue;
      let run: Run | null = first;
      let begun = false;
      while (run && !run.used) {
        run.used = true;
        if (!begun) {
          moveTo(cx + R * run.entry[0], cy + R * run.entry[1]);
          begun = true;
        } else lineTo(cx + R * run.entry[0], cy + R * run.entry[1]);
        const len = (run.to - run.from + n) % n;
        for (let q = 0; q <= len; q++) {
          const j = 3 * (a + ((run.from + q) % n));
          lineTo(sx(j), sy(j));
        }
        lineTo(cx + R * run.exit[0], cy + R * run.exit[1]);
        // the nearest entry clockwise from this exit
        const a0 = az(run.exit);
        let next: Run | null = null;
        let best = Infinity;
        for (const r of runs) {
          let dd = (sg * (az(r.entry) - a0)) % (2 * Math.PI);
          if (dd < 0) dd += 2 * Math.PI;
          if (dd < best) {
            best = dd;
            next = r;
          }
        }
        if (!next) break;
        const steps = Math.max(1, Math.ceil(best / ARC_STEP));
        for (let q = 1; q < steps; q++) lineTo(cx + R * Math.cos(a0 + (sg * best * q) / steps), cy + R * Math.sin(a0 + (sg * best * q) / steps));
        run = next;
        if (run === first) break;
      }
      out.push('Z');
    }
  }
  return out.join('');
}

/** vertices per ring and its winding (tests) */
export function landRings(): Array<{ vertices: number; dir: number; radius: number; centre: [number, number] }> {
  const { start, dir, cap } = landData();
  return Array.from({ length: start.length - 1 }, (_, k) => ({ vertices: start[k + 1] - start[k], dir: dir[k], radius: cap[4 * k + 3], centre: [(Math.atan2(cap[4 * k + 1], cap[4 * k]) * 180) / Math.PI, (Math.asin(cap[4 * k + 2]) * 180) / Math.PI] }));
}
