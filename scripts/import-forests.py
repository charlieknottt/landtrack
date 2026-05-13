#!/usr/bin/env python3
"""Download PA state forest + game land boundaries from PASDA and import into Supabase."""

import json
import os
import sys
import time
import requests

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY env vars")
    print("(or source .env.local)")
    sys.exit(1)

HEADERS = {"User-Agent": "PA-Rural-Land-Research/1.0"}

SOURCES = {
    "state_forest": {
        "url": "https://www.gis.dcnr.pa.gov/agsprod/rest/services/BOF/State_Forests/MapServer/4",
        "name_field": "SF_Name",
        "type_label": "State Forest",
    },
    "game_land": {
        "url": "https://pgcmaps.pa.gov/arcgis/rest/services/PGC/NEW_PUBLIC/MapServer/17",
        "name_field": "NAME",
        "type_label": "State Game Land",
    },
}


def fetch_features(url, name_field, page_size=500):
    """Download all features from an ArcGIS layer as GeoJSON."""
    features = []
    offset = 0

    count_resp = requests.get(
        f"{url}/query",
        params={"where": "1=1", "returnCountOnly": "true", "f": "json"},
        headers=HEADERS,
        timeout=30,
    )
    total = count_resp.json().get("count", 0)
    print(f"  Total features: {total}")

    while offset < total:
        resp = requests.get(
            f"{url}/query",
            params={
                "where": "1=1",
                "outFields": name_field,
                "returnGeometry": "true",
                "outSR": "4326",
                "resultOffset": offset,
                "resultRecordCount": page_size,
                "f": "geojson",
            },
            headers=HEADERS,
            timeout=120,
        )
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("features", [])
        if not batch:
            break
        features.extend(batch)
        offset += len(batch)
        print(f"  Fetched {offset}/{total}")
        time.sleep(0.3)

    return features


def ensure_multipolygon(geometry):
    """Convert Polygon to MultiPolygon for consistent storage."""
    if geometry["type"] == "Polygon":
        return {"type": "MultiPolygon", "coordinates": [geometry["coordinates"]]}
    return geometry


def insert_forests(forests):
    """Insert forest boundaries into Supabase via RPC."""
    batch_size = 20
    inserted = 0

    for i in range(0, len(forests), batch_size):
        batch = forests[i : i + batch_size]
        payload = json.dumps(
            [
                {
                    "name": f["name"],
                    "type": f["type"],
                    "geojson": json.dumps(f["geometry"]),
                }
                for f in batch
            ]
        )

        resp = requests.post(
            f"{SUPABASE_URL}/rest/v1/rpc/insert_forests_batch",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Content-Type": "application/json",
            },
            json={"forests_json": payload},
            timeout=60,
        )

        if resp.status_code >= 400:
            print(f"  Batch {i} error: {resp.text[:200]}")
        else:
            inserted += len(batch)

        if (i + batch_size) % 100 == 0 or i + batch_size >= len(forests):
            print(f"  Inserted {inserted}/{len(forests)}")

    return inserted


def main():
    all_forests = []

    for source_key, config in SOURCES.items():
        print(f"\nDownloading {config['type_label']} boundaries...")
        features = fetch_features(config["url"], config["name_field"])

        for feat in features:
            geom = feat.get("geometry")
            if not geom:
                continue
            name = feat.get("properties", {}).get(config["name_field"], "Unknown")
            all_forests.append({
                "name": name or "Unknown",
                "type": config["type_label"],
                "geometry": ensure_multipolygon(geom),
            })

        print(f"  Got {len(features)} {config['type_label']} polygons")

    print(f"\nTotal: {len(all_forests)} boundaries to import")
    print("Inserting into Supabase...")
    inserted = insert_forests(all_forests)
    print(f"\nDone. {inserted} boundaries imported.")
    print("\nNext step: Run the adjacency computation in Supabase SQL Editor:")
    print("  UPDATE parcels SET borders_forest = EXISTS (")
    print("    SELECT 1 FROM state_forests sf")
    print("    WHERE ST_DWithin(parcels.geom, sf.geom, 0.0001)")
    print("  );")


if __name__ == "__main__":
    main()
