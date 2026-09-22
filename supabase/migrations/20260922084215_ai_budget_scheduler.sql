begin;

-- Wayfinder tickets 0001/0005/0009: the AI spend latch comes off as a condition, not as a removal.
-- Nothing here enables AI. It becomes possible to enable, and impossible to enable unfunded.

alter table private.audit_events drop constraint audit_events_action_check;
alter table private.audit_events add constraint audit_events_action_check
  check (action in ('approve','reject','withdraw','reopen','auto_publish','policy_changed',
                    'draft_created','draft_updated','ai_enabled_changed','schedule_changed','budget_rolled_over'));

-- A CHECK cannot read another table, so the credential's enabled flag is carried alongside the
-- reference and kept honest by a composite foreign key rather than by a trigger a session can skip.
alter table private.credential_refs add constraint credential_refs_id_enabled_key unique (id, enabled);

alter table private.budgets drop constraint budgets_cash_limit_check;
alter table private.budgets drop constraint budgets_ai_enabled_check;
alter table private.budgets
  add column credential_ref_id uuid,
  add column credential_enabled boolean,
  add constraint budgets_cash_limit_check check (cash_limit >= 0),
  add constraint budgets_credential_pair check ((credential_ref_id is null) = (credential_enabled is null)),
  add constraint budgets_credential_fk foreign key (credential_ref_id, credential_enabled)
    references private.credential_refs(id, enabled) on update cascade,
  add constraint budgets_ai_requires_funding
    check (not ai_enabled or (cash_limit > 0 and credential_ref_id is not null and credential_enabled));

-- One row of operating configuration. The per-month budget rows materialise cash_limit from here.
create table private.ai_runtime (
  singleton boolean primary key default true check (singleton),
  monthly_cash_limit numeric(12,6) not null default 1.000000 check (monthly_cash_limit >= 0),
  stories_per_run integer not null default 6 check (stories_per_run between 1 and 50),
  -- Measured in ticket 0006: Thai summary on deepseek-flash, peak rate, thinking disabled.
  estimated_cost_per_story numeric(12,6) not null default 0.001373 check (estimated_cost_per_story > 0),
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);
insert into private.ai_runtime default values;
alter table private.ai_runtime enable row level security;
revoke all on private.ai_runtime from public, anon, authenticated, service_role;

-- Revoking a leaked key must never be blocked by the funding CHECK, so AI is stood down first
-- and the composite FK's cascade then lands on a row that already satisfies the constraint.
create function private.disable_ai_with_credential() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.enabled and not new.enabled then
    update private.budgets set ai_enabled = false where credential_ref_id = old.id and ai_enabled;
  end if;
  return new;
end $$;
create trigger credential_disable_stops_ai before update on private.credential_refs
  for each row execute function private.disable_ai_with_credential();

-- Off-peak only: DeepSeek charges double during 01:00-04:00 and 06:00-10:00 UTC on weekdays.
create function private.frequency_spec(p_frequency text) returns jsonb
language sql immutable set search_path = '' as $$
  select case p_frequency
    when 'daily'       then jsonb_build_object('cron', '0 17 * * *',         'runs_per_month', 30)
    when 'twice_daily' then jsonb_build_object('cron', '0 5,17 * * *',       'runs_per_month', 60)
    when 'every_6h'    then jsonb_build_object('cron', '0 5,11,17,23 * * *', 'runs_per_month', 120)
  end
$$;

create function private.scheduler_available() returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
$$;

create function private.current_month() returns date
language sql stable set search_path = '' as $$
  select date_trunc('month', (now() at time zone 'Asia/Bangkok'))::date
$$;

-- Idempotent: a month with no budget row is a silent stop, so this runs daily rather than
-- on a month boundary, and carries the previous month's switch and credential forward.
create function private.ensure_current_budget() returns uuid
language plpgsql security definer set search_path = '' as $$
declare m date; prev private.budgets; policy_id bigint; budget_id uuid;
begin
  m := private.current_month();
  select * into prev from private.budgets where month_start < m order by month_start desc limit 1;
  insert into private.budgets(month_start, cash_limit, ai_enabled, credential_ref_id, credential_enabled)
    select m, r.monthly_cash_limit, coalesce(prev.ai_enabled, false), prev.credential_ref_id, prev.credential_enabled
    from private.ai_runtime r where r.singleton
    on conflict (month_start) do nothing;
  if found then
    select policy_version into policy_id from private.editorial_control where singleton;
    insert into private.audit_events(actor_id, action, policy_version) values (null, 'budget_rolled_over', policy_id);
  end if;
  select id into budget_id from private.budgets where month_start = m;
  return budget_id;
end $$;

-- The scheduler binds to this seam. The pipeline will fill the body; today it deliberately
-- does nothing, so the job that calls it cannot fail or spend anything.
create function private.request_pipeline_run() returns void
language plpgsql security definer set search_path = '' as $$
begin
  return;
end $$;

