begin;

-- APPLIED TO PRODUCTION AND HAD NO EFFECT. Kept so this folder replays what production actually ran.
-- The intent was to revoke pg_net's functions from anon and authenticated. It could not work:
-- those functions are owned by supabase_admin and this runs as postgres, so PostgreSQL emits a
-- warning rather than an error and leaves the ACL untouched. apply_migration still reported success.
-- The situation is resolved by the next migration, which drops the extension instead.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_depend d on d.objid = p.oid and d.deptype = 'e'
    join pg_extension e on e.oid = d.refobjid and e.extname = 'pg_net'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;

commit;
