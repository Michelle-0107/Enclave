-- Targeted report access repair for the supplied policy/grant snapshot.
-- Alternative to applying all of 006: changes only reports and its owned ID sequence.
-- Does not alter rows, resident policies, profiles, notifications, categories, or Auth.
-- Review and run manually in the Enclave Supabase SQL Editor.
BEGIN;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'reports'
          AND policyname NOT IN (
              'enclave_resident_report_select_guard', 'enclave_resident_report_select_allow',
              'enclave_resident_report_insert_guard', 'enclave_resident_report_insert_allow'
          )
    ) THEN
        RAISE EXCEPTION 'Unexpected report policies exist; inspect before applying this targeted repair.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = 'reports' AND grantee = 'PUBLIC'
    ) OR EXISTS (
        SELECT 1 FROM information_schema.column_privileges
        WHERE table_schema = 'public' AND table_name = 'reports' AND grantee = 'PUBLIC'
    ) THEN
        RAISE EXCEPTION 'PUBLIC report grants differ from the supplied snapshot; review inherited service access first.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'residents' AND c.relrowsecurity
    ) OR NOT has_table_privilege('authenticated', 'public.residents', 'SELECT') OR NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'residents'
          AND policyname = 'enclave_resident_mvp_read_self' AND cmd = 'SELECT'
          AND roles @> ARRAY['authenticated']::name[]
          AND qual ILIKE '%profile_id%' AND qual ILIKE '%auth.uid%'
    ) THEN
        RAISE EXCEPTION 'Resident access differs from the supplied snapshot; inspect it before applying this repair.';
    END IF;
END;
$$;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.reports FROM PUBLIC, anon, authenticated;

-- Clear any explicit column grants too; table revocation does not remove them.
DO $$
DECLARE columns_sql text;
BEGIN
    SELECT string_agg(format('%I', attname), ', ' ORDER BY attnum)
    INTO columns_sql
    FROM pg_attribute
    WHERE attrelid = 'public.reports'::regclass AND attnum > 0 AND NOT attisdropped;
    EXECUTE format(
        'REVOKE ALL PRIVILEGES (%s) ON TABLE public.reports FROM PUBLIC, anon, authenticated',
        columns_sql
    );
END;
$$;

GRANT SELECT ON public.reports TO authenticated;
GRANT INSERT (ticket_id, user_id, description, status, image_url, category,
              priority, latitude, longitude, is_approved)
ON public.reports TO authenticated;

DO $$
DECLARE sequence_name text;
BEGIN
    sequence_name := pg_get_serial_sequence('public.reports', 'id');
    IF sequence_name IS NOT NULL THEN
        EXECUTE format('GRANT USAGE ON SEQUENCE %s TO authenticated', sequence_name);
    END IF;
END;
$$;

DROP POLICY IF EXISTS enclave_resident_report_select_guard ON public.reports;
CREATE POLICY enclave_resident_report_select_guard ON public.reports AS RESTRICTIVE
FOR SELECT TO authenticated USING (
    user_id = (SELECT auth.uid()) AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid())
          AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);
DROP POLICY IF EXISTS enclave_resident_report_select_allow ON public.reports;
CREATE POLICY enclave_resident_report_select_allow ON public.reports
FOR SELECT TO authenticated USING (
    user_id = (SELECT auth.uid()) AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid())
          AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);

DROP POLICY IF EXISTS enclave_resident_report_insert_guard ON public.reports;
CREATE POLICY enclave_resident_report_insert_guard ON public.reports AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (
    user_id = (SELECT auth.uid()) AND status::text = 'pending' AND is_approved IS FALSE
    AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid())
          AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);
DROP POLICY IF EXISTS enclave_resident_report_insert_allow ON public.reports;
CREATE POLICY enclave_resident_report_insert_allow ON public.reports
FOR INSERT TO authenticated WITH CHECK (
    user_id = (SELECT auth.uid()) AND status::text = 'pending' AND is_approved IS FALSE
    AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid())
          AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);

COMMIT;

-- Confirm the repair installed both the allow policies and restrictive guards.
SELECT policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'reports'
ORDER BY policyname;
