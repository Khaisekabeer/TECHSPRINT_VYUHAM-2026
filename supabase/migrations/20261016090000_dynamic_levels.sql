-- Levels (rounds) are managed by the quiz master: any number of them, each with a name and a
-- points multiplier. Questions belong to a level by its number; levels are played in number order.
create table public.levels (
  number     smallint primary key check (number between 1 and 99),
  name       text not null check (char_length(name) between 1 and 40),
  multiplier numeric(4, 2) not null default 1 check (multiplier > 0 and multiplier <= 10),
  created_at timestamptz not null default now()
);
alter table public.levels enable row level security; -- backend (secret key) only, like every table

insert into public.levels (number, name, multiplier) values
  (1, 'Warm-up', 1),
  (2, 'Core Tech', 2),
  (3, 'Brain Burner', 3);

alter table public.questions drop constraint questions_level_check;
alter table public.questions
  add constraint questions_level_fkey foreign key (level) references public.levels (number) on delete restrict;
create index questions_level_position_idx on public.questions (level, position);
