-- Migration: Accounts & Preferences
-- Adds sched_profiles and sched_user_preferences tables

create table if not exists sched_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'scheduler' check (role in ('scheduler', 'manager', 'admin', 'read_only')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists sched_user_preferences (
  user_id uuid primary key references sched_profiles(id) on delete cascade,
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  default_view text not null default 'week' check (default_view in ('day', 'week')),
  density text not null default 'comfortable' check (density in ('compact', 'comfortable')),
  department_filters jsonb default '[]'::jsonb,
  color_overrides jsonb default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS
alter table sched_profiles enable row level security;
alter table sched_user_preferences enable row level security;

create policy "Users can read all profiles"
  on sched_profiles for select
  to authenticated
  using (true);

create policy "Users can update own profile"
  on sched_profiles for update
  to authenticated
  using (id = auth.uid());

create policy "Admins can manage profiles"
  on sched_profiles for all
  to authenticated
  using (
    exists (
      select 1 from sched_profiles p
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  );

create policy "Users can read own preferences"
  on sched_user_preferences for select
  to authenticated
  using (user_id = auth.uid());

create policy "Users can manage own preferences"
  on sched_user_preferences for all
  to authenticated
  using (user_id = auth.uid());
