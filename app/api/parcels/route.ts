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
  const sp = request.nextUrl.searchParams;

  const bbox = sp.get("bbox")?.split(",").map(Number);
  const [bboxWest, bboxSouth, bboxEast, bboxNorth] = bbox && bbox.length === 4
    ? bbox
    : [-180, -90, 180, 90];

  const params = {
    bbox_west: bboxWest,
    bbox_south: bboxSouth,
    bbox_east: bboxEast,
    bbox_north: bboxNorth,
    p_county: sp.get("county") || null,
    p_min_acres: Number(sp.get("minAcres")) || 0,
    p_max_acres: Number(sp.get("maxAcres")) || 99999,
    p_state: sp.get("state") || null,
    p_max_sale_year: sp.get("maxSaleYear") ? Number(sp.get("maxSaleYear")) : null,
    p_search: sp.get("search") || null,
    p_address_mismatch: sp.get("addressMismatch") === "true" ? true : null,
    p_borders_forest: sp.get("bordersForest") === "true" ? true : null,
    p_sort: sp.get("sort") || "acres",
    p_dir: sp.get("dir") || "desc",
    p_limit: Math.min(Number(sp.get("limit")) || 500, 500),
    p_offset: Number(sp.get("offset")) || 0,
    p_zoom: Number(sp.get("zoom")) || 15,
  };

  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ type: "FeatureCollection", features: [], total: 0 });
  }

  const { data, error } = await supabase.rpc("search_parcels", params);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  const rows = data || [];
  const total = rows.length > 0 ? rows[0].total_count : 0;

  const features = rows.map((row: Record<string, unknown>) => ({
    type: "Feature" as const,
    geometry: row.geometry,
    properties: {
      county: row.county,
      fid: row.fid,
      taxidnum: row.taxidnum,
      municipality: row.municipality,
      acres: row.acres,
      owner_name: row.owner_name,
      mailing_street: row.mailing_street,
      mailing_city: row.mailing_city,
      mailing_state: row.mailing_state,
      mailing_zip: row.mailing_zip,
      situs: row.situs,
      land_use: row.land_use,
      sale_year: row.sale_year,
      sale_amt: row.sale_amt,
      assessed_total: row.assessed_total,
      land_val: row.land_val,
      improv_val: row.improv_val,
      deed_book: row.deed_book,
      deed_page: row.deed_page,
      address_mismatch: row.address_mismatch,
      borders_forest: row.borders_forest,
    },
  }));

  return Response.json({
    type: "FeatureCollection",
    features,
    total,
  });
}
