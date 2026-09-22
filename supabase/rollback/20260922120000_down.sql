-- Reverses 20260922120000_source_registry.sql: the source registry and the fetch allowlist go away
-- and story_records.source_key becomes free text again.
-- Deliberately outside supabase/migrations/ so neither the test harness nor a deploy applies it.
-- Apply by hand only. Seeded rows are lost; the seed lives in the migration, so re-applying restores
-- them, but any source a manager added or disabled from the back office afterwards is not recoverable.
begin;

drop function if exists public.remove_allowlist_domain(text);
drop function if exists public.add_allowlist_domain(text, text);
drop function if exists public.save_source(text, text, text, text, boolean, boolean);
drop function if exists public.set_source_enabled(text, boolean);
drop function if exists public.admin_sources();
drop function if exists private.audit_registry_change(text, text);
drop function if exists private.fetch_domain_allowed(text);
drop function if exists private.url_host(text);

alter table private.story_records drop constraint if exists story_records_source_key_fkey;

drop table if exists private.fetch_allowlist;
drop table if exists private.sources;
-- After the tables, because their CHECK constraints depend on it.
drop function if exists private.valid_fetch_domain(text);

delete from private.audit_events where action in ('source_changed', 'allowlist_changed');
alter table private.audit_events drop column if exists target;
alter table private.audit_events drop constraint audit_events_action_check;
alter table private.audit_events add constraint audit_events_action_check
  check (action in ('approve','reject','withdraw','reopen','auto_publish','policy_changed',
                    'draft_created','draft_updated','ai_enabled_changed','schedule_changed',
                    'budget_rolled_over'));

commit;
