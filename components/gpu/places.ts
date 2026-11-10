// Cities on the homepage globe. The hero checkout's countries (hero-demo.tsx)
// are keyed by the same ids, so picking a country turns the globe to it.
export type GeoPoint = { lat: number; lon: number };

export const heroCities: Record<string, GeoPoint> = {
  ng: { lat: 6.52, lon: 3.38 }, // Lagos
  gb: { lat: 51.51, lon: -0.13 }, // London
  in: { lat: 19.08, lon: 72.88 }, // Mumbai
  us: { lat: 40.71, lon: -74.0 }, // New York
  br: { lat: -23.55, lon: -46.63 }, // São Paulo
  au: { lat: -33.87, lon: 151.21 }, // Sydney
};

// Other places payments move between, for the ambient arcs.
export const hubs: GeoPoint[] = [
  { lat: -1.29, lon: 36.82 }, // Nairobi
  { lat: 5.6, lon: -0.19 }, // Accra
  { lat: 19.43, lon: -99.13 }, // Mexico City
  { lat: 1.35, lon: 103.82 }, // Singapore
  { lat: 25.2, lon: 55.27 }, // Dubai
  { lat: -26.2, lon: 28.05 }, // Johannesburg
  { lat: 14.6, lon: 120.98 }, // Manila
  { lat: 4.71, lon: -74.07 }, // Bogotá
  { lat: 48.85, lon: 2.35 }, // Paris
];

const rad = Math.PI / 180;
// Unit-sphere position: longitude 0 faces the camera (+z), east to the right.
export function toVec(p: GeoPoint, r = 1): [number, number, number] {
  const c = Math.cos(p.lat * rad);
  return [c * Math.sin(p.lon * rad) * r, Math.sin(p.lat * rad) * r, c * Math.cos(p.lon * rad) * r];
}
