-- REVIEWED CANDIDATE based on the supplied 2026-10-14 schema snapshot; not executed by this task.
-- Keeps existing profile rows/roles. Client users can read themselves and edit full_name only.
-- Trusted signup backend must create a missing profile and bind the resident transactionally.
-- No Auth trigger, signup RPC, report policy, or application endpoint is added here.
BEGIN;

LOCK TABLE public.profiles IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
    profile_columns text[];
BEGIN
    SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO profile_columns
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.profiles'::regclass AND a.attnum > 0 AND NOT a.attisdropped;
    IF profile_columns IS DISTINCT FROM ARRAY['id', 'email', 'full_name', 'role', 'created_at']::text[] THEN
        RAISE EXCEPTION 'Profile columns changed since review; inspect the schema before applying.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'id' AND udt_name = 'uuid'
    ) THEN
        RAISE EXCEPTION 'Expected profiles.id to be uuid.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies
        WHERE schemaname = 'public' AND tablename = 'profiles'
          AND policyname NOT IN ('enclave_profile_read_self', 'enclave_profile_edit_name_self')
    ) THEN
        RAISE EXCEPTION 'Unexpected profile policies found; review them before applying.';
    END IF;
END;
$$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
-- Revoke any column-level grants separately; removing a table grant does not remove column grants.
REVOKE ALL (id, email, full_name, role, created_at) ON TABLE public.profiles
    FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT UPDATE (full_name) ON TABLE public.profiles TO authenticated;
-- Existing postgres/service_role access is preserved. No client INSERT/DELETE/role/email/id update grant.

DROP POLICY IF EXISTS enclave_profile_read_self ON public.profiles;
CREATE POLICY enclave_profile_read_self ON public.profiles FOR SELECT TO authenticated
    USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS enclave_profile_edit_name_self ON public.profiles;
CREATE POLICY enclave_profile_edit_name_self ON public.profiles FOR UPDATE TO authenticated
    USING (id = (SELECT auth.uid()))
    WITH CHECK (id = (SELECT auth.uid()));

COMMIT;
