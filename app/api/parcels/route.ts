import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { isProRequest } from "@/lib/server-auth";
import { PAYWALL_ENABLED } from "@/lib/constants";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export const dynamic = "force-dynamic";

// Free tier: at most this many parcels per viewport, owner details stripped
const FREE_LIMIT = 50;

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const isPro = !PAYWALL_ENABLED || (await isProRequest(request));

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
    p_parcel_state: sp.get("parcelState") || null,
    p_county_keys: sp.get("countyKeys")?.split(",").filter(Boolean) || null,
    p_max_sale_year: sp.get("maxSaleYear") ? Number(sp.get("maxSaleYear")) : null,
    p_search: sp.get("search") || null,
    p_address_mismatch: sp.get("addressMismatch") === "true" ? true : null,
    p_borders_forest: sp.get("bordersForest") === "true" ? true : null,
    p_sort: sp.get("sort") || "acres",
    p_dir: sp.get("dir") || "desc",
    p_limit: Math.min(Number(sp.get("limit")) || 500, isPro ? 500 : FREE_LIMIT),
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
      state: row.state,
      county: row.county,
      fid: row.fid,
      taxidnum: row.taxidnum,
      municipality: row.municipality,
      acres: row.acres,
      // Owner identity and contact info are the paid product; the free
      // tier only sees parcel shape, size, and valuation.
      owner_name: isPro ? row.owner_name : "",
      mailing_street: isPro ? row.mailing_street : "",
      mailing_city: isPro ? row.mailing_city : "",
      mailing_state: isPro ? row.mailing_state : "",
      mailing_zip: isPro ? row.mailing_zip : "",
      situs: isPro ? row.situs : "",
      land_use: row.land_use,
      sale_year: row.sale_year,
      sale_amt: row.sale_amt,
      assessed_total: row.assessed_total,
      land_val: row.land_val,
      improv_val: row.improv_val,
      deed_book: isPro ? row.deed_book : "",
      deed_page: isPro ? row.deed_page : "",
      address_mismatch: row.address_mismatch,
      borders_forest: row.borders_forest,
    },
  }));

  return Response.json({
    type: "FeatureCollection",
    features,
    total,
    locked: !isPro,
  });
}
