-- Allow staff to sign in with an email address as their username.
alter table public.staff drop constraint staff_username_check;
alter table public.staff add constraint staff_username_check check (username ~ '^[a-zA-Z0-9._@+-]{3,64}$');
