-- ============================================================
-- LDR Companion — Supabase Schema
-- Run this entire file in your Supabase SQL Editor
-- https://supabase.com/dashboard/project/[your-project]/sql
-- ============================================================

-- Rooms (one per couple)
CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,
  n1         TEXT NOT NULL,
  n2         TEXT NOT NULL,
  tz1        TEXT NOT NULL,
  tz2        TEXT NOT NULL,
  since      DATE NOT NULL,
  visit      DATE,
  interests  TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages (real-time chat)
CREATE TABLE IF NOT EXISTS messages (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  partner_idx INTEGER NOT NULL CHECK (partner_idx IN (1, 2)),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Daily moods (one per partner per day)
CREATE TABLE IF NOT EXISTS moods (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  partner_idx INTEGER NOT NULL CHECK (partner_idx IN (1, 2)),
  mood        TEXT NOT NULL,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, partner_idx, date)
);

-- Daily love notes (one per partner per day)
CREATE TABLE IF NOT EXISTS notes (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  partner_idx INTEGER NOT NULL CHECK (partner_idx IN (1, 2)),
  content     TEXT,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, partner_idx, date)
);

-- Shared bucket list
CREATE TABLE IF NOT EXISTS bucket_items (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  done        BOOLEAN DEFAULT FALSE,
  added_by    INTEGER NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Relationship milestones
CREATE TABLE IF NOT EXISTS milestones (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  title       TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (open policies — room code acts as auth)
-- ============================================================
ALTER TABLE rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE moods        ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE bucket_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE milestones   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open_rooms"   ON rooms        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_msgs"    ON messages     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_moods"   ON moods        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_notes"   ON notes        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_bucket"  ON bucket_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "open_stones"  ON milestones   FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Realtime — full row diffs for all tables
-- ============================================================
ALTER TABLE messages     REPLICA IDENTITY FULL;
ALTER TABLE moods        REPLICA IDENTITY FULL;
ALTER TABLE notes        REPLICA IDENTITY FULL;
ALTER TABLE bucket_items REPLICA IDENTITY FULL;
ALTER TABLE milestones   REPLICA IDENTITY FULL;

-- Add tables to the realtime publication
-- (If this errors, enable Realtime manually in the Supabase dashboard
--  under Database → Replication → supabase_realtime)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE messages;
  ALTER PUBLICATION supabase_realtime ADD TABLE moods;
  ALTER PUBLICATION supabase_realtime ADD TABLE notes;
  ALTER PUBLICATION supabase_realtime ADD TABLE bucket_items;
  ALTER PUBLICATION supabase_realtime ADD TABLE milestones;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not alter publication: %. Enable realtime manually.', SQLERRM;
END $$;

-- ============================================================
-- Helpful indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_messages_room   ON messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_moods_room_date ON moods(room_id, date);
CREATE INDEX IF NOT EXISTS idx_notes_room_date ON notes(room_id, date);
CREATE INDEX IF NOT EXISTS idx_bucket_room     ON bucket_items(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stones_room     ON milestones(room_id, date DESC);
