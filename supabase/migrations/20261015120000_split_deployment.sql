-- Split deployment: UI + admin API on Vercel (serverless), live game server on a laptop.
--
-- Serverless requests don't share memory, so an unlocked question key (DEK) is kept with the
-- session, sealed with a key derived from the session token. Only the browser holds the token
-- (the database stores its SHA-256 hash), so this column alone cannot be opened.
alter table public.staff_sessions add column vault_dek text;

-- Public address of the live game server (e.g. https://game.example.com via Cloudflare Tunnel).
-- Empty = same origin as the UI (single-server / development mode).
insert into public.settings (key, value) values ('game_server_url', '""'::jsonb)
on conflict (key) do nothing;
