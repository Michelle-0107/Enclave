-- Read-only preflight for SQL 006_active_resident_feature_rls.sql.
-- Run in the Enclave Supabase SQL Editor and compare results before applying SQL 006.

SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('reports', 'residents', 'notifications', 'categories')
ORDER BY table_name, ordinal_position;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('reports', 'residents', 'notifications', 'categories')
ORDER BY c.relname;

SELECT tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('reports', 'residents', 'notifications', 'categories')
ORDER BY tablename, policyname;

SELECT table_name, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name IN ('reports', 'residents', 'notifications', 'categories')
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
ORDER BY table_name, grantee, privilege_type;

SELECT table_name, column_name, grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name IN ('reports', 'residents', 'notifications', 'categories')
  AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
ORDER BY table_name, column_name, grantee, privilege_type;

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.reports'::regclass, 'public.residents'::regclass,
                   'public.notifications'::regclass, 'public.categories'::regclass)
ORDER BY table_name, conname;
