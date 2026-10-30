-- Question videos: the files live in a private storage bucket (encrypted at rest by Supabase);
-- this table is their index. A question refers to a video by id, inside its encrypted content.
-- Links are signed by the game server and only handed to players while their question is live.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('question-videos', 'question-videos', false, 52428800, array['video/mp4', 'video/webm'])
on conflict (id) do nothing;

create table public.question_videos (
  id         uuid primary key default gen_random_uuid(),
  bank_id    uuid not null references public.question_banks (id) on delete cascade,
  path       text not null unique,
  mime       text not null check (mime in ('video/mp4', 'video/webm')),
  bytes      integer not null,
  created_by uuid references public.staff (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.question_videos enable row level security; -- backend (secret key) only, like every table
