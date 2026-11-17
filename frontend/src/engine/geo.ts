export interface LatLon {
  lat: number;
  lon: number;
}

// Redis GEO uses this Earth radius for its haversine distance, so results match GEOSEARCH.
const EARTH_RADIUS_M = 6372797.560856;

export function distanceKm(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return (2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h))) / 1000;
}

/** A point northKm north and eastKm east of base (good enough at city scale). */
export function offsetKm(base: LatLon, northKm: number, eastKm: number): LatLon {
  const lat = base.lat + northKm / 111.32;
  const lon = base.lon + eastKm / (111.32 * Math.cos((base.lat * Math.PI) / 180));
  return { lat, lon };
}

/** Polygon ring approximating a circle, as [lon, lat] pairs for GeoJSON. */
export function circleRing(center: LatLon, radiusKm: number, steps = 64): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const p = offsetKm(center, radiusKm * Math.cos(angle), radiusKm * Math.sin(angle));
    ring.push([p.lon, p.lat]);
  }
  return ring;
}
