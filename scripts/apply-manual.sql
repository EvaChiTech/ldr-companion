-- ============================================================
-- APPLY ME  —  run this whole file in the Supabase SQL editor.
--
-- Everything below is MISSING from your live database. It is the cause of:
--   • audio postcards failing to send   (sound-capsules bucket had no policy)
--   • analytics never recording anything (events table was never created)
--
-- Safe to run more than once: every statement is idempotent
-- (CREATE TABLE IF NOT EXISTS / ON CONFLICT DO UPDATE / DROP POLICY IF EXISTS).
--
-- Storage policies use an inline EXISTS on room_members, NOT is_room_member():
-- the function-call form fails inside storage RLS and broke uploads in prod.
-- ============================================================

-- ============================================================
-- ANALYTICS EVENTS
--
-- analytics.js has always written here, but the table was never defined —
-- every insert failed and the error was swallowed by a console.warn, so the
-- product has been running with no telemetry at all.
--
-- Privacy posture: no message bodies, no names, no free text. Only an event
-- name, a room code, an optional user id, and a small JSONB bag of
-- non-identifying dimensions.
-- ============================================================
CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID,                       -- null when the room has no account
  room_code   TEXT,
  session_id  TEXT,                       -- one browser session
  event_name  TEXT NOT NULL,
  props       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Retention queries slice by day, by room, and by event name.
CREATE INDEX IF NOT EXISTS events_created_idx   ON events (created_at DESC);
CREATE INDEX IF NOT EXISTS events_room_day_idx  ON events (room_code, created_at DESC);
CREATE INDEX IF NOT EXISTS events_name_idx      ON events (event_name, created_at DESC);
CREATE INDEX IF NOT EXISTS events_session_idx   ON events (session_id);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Append-only from the client. Rooms work without an account, so anon must be
-- able to insert too; a caller may only attribute an event to itself.
DROP POLICY IF EXISTS "events_insert" ON events;
CREATE POLICY "events_insert" ON events
  FOR INSERT TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- Deliberately NO select/update/delete policy: telemetry is readable only
-- via the service role (Supabase SQL editor / dashboard). Clients can write
-- their own events and can never read anyone's, including their own.

-- ============================================================
-- STORAGE BUCKETS — sound-capsules, voice-notes, chat-images
--
-- These three were used by the client but never defined here, while only
-- `vlogs` was. A bucket's `public` flag grants READ only: without an explicit
-- INSERT policy on storage.objects every upload fails with an RLS violation,
-- which surfaced as "Could not send" on audio postcards.
--
-- Same shape as vlogs: public read, writes gated on membership of the room
-- whose id is the first path segment (<room_id>/<file>). All uploads already
-- follow that convention.
--
-- Idempotent — safe to re-run whether or not the buckets already exist.
-- ============================================================

-- ── sound-capsules (audio postcards, 30s cap) ───────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sound-capsules', 'sound-capsules', true, 10485760,
        ARRAY['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav'])
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 10485760,
  allowed_mime_types = ARRAY['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav'];

DROP POLICY IF EXISTS "capsules_read"          ON storage.objects;
DROP POLICY IF EXISTS "capsules_member_insert" ON storage.objects;
DROP POLICY IF EXISTS "capsules_member_update" ON storage.objects;
DROP POLICY IF EXISTS "capsules_member_delete" ON storage.objects;

CREATE POLICY "capsules_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'sound-capsules');
CREATE POLICY "capsules_member_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sound-capsules' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())));
CREATE POLICY "capsules_member_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'sound-capsules' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())))
  WITH CHECK (bucket_id = 'sound-capsules' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())));
CREATE POLICY "capsules_member_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'sound-capsules' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())));

-- ── voice-notes (answers to daily questions) ────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('voice-notes', 'voice-notes', true, 10485760,
        ARRAY['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav'])
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 10485760,
  allowed_mime_types = ARRAY['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav'];

DROP POLICY IF EXISTS "voice_read"          ON storage.objects;
DROP POLICY IF EXISTS "voice_member_insert" ON storage.objects;
DROP POLICY IF EXISTS "voice_member_update" ON storage.objects;
DROP POLICY IF EXISTS "voice_member_delete" ON storage.objects;

CREATE POLICY "voice_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'voice-notes');
CREATE POLICY "voice_member_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'voice-notes' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())));
CREATE POLICY "voice_member_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'voice-notes' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())))
  WITH CHECK (bucket_id = 'voice-notes' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())));
CREATE POLICY "voice_member_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'voice-notes' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())));

-- ── chat-images (photos sent in chat) ───────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('chat-images', 'chat-images', true, 10485760,
        ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 10485760,
  allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif'];

DROP POLICY IF EXISTS "chatimg_read"          ON storage.objects;
DROP POLICY IF EXISTS "chatimg_member_insert" ON storage.objects;
DROP POLICY IF EXISTS "chatimg_member_update" ON storage.objects;
DROP POLICY IF EXISTS "chatimg_member_delete" ON storage.objects;

CREATE POLICY "chatimg_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'chat-images');
CREATE POLICY "chatimg_member_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chat-images' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())));
CREATE POLICY "chatimg_member_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING      (bucket_id = 'chat-images' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())))
  WITH CHECK (bucket_id = 'chat-images' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())));
CREATE POLICY "chatimg_member_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'chat-images' AND EXISTS (SELECT 1 FROM public.room_members rm WHERE rm.room_id = (storage.foldername(name))[1] AND rm.user_id = (SELECT auth.uid())));
