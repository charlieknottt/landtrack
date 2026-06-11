import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { STATE_FIPS } from "@/lib/constants";

const TIGERWEB_URL =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query";

const FIPS_TO_ABBR: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_FIPS).map(([abbr, fips]) => [fips, abbr])
);

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

interface CountyFeature {
  properties: Record<string, string>;
}

const cache = new Map<string, object>();

export async function GET(request: NextRequest) {
  // keys are "ST|County" pairs; without them, outline every county in the DB
  const keysParam = request.nextUrl.searchParams.get("keys");
  let keys: string[];
  if (keysParam) {
    keys = keysParam.split(",").filter(Boolean);
  } else {
    const supabase = getSupabase();
    if (!supabase) return NextResponse.json({ type: "FeatureCollection", features: [] });
    const { data } = await supabase.rpc("get_county_counts");
    keys = ((data || []) as { state: string; county: string }[]).map(
      (r) => `${r.state}|${r.county}`
    );
  }

  const cacheKey = keys.slice().sort().join(",");
  const hit = cache.get(cacheKey);
  if (hit) return NextResponse.json(hit);

  const byFips = new Map<string, string[]>();
  for (const key of keys) {
    const [abbr, county] = key.split("|");
    const fips = STATE_FIPS[abbr];
    if (!fips || !county) continue;
    const list = byFips.get(fips) || [];
    list.push(county.replace(/'/g, "''"));
    byFips.set(fips, list);
  }

  if (byFips.size === 0) {
    return NextResponse.json({ type: "FeatureCollection", features: [] });
  }

  const where = [...byFips.entries()]
    .map(([fips, counties]) =>
      `(STATE='${fips}' AND BASENAME IN (${counties.map((c) => `'${c}'`).join(",")}))`
    )
    .join(" OR ");

  const params = new URLSearchParams({
    where,
    outFields: "BASENAME,STATE",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
  });

  const res = await fetch(`${TIGERWEB_URL}?${params}`, {
    next: { revalidate: 86400 },
  });
  const data = await res.json();

  for (const feature of (data.features || []) as CountyFeature[]) {
    feature.properties.NAME = feature.properties.BASENAME;
    feature.properties.STATE_ABBR = FIPS_TO_ABBR[feature.properties.STATE] || "";
  }

  cache.set(cacheKey, data);
  return NextResponse.json(data);
}
