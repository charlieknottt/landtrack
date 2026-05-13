import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ type: "FeatureCollection", features: [] });
  }
  const bbox = request.nextUrl.searchParams.get("bbox")?.split(",").map(Number);
  const [west, south, east, north] = bbox && bbox.length === 4
    ? bbox
    : [-180, -90, 180, 90];

  const { data, error } = await supabase.rpc("get_forests_in_bbox", {
    bbox_west: west,
    bbox_south: south,
    bbox_east: east,
    bbox_north: north,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const features = (data || []).map((row: { name: string; type: string; geometry: object }) => ({
    type: "Feature" as const,
    geometry: row.geometry,
    properties: { name: row.name, type: row.type },
  }));

  return Response.json({ type: "FeatureCollection", features });
}
