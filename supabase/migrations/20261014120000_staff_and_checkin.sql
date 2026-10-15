-- TechSprint: staff roles, pass check-in, and settings.
-- All tables are backend-only (RLS on, no policies; the server uses the secret key).

-- Staff accounts: coordinator (everything except the question bank), quizmaster
-- (question bank behind a second PIN + game control), volunteer (pass scanning).
create table public.staff (
  id            uuid primary key default gen_random_uuid(),
  username      text not null check (username ~ '^[a-zA-Z0-9._-]{3,32}$'),
  display_name  text not null check (char_length(display_name) between 1 and 60),
  role          text not null check (role in ('coordinator', 'quizmaster', 'volunteer')),
  password_hash text not null,
  pin_hash      text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    uuid references public.staff (id) on delete set null,
  constraint quizmaster_has_pin check (role <> 'quizmaster' or pin_hash is not null)
);
create unique index staff_username_uq on public.staff (lower(username));
create index staff_created_by_idx on public.staff (created_by);

-- Login sessions (token stored as a SHA-256 hash). vault_until = question bank unlocked until.
create table public.staff_sessions (
  token_hash  text primary key,
  staff_id    uuid not null references public.staff (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  vault_until timestamptz
);
create index staff_sessions_staff_idx on public.staff_sessions (staff_id);

-- Registered participants, imported from the ticketing platform's CSV export.
create table public.registrations (
  ticket_id     text primary key check (ticket_id <> '' and ticket_id = upper(ticket_id)),
  name          text not null,
  email         text,
  phone         text,
  college       text,
  extra         jsonb not null default '{}'::jsonb,
  checked_in_at timestamptz,
  checked_in_by uuid references public.staff (id) on delete set null,
  imported_at   timestamptz not null default now()
);
create index registrations_name_idx on public.registrations (lower(name));
create index registrations_checked_in_at_idx on public.registrations (checked_in_at);
create index registrations_checked_in_by_idx on public.registrations (checked_in_by);

-- Audit trail of admissions and undos.
create table public.checkin_events (
  id         bigint generated always as identity primary key,
  ticket_id  text not null references public.registrations (ticket_id) on delete cascade,
  staff_id   uuid references public.staff (id) on delete set null,
  action     text not null check (action in ('admit', 'undo')),
  created_at timestamptz not null default now()
);
create index checkin_events_ticket_idx on public.checkin_events (ticket_id);
create index checkin_events_staff_idx on public.checkin_events (staff_id, created_at desc);

-- Key/value settings controlled by the coordinator.
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value) values ('require_checkin', 'true'::jsonb);

-- Link players to their ticket (null when check-in is not required).
alter table public.participants
  add column ticket_id text references public.registrations (ticket_id) on delete set null;
create index participants_ticket_idx on public.participants (ticket_id);
create unique index participants_game_ticket_uq on public.participants (game_id, ticket_id) where ticket_id is not null;

alter table public.staff          enable row level security;
alter table public.staff_sessions enable row level security;
alter table public.registrations  enable row level security;
alter table public.checkin_events enable row level security;
alter table public.settings       enable row level security;
