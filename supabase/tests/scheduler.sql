\set ON_ERROR_STOP on
\o /dev/null
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute statement; exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
  end;
  if actual_state is distinct from expected_state then
    raise exception 'Expected SQLSTATE %, got % for %', expected_state, actual_state, statement;
  end if;
end $$;

insert into auth.users values ('11000000-0000-4000-8000-000000000001'), ('11000000-0000-4000-8000-000000000002');
insert into private.admin_users values ('11000000-0000-4000-8000-000000000001', true);

-- The migration seeds operating config and the current month, and leaves AI off.
select pg_temp.assert_true((select monthly_cash_limit = 1.000000 and stories_per_run = 6 from private.ai_runtime),
  'runtime configuration carries the agreed 1 USD monthly limit');
select pg_temp.assert_true((select cash_limit = 1.000000 and not ai_enabled and credential_ref_id is null
  from private.budgets where month_start = private.current_month()), 'current month is funded and AI is still off');
select pg_temp.assert_true((select count(*) = 1 from private.budgets), 'exactly one month is seeded');

-- The old latch refused any funding at all; the new one refuses only unfunded enabling.
insert into private.budgets(id, month_start) values ('41000000-0000-4000-8000-000000000001', '2026-01-01');
update private.budgets set cash_limit = 1 where id = '41000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select cash_limit = 1 from private.budgets where id = '41000000-0000-4000-8000-000000000001'),
  'funding a month is allowed now that the latch is a condition');
select pg_temp.expect_error(
  'update private.budgets set ai_enabled=true where id=''41000000-0000-4000-8000-000000000001''', '23514');

insert into private.credential_refs(id, label, vault_secret_id, enabled) values
  ('42000000-0000-4000-8000-000000000001', 'live', '43000000-0000-4000-8000-000000000001', true),
  ('42000000-0000-4000-8000-000000000002', 'spare', '43000000-0000-4000-8000-000000000002', false);

-- Claiming a credential is enabled when it is not must fail in the database, not in a code path.
select pg_temp.expect_error($$update private.budgets set credential_ref_id='42000000-0000-4000-8000-000000000002',
  credential_enabled=true where month_start = private.current_month()$$, '23503');
select pg_temp.expect_error($$update private.budgets set credential_ref_id='42000000-0000-4000-8000-000000000001'
  where month_start = private.current_month()$$, '23514');

-- A disabled credential may be attached, but it cannot fund an enabled month.
update private.budgets set credential_ref_id = '42000000-0000-4000-8000-000000000002', credential_enabled = false
  where month_start = private.current_month();
select pg_temp.expect_error(
  'update private.budgets set ai_enabled=true where month_start = private.current_month()', '23514');

-- A signed-in non-admin reaches none of it.
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.expect_error('select public.set_ai_enabled(true)', '42501');
select pg_temp.expect_error('select public.set_run_schedule(''daily'', 6)', '42501');
select pg_temp.expect_error('select public.admin_scheduler()', '42501');
reset role;

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.expect_error('select public.set_ai_enabled(true)', '22023');
reset role;
select pg_temp.assert_true((select not ai_enabled from private.budgets where month_start = private.current_month()),
  'a refused enable leaves the switch alone');

update private.budgets set credential_ref_id = '42000000-0000-4000-8000-000000000001', credential_enabled = true
  where month_start = private.current_month();

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.assert_true((public.set_ai_enabled(true)->>'ai_enabled')::boolean,
  'the latch really opens once the month is funded and the credential is enabled');
reset role;
select pg_temp.assert_true(exists(select 1 from private.audit_events where action = 'ai_enabled_changed'
  and actor_id = '11000000-0000-4000-8000-000000000001'), 'flipping the switch is audited to the actor');

-- Revoking a leaked key must succeed and must stand AI down on its way through.
update private.credential_refs set enabled = false where id = '42000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select not ai_enabled and not credential_enabled from private.budgets
  where month_start = private.current_month()), 'disabling a credential stands AI down instead of being blocked');

update private.credential_refs set enabled = true where id = '42000000-0000-4000-8000-000000000001';
update private.budgets set credential_enabled = true where month_start = private.current_month();

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000001';
set local role authenticated;
-- 30 runs x 6 stories x 0.001373 = 0.247 USD, inside the 1 USD limit.
select pg_temp.assert_true((public.set_run_schedule('daily', 6)->>'projected_monthly_cost')::numeric = 0.247140,
  'daily at six stories projects the measured cost');
-- 120 runs x 50 stories is 8.24 USD and must be refused rather than silently overspent.
select pg_temp.expect_error('select public.set_run_schedule(''every_6h'', 50)', '22023');
select pg_temp.expect_error('select public.set_run_schedule(''hourly'', 6)', '22023');
select pg_temp.expect_error('select public.set_run_schedule(''daily'', 0)', '22023');
select pg_temp.assert_true(not (public.admin_scheduler()->>'scheduler_installed')::boolean,
  'the harness has no pg_cron and says so rather than pretending');
reset role;
select pg_temp.assert_true((select stories_per_run = 6 from private.ai_runtime),
  'the accepted schedule is stored and the refused ones changed nothing');

-- The rollover path is idempotent: running it twice must not create a second month.
do $$ begin perform private.ensure_current_budget(); end $$;
select pg_temp.assert_true((select count(*) = 2 from private.budgets), 'ensuring the current month twice adds nothing');
-- The job runs daily, so a no-op must stay silent or the audit fills with one row per day forever.
select pg_temp.assert_true((select count(*) = 1 from private.audit_events where action = 'budget_rolled_over'),
  'the idempotent path audits a month once, not once per day');

rollback;
\o
\echo 'Scheduler checks: conditional AI latch, credential hardness, budget-bounded schedule, idempotent rollover.'
