-- Shared drawing payloads are accessed only through room-authorized server routes.
alter table public.reading_rooms add column if not exists drawing_state jsonb not null
  default '{"revision":0,"items":[]}'::jsonb;
