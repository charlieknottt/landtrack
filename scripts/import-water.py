#!/usr/bin/env python3
"""Download water features (perennial rivers/streams, lakes, ponds, reservoirs)
from USGS NHD for every LandTrack county and import into Supabase.

Coverage: all 12 counties (7 PA + 5 AL). County bounding boxes come from the
Census TIGERweb service, so adding a county is just one more line below.

Run AFTER migration-water.sql:
  cd landtrack && export $(grep -v '^#' .env.local | xargs) && python3 scripts/import-water.py
Then compute flags in the Supabase SQL editor (see migration-water.sql step 5).
"""

import json
import os
import sys
import time
import requests

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (source .env.local)")
    sys.exit(1)

HEADERS = {"User-Agent": "LandTrack-Water-Import/1.0"}

NHD = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer"
TIGER = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query"

# Large-scale (high-res) layers
FLOWLINE_LAYER = 6     # perennial streams/rivers: fcode = 46006
WATERBODY_LAYER = 12   # lakes/ponds (ftype 390), reservoirs (436)

# (state, county name, state FIPS)
COUNTIES = [
    ("PA", "Bedford", "42"), ("PA", "Cameron", "42"), ("PA", "Clearfield", "42"),
    ("PA", "Clinton", "42"), ("PA", "Huntingdon", "42"), ("PA", "Lycoming", "42"),
    ("PA", "Potter", "42"),
    ("AL", "Blount", "01"), ("AL", "DeKalb", "01"), ("AL", "Etowah", "01"),
    ("AL", "Jackson", "01"), ("AL", "Marshall", "01"),
]

WATERBODY_TYPES = {390: "Lake/Pond", 436: "Reservoir"}


def county_bbox(session, state_fips, name):
    resp = session.get(TIGER, params={
        "where": f"STATE='{state_fips}' AND BASENAME='{name}'",
        "returnExtentOnly": "true",
        "outSR": "4326",
        "f": "json",
    }, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    ext = resp.json()["extent"]
    return ext["xmin"], ext["ymin"], ext["xmax"], ext["ymax"]


def fetch_layer(session, layer, where, bbox, label):
    """Page through an NHD layer clipped to a bbox, return GeoJSON features."""
    features = []
    offset = 0
    base = {
        "where": where,
        "geometry": ",".join(str(c) for c in bbox),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "outSR": "4326",
        "outFields": "permanent_identifier,gnis_name,ftype",
        "maxAllowableOffset": "0.00005",  # ~5m generalization to keep rows small
        "returnGeometry": "true",
        "f": "geojson",
    }
    while True:
        params = dict(base, resultOffset=offset, resultRecordCount=2000)
        for attempt in range(3):
            try:
                resp = session.get(f"{NHD}/{layer}/query", params=params,
                                   headers=HEADERS, timeout=120)
                resp.raise_for_status()
                data = resp.json()
                break
            except Exception as e:
                if attempt == 2:
                    raise
                print(f"    retry {attempt + 1} after error: {e}")
                time.sleep(2 * (attempt + 1))
        batch = data.get("features", [])
        if not batch:
            break
        features.extend(batch)
        offset += len(batch)
        print(f"    {label}: {offset} features")
        sys.stdout.flush()
        if len(batch) < 2000:
            break
        time.sleep(0.3)
    return features


def insert_batch(rows):
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/insert_water_batch",
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
        },
        json={"water_json": json.dumps(rows)},
        timeout=120,
    )
    if resp.status_code >= 400:
        print(f"    insert error: {resp.text[:300]}")
        return 0
    return len(rows)


def main():
    session = requests.Session()
    seen = set()  # permanent_identifier dedupe across overlapping county boxes
    total_inserted = 0
    summary = []

    for state, name, fips in COUNTIES:
        print(f"\n{state} {name}:")
        bbox = county_bbox(session, fips, name)

        streams = fetch_layer(session, FLOWLINE_LAYER, "fcode = 46006", bbox, "streams")
        lakes = fetch_layer(session, WATERBODY_LAYER, "ftype IN (390, 436)", bbox, "waterbodies")

        rows = []
        for feat in streams + lakes:
            props = feat.get("properties", {})
            geom = feat.get("geometry")
            if not geom:
                continue
            pid = props.get("permanent_identifier")
            if pid and pid in seen:
                continue
            if pid:
                seen.add(pid)
            ftype = props.get("ftype")
            rows.append({
                "state": state,
                "name": props.get("gnis_name") or "",
                "type": WATERBODY_TYPES.get(ftype, "Stream/River"),
                "geojson": json.dumps(geom),
            })

        if not rows:
            print(f"  WARNING: no water features found for {state} {name} — investigate!")
        inserted = 0
        for i in range(0, len(rows), 50):
            inserted += insert_batch(rows[i:i + 50])
        total_inserted += inserted
        summary.append((state, name, len(streams), len(lakes), inserted))
        print(f"  {state} {name}: {len(streams)} streams + {len(lakes)} waterbodies -> {inserted} inserted")

    print("\n=== SUMMARY ===")
    for state, name, s, l, ins in summary:
        print(f"  {state} {name}: streams={s} waterbodies={l} inserted={ins}")
    print(f"  TOTAL inserted: {total_inserted}")
    print("\nNext: run the has_water UPDATE from migration-water.sql step 5.")


if __name__ == "__main__":
    main()
