-- 2026-09-24: Let every scheduling user persist their own preferences.
--
-- sched_user_preferences.user_id was a FK to sched_profiles(id). But nothing in
-- this app writes sched_profiles rows — access is governed by the shared Duck
-- Force allowed_emails allowlist, not by having a profile. Result: only users
-- who happened to have a sched_profiles row (admins, added by hand to set their
-- role) could save preferences. Everyone else's upsert failed the FK silently,
-- so their personal resource colors, theme, etc. never persisted to the cloud
-- (they appeared to work in-session only because prefs are cached in
-- localStorage first — see src/lib/preferences.ts).
--
-- Preferences don't actually need a profile to exist; they only need a real
-- authenticated user. Repoint the FK to auth.users(id). RLS on the table is
-- already auth.uid()-scoped, so this is safe. Zero runtime cost.

ALTER TABLE sched_user_preferences
  DROP CONSTRAINT IF EXISTS sched_user_preferences_user_id_fkey;

ALTER TABLE sched_user_preferences
  ADD CONSTRAINT sched_user_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
