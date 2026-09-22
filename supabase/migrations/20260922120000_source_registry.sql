begin;

-- Wayfinder tickets 0016/0019: the feeds we fetch and the domains we may follow a link into are
-- two concepts, not one, so they are two tables. Counts disagree in both directions: six sources
-- read releases from the single host api.github.com, while anthropic.com has no feed at all yet
-- must stay followable. Both tables are editable from the back office, because 0011 requires a
-- fetch to stop the day a source objects and that cannot wait for a migration.

alter table private.audit_events drop constraint audit_events_action_check;
alter table private.audit_events add constraint audit_events_action_check
  check (action in ('approve','reject','withdraw','reopen','auto_publish','policy_changed',
                    'draft_created','draft_updated','ai_enabled_changed','schedule_changed',
                    'budget_rolled_over','source_changed','allowlist_changed'));

-- Which source or domain changed. story_id cannot carry it, and an audit row without its subject
-- says only that somebody touched something.
alter table private.audit_events add column target text
  check (target is null or length(private.trim_text(target)) between 1 and 253);

create table private.sources (
  source_key text primary key check (source_key ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(source_key) <= 60),
  label text not null check (length(private.trim_text(label)) between 1 and 200),
  feed_url text check (feed_url is null or private.valid_citation_url(feed_url)),
  -- json_api exists because github.com disallows /*.atom$ for every agent and points at its REST
  -- API instead, which also carries the prerelease flag the .atom feed never had (0019).
  fetch_mode text not null check (fetch_mode in ('feed_only','feed_then_page','json_api','manual')),
  -- 0007: Simon Willison is a linkblog, so his post may never be cited as the final source.
  commentary boolean not null default false,
  enabled boolean not null default true,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  last_ok_at timestamptz,
  last_failure_code text check (last_failure_code is null or length(private.trim_text(last_failure_code)) between 1 and 100),
  -- 'manual' is the editor's desk rather than a feed: it exists so a hand-written draft has a real
  -- source to point at, and it is the one row that is never fetched.
  constraint sources_manual_has_no_feed check ((fetch_mode = 'manual') = (feed_url is null)),
  constraint sources_manual_never_enabled check (fetch_mode <> 'manual' or not enabled)
);

-- A bare lowercase hostname whose last label is a TLD, punycode included so a Thai or Russian
-- source can be added later. The alphabetic last label keeps a raw IP literal out of the list,
-- which is the one address shape the fetch step cannot re-check after DNS resolves.
create function private.valid_fetch_domain(value text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(length(value) between 4 and 253
    and value !~ '[^.]{64}'
    and value ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.([a-z]{2,63}|xn--[a-z0-9-]{2,59})$', false)
$$;

create table private.fetch_allowlist (
  domain text primary key check (private.valid_fetch_domain(domain)),
  reason text not null check (length(private.trim_text(reason)) between 1 and 500),
  added_by uuid references auth.users(id),
  added_at timestamptz not null default now()
);

create function private.url_host(p_url text) returns text
language sql immutable set search_path = '' as $$
  select lower(substring(p_url from '^https?://([^/:?#]+)'))
$$;

-- The one place that answers "may we fetch from this host". The rule cannot live in a test or be
-- re-invented by the fetch step, and it matches on a label boundary: www.openai.com and any other
-- subdomain of a listed domain are in, evil-openai.com is not.
create function private.fetch_domain_allowed(p_host text) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from private.fetch_allowlist a
                 where lower(p_host) = a.domain or lower(p_host) like '%.' || a.domain)
$$;

-- 25 fetchable sources: the twelve of 0007 with GitHub moved to the REST API, plus the thirteen of
-- 0019. Every URL was requested with ai-daily-bot/0.1 on 2026-09-22 and is the address after any
-- redirect, so the pipeline never pays for a hop that is already known.
insert into private.sources(source_key, label, feed_url, fetch_mode, commentary, enabled) values
  ('openai',            'OpenAI News',            'https://openai.com/news/rss.xml',                        'feed_then_page', false, true),
  ('deepmind',          'Google DeepMind Blog',   'https://deepmind.google/blog/rss.xml',                   'feed_then_page', false, true),
  ('mistral',           'Mistral AI News',        'https://mistral.ai/news/rss',                            'feed_then_page', false, true),
  ('huggingface',       'Hugging Face Blog',      'https://huggingface.co/blog/feed.xml',                   'feed_then_page', false, true),
  ('google-research',   'Google Research Blog',   'https://research.google/blog/rss/',                      'feed_then_page', false, true),
  ('together-ai',       'Together AI Blog',       'https://www.together.ai/blog/rss.xml',                   'feed_then_page', false, true),
  ('gh-pytorch',        'PyTorch Releases',       'https://api.github.com/repos/pytorch/pytorch/releases',  'json_api',       false, true),
  ('gh-transformers',   'Transformers Releases',  'https://api.github.com/repos/huggingface/transformers/releases', 'json_api', false, true),
  ('gh-vllm',           'vLLM Releases',          'https://api.github.com/repos/vllm-project/vllm/releases','json_api',       false, true),
  ('gh-langchain',      'LangChain Releases',     'https://api.github.com/repos/langchain-ai/langchain/releases', 'json_api',  false, true),
  ('gh-llama-cpp',      'llama.cpp Releases',     'https://api.github.com/repos/ggml-org/llama.cpp/releases','json_api',      false, true),
  ('gh-mcp-servers',    'MCP Servers Releases',   'https://api.github.com/repos/modelcontextprotocol/servers/releases', 'json_api', false, true),
  ('simon-willison',    'Simon Willison',         'https://simonwillison.net/atom/everything/',             'feed_only',      true,  true),
  ('latent-space',      'Latent Space',           'https://www.latent.space/feed',                          'feed_only',      false, true),
  ('cursor',            'Cursor Changelog',       'https://cursor.com/changelog/rss.xml',                   'feed_only',      false, true),
  ('sebastian-raschka', 'Sebastian Raschka',      'https://magazine.sebastianraschka.com/feed',             'feed_only',      false, true),
  ('answer-ai',         'Answer.AI',              'https://www.answer.ai/index.xml',                        'feed_only',      false, true),
  ('hamel',             'Hamel Husain',           'https://hamel.dev/index.xml',                            'feed_only',      false, true),
  ('lilian-weng',       'Lilian Weng',            'https://lilianweng.github.io/index.xml',                 'feed_only',      false, true),
  ('aihero',            'AI Hero',                'https://www.aihero.dev/rss.xml',                         'feed_then_page', false, true),
  ('modal',             'Modal Blog',             'https://modal.com/blog/atom.xml',                        'feed_then_page', false, true),
  ('replicate',         'Replicate Blog',         'https://replicate.com/blog/rss',                         'feed_then_page', false, true),
  ('ollama',            'Ollama Blog',            'https://ollama.com/blog/rss.xml',                        'feed_then_page', false, true),
  ('jxnl',              'Jason Liu',              'https://jxnl.co/feed_rss_created.xml',                   'feed_then_page', false, true),
  ('eugene-yan',        'Eugene Yan',             'https://eugeneyan.com/rss/',                             'feed_then_page', false, true),
  ('manual',            'Editorial desk',         null,                                                     'manual',         false, false);

-- The FK closes the loop 0016 opened: source_key was free text, so a typo in the pipeline produced
-- a story from a source that does not exist. Hand-written drafts point at the 'manual' row above.
-- A stray key aborts the whole migration, so name it instead of leaving the operator with a
-- constraint name to decode.
do $$
declare strays text;
begin
  select string_agg(distinct s.source_key, ', ') into strays
    from private.story_records s
    left join private.sources src on src.source_key = s.source_key
   where src.source_key is null;
  if strays is not null then
    raise exception 'Remap these story_records.source_key values into private.sources first: %', strays;
  end if;
end $$;
alter table private.story_records
  add constraint story_records_source_key_fkey foreign key (source_key) references private.sources(source_key);

-- Deliberately wider than the feed list: Simon Willison links out on almost every post, so a narrow
-- allowlist fills the review queue with items a human has to open by hand (0016). robots.txt of every
-- domain here was read with ai-daily-bot/0.1 and allows the content paths; arxiv.org asks for a
-- 15-second crawl delay, which the fetch step owes it.
insert into private.fetch_allowlist(domain, reason) values
  ('openai.com',                     'Feed source'),
  ('deepmind.google',                'Feed source'),
  ('mistral.ai',                     'Feed source'),
  ('huggingface.co',                 'Feed source'),
  ('research.google',                'Feed source'),
  ('together.ai',                    'Feed source'),
  ('github.com',                     'Release notes link back to the repository; no feed lives here'),
  ('api.github.com',                 'Feed host: releases are read through the REST API (0019)'),
  ('simonwillison.net',              'Feed source: commentary, cited only alongside the original'),
  ('latent.space',                   'Feed source'),
  ('cursor.com',                     'Feed source'),
  ('magazine.sebastianraschka.com',  'Feed source'),
  ('answer.ai',                      'Feed source'),
  ('hamel.dev',                      'Feed source'),
  ('lilianweng.github.io',           'Feed source'),
  ('aihero.dev',                     'Feed source: feed carries no body, the page is required'),
  ('modal.com',                      'Feed source: feed carries no body, the page is required'),
  ('replicate.com',                  'Feed source: feed carries no body, the page is required'),
  ('ollama.com',                     'Feed source: feed carries no body, the page is required'),
  ('jxnl.co',                        'Feed source: feed carries a teaser only'),
  ('eugeneyan.com',                  'Feed source: feed carries a teaser only'),
  ('anthropic.com',                  'Major lab with no feed; reaches us only through other sources (0007)'),
  ('meta.com',                       'Major lab commonly linked to by commentary'),
  ('nvidia.com',                     'Major vendor commonly linked to by commentary'),
  ('microsoft.com',                  'Major vendor commonly linked to by commentary'),
  ('aws.amazon.com',                 'Major vendor commonly linked to by commentary'),
  ('arxiv.org',                      'Papers linked to by commentary; feed stays out of the MVP (0007)'),
  ('pytorch.org',                    'Framework documentation and release posts'),
  ('langchain.com',                  'Tool vendor commonly linked to by commentary');

alter table private.sources enable row level security;
alter table private.fetch_allowlist enable row level security;
revoke all on private.sources, private.fetch_allowlist from public, anon, authenticated, service_role;

-- One writer for both audit trails: the policy version is read the same way everywhere else.
create function private.audit_registry_change(p_action text, p_target text) returns void
language plpgsql security definer set search_path = '' as $$
declare policy_id bigint;
begin
  select policy_version into policy_id from private.editorial_control where singleton;
  insert into private.audit_events(actor_id, action, policy_version, target)
    values (auth.uid(), p_action, policy_id, p_target);
end $$;

create function public.admin_sources() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  return jsonb_build_object(
    'sources', coalesce((select jsonb_agg(to_jsonb(s) order by s.source_key) from private.sources s), '[]'::jsonb),
    'allowlist', coalesce((select jsonb_agg(to_jsonb(a) order by a.domain) from private.fetch_allowlist a), '[]'::jsonb));
end $$;

-- 0011's stop switch: one field, so stopping a fetch cannot rewrite the feed URL by accident.
create function public.set_source_enabled(p_source_key text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved private.sources;
begin
  perform private.assert_admin();
  if p_enabled is null then raise exception 'Enabled is required' using errcode = '22023'; end if;
  if p_source_key = 'manual' then
    raise exception 'The editorial desk is not a fetchable source' using errcode = '22023';
  end if;
  update private.sources set enabled = p_enabled
    where source_key = p_source_key and fetch_mode <> 'manual' returning * into saved;
  if saved.source_key is null then raise exception 'Unknown source' using errcode = '22023'; end if;
  perform private.audit_registry_change('source_changed', saved.source_key);
  return to_jsonb(saved);
end $$;

-- A full save, so every field is required and none may arrive null: a caller that omitted enabled
-- or commentary would otherwise restart a fetch its publisher asked us to stop, or drop the flag
-- that keeps a linkblog from being cited as the final source (0007).
create function public.save_source(p_source_key text, p_label text, p_feed_url text,
  p_fetch_mode text, p_enabled boolean, p_commentary boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved private.sources;
begin
  perform private.assert_admin();
  if p_source_key is null or p_source_key = 'manual' then
    raise exception 'The editorial desk is not a fetchable source' using errcode = '22023';
  end if;
  if p_source_key !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_source_key) > 60 then
    raise exception 'Source key must be lowercase words joined by hyphens' using errcode = '22023';
  end if;
  if p_fetch_mode is null or p_fetch_mode <> all(array['feed_only','feed_then_page','json_api']) then
    raise exception 'Fetch mode must be feed_only, feed_then_page or json_api' using errcode = '22023';
  end if;
  if p_label is null or length(private.trim_text(p_label)) not between 1 and 200 then
    raise exception 'Label is required' using errcode = '22023';
  end if;
  if p_enabled is null or p_commentary is null then
    raise exception 'Enabled and commentary are required' using errcode = '22023';
  end if;
  if p_feed_url is null or not private.valid_citation_url(private.trim_text(p_feed_url)) then
    raise exception 'A fetchable source needs a valid feed URL' using errcode = '22023';
  end if;
  -- Registering a source is also a decision to fetch from its host, so it goes through the same
  -- allowlist as following a link. The seed satisfies this; without the check only the seed did.
  if not private.fetch_domain_allowed(private.url_host(private.trim_text(p_feed_url))) then
    raise exception 'Allow % before registering a source there',
      private.url_host(private.trim_text(p_feed_url)) using errcode = '22023';
  end if;
  insert into private.sources as target (source_key, label, feed_url, fetch_mode, enabled, commentary)
    values (p_source_key, private.trim_text(p_label), private.trim_text(p_feed_url),
            p_fetch_mode, p_enabled, p_commentary)
  on conflict (source_key) do update set label = excluded.label, feed_url = excluded.feed_url,
    fetch_mode = excluded.fetch_mode, enabled = excluded.enabled, commentary = excluded.commentary,
    -- A different feed URL is a different source of failures; carrying the old count forward would
    -- auto-disable a healthy feed the moment anything reads it.
    consecutive_failures = case when excluded.feed_url = target.feed_url then target.consecutive_failures else 0 end,
    last_ok_at = case when excluded.feed_url = target.feed_url then target.last_ok_at else null end,
    last_failure_code = case when excluded.feed_url = target.feed_url then target.last_failure_code else null end
  returning * into saved;
  perform private.audit_registry_change('source_changed', saved.source_key);
  return to_jsonb(saved);
end $$;

-- Adding a domain permits fetching a page from somewhere new, which is a copyright and an injection
-- decision: it is audited, and 0016 records why the back office owns it rather than a migration.
create function public.add_allowlist_domain(p_domain text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare saved private.fetch_allowlist; normalised text;
begin
  perform private.assert_admin();
  normalised := lower(private.trim_text(p_domain));
  if not private.valid_fetch_domain(normalised) then
    raise exception 'Domain must be a bare hostname such as example.com' using errcode = '22023';
  end if;
  if p_reason is null or length(private.trim_text(p_reason)) not between 1 and 500 then
    raise exception 'Reason is required' using errcode = '22023';
  end if;
  -- Only the reason is rewritten: added_by and added_at say who first allowed the domain, and a
  -- later wording change is not a new decision.
  insert into private.fetch_allowlist(domain, reason, added_by)
    values (normalised, private.trim_text(p_reason), auth.uid())
  on conflict (domain) do update set reason = excluded.reason
  returning * into saved;
  perform private.audit_registry_change('allowlist_changed', saved.domain);
  return to_jsonb(saved);
end $$;

create function public.remove_allowlist_domain(p_domain text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare removed private.fetch_allowlist; normalised text; dependents text;
begin
  perform private.assert_admin();
  normalised := lower(private.trim_text(p_domain));
  -- Withdrawing a domain an enabled source fetches from would leave that source unable to read its
  -- own feed, which reads as a broken source rather than as a decision anybody made.
  select string_agg(s.source_key, ', ' order by s.source_key) into dependents
    from private.sources s
   where s.enabled and s.feed_url is not null
     and (private.url_host(s.feed_url) = normalised or private.url_host(s.feed_url) like '%.' || normalised);
  if dependents is not null then
    raise exception 'Disable % first; still fetching from this domain', dependents using errcode = '22023';
  end if;
  delete from private.fetch_allowlist where domain = normalised returning * into removed;
  if removed.domain is null then raise exception 'Unknown domain' using errcode = '22023'; end if;
  perform private.audit_registry_change('allowlist_changed', removed.domain);
  return to_jsonb(removed);
end $$;

revoke all on function private.audit_registry_change(text,text), private.valid_fetch_domain(text),
  private.url_host(text), private.fetch_domain_allowed(text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_sources(), public.set_source_enabled(text,boolean),
  public.save_source(text,text,text,text,boolean,boolean), public.add_allowlist_domain(text,text),
  public.remove_allowlist_domain(text) from public, anon, authenticated, service_role;
grant execute on function public.admin_sources(), public.set_source_enabled(text,boolean),
  public.save_source(text,text,text,text,boolean,boolean), public.add_allowlist_domain(text,text),
  public.remove_allowlist_domain(text) to authenticated;

commit;
