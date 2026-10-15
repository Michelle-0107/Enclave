-- Resident-facing feature access for the single-community MVP.
-- Review and run only after comparing the preflight snapshot with the live schema.
-- This migration does not change or delete existing rows. It protects Data API access,
-- including requests that bypass FastAPI and call Supabase PostgREST directly.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reports'
          AND column_name = 'user_id' AND udt_name = 'uuid'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reports'
          AND column_name = 'is_approved' AND udt_name = 'bool'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'residents'
          AND column_name = 'profile_id' AND udt_name = 'uuid'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'residents'
          AND column_name = 'status' AND udt_name = 'text'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'residents'
          AND column_name = 'verified_at' AND udt_name = 'timestamptz'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notifications'
          AND column_name = 'user_id' AND udt_name = 'uuid'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'notifications'
          AND column_name = 'is_read' AND udt_name = 'bool'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'categories'
          AND column_name = 'name' AND udt_name = 'text'
    ) THEN
        RAISE EXCEPTION 'Feature schema differs from the reviewed Enclave schema; inspect before applying.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'residents' AND c.relrowsecurity
    ) OR NOT has_table_privilege('authenticated', 'public.residents', 'SELECT') OR NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'residents' AND cmd = 'SELECT'
          AND roles @> ARRAY['authenticated']::name[]
          AND qual ILIKE '%profile_id%' AND qual ILIKE '%auth.uid%'
    ) THEN
        RAISE EXCEPTION 'Expected authenticated users to read only their own resident row; review SQL 003 before applying.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name IN ('reports', 'notifications', 'categories')
          AND grantee = 'PUBLIC'
    ) OR EXISTS (
        SELECT 1 FROM information_schema.column_privileges
        WHERE table_schema = 'public' AND table_name IN ('reports', 'notifications', 'categories')
          AND grantee = 'PUBLIC'
    ) THEN
        RAISE EXCEPTION 'PUBLIC feature-table grants exist; review their effect on trusted roles before applying.';
    END IF;
END;
$$;

-- Remove table and column grants inherited by client roles, then grant only
-- the operations needed by the current resident APIs. The preflight above ensures
-- revoking PUBLIC table privileges cannot silently change an inherited service grant.
REVOKE ALL PRIVILEGES ON TABLE public.reports, public.notifications, public.categories
    FROM PUBLIC, anon, authenticated;
DO $$
DECLARE
    table_name text;
    columns_sql text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY['reports', 'notifications', 'categories'] LOOP
        SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum)
        INTO columns_sql
        FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = format('public.%I', table_name)::regclass
          AND a.attnum > 0 AND NOT a.attisdropped;
        IF columns_sql IS NOT NULL THEN
            EXECUTE format(
                'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
                columns_sql, table_name
            );
        END IF;
    END LOOP;
END;
$$;

GRANT SELECT ON TABLE public.reports TO authenticated;
GRANT INSERT (ticket_id, user_id, description, status, image_url, category,
              priority, latitude, longitude, is_approved)
    ON TABLE public.reports TO authenticated;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated;
GRANT SELECT ON TABLE public.categories TO authenticated;

-- Report inserts use the existing generated bigint id, if present.
DO $$
DECLARE sequence_name text;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'id') THEN
        sequence_name := pg_get_serial_sequence('public.reports', 'id');
        IF sequence_name IS NOT NULL THEN
            EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM anon, authenticated', sequence_name);
            EXECUTE format('GRANT USAGE ON SEQUENCE %s TO authenticated', sequence_name);
        END IF;
    END IF;
END;
$$;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Restrictive checks remain in force even if an older permissive policy is present.
DROP POLICY IF EXISTS enclave_feature_resident_self_guard ON public.residents;
CREATE POLICY enclave_feature_resident_self_guard ON public.residents AS RESTRICTIVE
FOR SELECT TO authenticated USING (profile_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS enclave_resident_report_select_guard ON public.reports;
CREATE POLICY enclave_resident_report_select_guard ON public.reports AS RESTRICTIVE
FOR SELECT TO authenticated USING (
    user_id = (SELECT auth.uid()) AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);
DROP POLICY IF EXISTS enclave_resident_report_select_allow ON public.reports;
DROP POLICY IF EXISTS enclave_owner_select_guard ON public.reports;
DROP POLICY IF EXISTS enclave_owner_select_allow ON public.reports;
CREATE POLICY enclave_resident_report_select_allow ON public.reports
FOR SELECT TO authenticated USING (
    user_id = (SELECT auth.uid()) AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);

DROP POLICY IF EXISTS enclave_resident_report_insert_guard ON public.reports;
CREATE POLICY enclave_resident_report_insert_guard ON public.reports AS RESTRICTIVE
FOR INSERT TO authenticated WITH CHECK (
    user_id = (SELECT auth.uid()) AND status::text = 'pending' AND is_approved IS FALSE AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);
DROP POLICY IF EXISTS enclave_resident_report_insert_allow ON public.reports;
DROP POLICY IF EXISTS enclave_owner_insert_guard ON public.reports;
DROP POLICY IF EXISTS enclave_owner_insert_allow ON public.reports;
CREATE POLICY enclave_resident_report_insert_allow ON public.reports
FOR INSERT TO authenticated WITH CHECK (
    user_id = (SELECT auth.uid()) AND status::text = 'pending' AND is_approved IS FALSE AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);

-- Notifications are private to their recipient; residents can only mark them read.
DROP POLICY IF EXISTS enclave_resident_notification_select_guard ON public.notifications;
CREATE POLICY enclave_resident_notification_select_guard ON public.notifications AS RESTRICTIVE
FOR SELECT TO authenticated USING (
    user_id = (SELECT auth.uid()) AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);
DROP POLICY IF EXISTS enclave_resident_notification_select_allow ON public.notifications;
CREATE POLICY enclave_resident_notification_select_allow ON public.notifications
FOR SELECT TO authenticated USING (
    user_id = (SELECT auth.uid()) AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);
DROP POLICY IF EXISTS enclave_resident_notification_update_guard ON public.notifications;
CREATE POLICY enclave_resident_notification_update_guard ON public.notifications AS RESTRICTIVE
FOR UPDATE TO authenticated USING (
    user_id = (SELECT auth.uid()) AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
) WITH CHECK (
    user_id = (SELECT auth.uid()) AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);
DROP POLICY IF EXISTS enclave_resident_notification_update_allow ON public.notifications;
CREATE POLICY enclave_resident_notification_update_allow ON public.notifications
FOR UPDATE TO authenticated USING (
    user_id = (SELECT auth.uid()) AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
) WITH CHECK (
    user_id = (SELECT auth.uid()) AND EXISTS (
        SELECT 1 FROM public.residents r
        WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
    )
);

-- Categories are reference data for active residents. Writes stay server/admin-only.
DROP POLICY IF EXISTS enclave_active_resident_category_read_guard ON public.categories;
CREATE POLICY enclave_active_resident_category_read_guard ON public.categories AS RESTRICTIVE
FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.residents r
    WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
));
DROP POLICY IF EXISTS enclave_active_resident_category_read ON public.categories;
CREATE POLICY enclave_active_resident_category_read ON public.categories
FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.residents r
    WHERE r.profile_id = (SELECT auth.uid()) AND r.status = 'active' AND r.verified_at IS NOT NULL
));

COMMIT;
