begin;

-- Correction to the previous migration, which was a no-op: pg_net's functions are owned by
-- supabase_admin, so a REVOKE issued as postgres is only a warning and changed no ACL.
-- Nothing in this project calls pg_net: both cron jobs run plain SQL. It was installed ahead of a
-- pipeline that does not exist yet, and while it is unreachable through PostgREST (only public and
-- graphql_public are exposed), anon and authenticated do hold USAGE on net plus EXECUTE via PUBLIC.
-- Removing it now is the only lever available here; the pipeline can install it with proper grants
-- at the point it actually needs outbound HTTP.
drop extension if exists pg_net;

commit;
