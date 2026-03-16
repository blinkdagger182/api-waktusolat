export type SupportToastAudience = "debug" | "production" | "all";
export type SupportToastVariant = "generic" | "launch" | "streak" | "eid_pool" | "monthly_pool";

export type SupportToastScheduleRecord = {
  trigger_key: string;
  is_enabled: boolean;
  audience: SupportToastAudience;
  title?: string | null;
  message: string;
  variant: SupportToastVariant;
  min_launch_count?: number | null;
  min_active_day_streak?: number | null;
  minimum_hours_between_shows?: number | null;
  show_once: boolean;
  priority: number;
  has_progress: boolean;
  auto_dismiss_seconds: number;
  created_at?: string | null;
  updated_at?: string | null;
};
