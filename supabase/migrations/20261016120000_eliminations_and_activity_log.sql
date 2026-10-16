-- Elimination between levels, disqualification, and a per-candidate activity log.

-- After a level's last question, only the top N (by total score, ties broken by total answer
-- time) go on to the next level. NULL = everyone advances. Ignored on the final level.
alter table public.levels
  add column qualify_top integer check (qualify_top is null or qualify_top between 1 and 10000);

-- Participants stay in `participants` (their answers and log must survive); `status` says
-- whether they are still playing.
alter table public.participants
  add column status text not null default 'active' check (status in ('active', 'eliminated', 'disqualified')),
  add column eliminated_level smallint;

-- Everyone who left a game before the end, and why: cut after a level, or disqualified by staff.
create table public.eliminations (
  id             bigint generated always as identity primary key,
  game_id        uuid not null references public.games (id) on delete cascade,
  participant_id uuid not null references public.participants (id) on delete cascade,
  ticket_id      text,
  name           text not null,
  level          smallint,          -- level number they were in when they left
  round          smallint,          -- that level's place in the game (1st, 2nd, ...)
  reason         text not null check (reason in ('cut', 'disqualified')),
  note           text,              -- "Top 20 advance", or the staff member's reason
  rank_at_exit   integer,
  score_at_exit  integer not null default 0,
  staff_id       uuid references public.staff (id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (game_id, participant_id)
);
create index eliminations_game_idx on public.eliminations (game_id);
alter table public.eliminations enable row level security;

-- Everything a candidate did, in order: joins, failed attempts, reconnects, answers, leaving the
-- quiz screen, eliminations, disqualifications. game_id has no foreign key because lobby events
-- are logged before the game row exists (it is created when the host starts the game).
create table public.participant_events (
  id             bigint generated always as identity primary key,
  game_id        uuid not null,
  participant_id uuid,
  ticket_id      text,
  player_name    text,
  event          text not null,
  question_index integer,           -- 1-based question number, when it happened during one
  question_id    bigint,
  detail         jsonb not null default '{}'::jsonb,
  ip             text,
  at             timestamptz not null
);
create index participant_events_game_idx on public.participant_events (game_id, at);
create index participant_events_ticket_idx on public.participant_events (ticket_id);
alter table public.participant_events enable row level security;
