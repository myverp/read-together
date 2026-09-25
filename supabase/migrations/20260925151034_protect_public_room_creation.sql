-- Public upload guard. Only the server's service_role can call these functions.
create table public.room_creation_limits (
  scope_hash text not null,
  window_kind text not null check (window_kind in ('hour', 'day')),
  window_start timestamptz not null,
  attempts integer not null default 0,
  primary key (scope_hash, window_kind, window_start)
);
alter table public.room_creation_limits enable row level security;
revoke all on public.room_creation_limits from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.room_creation_limits to service_role;

alter table public.reading_rooms add column cleanup_started_at timestamptz;
create index reading_rooms_pending_cleanup on public.reading_rooms(created_at)
  where ready = false;

create function public.room_storage_usage()
returns table (stored_bytes bigint, pending_bytes bigint, budget_bytes bigint, room_count bigint)
language sql security invoker set search_path = ''
as $$
  select
    (select coalesce(sum(coalesce((o.metadata->>'size')::bigint, 0)), 0)::bigint
       from storage.objects o where o.bucket_id = 'epubs'),
    (select count(*) * 26214400 from public.reading_rooms r
       where not r.ready and r.cleanup_started_at is null
       and not exists (select 1 from storage.objects o
         where o.bucket_id = 'epubs' and o.name = r.book_path)),
    524288000::bigint,
    (select count(*) from public.reading_rooms);
$$;
revoke all on function public.room_storage_usage() from public, anon, authenticated;
grant execute on function public.room_storage_usage() to service_role;

create function public.create_reading_room(
  p_code text, p_title text, p_book_path text, p_topic text,
  p_reader_one text, p_reader_one_user uuid, p_control_hash_one text,
  p_preferred_color integer, p_scope_hash text
)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  usage record;
  hour_start timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  day_start timestamptz := pg_catalog.date_trunc('day', pg_catalog.now());
  hour_count integer;
  day_count integer;
  browser_count integer;
begin
  -- Serialize the budget check, counters, and room insert across server instances.
  perform pg_catalog.pg_advisory_xact_lock(781452930);
  select * into usage from public.room_storage_usage();
  if usage.stored_bytes + usage.pending_bytes + 26214400 > usage.budget_bytes then
    return 'storage_budget';
  end if;
  select count(*) into browser_count from public.reading_rooms
    where reader_one = p_reader_one and created_at >= pg_catalog.now() - interval '1 hour';
  if browser_count >= 10 then return 'browser_limit'; end if;
  select coalesce(attempts, 0) into hour_count from public.room_creation_limits
    where scope_hash = p_scope_hash and window_kind = 'hour' and window_start = hour_start;
  select coalesce(attempts, 0) into day_count from public.room_creation_limits
    where scope_hash = p_scope_hash and window_kind = 'day' and window_start = day_start;
  if coalesce(hour_count, 0) >= 30 or coalesce(day_count, 0) >= 100 then
    return 'network_limit';
  end if;

  insert into public.reading_rooms (
    code, title, book_path, topic, reader_one, reader_one_user,
    control_hash_one, control_version_one, highlight_state
  ) values (
    p_code, p_title, p_book_path, p_topic, p_reader_one, p_reader_one_user,
    p_control_hash_one, case when p_reader_one_user is null then 0 else 1 end,
    pg_catalog.jsonb_build_object('revision', 0, 'items', '[]'::jsonb,
      'colors', pg_catalog.jsonb_build_array(p_preferred_color, -1))
  );
  insert into public.room_creation_limits (scope_hash, window_kind, window_start, attempts)
    values (p_scope_hash, 'hour', hour_start, 1), (p_scope_hash, 'day', day_start, 1)
    on conflict (scope_hash, window_kind, window_start)
    do update set attempts = public.room_creation_limits.attempts + 1;
  return 'ok';
end;
$$;
revoke all on function public.create_reading_room(text,text,text,text,text,uuid,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.create_reading_room(text,text,text,text,text,uuid,text,integer,text)
  to service_role;