create function public.set_ai_enabled(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b private.budgets; policy_id bigint;
begin
  perform private.assert_admin();
  perform private.ensure_current_budget();
  select * into b from private.budgets where month_start = private.current_month() for update;
  -- The CHECK is the backstop; this says why in words the back office can show.
  if p_enabled and (b.cash_limit <= 0 or b.credential_ref_id is null or not coalesce(b.credential_enabled, false)) then
    raise exception 'Fund the budget and attach an enabled credential before enabling AI' using errcode = '22023';
  end if;
  update private.budgets set ai_enabled = p_enabled where id = b.id;
  select policy_version into policy_id from private.editorial_control where singleton;
  insert into private.audit_events(actor_id, action, policy_version) values (auth.uid(), 'ai_enabled_changed', policy_id);
  return jsonb_build_object('month_start', b.month_start, 'ai_enabled', p_enabled);
end $$;

-- Frequency and stories per run are the two axes that spend money, so they are set together
-- and refused together when the projection exceeds the month's limit.
create function public.set_run_schedule(p_frequency text, p_stories_per_run integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare spec jsonb; cost numeric; month_limit numeric; projected numeric; policy_id bigint;
begin
  perform private.assert_admin();
  spec := private.frequency_spec(p_frequency);
  if spec is null then
    raise exception 'Frequency must be daily, twice_daily or every_6h' using errcode = '22023';
  end if;
  if p_stories_per_run is null or p_stories_per_run not between 1 and 50 then
    raise exception 'Stories per run must be between 1 and 50' using errcode = '22023';
  end if;
  perform private.ensure_current_budget();
  select cash_limit into month_limit from private.budgets where month_start = private.current_month();
  select estimated_cost_per_story into cost from private.ai_runtime where singleton;
  projected := (spec->>'runs_per_month')::integer * p_stories_per_run * cost;
  if projected > month_limit then
    raise exception 'Projected % USD per month exceeds the % USD limit', round(projected, 6), month_limit
      using errcode = '22023';
  end if;
  update private.ai_runtime set stories_per_run = p_stories_per_run, updated_by = auth.uid(), updated_at = now()
    where singleton;
  -- cron.job stays the single source of truth for the schedule itself; where pg_cron is absent
  -- the stored settings still apply and admin_scheduler() reports the scheduler as missing.
  if private.scheduler_available() then
    execute format('select cron.schedule(%L, %L, %L)', 'ai-daily-run', spec->>'cron',
                   'select private.request_pipeline_run();');
  end if;
  select policy_version into policy_id from private.editorial_control where singleton;
  insert into private.audit_events(actor_id, action, policy_version) values (auth.uid(), 'schedule_changed', policy_id);
  return jsonb_build_object('frequency', p_frequency, 'cron', spec->>'cron',
    'stories_per_run', p_stories_per_run, 'projected_monthly_cost', round(projected, 6),
    'cash_limit', month_limit, 'scheduler_installed', private.scheduler_available());
end $$;

create function public.admin_scheduler() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare jobs jsonb := '[]'::jsonb;
begin
  perform private.assert_admin();
  if private.scheduler_available() then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''jobname'', jobname, ''schedule'', schedule,
             ''active'', active) order by jobname), ''[]''::jsonb) from cron.job where jobname like ''ai-daily-%''' into jobs;
  end if;
  return jsonb_build_object(
    'scheduler_installed', private.scheduler_available(),
    'jobs', jobs,
    'runtime', (select to_jsonb(r) from private.ai_runtime r where r.singleton),
    'budget', (select to_jsonb(b) from private.budgets b where b.month_start = private.current_month()));
end $$;

do $$ begin perform private.ensure_current_budget(); end $$;

-- pg_cron and pg_net are Supabase-provided and absent from a plain postgres image, so both the
-- extensions and the jobs are conditional. This keeps one migration portable to the test harness.
do $$
begin
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    execute 'create extension if not exists pg_cron';
  end if;
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    execute 'create extension if not exists pg_net';
  end if;
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    -- Daily rather than monthly: the Bangkok month turns over at 17:00 UTC and the call is idempotent.
    execute format('select cron.schedule(%L, %L, %L)', 'ai-daily-budget-rollover', '0 17 * * *',
                   'select private.ensure_current_budget();');
    -- Registered so the schedule is visible and configurable, inactive because no pipeline exists yet.
    execute format('select cron.schedule(%L, %L, %L)', 'ai-daily-run', '0 17 * * *',
                   'select private.request_pipeline_run();');
    execute 'select cron.alter_job((select jobid from cron.job where jobname = ''ai-daily-run''), active := false)';
  end if;
end $$;

revoke all on function private.disable_ai_with_credential(), private.frequency_spec(text),
  private.scheduler_available(), private.current_month(), private.ensure_current_budget(),
  private.request_pipeline_run() from public, anon, authenticated, service_role;
revoke all on function public.set_ai_enabled(boolean), public.set_run_schedule(text,integer),
  public.admin_scheduler() from public, anon, authenticated, service_role;
grant execute on function public.set_ai_enabled(boolean), public.set_run_schedule(text,integer),
  public.admin_scheduler() to authenticated;

commit;
