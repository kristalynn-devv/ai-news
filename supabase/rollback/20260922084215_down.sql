-- Reverses 20260922084215_ai_budget_scheduler.sql and puts the permanent AI latch back on.
-- The two follow-up migrations only concern pg_net, which is already dropped; nothing to undo there.
-- Deliberately outside supabase/migrations/ so neither the test harness nor a deploy applies it.
-- Apply by hand only, and read the note on budgets below before running it in production.
begin;

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'ai-daily-run') then
      execute 'select cron.unschedule(''ai-daily-run'')';
    end if;
    if exists (select 1 from cron.job where jobname = 'ai-daily-budget-rollover') then
      execute 'select cron.unschedule(''ai-daily-budget-rollover'')';
    end if;
  end if;
end $$;

drop function if exists public.admin_scheduler();
drop function if exists public.set_run_schedule(text, integer);
drop function if exists public.set_ai_enabled(boolean);
drop trigger if exists credential_disable_stops_ai on private.credential_refs;
drop function if exists private.disable_ai_with_credential();
drop function if exists private.request_pipeline_run();
drop function if exists private.ensure_current_budget();
drop function if exists private.frequency_spec(text);
drop function if exists private.scheduler_available();
drop function if exists private.current_month();
drop table if exists private.ai_runtime;

-- Not a delete: month rows may already be referenced by private.invocations. Zeroing them is
-- what the old latch meant anyway, and it keeps the usage ledger intact.
update private.budgets set cash_limit = 0, ai_enabled = false;

alter table private.budgets drop constraint if exists budgets_ai_requires_funding;
alter table private.budgets drop constraint if exists budgets_credential_fk;
alter table private.budgets drop constraint if exists budgets_credential_pair;
alter table private.budgets drop constraint if exists budgets_cash_limit_check;
alter table private.budgets drop column if exists credential_enabled;
alter table private.budgets drop column if exists credential_ref_id;
alter table private.budgets add constraint budgets_cash_limit_check check (cash_limit = 0);
alter table private.budgets add constraint budgets_ai_enabled_check check (not ai_enabled);

alter table private.credential_refs drop constraint if exists credential_refs_id_enabled_key;

delete from private.audit_events
  where action in ('ai_enabled_changed', 'schedule_changed', 'budget_rolled_over');
alter table private.audit_events drop constraint audit_events_action_check;
alter table private.audit_events add constraint audit_events_action_check
  check (action in ('approve','reject','withdraw','reopen','auto_publish','policy_changed',
                    'draft_created','draft_updated'));

commit;
