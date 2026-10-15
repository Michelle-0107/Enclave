-- READ-ONLY schema metadata for reviewing resident signup against the existing Enclave database.
-- Paste this SELECT into Supabase SQL Editor and run it. Copy/export the schema_snapshot result.
-- No table rows, passwords, tokens, trigger arguments, or function bodies are selected.
-- Review custom default/policy/index expressions before sharing: they may contain application literals.
WITH target_tables AS (
    SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name,
           c.relowner, c.relacl, c.relrowsecurity, c.relforcerowsecurity
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      AND c.relname IN ('profiles', 'reports', 'notifications', 'categories',
                       'residents', 'resident_invitations', 'email_verification_challenges', 'registration_rate_limits',
                       'communities', 'community_staff', 'resident_memberships')
),
table_metadata AS (
    SELECT schema_name, table_name, relrowsecurity AS rls_enabled,
           relforcerowsecurity AS rls_forced
    FROM target_tables
),
column_metadata AS (
    SELECT c.table_schema, c.table_name, c.ordinal_position, c.column_name,
           c.data_type, c.udt_name, c.is_nullable, c.column_default,
           c.is_identity, c.identity_generation
    FROM information_schema.columns c
    JOIN target_tables t ON t.schema_name = c.table_schema AND t.table_name = c.table_name
),
constraint_metadata AS (
    SELECT t.schema_name, t.table_name, c.conname AS constraint_name,
           c.contype AS constraint_type, c.convalidated AS validated,
           pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
    FROM pg_catalog.pg_constraint c
    JOIN target_tables t ON t.oid = c.conrelid
),
index_metadata AS (
    SELECT t.schema_name, t.table_name, c.relname AS index_name,
           i.indisunique AS is_unique, i.indisvalid AS is_valid,
           pg_catalog.pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_catalog.pg_index i
    JOIN target_tables t ON t.oid = i.indrelid
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
),
policy_metadata AS (
    SELECT p.schemaname, p.tablename, p.policyname, p.permissive,
           p.roles, p.cmd, p.qual AS using_expression, p.with_check AS check_expression
    FROM pg_catalog.pg_policies p
    JOIN target_tables t ON t.schema_name = p.schemaname AND t.table_name = p.tablename
),
table_grants AS (
    SELECT t.schema_name, t.table_name,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
           a.privilege_type, a.is_grantable
    FROM target_tables t
    CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(t.relacl, pg_catalog.acldefault('r', t.relowner))
    ) a
),
column_grants AS (
    SELECT t.schema_name, t.table_name, col.attname AS column_name,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
           a.privilege_type, a.is_grantable
    FROM target_tables t
    JOIN pg_catalog.pg_attribute col ON col.attrelid = t.oid
    CROSS JOIN LATERAL pg_catalog.aclexplode(col.attacl) a
    WHERE col.attnum > 0 AND NOT col.attisdropped
),
trigger_metadata AS (
    SELECT n.nspname AS schema_name, c.relname AS table_name,
           t.tgname AS trigger_name, t.tgenabled AS enabled,
           fnn.nspname AS function_schema, p.proname AS function_name,
           p.prosecdef AS security_definer,
           (t.tgtype::integer & 2) <> 0 AS before_event,
           (t.tgtype::integer & 4) <> 0 AS on_insert,
           (t.tgtype::integer & 8) <> 0 AS on_delete,
           (t.tgtype::integer & 16) <> 0 AS on_update,
           t.tgnargs AS argument_count
    FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace fnn ON fnn.oid = p.pronamespace
    WHERE NOT t.tgisinternal AND
          (c.oid IN (SELECT oid FROM target_tables) OR (n.nspname = 'auth' AND c.relname = 'users'))
),
public_functions AS (
    SELECT p.oid, n.nspname AS schema_name, p.proname AS function_name,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS argument_types,
           p.prosecdef AS security_definer, p.proowner, p.proacl
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
),
function_metadata AS (
    SELECT schema_name, function_name, argument_types, security_definer FROM public_functions
),
function_grants AS (
    SELECT f.schema_name, f.function_name, f.argument_types,
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee)::text END AS grantee,
           a.privilege_type
    FROM public_functions f
    CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(f.proacl, pg_catalog.acldefault('f', f.proowner))
    ) a
)
SELECT jsonb_build_object(
    'tables', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.schema_name, m.table_name) FROM table_metadata m), '[]'::jsonb),
    'columns', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.table_name, m.ordinal_position) FROM column_metadata m), '[]'::jsonb),
    'constraints', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.table_name, m.constraint_name) FROM constraint_metadata m), '[]'::jsonb),
    'indexes', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.table_name, m.index_name) FROM index_metadata m), '[]'::jsonb),
    'policies', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.tablename, m.policyname) FROM policy_metadata m), '[]'::jsonb),
    'table_grants', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.table_name, m.grantee, m.privilege_type) FROM table_grants m), '[]'::jsonb),
    'column_grants', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.table_name, m.column_name, m.grantee) FROM column_grants m), '[]'::jsonb),
    'triggers', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.schema_name, m.table_name, m.trigger_name) FROM trigger_metadata m), '[]'::jsonb),
    'public_functions', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.function_name, m.argument_types) FROM function_metadata m), '[]'::jsonb),
    'function_grants', COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.function_name, m.argument_types, m.grantee) FROM function_grants m), '[]'::jsonb)
) AS schema_snapshot;
