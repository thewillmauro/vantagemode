-- CI login role for the migration check (.github/workflows/migration-check.yml).
-- It can read only the version and name columns of supabase_migrations.schema_migrations.
-- NOT APPLIED YET. Will applies it with `supabase db push` so history records this exact
-- version (see CLAUDE.md > Migrations). No password here: the role cannot log in until Will
-- sets one outside git with ALTER ROLE ... PASSWORD.
--
-- What this role gets directly: LOGIN, USAGE on schema supabase_migrations, SELECT on
-- schema_migrations(version, name). Nothing else is granted to it, and it is a member of no role.
--
-- What it still gets through PUBLIC (Postgres cannot revoke a PUBLIC grant for one role, and
-- changing those grants would affect every role, so this file leaves them alone):
--   * CONNECT and TEMPORARY on the database
--   * USAGE on schemas public, net, pg_catalog, information_schema (public has no tables or
--     functions granted to PUBLIC today; the catalogs are readable by every role)
--   * pg_net: EXECUTE on the net.* functions (http_get, http_post, ...) and full DML on
--     net.http_request_queue and net._http_response. This is the meaningful one: a session as
--     this role could send outbound HTTP from the database and read or delete pg_net responses.
--     default_transaction_read_only below blocks those writes by default, but a session can
--     turn it off with SET, so it is a default, not a control. It cannot be fixed per project:
--     supabase_admin owns net and made these grants, so a REVOKE run as postgres is a no-op
--     ("no privileges could be revoked"), and Supabase documents that removing the PUBLIC table
--     grants would break pg_net for postgres (the lead-alert trigger and the nurture cron job).
--     See supabase.com/docs/guides/troubleshooting/revoking-access-to-pg_net-objects-has-no-effect-0bbc16
--     Also: queued pg_net requests, headers included, are readable by this role until sent.
--   * EXECUTE on functions granted to PUBLIC in pg_catalog and information_schema
--
-- ROLLBACK:
--   revoke select (version, name) on supabase_migrations.schema_migrations from ci_migrations_reader;
--   revoke usage on schema supabase_migrations from ci_migrations_reader;
--   drop role ci_migrations_reader;

create role ci_migrations_reader with
  login
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 2;

alter role ci_migrations_reader set default_transaction_read_only = on;
alter role ci_migrations_reader set statement_timeout = '10s';
alter role ci_migrations_reader set idle_in_transaction_session_timeout = '10s';

grant usage on schema supabase_migrations to ci_migrations_reader;
grant select (version, name) on supabase_migrations.schema_migrations to ci_migrations_reader;
