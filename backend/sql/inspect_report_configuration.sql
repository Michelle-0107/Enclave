-- Run in the Enclave project's SQL Editor before reviewing the proposed migration.
-- Read-only: inspect schema, constraints, grants, and policies without changing data.
-- Share these results with the backend reviewer; do not share keys or credentials.
-- These queries do not establish actual two-user isolation; test it after policy review.

SELECT column_name, data_type, udt_name, is_nullable, column_default,
       character_maximum_length, is_identity
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'reports'
  AND column_name IN ('id', 'ticket_id', 'user_id', 'description', 'status', 'created_at',
                      'latitude', 'longitude', 'image_url', 'category', 'priority', 'is_approved')
ORDER BY ordinal_position;

SELECT c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'reports';

SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'reports'
ORDER BY policyname;

SELECT grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND table_name = 'reports'
  AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
ORDER BY grantee, privilege_type;

SELECT grantee, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'reports'
  AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
ORDER BY grantee, column_name, privilege_type;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.reports'::regclass
ORDER BY conname;
