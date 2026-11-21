import { geoDistance, geoInterpolate } from 'd3-geo';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';

import { PYRAMIDS, type PyramidId, type Site } from '../core/pyramids';
import landTopology from 'world-atlas/land-110m.json';

/**
 * The geography of the world map (plan 06): plain TypeScript, no Skia. The four real pyramids stand
 * where the real ones are; the Black Pyramid sits on an uncharted island in the open Indian Ocean.
 * Coastlines are Natural Earth 110m land (public domain) from `world-atlas`, converted once on first use.
 */
export type LonLat = { lon: number; lat: number };

/** the pager order, west to east, the Black Pyramid last */
export const SITE_ORDER: readonly PyramidId[] = ['maya', 'egypt', 'cambodia', 'china', 'black'];

export const siteOf = (id: PyramidId): Site => PYRAMIDS[id].site;

const RAD = Math.PI / 180;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** the globe centre that shows a pyramid: its longitude, its latitude kept between -20 and 45 */
export function viewFor(id: PyramidId): LonLat {
  const s = siteOf(id);
  return { lon: s.lon, lat: clamp(s.lat, -20, 45) };
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** The globe centre while turning from one view to another along the shortest great circle, eased. */
export function turn(from: LonLat, to: LonLat, t: number): LonLat {
  const u = clamp(t, 0, 1);
  if (u <= 0) return from;
  if (u >= 1) return to;
  const [lon, lat] = geoInterpolate([from.lon, from.lat], [to.lon, to.lat])(easeInOutCubic(u));
  return { lon, lat };
}

/** a site faces the viewer when it is on the near side of the limb, with a small margin */
export function visible(center: LonLat, site: Pick<Site, 'lon' | 'lat'>): boolean {
  return geoDistance([center.lon, center.lat], [site.lon, site.lat]) < Math.PI / 2 - 0.05;
}

/** A point on the great circle between two places, 0..1 (longitude, latitude). */
export function arc(a: LonLat, b: LonLat, t: number): LonLat {
  const [lon, lat] = geoInterpolate([a.lon, a.lat], [b.lon, b.lat])(clamp(t, 0, 1));
  return { lon, lat };
}

/** great-circle distance in radians */
export const distance = (a: LonLat, b: LonLat): number => geoDistance([a.lon, a.lat], [b.lon, b.lat]);

let land: FeatureCollection<Polygon | MultiPolygon> | ReturnType<typeof feature> | null = null;

/** The land of the 110m atlas as GeoJSON; parsed once (about 15 ms) on first use. */
export function landFeature() {
  if (!land) {
    const topo = landTopology as unknown as Topology<{ land: GeometryCollection }>;
    land = feature(topo, topo.objects.land);
  }
  return land;
}

export { RAD };
