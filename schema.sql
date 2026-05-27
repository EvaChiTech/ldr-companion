-- ============================================================
-- LDR Companion — Supabase Schema
-- Run this entire file in your Supabase SQL Editor
-- https://supabase.com/dashboard/project/[your-project]/sql
-- ============================================================

-- Rooms (one per pairing — couple, family member, friend, etc.)
CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT PRIMARY KEY,
  n1         TEXT NOT NULL,
  n2         TEXT NOT NULL,
  tz1        TEXT NOT NULL,
  tz2        TEXT NOT NULL,
  since      DATE NOT NULL,
  visit      DATE,
  interests  TEXT,
  kind       TEXT NOT NULL DEFAULT 'couple'
              CHECK (kind IN ('couple','family','friend','parent_child','siblings','chosen_family','other')),
  theme      TEXT NOT NULL DEFAULT 'warm'
              CHECK (theme IN ('warm','ocean','forest','sunset','lavender','mono','noir')),
  alias      TEXT,
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

-- Couple's questions (many per day, sequenced)
CREATE TABLE IF NOT EXISTS daily_questions (
  id         BIGSERIAL PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  date       DATE NOT NULL DEFAULT CURRENT_DATE,
  question   TEXT NOT NULL,
  category   TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Each partner's answer linked to a specific question_id
CREATE TABLE IF NOT EXISTS daily_answers (
  id          BIGSERIAL PRIMARY KEY,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  partner_idx INTEGER NOT NULL CHECK (partner_idx IN (1, 2)),
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  question_id BIGINT REFERENCES daily_questions(id) ON DELETE CASCADE,
  answer      TEXT NOT NULL,
  audio_url   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(question_id, partner_idx)
);

-- Goodnight / wake-up sync
CREATE TABLE IF NOT EXISTS sleep_events (
  id           BIGSERIAL PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  partner_idx  INTEGER NOT NULL CHECK (partner_idx IN (1, 2)),
  date         DATE NOT NULL DEFAULT CURRENT_DATE,
  goodnight_at TIMESTAMPTZ,
  wakeup_at    TIMESTAMPTZ,
  UNIQUE(room_id, partner_idx, date)
);

-- AI memory chapters
CREATE TABLE IF NOT EXISTS memory_chapters (
  id           BIGSERIAL PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Co-watch / co-listen session (one row per room)
CREATE TABLE IF NOT EXISTS watch_sessions (
  room_id     TEXT PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  source      TEXT NOT NULL CHECK (source IN ('youtube','video','none')),
  media_id    TEXT,
  is_playing  BOOLEAN NOT NULL DEFAULT FALSE,
  position    NUMERIC NOT NULL DEFAULT 0,
  position_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  INTEGER CHECK (updated_by IN (1, 2)),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  queue       JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Row Level Security is defined at the END of this file (see
-- "AUTHORIZATION MODEL"), after every table exists, so the policy loop
-- can cover all room-scoped tables in one pass.

-- ============================================================
-- Realtime — full row diffs for all tables
-- ============================================================
ALTER TABLE messages       REPLICA IDENTITY FULL;
ALTER TABLE moods          REPLICA IDENTITY FULL;
ALTER TABLE notes          REPLICA IDENTITY FULL;
ALTER TABLE bucket_items   REPLICA IDENTITY FULL;
ALTER TABLE milestones     REPLICA IDENTITY FULL;
ALTER TABLE watch_sessions REPLICA IDENTITY FULL;

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
  ALTER PUBLICATION supabase_realtime ADD TABLE watch_sessions;
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

-- ============================================================
-- VLOGS — short video diaries with dual-timezone watermark
-- ============================================================
CREATE TABLE IF NOT EXISTS vlogs (
  id            BIGSERIAL PRIMARY KEY,
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  partner_idx   INTEGER NOT NULL CHECK (partner_idx IN (1, 2)),
  caption       TEXT,
  video_url     TEXT NOT NULL,
  thumb_url     TEXT,
  duration_s    NUMERIC,
  orientation   TEXT NOT NULL DEFAULT 'portrait'
                  CHECK (orientation IN ('portrait','landscape','square')),
  width         INTEGER,
  height        INTEGER,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_tz   TEXT,
  reply_to      BIGINT REFERENCES vlogs(id) ON DELETE SET NULL,
  watched_by    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS for vlogs is applied by the policy loop at the end of this file.
ALTER TABLE vlogs REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE vlogs;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not alter publication for vlogs: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS idx_vlogs_room ON vlogs(room_id, created_at DESC);

-- ============================================================
-- AUTHORIZATION MODEL — invisible accounts
-- ============================================================
-- Every device signs in anonymously via Supabase Auth on first load, so
-- auth.uid() is always a real identity (no login screen for the user).
-- room_members links that identity to the rooms it belongs to; every RLS
-- policy gates on it. A leaked room code alone no longer grants data
-- access — you must be a recorded member of the room.
-- This whole block is idempotent: safe to re-run.
-- ============================================================

-- Membership: which auth identity belongs to which room.
CREATE TABLE IF NOT EXISTS room_members (
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_idx INTEGER NOT NULL CHECK (partner_idx IN (1, 2)),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_room_members_user ON room_members(user_id);

-- Membership check. SECURITY DEFINER so RLS policies can call it without
-- recursing into room_members' own RLS. STABLE: constant within a statement.
CREATE OR REPLACE FUNCTION is_room_member(p_room_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM room_members
    WHERE room_id = p_room_id AND user_id = auth.uid()
  );
$$;

-- Lightweight fixed-window rate limiter — edge functions call
-- check_rate_limit() to throttle abusive callers.
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key   TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT, p_max INTEGER, p_window_seconds INTEGER
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window TIMESTAMPTZ := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );
  v_hits INTEGER;
BEGIN
  INSERT INTO rate_limits (bucket_key, window_start, hits)
  VALUES (p_key, v_window, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET hits = rate_limits.hits + 1
  RETURNING hits INTO v_hits;
  DELETE FROM rate_limits WHERE window_start < now() - INTERVAL '1 day';
  RETURN v_hits <= p_max;
END;
$$;

-- ── RLS: identity-gated, deny by default ──
ALTER TABLE rooms        ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limits  ENABLE ROW LEVEL SECURITY;
-- rate_limits: RLS on + zero policies = no client access (service role only).

-- Drop every legacy permissive policy.
DROP POLICY IF EXISTS "open_rooms"  ON rooms;
DROP POLICY IF EXISTS "open_msgs"   ON messages;
DROP POLICY IF EXISTS "open_moods"  ON moods;
DROP POLICY IF EXISTS "open_notes"  ON notes;
DROP POLICY IF EXISTS "open_bucket" ON bucket_items;
DROP POLICY IF EXISTS "open_stones" ON milestones;
DROP POLICY IF EXISTS "open_watch"  ON watch_sessions;
DROP POLICY IF EXISTS "open_vlogs"  ON vlogs;

-- rooms — members only. INSERT happens solely via create_room() (definer).
DROP POLICY IF EXISTS "rooms_member_select" ON rooms;
DROP POLICY IF EXISTS "rooms_member_update" ON rooms;
DROP POLICY IF EXISTS "rooms_member_delete" ON rooms;
CREATE POLICY "rooms_member_select" ON rooms FOR SELECT TO authenticated
  USING (is_room_member(id));
CREATE POLICY "rooms_member_update" ON rooms FOR UPDATE TO authenticated
  USING (is_room_member(id)) WITH CHECK (is_room_member(id));
CREATE POLICY "rooms_member_delete" ON rooms FOR DELETE TO authenticated
  USING (is_room_member(id));

-- room_members — a user sees/removes only their own rows. INSERT is done
-- by the create_room()/join_room() RPCs (definer), so no client INSERT.
DROP POLICY IF EXISTS "rm_select_own" ON room_members;
DROP POLICY IF EXISTS "rm_delete_own" ON room_members;
CREATE POLICY "rm_select_own" ON room_members FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "rm_delete_own" ON room_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Every room-scoped table: full access only to members of that room.
-- Looped so tables created outside this file are covered too, and any
-- missing table is skipped instead of aborting the migration.
DO $$
DECLARE
  t TEXT;
  room_tables TEXT[] := ARRAY[
    'messages','moods','notes','bucket_items','milestones',
    'daily_questions','daily_answers','sleep_events','memory_chapters',
    'watch_sessions','vlogs','future_letters','dreams','calendar_events',
    'expenses','visa_items','care_pings','sound_capsules',
    'reunion_sessions','heartbeat_sessions'
  ];
BEGIN
  FOREACH t IN ARRAY room_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS member_all ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY member_all ON public.%I FOR ALL TO authenticated '
        || 'USING (is_room_member(room_id)) '
        || 'WITH CHECK (is_room_member(room_id))', t);
    ELSE
      RAISE NOTICE 'Table % not found — RLS skipped', t;
    END IF;
  END LOOP;
END $$;

-- push_subscriptions (keyed on room_code) and user_room_links (keyed on
-- user_id) — bespoke policies, applied only if the tables exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='push_subscriptions') THEN
    ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS member_push ON public.push_subscriptions;
    CREATE POLICY member_push ON public.push_subscriptions FOR ALL TO authenticated
      USING (is_room_member(room_code))
      WITH CHECK (is_room_member(room_code));
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='user_room_links') THEN
    ALTER TABLE public.user_room_links ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS own_links ON public.user_room_links;
    CREATE POLICY own_links ON public.user_room_links FOR ALL TO authenticated
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ============================================================
-- RPCs — room create/join/preview/erase. SECURITY DEFINER so a brand-new
-- member can be recorded atomically before RLS would otherwise allow it.
-- ============================================================
CREATE OR REPLACE FUNCTION create_room(
  p_id TEXT, p_n1 TEXT, p_n2 TEXT, p_tz1 TEXT, p_tz2 TEXT,
  p_since DATE, p_visit DATE, p_interests TEXT,
  p_kind TEXT, p_theme TEXT, p_alias TEXT
) RETURNS rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_room rooms;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF EXISTS (SELECT 1 FROM rooms WHERE id = p_id) THEN
    RAISE EXCEPTION 'room code already exists';
  END IF;
  INSERT INTO rooms (id,n1,n2,tz1,tz2,since,visit,interests,kind,theme,alias)
  VALUES (p_id,p_n1,p_n2,p_tz1,p_tz2,p_since,p_visit,p_interests,
          COALESCE(NULLIF(p_kind,''),'couple'),
          COALESCE(NULLIF(p_theme,''),'warm'), p_alias)
  RETURNING * INTO v_room;
  INSERT INTO room_members (room_id,user_id,partner_idx)
  VALUES (p_id, auth.uid(), 1);
  RETURN v_room;
END;
$$;

-- Preview a room (names + cities) before joining — you still need the code.
CREATE OR REPLACE FUNCTION preview_room(p_code TEXT)
RETURNS TABLE (n1 TEXT, n2 TEXT, tz1 TEXT, tz2 TEXT, kind TEXT, theme TEXT)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT n1, n2, tz1, tz2, kind, theme FROM rooms WHERE id = p_code;
$$;

CREATE OR REPLACE FUNCTION join_room(p_code TEXT, p_partner_idx INTEGER)
RETURNS rooms
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_room rooms;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF p_partner_idx NOT IN (1,2) THEN RAISE EXCEPTION 'invalid partner index'; END IF;
  SELECT * INTO v_room FROM rooms WHERE id = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'room not found'; END IF;
  INSERT INTO room_members (room_id,user_id,partner_idx)
  VALUES (p_code, auth.uid(), p_partner_idx)
  ON CONFLICT (room_id,user_id) DO UPDATE SET partner_idx = EXCLUDED.partner_idx;
  RETURN v_room;
END;
$$;

-- GDPR Art. 17 / CCPA erasure. Deleting the rooms cascades to every
-- room-scoped table. A 2-person room is shared data, so erasing your data
-- ends the room for both — this is intended for an intimate shared diary.
CREATE OR REPLACE FUNCTION delete_my_data()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  DELETE FROM rooms WHERE id IN (
    SELECT room_id FROM room_members WHERE user_id = auth.uid()
  );
  DELETE FROM room_members WHERE user_id = auth.uid();
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema='public' AND table_name='user_room_links') THEN
    DELETE FROM user_room_links WHERE user_id = auth.uid();
  END IF;
END;
$$;

-- ============================================================
-- VLOGS — Storage bucket + member-gated policies (idempotent)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'vlogs', 'vlogs', true,
  524288000,
  ARRAY['video/webm','video/mp4','image/jpeg','image/png']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 524288000,
  allowed_mime_types = ARRAY['video/webm','video/mp4','image/jpeg','image/png'];

DROP POLICY IF EXISTS "vlogs_public_read"   ON storage.objects;
DROP POLICY IF EXISTS "vlogs_anon_insert"   ON storage.objects;
DROP POLICY IF EXISTS "vlogs_anon_update"   ON storage.objects;
DROP POLICY IF EXISTS "vlogs_anon_delete"   ON storage.objects;
DROP POLICY IF EXISTS "vlogs_read"          ON storage.objects;
DROP POLICY IF EXISTS "vlogs_member_insert" ON storage.objects;
DROP POLICY IF EXISTS "vlogs_member_update" ON storage.objects;
DROP POLICY IF EXISTS "vlogs_member_delete" ON storage.objects;

-- Read stays public — the file path carries an unguessable room id and the
-- player + client-side export pipeline fetch via plain URLs.
CREATE POLICY "vlogs_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'vlogs');

-- Writes only by a member of the room whose id is the first path segment
-- (<room_id>/<file>) — stops overwriting/deleting other couples' media.
CREATE POLICY "vlogs_member_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vlogs' AND is_room_member((storage.foldername(name))[1]));
CREATE POLICY "vlogs_member_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'vlogs' AND is_room_member((storage.foldername(name))[1]))
  WITH CHECK (bucket_id = 'vlogs' AND is_room_member((storage.foldername(name))[1]));
CREATE POLICY "vlogs_member_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'vlogs' AND is_room_member((storage.foldername(name))[1]));
