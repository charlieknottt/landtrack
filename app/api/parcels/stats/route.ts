import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = getSupabase();
  if (!supabase) {
    return Response.json({ total: 0, filtered: 0, counties: [], states: [] });
  }
  const [countResult, countyResult, stateResult] = await Promise.all([
    supabase.from("parcels").select("*", { count: "exact", head: true }),
    supabase.rpc("get_county_counts"),
    supabase.rpc("get_distinct_states"),
  ]);

  if (countResult.error || countyResult.error || stateResult.error) {
    const err = countResult.error || countyResult.error || stateResult.error;
    return Response.json({ error: err!.message }, { status: 500 });
  }

  return Response.json({
    total: countResult.count || 0,
    filtered: countResult.count || 0,
    counties: (countyResult.data || []).map((r: { state: string; county: string; count: number }) => ({
      state: r.state,
      name: r.county,
      count: r.count,
    })),
    states: (stateResult.data || []).map((r: { mailing_state: string }) => r.mailing_state),
  });
}
