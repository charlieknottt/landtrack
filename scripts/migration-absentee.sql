-- Migration: absentee becomes a data flag instead of an import precondition.
-- Run in the Supabase SQL Editor (project pkkiqrncgjvxaslbesec).

-- 1. Column. Everything currently in the DB came through the old absentee
--    gate, so mark it all absentee for now; the re-import sets each row
--    precisely from corrected ZIP lists.
ALTER TABLE parcels ADD COLUMN IF NOT EXISTS absentee BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE parcels SET absentee = TRUE;
CREATE INDEX IF NOT EXISTS idx_parcels_absentee ON parcels (absentee) WHERE absentee;

-- 2. search_parcels: filter on and return the flag. Return type changes, so drop first.
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
  p_absentee BOOLEAN DEFAULT NULL       -- true = absentee owners only
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
    p.address_mismatch, p.borders_forest, p.absentee,
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

-- 3. insert_parcels_batch becomes an upsert: re-importing refreshes
--    attributes, geometry, and absentee, but preserves the computed
--    borders_forest flag on existing rows.
CREATE OR REPLACE FUNCTION insert_parcels_batch(parcels_json TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rec JSONB;
BEGIN
  FOR rec IN SELECT jsonb_array_elements(parcels_json::jsonb)
  LOOP
    INSERT INTO parcels (
      state, county, fid, taxidnum, municipality, acres, owner_name,
      mailing_street, mailing_city, mailing_state, mailing_zip,
      situs, land_use, sale_year, sale_amt, assessed_total,
      land_val, improv_val, deed_book, deed_page,
      address_mismatch, borders_forest, absentee, geom
    ) VALUES (
      COALESCE(NULLIF(rec->>'state', ''), 'PA'),
      rec->>'county', (rec->>'fid')::int, rec->>'taxidnum', rec->>'municipality',
      (rec->>'acres')::real, rec->>'owner_name',
      rec->>'mailing_street', rec->>'mailing_city', rec->>'mailing_state', rec->>'mailing_zip',
      rec->>'situs', rec->>'land_use',
      (rec->>'sale_year')::int, (rec->>'sale_amt')::real, (rec->>'assessed_total')::real,
      (rec->>'land_val')::real, (rec->>'improv_val')::real,
      rec->>'deed_book', rec->>'deed_page',
      (rec->>'address_mismatch')::boolean, (rec->>'borders_forest')::boolean,
      COALESCE((rec->>'absentee')::boolean, FALSE),
      ST_GeomFromGeoJSON(rec->>'geojson')
    ) ON CONFLICT (state, county, fid) DO UPDATE SET
      taxidnum = EXCLUDED.taxidnum,
      municipality = EXCLUDED.municipality,
      acres = EXCLUDED.acres,
      owner_name = EXCLUDED.owner_name,
      mailing_street = EXCLUDED.mailing_street,
      mailing_city = EXCLUDED.mailing_city,
      mailing_state = EXCLUDED.mailing_state,
      mailing_zip = EXCLUDED.mailing_zip,
      situs = EXCLUDED.situs,
      land_use = EXCLUDED.land_use,
      sale_year = EXCLUDED.sale_year,
      sale_amt = EXCLUDED.sale_amt,
      assessed_total = EXCLUDED.assessed_total,
      land_val = EXCLUDED.land_val,
      improv_val = EXCLUDED.improv_val,
      deed_book = EXCLUDED.deed_book,
      deed_page = EXCLUDED.deed_page,
      address_mismatch = EXCLUDED.address_mismatch,
      absentee = EXCLUDED.absentee,
      geom = EXCLUDED.geom;
  END LOOP;
END;
$$;

-- 4. AFTER the expanded re-import finishes, run this once so newly added
--    parcels get their borders_forest flag (PA only; no AL forest data yet):
-- UPDATE parcels SET borders_forest = EXISTS (
--   SELECT 1 FROM state_forests sf
--   WHERE ST_DWithin(parcels.geom, sf.geom, 0.0001)
-- ) WHERE state = 'PA';
