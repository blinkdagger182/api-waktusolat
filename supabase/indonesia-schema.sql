create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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

alter table public.indonesia_regions enable row level security;
alter table public.indonesia_prayer_months enable row level security;

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
