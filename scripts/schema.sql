CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE parcels (
  id              SERIAL PRIMARY KEY,
  county          TEXT NOT NULL,
  fid             INTEGER NOT NULL,
  taxidnum        TEXT NOT NULL,
  municipality    TEXT,
  acres           REAL NOT NULL,
  owner_name      TEXT NOT NULL,
  mailing_street  TEXT,
  mailing_city    TEXT,
  mailing_state   TEXT,
  mailing_zip     TEXT,
  situs           TEXT,
  land_use        TEXT,
  sale_year       INTEGER,
  sale_amt        REAL DEFAULT 0,
  assessed_total  REAL DEFAULT 0,
  land_val        REAL DEFAULT 0,
  improv_val      REAL DEFAULT 0,
  deed_book       TEXT,
  deed_page       TEXT,
  address_mismatch BOOLEAN DEFAULT FALSE,
  borders_forest  BOOLEAN DEFAULT FALSE,
  geom            GEOMETRY(Polygon, 4326) NOT NULL,
  UNIQUE(county, fid)
);

CREATE INDEX idx_parcels_geom ON parcels USING GIST (geom);
CREATE INDEX idx_parcels_county ON parcels (county);
CREATE INDEX idx_parcels_acres ON parcels (acres);
CREATE INDEX idx_parcels_state ON parcels (mailing_state);
CREATE INDEX idx_parcels_sale_year ON parcels (sale_year);
CREATE INDEX idx_parcels_forest ON parcels (borders_forest) WHERE borders_forest;

ALTER TABLE parcels ADD COLUMN search_text TSVECTOR GENERATED ALWAYS AS (
  to_tsvector('english',
    coalesce(owner_name, '') || ' ' ||
    coalesce(municipality, '') || ' ' ||
    coalesce(taxidnum, '') || ' ' ||
    coalesce(mailing_street, '') || ' ' ||
    coalesce(mailing_city, '') || ' ' ||
    coalesce(mailing_state, '') || ' ' ||
    coalesce(mailing_zip, '') || ' ' ||
    coalesce(situs, '') || ' ' ||
    coalesce(county, '')
  )
) STORED;
CREATE INDEX idx_parcels_search ON parcels USING GIN (search_text);

CREATE TABLE state_forests (
  id    SERIAL PRIMARY KEY,
  name  TEXT NOT NULL,
  type  TEXT NOT NULL,
  geom  GEOMETRY(MultiPolygon, 4326) NOT NULL
);
CREATE INDEX idx_forests_geom ON state_forests USING GIST (geom);

-- RPC function for viewport-based parcel queries
CREATE OR REPLACE FUNCTION search_parcels(
  bbox_west FLOAT DEFAULT -180,
  bbox_south FLOAT DEFAULT -90,
  bbox_east FLOAT DEFAULT 180,
  bbox_north FLOAT DEFAULT 90,
  p_county TEXT DEFAULT NULL,
  p_min_acres REAL DEFAULT 0,
  p_max_acres REAL DEFAULT 99999,
  p_state TEXT DEFAULT NULL,
  p_max_sale_year INT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_address_mismatch BOOLEAN DEFAULT NULL,
  p_borders_forest BOOLEAN DEFAULT NULL,
  p_sort TEXT DEFAULT 'acres',
  p_dir TEXT DEFAULT 'desc',
  p_limit INT DEFAULT 500,
  p_offset INT DEFAULT 0,
  p_zoom INT DEFAULT 15
)
RETURNS TABLE(
  id INT,
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
  geometry JSON,
  total_count BIGINT
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.id, p.county, p.fid, p.taxidnum, p.municipality,
    p.acres, p.owner_name, p.mailing_street, p.mailing_city,
    p.mailing_state, p.mailing_zip, p.situs, p.land_use,
    p.sale_year, p.sale_amt, p.assessed_total, p.land_val,
    p.improv_val, p.deed_book, p.deed_page,
    p.address_mismatch, p.borders_forest,
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
    AND p.acres BETWEEN p_min_acres AND p_max_acres
    AND (p_state IS NULL OR p.mailing_state = p_state)
    AND (p_max_sale_year IS NULL OR p.sale_year IS NULL OR p.sale_year <= p_max_sale_year)
    AND (p_search IS NULL OR p.search_text @@ plainto_tsquery('english', p_search)
         OR p.taxidnum ILIKE '%' || p_search || '%')
    AND (p_address_mismatch IS NULL OR p.address_mismatch = p_address_mismatch)
    AND (p_borders_forest IS NULL OR p.borders_forest = p_borders_forest)
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

-- Batch insert helper (called from import script)
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
      county, fid, taxidnum, municipality, acres, owner_name,
      mailing_street, mailing_city, mailing_state, mailing_zip,
      situs, land_use, sale_year, sale_amt, assessed_total,
      land_val, improv_val, deed_book, deed_page,
      address_mismatch, borders_forest, geom
    ) VALUES (
      rec->>'county', (rec->>'fid')::int, rec->>'taxidnum', rec->>'municipality',
      (rec->>'acres')::real, rec->>'owner_name',
      rec->>'mailing_street', rec->>'mailing_city', rec->>'mailing_state', rec->>'mailing_zip',
      rec->>'situs', rec->>'land_use',
      (rec->>'sale_year')::int, (rec->>'sale_amt')::real, (rec->>'assessed_total')::real,
      (rec->>'land_val')::real, (rec->>'improv_val')::real,
      rec->>'deed_book', rec->>'deed_page',
      (rec->>'address_mismatch')::boolean, (rec->>'borders_forest')::boolean,
      ST_GeomFromGeoJSON(rec->>'geojson')
    ) ON CONFLICT (county, fid) DO NOTHING;
  END LOOP;
END;
$$;

-- Helper: county counts for stats endpoint
CREATE OR REPLACE FUNCTION get_county_counts()
RETURNS TABLE(county TEXT, count BIGINT)
LANGUAGE sql STABLE
AS $$
  SELECT p.county, COUNT(*) AS count
  FROM parcels p
  GROUP BY p.county
  ORDER BY p.county;
$$;

-- Helper: distinct mailing states
CREATE OR REPLACE FUNCTION get_distinct_states()
RETURNS TABLE(mailing_state TEXT)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT p.mailing_state
  FROM parcels p
  WHERE p.mailing_state IS NOT NULL AND p.mailing_state != ''
  ORDER BY p.mailing_state;
$$;

-- Helper: forest boundaries in viewport
CREATE OR REPLACE FUNCTION get_forests_in_bbox(
  bbox_west FLOAT DEFAULT -180,
  bbox_south FLOAT DEFAULT -90,
  bbox_east FLOAT DEFAULT 180,
  bbox_north FLOAT DEFAULT 90
)
RETURNS TABLE(name TEXT, type TEXT, geometry JSON)
LANGUAGE sql STABLE
AS $$
  SELECT f.name, f.type,
    ST_AsGeoJSON(ST_Simplify(f.geom, 0.001))::json AS geometry
  FROM state_forests f
  WHERE f.geom && ST_MakeEnvelope(bbox_west, bbox_south, bbox_east, bbox_north, 4326);
$$;
