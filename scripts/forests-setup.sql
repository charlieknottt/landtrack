-- Run this in Supabase SQL Editor BEFORE running import-forests.py

-- Batch insert helper for forest/game land boundaries
CREATE OR REPLACE FUNCTION insert_forests_batch(forests_json TEXT)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  rec JSONB;
BEGIN
  FOR rec IN SELECT jsonb_array_elements(forests_json::jsonb)
  LOOP
    INSERT INTO state_forests (name, type, geom)
    VALUES (
      rec->>'name',
      rec->>'type',
      ST_Multi(ST_GeomFromGeoJSON(rec->>'geojson'))
    );
  END LOOP;
END;
$$;
