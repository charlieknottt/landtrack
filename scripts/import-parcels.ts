import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function addressesDiffer(situs: string, street: string): boolean {
  if (!situs || !situs.trim()) return false;
  const s = situs.toLowerCase().replace(/[^a-z0-9]/g, "");
  const m = street.toLowerCase().replace(/[^a-z0-9]/g, "");
  return s !== m;
}

async function main() {
  const geojsonPath = process.argv[2] || "../public/all_parcels.geojson";
  const defaultState = process.argv[3] || "PA";
  console.log(`Reading ${geojsonPath} (default state: ${defaultState})...`);
  const raw = readFileSync(geojsonPath, "utf-8");
  const data = JSON.parse(raw);
  const features = data.features;
  console.log(`Loaded ${features.length} features`);

  const BATCH = 200;
  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < features.length; i += BATCH) {
    const batch = features.slice(i, i + BATCH);

    const rows = batch.map((f: { properties: Record<string, unknown>; geometry: object }) => {
      const p = f.properties;
      return {
        state: String(p.state || defaultState),
        county: p.county || "",
        fid: Number(p.fid) || 0,
        taxidnum: String(p.taxidnum || ""),
        municipality: String(p.municipality || ""),
        acres: Number(p.acres) || 0,
        owner_name: String(p.owner_name || ""),
        mailing_street: String(p.mailing_street || ""),
        mailing_city: String(p.mailing_city || ""),
        mailing_state: String(p.mailing_state || ""),
        mailing_zip: String(p.mailing_zip || ""),
        situs: String(p.situs || ""),
        land_use: String(p.land_use || ""),
        sale_year: Number(p.sale_year) || null,
        sale_amt: Number(p.sale_amt) || 0,
        assessed_total: Number(p.assessed_total) || 0,
        land_val: Number(p.land_val) || 0,
        improv_val: Number(p.improv_val) || 0,
        deed_book: String(p.deed_book || ""),
        deed_page: String(p.deed_page || ""),
        address_mismatch: addressesDiffer(String(p.situs || ""), String(p.mailing_street || "")),
        borders_forest: false,
      };
    });

    // Use RPC to insert with geometry since supabase-js can't handle PostGIS directly
    const { error } = await supabase.rpc("insert_parcels_batch", {
      parcels_json: JSON.stringify(
        batch.map((f: { properties: Record<string, unknown>; geometry: object }, idx: number) => ({
          ...rows[idx],
          geojson: JSON.stringify(f.geometry),
        }))
      ),
    });

    if (error) {
      console.error(`Batch ${i} error: ${error.message}`);
      skipped += batch.length;
    } else {
      inserted += batch.length;
    }

    if ((i + BATCH) % 1000 === 0 || i + BATCH >= features.length) {
      console.log(`  ${Math.min(i + BATCH, features.length)}/${features.length} (${inserted} inserted, ${skipped} skipped)`);
    }
  }

  console.log(`Done. ${inserted} inserted, ${skipped} skipped.`);
}

main().catch(console.error);
