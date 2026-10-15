-- Hardening for hosted PostgreSQL (e.g. Supabase), harmless on plain PostgreSQL.
--
-- 1. Supabase exposes the public schema through its Data API as the roles
--    `anon` and `authenticated`, and by default grants them every new table.
--    This app never uses that API, so those roles get no access at all.
-- 2. Every table in public gets row-level security. Tenant tables already have
--    tenant policies; the remaining (platform) tables get explicit policies for
--    the two application roles only, so any other role sees nothing even if it
--    is granted access by mistake.
do $$
declare
  r text;
  t text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on all tables in schema public from %I', r);
      execute format('revoke all on all sequences in schema public from %I', r);
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
    end if;
  end loop;

  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
       and c.relname <> 'schema_migrations'
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy app_roles on %I for all to cba_app, cba_platform using (true) with check (true)', t);
  end loop;
end $$;

-- The migration bookkeeping table is for the schema owner only.
alter table if exists schema_migrations enable row level security;
