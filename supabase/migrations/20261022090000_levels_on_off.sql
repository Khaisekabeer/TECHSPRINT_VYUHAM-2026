-- A level can be switched off by the quiz master: its questions are kept, but the level is left out
-- of the game and the levels after it are numbered consecutively without it.
alter table public.levels
  add column is_active boolean not null default true;
