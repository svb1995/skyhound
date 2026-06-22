import type { Context, Config } from "@netlify/functions";

// Looks up a flight's origin/destination by callsign via adsbdb.com (keyless).
// Validates the route against the aircraft's reported position to drop stale
// or mismatched routes (a common issue with callsign-based route databases).
export default async (req: Request, context: Context) => {
  const { callsign } = context.params as Record<string, string>;
  const cs = (callsign || "").trim().toUpperCase();

  const url = new URL(req.url);
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lon = parseFloat(url.searchParams.get("lon") || "");

  const noRoute = (cache = 600) =>
    new Response(JSON.stringify({ route: null }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": `public, max-age=${cache}` },
    });

  if (!/^[A-Z0-9]{2,8}$/.test(cs)) return noRoute();

  try {
    const upstream = await fetch(`https://api.adsbdb.com/v0/callsign/${cs}`, {
      headers: { "User-Agent": "FlightBoard/1.0 (netlify function)" },
    });
    if (!upstream.ok) return noRoute();

    const data = await upstream.json();
    const fr = data?.response?.flightroute;
    if (!fr || !fr.origin || !fr.destination) return noRoute();

    const o = fr.origin, d = fr.destination;

    // Plausibility: the aircraft should be reasonably near the great-circle
    // path between origin and destination. If far off, the cached route is
    // probably for a different leg flown under the same callsign — drop it.
    if (isFinite(lat) && isFinite(lon) &&
        isFinite(o.latitude) && isFinite(o.longitude) &&
        isFinite(d.latitude) && isFinite(d.longitude)) {
      const dev = corridorDeviationKm(lat, lon, o.latitude, o.longitude, d.latitude, d.longitude);
      const routeLen = haversineKm(o.latitude, o.longitude, d.latitude, d.longitude);
      const allow = Math.max(250, routeLen * 0.35);
      if (dev > allow) return noRoute(120);
    }

    const route = {
      origin: o.iata_code || o.icao_code || null,
      originCity: o.municipality || null,
      dest: d.iata_code || d.icao_code || null,
      destCity: d.municipality || null,
      airline: fr.airline?.name || null,
    };

    return new Response(JSON.stringify({ route }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=900" },
    });
  } catch (err) {
    return noRoute(60);
  }
};

function toRad(x: number) { return (x * Math.PI) / 180; }
function haversineKm(a: number, b: number, c: number, d: number) {
  const R = 6371;
  const dLat = toRad(c - a), dLon = toRad(d - b);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function corridorDeviationKm(plat: number, plon: number, olat: number, olon: number, dlat: number, dlon: number) {
  const dO = haversineKm(plat, plon, olat, olon);
  const dD = haversineKm(plat, plon, dlat, dlon);
  const dOD = haversineKm(olat, olon, dlat, dlon) || 1;
  const s = (dO + dD + dOD) / 2;
  const areaSq = Math.max(0, s * (s - dO) * (s - dD) * (s - dOD));
  const height = (2 * Math.sqrt(areaSq)) / dOD;
  const along = (dO * dO - dD * dD + dOD * dOD) / (2 * dOD);
  if (along < 0) return dO;
  if (along > dOD) return dD;
  return height;
}

export const config: Config = {
  path: "/api/route/:callsign",
};
