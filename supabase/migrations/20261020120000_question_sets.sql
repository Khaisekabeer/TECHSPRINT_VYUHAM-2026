-- Question sets: several banks (e.g. "Main set", "Trial set"), each with its own levels,
-- questions, PIN and recovery code. The PIN belongs to the set, not to an account: the quiz
-- master who creates a set chooses it, and the coordinator enters it to load the set into the game.
create table public.question_banks (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 60),
  -- The set's key (DEK) sealed with a key derived from its PIN + the server secret.
  -- NULL until a quiz master sets the PIN (the Trial set, migrated from the old single bank).
  pin_salt         text,
  wrapped_dek      text,
  recovery_salt    text,
  recovery_wrapped text,
  created_by       uuid references public.staff (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.question_banks enable row level security;

-- Existing questions and levels become the "Trial set" (its key is moved over on first open).
insert into public.question_banks (name) values ('Trial set');

-- Levels belong to a set.
alter table public.questions drop constraint questions_level_fkey;
alter table public.levels drop constraint levels_pkey;
alter table public.levels add column bank_id uuid references public.question_banks (id) on delete cascade;
update public.levels set bank_id = (select id from public.question_banks limit 1);
alter table public.levels alter column bank_id set not null;
alter table public.levels add primary key (bank_id, number);

-- Questions belong to a set and to one of its levels.
alter table public.questions add column bank_id uuid references public.question_banks (id) on delete cascade;
update public.questions set bank_id = (select id from public.question_banks limit 1);
alter table public.questions alter column bank_id set not null;
alter table public.questions
  add constraint questions_level_fkey foreign key (bank_id, level) references public.levels (bank_id, number) on delete restrict;
drop index if exists questions_level_position_idx;
create index questions_bank_level_position_idx on public.questions (bank_id, level, position);

-- Pictures are encrypted with their set's key.
alter table public.question_images add column bank_id uuid references public.question_banks (id) on delete cascade;
update public.question_images set bank_id = (select id from public.question_banks limit 1);

-- A staff session holds at most one open set.
alter table public.staff_sessions add column vault_bank uuid references public.question_banks (id) on delete set null;
