-- Role hierarchy:
--   admin        management: participants (MakeMyPass CSV), staff, check-in, settings, results
--   quizmaster   writes questions/answers (encrypted bank) and loads them into the game
--   coordinator  conducts the live event (host console)
--   volunteer    pass check-in and live monitoring
alter table public.staff drop constraint staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('admin', 'quizmaster', 'coordinator', 'volunteer'));

-- Existing management accounts (previously "coordinator") become admins.
update public.staff set role = 'admin' where role = 'coordinator';
