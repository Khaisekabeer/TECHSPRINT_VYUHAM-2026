-- Encrypted question bank (envelope encryption).
--   * Each question's text/options/answer is stored in `payload`, AES-256-GCM encrypted with a
--     random data key (DEK). Plaintext columns are emptied once a row is encrypted.
--   * The DEK is never stored in the clear. Each quiz master has an X25519 key pair whose private
--     key is encrypted with a key derived from their PIN (+ a server-side secret); the DEK is
--     wrapped to each quiz master's public key in question_key_grants.
--   * question_vault holds one extra copy of the DEK wrapped with a one-time recovery code.

alter table public.questions add column payload text;
alter table public.questions alter column text drop not null;
alter table public.questions alter column correct_answer drop not null;
alter table public.questions add constraint questions_content_present
  check (payload is not null or (text is not null and correct_answer is not null));

alter table public.staff add column vault_public_key text;
alter table public.staff add column vault_private_key text;
alter table public.staff add column vault_key_salt text;

create table public.question_vault (
  id               smallint primary key default 1 check (id = 1),
  recovery_salt    text not null,
  recovery_wrapped text not null,
  created_at       timestamptz not null default now(),
  created_by       uuid references public.staff (id) on delete set null
);
create index question_vault_created_by_idx on public.question_vault (created_by);

create table public.question_key_grants (
  staff_id    uuid primary key references public.staff (id) on delete cascade,
  wrapped_dek text not null,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references public.staff (id) on delete set null
);
create index question_key_grants_granted_by_idx on public.question_key_grants (granted_by);

alter table public.question_vault      enable row level security;
alter table public.question_key_grants enable row level security;
