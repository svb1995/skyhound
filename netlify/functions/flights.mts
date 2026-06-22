import type { Context, Config } from "@netlify/functions";

// Proxies adsb.lol so the browser fetches from our own origin (no CORS issue).
export default async (req: Request, context: Context) => {
  const { lat, lon, nm } = context.params as Record<string, string>;

  // basic validation
  const fLat = Number(lat), fLon = Number(lon), fNm = Number(nm);
  if (!isFinite(fLat) || !isFinite(fLon) || !isFinite(fNm)) {
    return new Response(JSON.stringify({ error: "bad params" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const url = `https://api.adsb.lol/v2/point/${fLat}/${fLon}/${Math.min(250, Math.round(fNm))}`;

  try {
    const upstream = await fetch(url, {
      headers: { "User-Agent": "FlightBoard/1.0 (netlify function)" },
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        "content-type": "application/json",
        // cache briefly at the edge so rapid refreshes are cheap
        "cache-control": "public, max-age=5",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "upstream fetch failed" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/flights/:lat/:lon/:nm",
};
