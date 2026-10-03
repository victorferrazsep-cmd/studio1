create table if not exists public.google_calendar_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  encryption_iv text not null,
  updated_at timestamptz not null default now()
);

alter table public.google_calendar_credentials enable row level security;

revoke all on public.google_calendar_credentials from anon, authenticated;
