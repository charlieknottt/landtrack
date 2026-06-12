-- Migration: water features (rivers, ponds, lakes) and has_water flag.
-- Run in the Supabase SQL Editor AFTER migration-absentee.sql.

-- 1. Water feature geometries from USGS NHD (mixed lines and polygons)
CREATE TABLE water_features (
  id    SERIAL PRIMARY KEY,
  state TEXT NOT NULL,
  name  TEXT,
  type  TEXT NOT NULL,                -- 'Stream/River', 'Lake/Pond', 'Reservoir'
  geom  GEOMETRY(Geometry, 4326) NOT NULL
);
CREATE INDEX idx_water_geom ON water_features USING GIST (geom);

-- 2. Batch insert helper for import-water.py
CREATE OR REPLACE FUNCTION insert_water_batch(water_json TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rec JSONB;
BEGIN
  FOR rec IN SELECT jsonb_array_elements(water_json::jsonb)
  LOOP
    INSERT INTO water_features (state, name, type, geom)
    VALUES (
      rec->>'state',
      NULLIF(rec->>'name', ''),
      rec->>'type',
      ST_MakeValid(ST_GeomFromGeoJSON(rec->>'geojson'))
    );
  END LOOP;
END;
$$;

-- 3. Flag on parcels
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS has_water BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_parcels_water ON parcels (has_water) WHERE has_water;

-- 4. search_parcels: filter on and return has_water (requires the absentee
--    migration to have run first). Return type changes, so drop first.
DROP FUNCTION IF EXISTS search_parcels;

CREATE FUNCTION search_parcels(
  bbox_west FLOAT DEFAULT -180,
  bbox_south FLOAT DEFAULT -90,
  bbox_east FLOAT DEFAULT 180,
  bbox_north FLOAT DEFAULT 90,
  p_county TEXT DEFAULT NULL,
  p_min_acres REAL DEFAULT 0,
  p_max_acres REAL DEFAULT 99999,
  p_state TEXT DEFAULT NULL,            -- owner mailing state
  p_max_sale_year INT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_address_mismatch BOOLEAN DEFAULT NULL,
  p_borders_forest BOOLEAN DEFAULT NULL,
  p_sort TEXT DEFAULT 'acres',
  p_dir TEXT DEFAULT 'desc',
  p_limit INT DEFAULT 500,
  p_offset INT DEFAULT 0,
  p_zoom INT DEFAULT 15,
  p_parcel_state TEXT DEFAULT NULL,     -- state the parcel is located in
  p_county_keys TEXT[] DEFAULT NULL,    -- selected counties as 'ST|County' keys
  p_absentee BOOLEAN DEFAULT NULL,      -- true = absentee owners only
  p_has_water BOOLEAN DEFAULT NULL      -- true = water on property only
)
RETURNS TABLE(
  id INT,
  state TEXT,
  county TEXT,
  fid INT,
  taxidnum TEXT,
  municipality TEXT,
  acres REAL,
  owner_name TEXT,
  mailing_street TEXT,
  mailing_city TEXT,
  mailing_state TEXT,
  mailing_zip TEXT,
  situs TEXT,
  land_use TEXT,
  sale_year INT,
  sale_amt REAL,
  assessed_total REAL,
  land_val REAL,
  improv_val REAL,
  deed_book TEXT,
  deed_page TEXT,
  address_mismatch BOOLEAN,
  borders_forest BOOLEAN,
  absentee BOOLEAN,
  has_water BOOLEAN,
  geometry JSON,
  total_count BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id, p.state, p.county, p.fid, p.taxidnum, p.municipality,
    p.acres, p.owner_name, p.mailing_street, p.mailing_city,
    p.mailing_state, p.mailing_zip, p.situs, p.land_use,
    p.sale_year, p.sale_amt, p.assessed_total, p.land_val,
    p.improv_val, p.deed_book, p.deed_page,
    p.address_mismatch, p.borders_forest, p.absentee, p.has_water,
    ST_AsGeoJSON(
      CASE
        WHEN p_zoom < 10 THEN ST_Simplify(p.geom, 0.005)
        WHEN p_zoom < 13 THEN ST_Simplify(p.geom, 0.001)
        ELSE p.geom
      END
    )::json AS geometry,
    COUNT(*) OVER() AS total_count
  FROM parcels p
  WHERE p.geom && ST_MakeEnvelope(bbox_west, bbox_south, bbox_east, bbox_north, 4326)
    AND (p_county IS NULL OR p.county = p_county)
    AND (p_parcel_state IS NULL OR p.state = p_parcel_state)
    AND (p_county_keys IS NULL OR (p.state || '|' || p.county) = ANY(p_county_keys))
    AND p.acres BETWEEN p_min_acres AND p_max_acres
    AND (p_state IS NULL OR p.mailing_state = p_state)
    AND (p_max_sale_year IS NULL OR p.sale_year IS NULL OR p.sale_year <= p_max_sale_year)
    AND (p_search IS NULL OR p.search_text @@ plainto_tsquery('english', p_search)
         OR p.taxidnum ILIKE '%' || p_search || '%')
    AND (p_address_mismatch IS NULL OR p.address_mismatch = p_address_mismatch)
    AND (p_borders_forest IS NULL OR p.borders_forest = p_borders_forest)
    AND (p_absentee IS NULL OR p.absentee = p_absentee)
    AND (p_has_water IS NULL OR p.has_water = p_has_water)
  ORDER BY
    CASE WHEN p_sort = 'acres' AND p_dir = 'desc' THEN p.acres END DESC NULLS LAST,
    CASE WHEN p_sort = 'acres' AND p_dir = 'asc' THEN p.acres END ASC NULLS LAST,
    CASE WHEN p_sort = 'sale_year' AND p_dir = 'desc' THEN p.sale_year END DESC NULLS LAST,
    CASE WHEN p_sort = 'sale_year' AND p_dir = 'asc' THEN p.sale_year END ASC NULLS LAST,
    CASE WHEN p_sort = 'assessed_total' AND p_dir = 'desc' THEN p.assessed_total END DESC NULLS LAST,
    CASE WHEN p_sort = 'assessed_total' AND p_dir = 'asc' THEN p.assessed_total END ASC NULLS LAST,
    CASE WHEN p_sort = 'owner_name' AND p_dir = 'asc' THEN p.owner_name END ASC NULLS LAST,
    CASE WHEN p_sort = 'owner_name' AND p_dir = 'desc' THEN p.owner_name END DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
$$;

-- 5. AFTER import-water.py has run (and again after any parcel re-import),
--    compute the flag. Runs in the SQL editor; takes a minute or two:
-- UPDATE parcels SET has_water = EXISTS (
--   SELECT 1 FROM water_features w
--   WHERE parcels.geom && w.geom AND ST_Intersects(parcels.geom, w.geom)
-- );
