-- Per-level visual theme, player avatars, and encrypted question images.

-- Theme of each level on the projector and phones (NULL = picked automatically by round).
alter table public.levels
  add column theme text check (theme is null or theme in ('blast', 'pop', 'arcade', 'circuit', 'classic'));

-- Avatar the player picked when joining, e.g. "a:Kiran7" (style:seed, drawn in the browser).
alter table public.participants
  add column avatar text check (avatar is null or avatar ~ '^[ab]:[A-Za-z0-9]{1,16}$');

-- Images for "identify this person / object" questions. Like question text, the image bytes are
-- encrypted with the question key (AES-256-GCM); only the quiz master and the live game can see them.
create table public.question_images (
  id         uuid primary key default gen_random_uuid(),
  mime       text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  payload    text not null,
  bytes      integer not null,
  created_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.question_images enable row level security;
