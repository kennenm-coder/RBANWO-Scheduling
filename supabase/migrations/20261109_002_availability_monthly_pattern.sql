-- Monthly recurrence for availability rules: "first Friday of every other month".
--
--   week_of_month  NULL = ordinary weekly rule. 1-4 = that occurrence of each
--                  selected weekday in the month; 5 = the LAST one.
--   month_interval months between occurrences (1 = every month, 2 = every other
--                  month...), counted from the month of effective_start.
--
-- Existing rows keep NULL / 1 and behave exactly as before. Safe to re-run.

ALTER TABLE sched_availability_rules
  ADD COLUMN IF NOT EXISTS week_of_month SMALLINT
    CHECK (week_of_month IS NULL OR week_of_month BETWEEN 1 AND 5);

ALTER TABLE sched_availability_rules
  ADD COLUMN IF NOT EXISTS month_interval INTEGER NOT NULL DEFAULT 1
    CHECK (month_interval >= 1);
