-- Elimination rules per level, chosen by the quiz master:
--   top          top N (cut_value) advance
--   percent      top X% (cut_value) advance
--   min_score    a total score of at least cut_value advances
--   bottom       the bottom N (cut_value) are eliminated
--   min_correct  at least cut_value correct answers in this level advance
-- cut_ties: at the cut line, 'speed' = the faster player (less answer time) wins,
--           'include' = everyone tied with the last player through also advances.
-- The coordinator always confirms the cut (and can adjust it) in the host console.
alter table public.levels
  add column cut_rule  text check (cut_rule is null or cut_rule in ('top', 'percent', 'min_score', 'bottom', 'min_correct')),
  add column cut_value numeric check (cut_value is null or cut_value >= 0),
  add column cut_ties  text not null default 'speed' check (cut_ties in ('speed', 'include'));

-- Earlier "Top N advance" settings carry over.
update public.levels set cut_rule = 'top', cut_value = qualify_top where qualify_top is not null;

-- A player can also be eliminated by the coordinator directly (not a disqualification).
alter table public.eliminations drop constraint eliminations_reason_check;
alter table public.eliminations
  add constraint eliminations_reason_check check (reason in ('cut', 'disqualified', 'manual'));
