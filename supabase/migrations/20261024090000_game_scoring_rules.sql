-- The scoring rules a game was played with (multiplier, first-to-answer bonus, streak bonus, round reset).
-- Null on games played before this migration, which used the original rules.
alter table public.games add column if not exists rules jsonb;
