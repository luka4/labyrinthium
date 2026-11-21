/**
 * The world map's geography (plan 06): true sites, the fictional island, the globe turn. Plain node, no
 * Skia. Called from check-floors.ts.
 */
import { geoContains, geoDistance, geoOrthographic } from 'd3-geo';

import { PYRAMIDS, SEALS, type PyramidId } from '../src/game/core/pyramids';
import { SITE_ORDER, arc, distance, landFeature, turn, viewFor, visible } from '../src/game/world/geo';
import { landPath } from '../src/game/world/projectLand';

type Report = { fail: (m: string) => void; warn: (m: string) => void };

export function runWorldChecks({ fail, warn }: Report) {
  const ids = Object.keys(PYRAMIDS) as PyramidId[];
  for (const id of ids) {
    const s = PYRAMIDS[id].site;
    if (!(s.lat >= -90 && s.lat <= 90 && s.lon >= -180 && s.lon <= 180)) fail(`world: ${id} site out of range`);
  }
  if (SITE_ORDER.length !== ids.length || ids.some((id) => !SITE_ORDER.includes(id))) fail('world: SITE_ORDER is not every pyramid once');
  const lons = SITE_ORDER.slice(0, 4).map((id) => PYRAMIDS[id].site.lon);
  if (lons.some((l, i) => i > 0 && l <= lons[i - 1])) fail(`world: the four sites are not west to east (${lons.join(', ')})`);
  if (SITE_ORDER[4] !== 'black') fail('world: the Black Pyramid is not last');
  if (SEALS.some((id) => id === 'black')) fail('world: black among the seals');

  // the real sites stand on land, the fictional island does not and is far from every coast
  const land = landFeature();
  for (const id of ids) {
    if (id === 'black') continue;
    const s = PYRAMIDS[id].site;
    if (!geoContains(land as never, [s.lon, s.lat])) fail(`world: ${id} (${s.lat}, ${s.lon}) is not on land`);
  }
  const b = PYRAMIDS.black.site;
  if (geoContains(land as never, [b.lon, b.lat])) fail('world: the Black Pyramid is on land');
  let nearest = Infinity;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') nearest = Math.min(nearest, geoDistance([b.lon, b.lat], c as [number, number]));
    else if (Array.isArray(c)) for (const x of c) walk(x);
  };
  const features = (land as { features?: Array<{ geometry: { coordinates: unknown } }>; geometry?: { coordinates: unknown } }).features ?? [land as { geometry: { coordinates: unknown } }];
  for (const f of features) walk(f.geometry.coordinates);
  const deg = (nearest * 180) / Math.PI;
  if (deg < 5) fail(`world: the Black Pyramid is only ${deg.toFixed(1)} degrees from a coast (want >= 5)`);

  // turning
  for (const a of SITE_ORDER) {
    for (const c of SITE_ORDER) {
      const from = viewFor(a);
      const to = viewFor(c);
      const t0 = turn(from, to, 0);
      const t1 = turn(from, to, 1);
      if (Math.abs(t0.lon - from.lon) > 1e-9 || Math.abs(t1.lat - to.lat) > 1e-9 || Math.abs(t1.lon - to.lon) > 1e-9) fail(`world: turn ${a} -> ${c} misses an endpoint`);
      // the shortest way: no step of the interpolation moves the longitude by more than 180
      let prev = from.lon;
      for (let k = 1; k <= 20; k++) {
        const m = turn(from, to, k / 20);
        const d = Math.abs(((m.lon - prev + 540) % 360) - 180);
        if (d > 180 - 1e-9 && a !== c) fail(`world: turn ${a} -> ${c} jumps`);
        prev = m.lon;
      }
      if (a !== c && distance(from, to) > Math.PI) fail('world: distance over pi');
      const mid = turn(from, to, 0.5);
      if (distance(from, mid) > distance(from, to) + 1e-9) fail(`world: turn ${a} -> ${c} goes the long way`);
    }
  }
  const a0 = arc({ lon: 31, lat: 30 }, { lon: 83, lat: -9.5 }, 0);
  const a1 = arc({ lon: 31, lat: 30 }, { lon: 83, lat: -9.5 }, 1);
  if (Math.abs(a0.lon - 31) > 1e-9 || Math.abs(a1.lat + 9.5) > 1e-9) fail('world: arc endpoints');
  // visibility: a site faces you when the globe is turned to it, and not on the far side
  if (!visible(viewFor('egypt'), PYRAMIDS.egypt.site)) fail('world: egypt not visible when centred');
  if (visible(viewFor('maya'), PYRAMIDS.china.site)) fail('world: china visible from the Americas');

  // the land projector against d3's geoContains: sample points inside the disc, views around the sites and at random
  const R = 165;
  const views: Array<[number, number]> = SITE_ORDER.map((id) => [viewFor(id).lon, viewFor(id).lat]);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let k = 0; k < 14; k++) views.push([rnd() * 360 - 180, -20 + rnd() * 65]);
  let worst = 0;
  for (const [lon, lat] of views) {
    const rings: number[][] = [];
    landPath(lon, lat, R, 180, 180, rings);
    const proj = geoOrthographic().rotate([-lon, -lat]).scale(R).translate([180, 180]).clipAngle(90);
    let bad = 0;
    let n = 0;
    for (let k = 0; k < 160; k++) {
      const x = 180 + (rnd() * 2 - 1) * R * 0.985;
      const y = 180 + (rnd() * 2 - 1) * R * 0.985;
      if ((x - 180) ** 2 + (y - 180) ** 2 > (R * 0.98) ** 2) continue;
      n++;
      let inside = false;
      for (const r of rings) for (let i = 0, j = r.length - 2; i < r.length; i += 2) {
        if (r[i + 1] > y !== r[j + 1] > y && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) inside = !inside;
        j = i;
      }
      if (geoContains(land as never, proj.invert!([x, y])!) !== inside) bad++;
    }
    worst = Math.max(worst, bad / Math.max(1, n));
  }
  if (worst > 0.03) fail(`world: the land projector disagrees with d3 on ${(worst * 100).toFixed(1)} % of the points of a view (max 3 %)`);

  // one frame: the land path string and the graticule
  landPath(31, 29.98, R, 180, 180);
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) landPath(31 + k, 30, R, 180, 180);
  const ms = (performance.now() - t0) / 20;
  console.log(`world: land path for one globe frame ${ms.toFixed(2)} ms on this machine (worst view mismatch ${(worst * 100).toFixed(2)} %)`);
  if (ms > 1.5) warn(`world: land path ${ms.toFixed(2)} ms (target <= 1.5 desktop)`);
}
