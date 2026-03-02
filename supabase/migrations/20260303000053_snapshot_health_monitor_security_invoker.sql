-- SAFETY-PR4
-- Supabase linter fix: avoid SECURITY DEFINER behavior on monitoring view.
-- Ensure view runs with caller permissions (RLS/privileges of querying user).

ALTER VIEW IF EXISTS public.snapshot_health_monitor
SET (security_invoker = true);
