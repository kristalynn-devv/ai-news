begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true
);

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from private.admin_users where user_id = auth.uid() and active)
$$;

create table private.editorial_policies (
  version bigint generated always as identity primary key,
  mode text not null default 'Manual' check (mode in ('Manual', 'Hybrid', 'Auto')),
  auto_stopped boolean not null default true,
  manual_sources text[] not null default '{}',
  auto_sources text[] not null default '{}',
  manual_categories text[] not null default '{}',
  auto_categories text[] not null default '{}',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
insert into private.editorial_policies default values;
create table private.editorial_control (
  singleton boolean primary key default true check (singleton),
  policy_version bigint not null references private.editorial_policies(version)
);
insert into private.editorial_control values (true, 1);

create function private.trim_text(value text) returns text
language sql immutable set search_path = '' as $$
  select btrim(value, E' \t\n\r\f\013' || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
$$;

create function private.valid_citation_url(value text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(length(value) <= 2048
    and value ~ '^https?://([a-zA-Z0-9-]+\.)+[a-zA-Z][a-zA-Z0-9-]*(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'
    and coalesce(substring(value from '^https?://[^/:?#]+:([0-9]+)')::integer <= 65535, true), false)
$$;

-- Content is rendered as text by the UI, never HTML. Internal review fields live elsewhere.
create function private.valid_content(value jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare item jsonb; key text; technical jsonb;
begin
  if jsonb_typeof(value) is distinct from 'object' or octet_length(value::text) > 40000 then return false; end if;
  for key in select jsonb_object_keys(value) loop
    if key <> all(array['title','summary','category','type','why','audience','tags','read','art','technical']) then return false; end if;
  end loop;
  foreach key in array array['title','summary','category','type','why','audience','art'] loop
    if jsonb_typeof(value->key) is distinct from 'string' or length(private.trim_text(value->>key)) = 0 or length(value->>key) > 4000 then return false; end if;
  end loop;
  if length(value->>'title') > 300 or length(value->>'category') > 100 then return false; end if;
  if value->>'type' <> all(array['ข่าว','ความคิดเห็น','งานวิจัย','ประกาศบริษัท','แนวปฏิบัติ']) or
     value->>'art' <> all(array['orbit','model','context','human','workflow','release']) then return false; end if;
  if jsonb_typeof(value->'read') is distinct from 'number' then return false; end if;
  if (value->>'read')::numeric not between 1 and 60 or mod((value->>'read')::numeric,1) <> 0 then return false; end if;
  if jsonb_typeof(value->'tags') is distinct from 'array' then return false; end if;
  if jsonb_array_length(value->'tags') > 20 then return false; end if;
  for item in select jsonb_array_elements(value->'tags') loop
    if jsonb_typeof(item) <> 'string' or length(item#>>'{}') not between 1 and 60 then return false; end if;
  end loop;
  if value ? 'technical' then
    technical := value->'technical';
    if jsonb_typeof(technical) is distinct from 'object' then return false; end if;
    for key in select jsonb_object_keys(technical) loop
      if key <> all(array['impact','steps','caveat']) then return false; end if;
    end loop;
    foreach key in array array['impact','caveat'] loop
      if jsonb_typeof(technical->key) is distinct from 'string' or length(private.trim_text(technical->>key)) not between 1 and 4000 then return false; end if;
    end loop;
    if jsonb_typeof(technical->'steps') is distinct from 'array' then return false; end if;
    if jsonb_array_length(technical->'steps') not between 1 and 20 then return false; end if;
    for item in select jsonb_array_elements(technical->'steps') loop
      if jsonb_typeof(item) <> 'string' or length(private.trim_text(item#>>'{}')) not between 1 and 4000 then return false; end if;
    end loop;
  end if;
  return true;
end $$;

create table private.story_records (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (length(event_key) between 1 and 500),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120),
  source_key text not null,
  status text not null default 'pending' check (status in ('pending','published','excluded','rejected','withdrawn')),
  version integer not null default 1 check (version > 0),
  current_revision_id uuid,
  created_at timestamptz not null default now()
);
create table private.revisions (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references private.story_records(id),
  revision_number integer not null check (revision_number > 0),
  content jsonb not null check (private.valid_content(content)),
  checks_passed boolean not null default false,
  source_conflict boolean not null default false,
  unsupported_claims boolean not null default false,
  injection_detected boolean not null default false,
  evaluated_policy_version bigint references private.editorial_policies(version),
  created_at timestamptz not null default now(),
  unique(story_id, revision_number), unique(story_id, id)
);
alter table private.story_records add constraint current_revision_belongs_to_story
  foreign key (id, current_revision_id) references private.revisions(story_id, id);
create table private.revision_citations (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references private.revisions(id),
  label text not null check (length(private.trim_text(label)) between 1 and 300),
  url text not null check (private.valid_citation_url(url)),
  source_published_at timestamptz,
  verified boolean not null default false,
  unique(revision_id, url)
);

create table public.stories (
  id uuid primary key references private.story_records(id),
  slug text not null unique,
  revision_id uuid not null,
  content jsonb not null check (private.valid_content(content)),
  published_at timestamptz not null,
  updated_at timestamptz not null,
  withdrawn boolean not null default false,
  foreign key (id, revision_id) references private.revisions(story_id, id)
);
create index stories_published_at on public.stories (published_at desc, id) where not withdrawn;
create table public.citations (
  id uuid primary key,
  story_id uuid not null references public.stories(id),
  label text not null,
  url text not null,
  source_published_at timestamptz
);
create index citations_story_id on public.citations(story_id);

create table private.reviews (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references private.story_records(id),
  revision_id uuid not null references private.revisions(id),
  actor_id uuid references auth.users(id),
  decision text not null check (decision in ('approve','reject','withdraw','reopen','auto_publish')),
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  policy_version bigint not null references private.editorial_policies(version),
  created_at timestamptz not null default now(),
  foreign key (story_id, revision_id) references private.revisions(story_id, id)
);
create table private.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null check (action in ('approve','reject','withdraw','reopen','auto_publish','policy_changed')),
  story_id uuid references private.story_records(id),
  policy_version bigint not null references private.editorial_policies(version),
  created_at timestamptz not null default now()
);

create table private.runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  trigger_kind text not null check (trigger_kind in ('scheduled','manual','dry_run')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  status text not null default 'paused' check (status in ('paused','running','success','partial','failed')),
  lease_owner uuid,
  lease_expires_at timestamptz,
  failure_code text,
  policy_version bigint not null references private.editorial_policies(version),
  check (status <> 'running' or (started_at is not null and lease_owner is not null and lease_expires_at is not null))
);
create unique index one_active_run on private.runs ((true)) where status = 'running';
create table private.run_steps (
  run_id uuid not null references private.runs(id),
  step_key text not null,
  attempt integer not null default 1 check (attempt between 1 and 3),
  status text not null check (status in ('pending','running','success','failed','unknown')),
  checkpoint jsonb not null default '{}' check (octet_length(checkpoint::text) <= 4096),
  primary key (run_id, step_key, attempt)
);

-- No AI credentials, provider selection, allowance or scheduler is seeded.
create table private.credential_refs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  vault_secret_id uuid not null unique,
  enabled boolean not null default false
);
create table private.budgets (
  id uuid primary key default gen_random_uuid(),
  month_start date not null unique check (extract(day from month_start) = 1),
  timezone text not null default 'Asia/Bangkok' check (timezone = 'Asia/Bangkok'),
  cash_limit numeric(12,6) not null default 0 check (cash_limit = 0),
  ai_enabled boolean not null default false check (not ai_enabled)
);
create table private.invocations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  run_id uuid not null references private.runs(id),
  story_id uuid references private.story_records(id),
  budget_id uuid not null references private.budgets(id),
  step_key text not null,
  attempt integer not null check (attempt between 1 and 3),
  purpose text not null check (purpose in ('pipeline','test','dry_run','retry')),
  provider text not null,
  model text not null,
  provider_request_id text,
  agent_name text,
  credential_ref_id uuid references private.credential_refs(id),
  prompt_version text,
  latency_ms bigint check (latency_ms >= 0),
  currency text not null default 'USD' check (currency = 'USD'),
  status text not null default 'reserved' check (status in ('reserved','succeeded','failed','unknown')),
  measurement text not null default 'unavailable' check (measurement in ('provider_reported','estimated','unavailable')),
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  cache_read_tokens bigint check (cache_read_tokens >= 0),
  cache_write_tokens bigint check (cache_write_tokens >= 0),
  reasoning_tokens bigint check (reasoning_tokens >= 0),
  reserved_quota bigint not null check (reserved_quota >= 0),
  quota_unit text not null check (quota_unit in ('tokens','requests','neurons')),
  estimated_cost numeric(12,6) check (estimated_cost >= 0),
  actual_cost numeric(12,6) check (actual_cost >= 0),
  usage_mapping jsonb not null default '{}' check (jsonb_typeof(usage_mapping) = 'object'),
  pricing_snapshot jsonb not null check (jsonb_typeof(pricing_snapshot) = 'object'),
  created_at timestamptz not null default now(),
  unique(run_id, step_key, attempt),
  check (measurement <> 'unavailable' or (input_tokens is null and output_tokens is null and cache_read_tokens is null and cache_write_tokens is null and reasoning_tokens is null)),
  check (status <> 'unknown' or actual_cost is null)
);

-- RLS is a second boundary behind schema/table grants, including accidental exposure.
DO $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname = 'private' loop
    execute format('alter table private.%I enable row level security', t.tablename);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role', t.tablename);
  end loop;
end $$;
alter table public.stories enable row level security;
alter table public.citations enable row level security;
revoke all on public.stories, public.citations from public, anon, authenticated, service_role;
grant select on public.stories, public.citations to anon, authenticated;
create policy published_stories on public.stories for select to anon, authenticated using (not withdrawn);
create policy published_citations on public.citations for select to anon, authenticated
  using (exists (select 1 from public.stories s where s.id = story_id and not s.withdrawn));

-- A Vault UUID is a reference, never a plaintext provider key. No decrypt RPC is exposed.
-- Supabase owns the vault schema and its function grants; this app never changes them.

create function private.assert_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Administrator required' using errcode = '42501'; end if;
end $$;

create function private.publication_decision(p_story uuid, p_revision uuid, p_policy bigint)
returns text language plpgsql stable security definer set search_path = '' as $$
declare s private.story_records; r private.revisions; p private.editorial_policies;
begin
  select * into s from private.story_records where id = p_story;
  select * into r from private.revisions where id = p_revision and story_id = p_story;
  select ep.* into p from private.editorial_policies ep join private.editorial_control c on c.policy_version = ep.version;
  if s.id is null or r.id is null or s.current_revision_id is distinct from r.id then return 'stale_revision'; end if;
  if s.status <> 'pending' then return 'held_status'; end if;
  if p.version is distinct from p_policy or r.evaluated_policy_version is distinct from p.version then return 'stale_policy'; end if;
  if p.auto_stopped then return 'auto_stopped'; end if;
  if not r.checks_passed or r.source_conflict or r.unsupported_claims or r.injection_detected then return 'unsafe'; end if;
  if not exists (select 1 from private.revision_citations where revision_id = r.id and verified)
    or exists (select 1 from private.revision_citations where revision_id = r.id and (not verified or source_published_at is null)) then return 'citations_need_review'; end if;
  if p.mode = 'Manual' or s.source_key = any(p.manual_sources) or r.content->>'category' = any(p.manual_categories) then return 'manual'; end if;
  if p.mode = 'Hybrid' and not (s.source_key = any(p.auto_sources) or r.content->>'category' = any(p.auto_categories)) then return 'manual'; end if;
  return 'eligible';
end $$;

create function public.admin_queue(p_status text default 'pending', p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  return coalesce((select jsonb_agg(row_data order by created_at desc, id) from (
    select s.id, s.created_at, jsonb_build_object('id', s.id, 'slug', s.slug, 'version', s.version,
      'status', case when s.status = 'published' and s.current_revision_id <> published.revision_id then 'pending' else s.status end,
      'has_publication', published.id is not null, 'revision_id', r.id, 'content', r.content, 'checks_passed', r.checks_passed,
      'source_conflict', r.source_conflict, 'unsupported_claims', r.unsupported_claims,
      'injection_detected', r.injection_detected, 'policy_version', r.evaluated_policy_version,
      'citations', coalesce((select jsonb_agg(jsonb_build_object('label', c.label, 'url', c.url,
        'source_published_at', c.source_published_at, 'verified', c.verified) order by c.url)
        from private.revision_citations c where c.revision_id = r.id), '[]'::jsonb)) row_data
    from private.story_records s join private.revisions r on r.id = s.current_revision_id
    left join public.stories published on published.id = s.id and not published.withdrawn
    where p_status = 'all' or (case when s.status = 'published' and s.current_revision_id <> published.revision_id then 'pending' else s.status end) = p_status
    order by s.created_at desc, s.id limit 50 offset greatest(coalesce(p_offset,0),0)
  ) q), '[]'::jsonb);
end $$;

create function public.review_story(p_story_id uuid, p_revision_id uuid, p_expected_version integer, p_action text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s private.story_records; r private.revisions; policy_id bigint; reviewed_revision uuid;
begin
  perform private.assert_admin();
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Reason required' using errcode = '22023'; end if;
  -- Lock ordering matches policy updates; publication cannot race a stop/change.
  select policy_version into policy_id from private.editorial_control where singleton for share;
  select * into s from private.story_records where id = p_story_id for update;
  if s.id is null or s.version is distinct from p_expected_version or s.current_revision_id is distinct from p_revision_id then
    raise exception 'Story changed; reload before deciding' using errcode = '40001';
  end if;
  select * into r from private.revisions where id = p_revision_id;
  reviewed_revision := r.id;
  if p_action = 'approve' and s.status in ('pending','published') then
    if not r.checks_passed or r.source_conflict or r.unsupported_claims or r.injection_detected then
      raise exception 'Resolve safety checks before approval' using errcode = '22023';
    end if;
    if (select count(*) from private.revision_citations where revision_id = r.id) not between 1 and 100
      or exists (select 1 from private.revision_citations where revision_id = r.id and not verified) then
      raise exception 'Verified citations required' using errcode = '22023';
    end if;
    if exists (select 1 from public.stories where id = s.id and revision_id = r.id and not withdrawn) then
      raise exception 'Revision already published' using errcode = '22023';
    end if;
    insert into public.stories(id, slug, revision_id, content, published_at, updated_at)
      values(s.id, s.slug, r.id, r.content, now(), now())
      on conflict (id) do update set revision_id = excluded.revision_id, content = excluded.content,
        updated_at = excluded.updated_at, withdrawn = false;
    delete from public.citations where story_id = s.id;
    insert into public.citations(id, story_id, label, url, source_published_at)
      select id, s.id, label, url, source_published_at from private.revision_citations where revision_id = r.id;
    update private.story_records set status = 'published', version = version + 1 where id = s.id;
  elsif p_action = 'reject' and (s.status = 'pending' or (s.status = 'published' and exists (
      select 1 from public.stories where id = s.id and not withdrawn and revision_id <> r.id))) then
    -- Reject the new draft, preserving the last approved publication and its citations.
    update private.story_records set
      status = case when exists(select 1 from public.stories where id = s.id and not withdrawn) then 'published' else 'rejected' end,
      current_revision_id = coalesce((select revision_id from public.stories where id = s.id and not withdrawn), current_revision_id),
      version = version + 1 where id = s.id;
  elsif p_action = 'withdraw' and s.status in ('pending','published') and exists(select 1 from public.stories where id = s.id and not withdrawn) then
    select revision_id into reviewed_revision from public.stories where id = s.id;
    update public.stories set withdrawn = true where id = s.id;
    update private.story_records set status = 'withdrawn', version = version + 1 where id = s.id;
  elsif p_action = 'reopen' and s.status in ('rejected','withdrawn','excluded') then
    update private.story_records set status = 'pending', version = version + 1 where id = s.id;
  else
    raise exception 'Invalid review transition' using errcode = '22023';
  end if;
  insert into private.reviews(story_id, revision_id, actor_id, decision, reason, policy_version)
    values(s.id, reviewed_revision, auth.uid(), p_action, btrim(p_reason), policy_id);
  insert into private.audit_events(actor_id, action, story_id, policy_version)
    values(auth.uid(), p_action, s.id, policy_id);
end $$;

create function public.set_editorial_policy(p_expected_version bigint, p_mode text, p_auto_stopped boolean,
  p_manual_sources text[] default '{}', p_auto_sources text[] default '{}',
  p_manual_categories text[] default '{}', p_auto_categories text[] default '{}')
returns bigint language plpgsql security definer set search_path = '' as $$
declare current_version bigint; next_version bigint;
begin
  perform private.assert_admin();
  select policy_version into current_version from private.editorial_control where singleton for update;
  if current_version is distinct from p_expected_version then raise exception 'Policy changed; reload' using errcode = '40001'; end if;
  insert into private.editorial_policies(mode, auto_stopped, manual_sources, auto_sources, manual_categories, auto_categories, created_by)
    values(p_mode, p_auto_stopped, p_manual_sources, p_auto_sources, p_manual_categories, p_auto_categories, auth.uid()) returning version into next_version;
  update private.editorial_control set policy_version = next_version where singleton;
  insert into private.audit_events(actor_id, action, policy_version) values(auth.uid(), 'policy_changed', next_version);
  return next_version;
end $$;

create function public.admin_policy() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  return (select to_jsonb(p) from private.editorial_policies p join private.editorial_control c on c.policy_version = p.version);
end $$;

create function public.search_stories(p_query text default '', p_limit integer default 30, p_offset integer default 0)
returns setof jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(s) || jsonb_build_object('citations', coalesce((select jsonb_agg(to_jsonb(c) order by c.url) from public.citations c where c.story_id = s.id), '[]'::jsonb))
  from public.stories s
  where not withdrawn and (coalesce(p_query, '') = '' or
    strpos(lower((content->>'title') || ' ' || (content->>'summary') || ' ' || (content->'tags')::text), lower(left(p_query, 200))) > 0)
  order by published_at desc, id limit least(greatest(coalesce(p_limit, 30), 1), 50)
  offset least(greatest(coalesce(p_offset, 0), 0), 10000)
$$;

create function public.get_story(p_slug text) returns setof jsonb
language sql stable security invoker set search_path = '' as $$
  select to_jsonb(s) || jsonb_build_object('citations', coalesce((select jsonb_agg(to_jsonb(c) order by c.url) from public.citations c where c.story_id = s.id), '[]'::jsonb))
  from public.stories s where s.slug = p_slug and not s.withdrawn limit 1
$$;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on function public.is_admin(), public.admin_queue(text,integer), public.admin_policy(),
  public.review_story(uuid,uuid,integer,text,text),
  public.set_editorial_policy(bigint,text,boolean,text[],text[],text[],text[]),
  public.search_stories(text,integer,integer), public.get_story(text) from public, anon, authenticated, service_role;
grant execute on function public.is_admin(), public.admin_queue(text,integer), public.admin_policy(),
  public.review_story(uuid,uuid,integer,text,text),
  public.set_editorial_policy(bigint,text,boolean,text[],text[],text[],text[]) to authenticated;
grant execute on function public.search_stories(text,integer,integer), public.get_story(text) to anon, authenticated;

commit;
