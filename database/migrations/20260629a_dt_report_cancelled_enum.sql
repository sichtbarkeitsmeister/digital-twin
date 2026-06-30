-- Add a dedicated "cancelled" state so a user-stopped report can be told apart
-- from a report that failed because of an error.
-- NOTE: ADD VALUE must be committed before the value can be used in DML, so this
-- lives in its own migration, applied before 20260629b.
ALTER TYPE public.dt_report_state ADD VALUE IF NOT EXISTS 'cancelled';
