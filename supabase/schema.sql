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

alter table public.zones enable row level security;
alter table public.prayer_months enable row level security;

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
