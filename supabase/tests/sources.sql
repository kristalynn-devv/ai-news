\set ON_ERROR_STOP on
\o /dev/null
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute statement; exception when others then get stacked diagnostics actual_state = returned_sqlstate; end;
  if actual_state is distinct from expected_state then
    raise exception 'Expected SQLSTATE %, got % for %', expected_state, actual_state, statement;
  end if;
end $$;
-- Two refusals can share a SQLSTATE and still tell the manager the wrong thing, so the wording of
-- the ones that guide an action is asserted too.
create function pg_temp.expect_message(statement text, expected_fragment text) returns void language plpgsql as $$
declare actual_message text;
begin
  begin execute statement; exception when others then get stacked diagnostics actual_message = message_text; end;
  if actual_message is null or position(expected_fragment in actual_message) = 0 then
    raise exception 'Expected message containing %, got % for %', expected_fragment, actual_message, statement;
  end if;
end $$;

insert into auth.users values
  ('12000000-0000-4000-8000-000000000001'),
  ('12000000-0000-4000-8000-000000000002');
insert into private.admin_users values ('12000000-0000-4000-8000-000000000001', true);

-- The seed is the contract the fetch step reads, so its shape is asserted rather than eyeballed.
select pg_temp.assert_true((select count(*) = 25 from private.sources where fetch_mode <> 'manual'), 'twenty-five fetchable sources seeded');
select pg_temp.assert_true((select count(*) = 1 from private.sources where fetch_mode = 'manual' and not enabled and feed_url is null), 'the editorial desk is the one unfetchable source');
select pg_temp.assert_true((select count(*) = 0 from private.sources where fetch_mode <> 'manual' and (feed_url is null or not enabled)), 'every fetchable source starts enabled with a feed URL');
select pg_temp.assert_true((select count(*) = 6 from private.sources where fetch_mode = 'json_api' and feed_url like 'https://api.github.com/repos/%/releases'), 'GitHub releases are read through the REST API');
-- github.com disallows /*.atom$ for every agent, so no source may fetch from that host at all.
select pg_temp.assert_true((select count(*) = 0 from private.sources where private.url_host(feed_url) = 'github.com'), 'no source fetches from the host that disallows its feeds');
select pg_temp.assert_true((select commentary from private.sources where source_key = 'simon-willison'), 'the linkblog is tagged commentary');
select pg_temp.assert_true((select count(*) = 0 from private.sources where commentary and source_key <> 'simon-willison'), 'commentary is not claimed by anyone else');
select pg_temp.assert_true((select count(*) = 29 from private.fetch_allowlist), 'twenty-nine domains allowed');
select pg_temp.assert_true((select count(*) = 2 from private.fetch_allowlist where domain in ('github.com','api.github.com')), 'both GitHub hosts are allowed, the API included');
select pg_temp.assert_true((select count(*) = 1 from private.fetch_allowlist where domain = 'anthropic.com'), 'a lab with no feed is still followable');

-- The matching rule lives in one function, not in this file: a test that folded www. itself would
-- keep passing while the fetch step did something else.
select pg_temp.assert_true((select count(*) = 0 from private.sources s
  where s.feed_url is not null and not private.fetch_domain_allowed(private.url_host(s.feed_url))), 'every feed host is allowed');
select pg_temp.assert_true(private.fetch_domain_allowed('www.openai.com'), 'a subdomain of an allowed domain is allowed');
select pg_temp.assert_true(private.fetch_domain_allowed('OpenAI.com'), 'host matching ignores case');
select pg_temp.assert_true(not private.fetch_domain_allowed('evil-openai.com'), 'a lookalike domain is not allowed');
select pg_temp.assert_true(not private.fetch_domain_allowed('openai.com.evil.example'), 'a suffix trick is not allowed');
-- The port is deliberately not part of the host: the allowlist answers "which publisher", not
-- "which port", so http://evil.example:8443 and https://evil.example match the same list entry.
select pg_temp.assert_true(private.url_host('https://WWW.Example.com:8443/path?q=1') = 'www.example.com', 'the host is read from the URL, lowercased, without its port');

-- The FK is the point of the registry: a typo can no longer invent a source.
select pg_temp.expect_error($sql$insert into private.story_records(event_key,slug,source_key) values ('e','typo-source','openai-typo')$sql$,'23503');
select pg_temp.expect_error($sql$update private.sources set enabled = true where source_key = 'manual'$sql$,'23514');
select pg_temp.expect_error($sql$insert into private.sources(source_key,label,fetch_mode) values ('no-feed','No feed','feed_only')$sql$,'23514');
select pg_temp.expect_error($sql$insert into private.sources(source_key,label,feed_url,fetch_mode) values ('bad-mode','Bad','https://example.com/feed','rss')$sql$,'23514');
select pg_temp.expect_error($sql$insert into private.sources(source_key,label,feed_url,fetch_mode) values ('Bad Key','Bad','https://example.com/feed','feed_only')$sql$,'23514');
select pg_temp.expect_error($sql$insert into private.fetch_allowlist(domain,reason) values ('https://example.com','not a hostname')$sql$,'23514');
select pg_temp.expect_error($sql$insert into private.fetch_allowlist(domain,reason) values ('Example.COM','uppercase')$sql$,'23514');
select pg_temp.expect_error($sql$insert into private.fetch_allowlist(domain,reason) values ('10.0.0.1','a host inside the network is not a publisher')$sql$,'23514');
select pg_temp.expect_error($sql$insert into private.fetch_allowlist(domain,reason) values ('localhost','no TLD')$sql$,'23514');
select pg_temp.expect_error($sql$insert into private.fetch_allowlist(domain,reason) values ('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.com','label over 63 characters')$sql$,'23514');
select pg_temp.assert_true(private.valid_fetch_domain('example.xn--p1ai'), 'a punycode TLD is a real TLD');

-- No RPC is reachable without an admin row behind the JWT.
set local role anon;
select pg_temp.expect_error($sql$select public.admin_sources()$sql$,'42501');
select pg_temp.expect_error($sql$select public.set_source_enabled('openai',false)$sql$,'42501');
select pg_temp.expect_error($sql$select public.save_source('rogue','Rogue','https://example.com/feed','feed_only',true,false)$sql$,'42501');
select pg_temp.expect_error($sql$select public.add_allowlist_domain('rogue.example','no')$sql$,'42501');
select pg_temp.expect_error($sql$select public.remove_allowlist_domain('openai.com')$sql$,'42501');
reset role;

set local request.jwt.claim.sub = '12000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.expect_error($sql$select public.admin_sources()$sql$,'42501');
select pg_temp.expect_error($sql$select public.set_source_enabled('openai',false)$sql$,'42501');
reset role;

set local request.jwt.claim.sub = '12000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.assert_true(jsonb_array_length(public.admin_sources()->'sources') = 26, 'the back office sees every source including the desk');
select pg_temp.assert_true(jsonb_array_length(public.admin_sources()->'allowlist') = 29, 'the back office sees the allowlist');

-- 0011: a source that objects is stopped the same day, from the web, without touching the feed URL.
create temporary table stopped(value jsonb) on commit drop;
insert into stopped select public.set_source_enabled('openai',false);
select pg_temp.assert_true((select (value->>'enabled')::boolean is false from stopped), 'a source can be stopped');
select pg_temp.assert_true((select value->>'feed_url' = 'https://openai.com/news/rss.xml' from stopped), 'stopping a source leaves its feed URL alone');
select pg_temp.expect_error($sql$select public.set_source_enabled('manual',true)$sql$,'22023');
select pg_temp.expect_message($sql$select public.set_source_enabled('manual',true)$sql$,'editorial desk');
select pg_temp.expect_error($sql$select public.set_source_enabled('nobody',false)$sql$,'22023');
select pg_temp.expect_error($sql$select public.set_source_enabled('openai',null)$sql$,'22023');

select pg_temp.expect_error($sql$select public.save_source('manual','Desk','https://example.com/feed','feed_only',true,false)$sql$,'22023');
select pg_temp.expect_error($sql$select public.save_source('Bad Key','Bad','https://example.com/feed','feed_only',true,false)$sql$,'22023');
select pg_temp.expect_error($sql$select public.save_source('rss-mode','Bad mode','https://example.com/feed','manual',true,false)$sql$,'22023');
select pg_temp.expect_error($sql$select public.save_source('no-url','No URL',null,'feed_only',true,false)$sql$,'22023');
select pg_temp.expect_error($sql$select public.save_source('blank','   ','https://example.com/feed','feed_only',true,false)$sql$,'22023');
-- A null here would have restarted a stopped fetch or dropped the commentary flag.
select pg_temp.expect_error($sql$select public.save_source('nulls','Nulls','https://example.com/feed','feed_only',null,false)$sql$,'22023');
select pg_temp.expect_error($sql$select public.save_source('nulls','Nulls','https://example.com/feed','feed_only',true,null)$sql$,'22023');
-- Registering a source on a host nobody allowed is refused, and the refusal names the host.
select pg_temp.expect_error($sql$select public.save_source('off-list','Off list','https://feeds.evil.example.net/rss','feed_only',true,false)$sql$,'22023');
select pg_temp.expect_message($sql$select public.save_source('off-list','Off list','https://feeds.evil.example.net/rss','feed_only',true,false)$sql$,'feeds.evil.example.net');

select pg_temp.assert_true((public.add_allowlist_domain('  Example.COM  ','linked to by commentary')->>'domain') = 'example.com', 'a domain is stored bare and lowercased');
select pg_temp.assert_true((public.add_allowlist_domain('example.com','second thought')->>'reason') = 'second thought', 'adding a known domain rewrites its reason');
select pg_temp.expect_error($sql$select public.add_allowlist_domain('https://example.org/path','bad shape')$sql$,'22023');
select pg_temp.expect_error($sql$select public.add_allowlist_domain('example.org',' ')$sql$,'22023');
select pg_temp.expect_error($sql$select public.add_allowlist_domain('10.0.0.1','inside the network')$sql$,'22023');

select pg_temp.assert_true((public.save_source('new-source','New source','https://example.com/feed','feed_only',true,false)->>'source_key') = 'new-source', 'a manager can add a source once its host is allowed');
select pg_temp.assert_true((public.save_source('new-linkblog','A linkblog','https://sub.example.com/links','feed_only',true,true)->>'commentary')::boolean, 'a linkblog can be tagged commentary from the back office');
select pg_temp.assert_true((public.save_source('new-source','Renamed','https://example.com/feed','feed_then_page',false,false)->>'label') = 'Renamed', 'saving the same key updates it');
select pg_temp.assert_true((public.set_source_enabled('new-source',false)->>'enabled')::boolean is false, 'the new source can be stopped');
select pg_temp.assert_true((public.save_source('new-source','Renamed again','https://example.com/feed','feed_then_page',false,false)->>'enabled')::boolean is false, 'a full save does not restart a stopped fetch');
reset role;

update private.sources set consecutive_failures = 3, last_failure_code = 'http_500', last_ok_at = now()
  where source_key = 'new-source';
set local role authenticated;
select pg_temp.assert_true((public.save_source('new-source','Same feed','https://example.com/feed','feed_then_page',false,false)->>'consecutive_failures')::integer = 3, 'editing a label keeps the failure history');
select pg_temp.assert_true((public.save_source('new-source','New feed','https://example.com/feed2','feed_then_page',false,false)->>'consecutive_failures')::integer = 0, 'a new feed URL starts a fresh failure count');
select pg_temp.assert_true((public.save_source('new-source','Newer feed','https://example.com/feed3','feed_then_page',false,false)->>'last_failure_code') is null, 'a new feed URL clears the last failure code');

-- Withdrawing a domain an enabled source still fetches from is refused, and the refusal names it.
select pg_temp.expect_error($sql$select public.remove_allowlist_domain('example.com')$sql$,'22023');
select pg_temp.expect_message($sql$select public.remove_allowlist_domain('example.com')$sql$,'new-linkblog');
select pg_temp.assert_true((public.set_source_enabled('new-linkblog',false)->>'enabled')::boolean is false, 'the dependent source can be stopped first');
select pg_temp.assert_true((public.remove_allowlist_domain('EXAMPLE.com')->>'domain') = 'example.com', 'a domain can be withdrawn once nothing enabled fetches from it');
select pg_temp.expect_error($sql$select public.remove_allowlist_domain('example.com')$sql$,'22023');
reset role;

-- Every change names its subject; an audit row that only says "something changed" is not an audit.
select pg_temp.assert_true((select count(*) = 0 from private.audit_events
  where action in ('source_changed','allowlist_changed') and target is null), 'registry audits always name their subject');
select pg_temp.assert_true((select count(*) = 1 from private.audit_events where action = 'source_changed' and target = 'openai'), 'the audit names the stopped source');
select pg_temp.assert_true((select count(*) = 3 from private.audit_events where action = 'allowlist_changed' and target = 'example.com'), 'two adds and one withdrawal are audited');
select pg_temp.assert_true((select count(*) = 0 from private.audit_events
  where action in ('source_changed','allowlist_changed') and actor_id is distinct from '12000000-0000-4000-8000-000000000001'), 'audits record the acting manager');
select pg_temp.expect_error($sql$insert into private.audit_events(action,policy_version) values ('source_invented',1)$sql$,'23514');

-- A mistakenly added table grant still cannot read either table: RLS is the second boundary.
grant usage on schema private to authenticated;
grant select on private.sources, private.fetch_allowlist to authenticated;
set local role authenticated;
select pg_temp.assert_true((select count(*) = 0 from private.sources), 'RLS denies an accidental grant on sources');
select pg_temp.assert_true((select count(*) = 0 from private.fetch_allowlist), 'RLS denies an accidental grant on the allowlist');
reset role;

rollback;
\o
\echo 'Source registry checks: seed shape, host matching, foreign key, admin-only RPCs, stop-switch durability and audited changes.'
