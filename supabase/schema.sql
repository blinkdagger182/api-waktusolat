create table if not exists public.zones (
  code text primary key,
  negeri text not null,
  daerah text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.prayer_months (
  zone text not null references public.zones(code) on update cascade on delete cascade,
  year integer not null,
  month text not null check (month in ('JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC')),
  last_updated timestamptz null,
  prayers jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (zone, year, month)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists prayer_months_set_updated_at on public.prayer_months;

create trigger prayer_months_set_updated_at
before update on public.prayer_months
for each row
execute function public.set_updated_at();

create index if not exists prayer_months_year_month_idx on public.prayer_months(year, month);

create table if not exists public.indonesia_regions (
  id text primary key,
  location text not null,
  province text not null,
  timezone text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.indonesia_prayer_months (
  region_id text not null references public.indonesia_regions(id) on update cascade on delete cascade,
  year integer not null,
  month text not null check (month in ('JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC')),
  month_number integer not null check (month_number between 1 and 12),
  timezone text not null,
  location text not null,
  province text not null,
  last_updated timestamptz null,
  prayers jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (region_id, year, month)
);

drop trigger if exists indonesia_prayer_months_set_updated_at on public.indonesia_prayer_months;

create trigger indonesia_prayer_months_set_updated_at
before update on public.indonesia_prayer_months
for each row
execute function public.set_updated_at();

create index if not exists indonesia_prayer_months_year_month_idx on public.indonesia_prayer_months(year, month);

create table if not exists public.donation_pool_monthly (
  month_start date primary key,
  total_amount numeric(10,2) not null default 0 check (total_amount >= 0),
  target_amount integer not null default 150 check (target_amount > 0),
  cap_amount integer not null default 1000 check (cap_amount > 0 and cap_amount >= target_amount),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists donation_pool_monthly_set_updated_at on public.donation_pool_monthly;

create trigger donation_pool_monthly_set_updated_at
before update on public.donation_pool_monthly
for each row
execute function public.set_updated_at();

create table if not exists public.donation_events (
  id bigint generated always as identity primary key,
  event_id text not null unique,
  month_start date not null references public.donation_pool_monthly(month_start) on update cascade on delete restrict,
  amount numeric(10,2) not null check (amount > 0),
  source text not null default 'backend',
  currency text not null default 'MYR',
  purchased_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists donation_events_month_start_idx on public.donation_events(month_start);
create index if not exists donation_events_purchased_at_idx on public.donation_events(purchased_at desc);

create or replace function public.record_donation_pool_event(
  p_event_id text,
  p_amount numeric,
  p_source text default 'backend',
  p_currency text default 'MYR',
  p_purchased_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb,
  p_target_amount integer default null,
  p_cap_amount integer default null
)
returns setof public.donation_pool_monthly
language plpgsql
as $$
declare
  effective_timestamp timestamptz := coalesce(p_purchased_at, now());
  effective_month_start date := date_trunc('month', timezone('Asia/Kuala_Lumpur', effective_timestamp))::date;
  effective_cap integer := coalesce(p_cap_amount, 1000);
  inserted_event_id bigint;
begin
  if coalesce(trim(p_event_id), '') = '' then
    raise exception 'event_id is required';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than zero';
  end if;

  if effective_cap <= 0 then
    raise exception 'cap_amount must be greater than zero';
  end if;

  if p_target_amount is not null and p_target_amount <= 0 then
    raise exception 'target_amount must be greater than zero';
  end if;

  insert into public.donation_pool_monthly (month_start, total_amount, target_amount, cap_amount)
  values (
    effective_month_start,
    0,
    least(coalesce(p_target_amount, 150), effective_cap),
    effective_cap
  )
  on conflict (month_start) do nothing;

  insert into public.donation_events (
    event_id,
    month_start,
    amount,
    source,
    currency,
    purchased_at,
    metadata
  )
  values (
    p_event_id,
    effective_month_start,
    p_amount,
    coalesce(nullif(trim(p_source), ''), 'backend'),
    coalesce(nullif(trim(p_currency), ''), 'MYR'),
    p_purchased_at,
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (event_id) do nothing
  returning id into inserted_event_id;

  if inserted_event_id is not null then
    update public.donation_pool_monthly
    set
      total_amount = total_amount + p_amount,
      target_amount = case
        when p_target_amount is null then target_amount
        else least(p_target_amount, effective_cap)
      end,
      cap_amount = effective_cap
    where month_start = effective_month_start;
  elsif p_target_amount is not null or p_cap_amount is not null then
    update public.donation_pool_monthly
    set
      target_amount = case
        when p_target_amount is null then least(target_amount, effective_cap)
        else least(p_target_amount, effective_cap)
      end,
      cap_amount = effective_cap
    where month_start = effective_month_start;
  end if;

  return query
  select *
  from public.donation_pool_monthly
  where month_start = effective_month_start;
end;
$$;

create or replace function public.set_donation_pool_target(
  p_month_start date default null,
  p_target_amount integer default 150,
  p_cap_amount integer default null
)
returns setof public.donation_pool_monthly
language plpgsql
as $$
declare
  effective_month_start date := coalesce(
    p_month_start,
    date_trunc('month', timezone('Asia/Kuala_Lumpur', now()))::date
  );
  effective_cap integer := coalesce(p_cap_amount, 1000);
begin
  if p_target_amount is null or p_target_amount <= 0 then
    raise exception 'target_amount must be greater than zero';
  end if;

  if effective_cap <= 0 then
    raise exception 'cap_amount must be greater than zero';
  end if;

  insert into public.donation_pool_monthly (month_start, total_amount, target_amount, cap_amount)
  values (
    effective_month_start,
    0,
    least(p_target_amount, effective_cap),
    effective_cap
  )
  on conflict (month_start) do nothing;

  update public.donation_pool_monthly
  set
    target_amount = least(p_target_amount, effective_cap),
    cap_amount = effective_cap
  where month_start = effective_month_start;

  return query
  select *
  from public.donation_pool_monthly
  where month_start = effective_month_start;
end;
$$;

create table if not exists public.support_toast_schedule (
  trigger_key text primary key,
  is_enabled boolean not null default true,
  audience text not null default 'production' check (audience in ('debug', 'production', 'all')),
  title text null,
  message text not null,
  variant text not null check (variant in ('generic', 'launch', 'streak', 'eid_pool', 'monthly_pool')),
  min_launch_count integer null check (min_launch_count > 0),
  min_active_day_streak integer null check (min_active_day_streak > 0),
  minimum_hours_between_shows integer null check (minimum_hours_between_shows > 0),
  show_once boolean not null default true,
  priority integer not null default 100,
  has_progress boolean not null default false,
  auto_dismiss_seconds integer not null default 8 check (auto_dismiss_seconds > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists support_toast_schedule_set_updated_at on public.support_toast_schedule;

create trigger support_toast_schedule_set_updated_at
before update on public.support_toast_schedule
for each row
execute function public.set_updated_at();

insert into public.support_toast_schedule (
  trigger_key,
  is_enabled,
  audience,
  message,
  variant,
  min_launch_count,
  min_active_day_streak,
  minimum_hours_between_shows,
  show_once,
  priority,
  has_progress,
  auto_dismiss_seconds
)
values
  ('generic_debug', true, 'debug', 'Enjoying Waktu? Support it.', 'generic', null, null, 24, false, 100, false, 8),
  ('launch_5', true, 'production', 'Love Waktu? Help keep it running.', 'launch', 5, null, null, true, 10, false, 8),
  ('launch_6', true, 'production', 'Use Waktu daily? Support this month''s costs.', 'launch', 6, null, null, true, 20, false, 8),
  ('streak_7', true, 'production', '7 days in a row. Help keep Waktu going.', 'streak', null, 7, null, true, 30, false, 8),
  ('eid_pool', false, 'production', 'Eid pool is live. Keep Waktu running.', 'eid_pool', null, null, 72, false, 40, true, 8),
  ('monthly_pool', false, 'production', 'This month''s pool is open. Keep Waktu accurate.', 'monthly_pool', null, null, 168, false, 50, true, 8)
on conflict (trigger_key) do nothing;

create table if not exists public.device_tokens (
  device_token text primary key,
  platform text not null check (platform in ('ios', 'android')),
  app_version text null,
  device_model text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists device_tokens_set_updated_at on public.device_tokens;

create trigger device_tokens_set_updated_at
before update on public.device_tokens
for each row
execute function public.set_updated_at();

create index if not exists device_tokens_platform_idx on public.device_tokens(platform);

create table if not exists public.live_activity_tokens (
  push_token text primary key,
  activity_id text not null,
  device_token text null references public.device_tokens(device_token) on delete set null,
  zone text null,
  prayer_name text null,
  prayer_time timestamptz null,
  city text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists live_activity_tokens_set_updated_at on public.live_activity_tokens;

create trigger live_activity_tokens_set_updated_at
before update on public.live_activity_tokens
for each row
execute function public.set_updated_at();

create index if not exists live_activity_tokens_device_token_idx on public.live_activity_tokens(device_token);

alter table public.zones enable row level security;
alter table public.prayer_months enable row level security;
alter table public.indonesia_regions enable row level security;
alter table public.indonesia_prayer_months enable row level security;
alter table public.donation_pool_monthly enable row level security;
alter table public.donation_events enable row level security;
alter table public.support_toast_schedule enable row level security;

drop policy if exists "public can read zones" on public.zones;
create policy "public can read zones"
on public.zones
for select
to anon, authenticated
using (true);

drop policy if exists "public can read prayer months" on public.prayer_months;
create policy "public can read prayer months"
on public.prayer_months
for select
to anon, authenticated
using (true);

drop policy if exists "public can read indonesia regions" on public.indonesia_regions;
create policy "public can read indonesia regions"
on public.indonesia_regions
for select
to anon, authenticated
using (true);

drop policy if exists "public can read indonesia prayer months" on public.indonesia_prayer_months;
create policy "public can read indonesia prayer months"
on public.indonesia_prayer_months
for select
to anon, authenticated
using (true);

drop policy if exists "public can read donation pool monthly" on public.donation_pool_monthly;
create policy "public can read donation pool monthly"
on public.donation_pool_monthly
for select
to anon, authenticated
using (true);

drop policy if exists "public can read support toast schedule" on public.support_toast_schedule;
create policy "public can read support toast schedule"
on public.support_toast_schedule
for select
to anon, authenticated
using (true);
