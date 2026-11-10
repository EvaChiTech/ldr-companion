-- ============================================================
-- RETENTION & ENGAGEMENT QUERIES
--
-- Run these in the Supabase SQL editor (service role — the `events` table has
-- no SELECT policy, so clients can never read telemetry, including their own).
--
-- These are the numbers you will be asked for first. Each query is written to
-- be read aloud: the answer is a single table you can paste into a deck.
-- ============================================================


-- ── 1. Is telemetry actually flowing? ───────────────────────
-- Run this first. If it returns no rows, nothing else below will work, and
-- the cause is almost always a missing table or insert policy.
SELECT
  COUNT(*)                                   AS events_total,
  COUNT(DISTINCT session_id)                 AS sessions,
  COUNT(DISTINCT room_code)                  AS rooms,
  MIN(created_at)                            AS first_event,
  MAX(created_at)                            AS last_event
FROM events;


-- ── 2. Classic cohort retention (D1 / D7 / D30) ─────────────
-- Cohort = the day a room first appeared. A room "returned on day N" if it
-- produced any event N days later. This is the headline number.
WITH first_day AS (
  SELECT room_code, MIN(created_at::date) AS cohort_day
  FROM events
  WHERE room_code IS NOT NULL
  GROUP BY room_code
),
activity AS (
  SELECT DISTINCT e.room_code, e.created_at::date AS active_day
  FROM events e
  WHERE e.room_code IS NOT NULL
)
SELECT
  f.cohort_day,
  COUNT(DISTINCT f.room_code)                                               AS cohort_size,
  COUNT(DISTINCT f.room_code) FILTER (WHERE a.active_day = f.cohort_day + 1)  AS d1,
  COUNT(DISTINCT f.room_code) FILTER (WHERE a.active_day = f.cohort_day + 7)  AS d7,
  COUNT(DISTINCT f.room_code) FILTER (WHERE a.active_day = f.cohort_day + 30) AS d30,
  ROUND(100.0 * COUNT(DISTINCT f.room_code) FILTER (WHERE a.active_day = f.cohort_day + 1)
        / NULLIF(COUNT(DISTINCT f.room_code), 0), 1) AS d1_pct,
  ROUND(100.0 * COUNT(DISTINCT f.room_code) FILTER (WHERE a.active_day = f.cohort_day + 7)
        / NULLIF(COUNT(DISTINCT f.room_code), 0), 1) AS d7_pct,
  ROUND(100.0 * COUNT(DISTINCT f.room_code) FILTER (WHERE a.active_day = f.cohort_day + 30)
        / NULLIF(COUNT(DISTINCT f.room_code), 0), 1) AS d30_pct
FROM first_day f
LEFT JOIN activity a ON a.room_code = f.room_code
GROUP BY f.cohort_day
ORDER BY f.cohort_day DESC;


-- ── 3. BOTH partners active on the same day ─────────────────
-- The metric that actually matters here. A relationship app where only one
-- person shows up is a diary, not a shared space — and investors will
-- understand that distinction immediately.
WITH per_day AS (
  SELECT
    created_at::date                                        AS day,
    room_code,
    COUNT(DISTINCT (props->>'seat')) FILTER (WHERE props->>'seat' IS NOT NULL) AS seats_active
  FROM events
  WHERE room_code IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  day,
  COUNT(*)                                          AS rooms_active,
  COUNT(*) FILTER (WHERE seats_active >= 2)         AS rooms_both_partners,
  ROUND(100.0 * COUNT(*) FILTER (WHERE seats_active >= 2)
        / NULLIF(COUNT(*), 0), 1)                   AS both_pct
FROM per_day
GROUP BY day
ORDER BY day DESC
LIMIT 30;


-- ── 4. Activation funnel ────────────────────────────────────
-- How far a new room gets. The big drop-off tells you what to fix next.
SELECT
  COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'session_start')              AS opened,
  COUNT(DISTINCT session_id) FILTER (WHERE event_name IN ('room_created','room_joined')) AS got_a_room,
  COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'activated_first_message')    AS sent_first_message,
  COUNT(DISTINCT session_id) FILTER (WHERE event_name = 'tour_completed')             AS finished_tour
FROM events;


-- ── 5. Which features are actually used ─────────────────────
-- Expect a long tail. Anything with near-zero adoption is a candidate to cut
-- or bury — a shorter product tells a sharper story.
SELECT
  COALESCE(props->>'tab', event_name)   AS feature,
  COUNT(*)                              AS uses,
  COUNT(DISTINCT room_code)             AS rooms_using,
  ROUND(100.0 * COUNT(DISTINCT room_code)
        / NULLIF((SELECT COUNT(DISTINCT room_code) FROM events), 0), 1) AS pct_of_rooms
FROM events
WHERE event_name = 'tab_view' OR event_name NOT LIKE 'session_%'
GROUP BY 1
ORDER BY uses DESC;


-- ── 6. Session length ───────────────────────────────────────
-- Median is the honest figure; the mean is dragged up by tabs left open.
SELECT
  created_at::date                                                          AS day,
  COUNT(*)                                                                  AS sessions,
  ROUND(AVG((props->>'duration_s')::numeric))                               AS mean_s,
  ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY (props->>'duration_s')::numeric)::numeric)                 AS median_s
FROM events
WHERE event_name = 'session_end'
  AND props->>'duration_s' ~ '^[0-9]+$'
GROUP BY day
ORDER BY day DESC
LIMIT 30;


-- ── 7. Stickiness (DAU / MAU) ───────────────────────────────
-- Above ~20% is strong for a consumer social product: it means a typical
-- room shows up roughly 6 days a month.
WITH d AS (
  SELECT created_at::date AS day, COUNT(DISTINCT room_code) AS dau
  FROM events WHERE room_code IS NOT NULL GROUP BY 1
),
m AS (
  SELECT COUNT(DISTINCT room_code) AS mau
  FROM events
  WHERE room_code IS NOT NULL AND created_at >= NOW() - INTERVAL '30 days'
)
SELECT
  ROUND(AVG(d.dau))                                        AS avg_dau,
  (SELECT mau FROM m)                                      AS mau,
  ROUND(100.0 * AVG(d.dau) / NULLIF((SELECT mau FROM m), 0), 1) AS stickiness_pct
FROM d
WHERE d.day >= CURRENT_DATE - 30;
