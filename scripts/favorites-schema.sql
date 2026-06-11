-- Favorites table: stores per-user favorited parcels
CREATE TABLE favorites (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parcel_state TEXT NOT NULL DEFAULT 'PA',
  parcel_county TEXT NOT NULL,
  parcel_fid INTEGER NOT NULL,
  reached_out BOOLEAN DEFAULT FALSE,
  lat REAL,
  lng REAL,
  properties JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, parcel_state, parcel_county, parcel_fid)
);

CREATE INDEX idx_favorites_user ON favorites (user_id);

-- Row Level Security: each user can only access their own favorites
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own favorites"
  ON favorites FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own favorites"
  ON favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own favorites"
  ON favorites FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own favorites"
  ON favorites FOR DELETE
  USING (auth.uid() = user_id);
