-- Vyuham 2026 TechQuiz: persistent storage.
-- Live gameplay runs in memory on the Node/Socket.IO server; this schema stores
-- the question bank, each game session, participants, and every answer.
-- RLS is enabled with no policies: only the backend (service_role key) can access it.

create table public.questions (
  id             bigint generated always as identity primary key,
  level          smallint not null default 1 check (level between 1 and 3),
  position       integer  not null default 0,
  text           text     not null,
  type           text     not null check (type in ('mcq', 'tf', 'short', 'image')),
  options        jsonb    not null default '[]'::jsonb,
  correct_answer text     not null,
  time_limit     integer  not null default 20 check (time_limit > 0),
  points         integer  not null default 1000,
  image_url      text,
  is_active      boolean  not null default true,
  created_at     timestamptz not null default now()
);

create index questions_order_idx on public.questions (level, position, id) where is_active;

create table public.games (
  id         uuid primary key,
  name       text not null default 'Vyuham 2026',
  status     text not null default 'lobby' check (status in ('lobby', 'running', 'finished')),
  started_at timestamptz,
  ended_at   timestamptz,
  created_at timestamptz not null default now()
);

create table public.participants (
  id                uuid primary key,
  game_id           uuid not null references public.games (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 30),
  team              text,
  score             integer not null default 0,
  streak            integer not null default 0,
  drone_assists     integer not null default 2,
  total_response_ms bigint  not null default 0,
  final_rank        integer,
  joined_at         timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create unique index participants_game_name_uq on public.participants (game_id, lower(name));

create table public.answers (
  id             bigint generated always as identity primary key,
  game_id        uuid   not null references public.games (id) on delete cascade,
  participant_id uuid   not null references public.participants (id) on delete cascade,
  question_id    bigint references public.questions (id) on delete set null,
  answer         text,
  is_correct     boolean not null,
  points         integer not null default 0,
  response_ms    integer not null,
  badge          text,
  created_at     timestamptz not null default now(),
  unique (participant_id, question_id)
);

create index answers_game_idx     on public.answers (game_id);
create index answers_question_idx on public.answers (question_id);

alter table public.questions    enable row level security;
alter table public.games        enable row level security;
alter table public.participants enable row level security;
alter table public.answers      enable row level security;
