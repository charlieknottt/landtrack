-- Fix: water_features has RLS enabled, which blocked the import (the batch
-- function ran with caller privileges). Keep RLS on, allow public reads, and
-- let the import function write with definer privileges.
-- Run in the Supabase SQL Editor.

ALTER TABLE water_features ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read water" ON water_features;
CREATE POLICY "Public read water"
  ON water_features FOR SELECT
  USING (true);

CREATE OR REPLACE FUNCTION insert_water_batch(water_json TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
