-- Intentional availability override (schedule-over-block flow).
--
-- Late Day / Office Day / PTO / Unavailable rules block scheduling on the app
-- side and raise an `availability_conflict` flag. When a scheduler knowingly
-- books over one of those windows (confirming the override checkbox), we tag the
-- appointment so the flag stops nagging. Unlike allow_overlap, this is NOT
-- enforced by a DB trigger — availability rules are app-side only — so the flag
-- suppression is the only behavior it drives.

ALTER TABLE sched_appointments
  ADD COLUMN IF NOT EXISTS allow_availability_conflict boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN sched_appointments.allow_availability_conflict IS
  'True when a scheduler intentionally booked this appointment onto a blocked availability window (PTO / Unavailable / Late Day / Office Day) via the override flow. Suppresses the availability_conflict flag.';
