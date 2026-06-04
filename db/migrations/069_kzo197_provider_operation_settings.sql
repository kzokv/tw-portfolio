-- KZO-197 Provider Console V2: provider operation policy settings.
--
-- These nullable overrides make the Provider operations admin settings durable.
-- NULL means use the API defaults. Route validation owns bounds and cross-field
-- ordering, so these columns remain simple nullable integers.

ALTER TABLE public.app_config
  ADD COLUMN IF NOT EXISTS provider_operation_auto_renew_interval_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS provider_incident_recurrence_window_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS provider_health_warning_unresolved_threshold INTEGER,
  ADD COLUMN IF NOT EXISTS provider_health_critical_unresolved_threshold INTEGER,
  ADD COLUMN IF NOT EXISTS provider_operation_stale_heartbeat_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS provider_operation_summary_retention_days INTEGER,
  ADD COLUMN IF NOT EXISTS provider_operation_log_retention_days INTEGER,
  ADD COLUMN IF NOT EXISTS provider_incident_retention_days INTEGER,
  ADD COLUMN IF NOT EXISTS provider_resolved_item_retention_days INTEGER;

COMMENT ON COLUMN public.app_config.provider_operation_auto_renew_interval_minutes IS
  'Provider operations auto-renew cadence in minutes. NULL = API default.';
COMMENT ON COLUMN public.app_config.provider_incident_recurrence_window_minutes IS
  'Window in minutes for grouping repeated provider errors into the same incident. NULL = API default.';
COMMENT ON COLUMN public.app_config.provider_health_warning_unresolved_threshold IS
  'Unresolved active-item count at which provider health becomes warning. NULL = API default; must be below critical threshold at API write time.';
COMMENT ON COLUMN public.app_config.provider_health_critical_unresolved_threshold IS
  'Unresolved active-item count at which provider health becomes critical. NULL = API default; must be above warning threshold at API write time.';
COMMENT ON COLUMN public.app_config.provider_operation_stale_heartbeat_minutes IS
  'Running operation heartbeat age in minutes after which the admin surface treats the operation as stale. NULL = API default.';
COMMENT ON COLUMN public.app_config.provider_operation_summary_retention_days IS
  'Retention window in days for provider operation summaries. NULL = API default.';
COMMENT ON COLUMN public.app_config.provider_operation_log_retention_days IS
  'Retention window in days for provider operation logs. NULL = API default.';
COMMENT ON COLUMN public.app_config.provider_incident_retention_days IS
  'Retention window in days for resolved or ignored provider incidents. NULL = API default.';
COMMENT ON COLUMN public.app_config.provider_resolved_item_retention_days IS
  'Retention window in days for resolved provider unresolved-item records. NULL = API default.';
