-- SUPERSEDED: use 006_active_resident_feature_rls.sql for resident access.
-- Kept as history only; do not apply this owner-only predecessor for resident launch.
-- Review with the project owner, then run in the Enclave project's SQL Editor.
-- No rows are deleted or reassigned. Existing policies remain, with additional
-- restrictive guards so older permissive policies cannot expose another owner.
-- Signed-in updates/deletes and anonymous access are disabled for this milestone.
BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reports'
          AND column_name = 'user_id' AND udt_name = 'uuid'
    ) THEN
        RAISE EXCEPTION 'Expected public.reports.user_id of type uuid; review the schema before applying.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reports'
          AND column_name = 'is_approved' AND udt_name = 'bool'
    ) THEN
        RAISE EXCEPTION 'Expected public.reports.is_approved of type boolean; review the schema before applying.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'ticket_id'
          AND character_maximum_length < 37
    ) THEN
        RAISE EXCEPTION 'Expected reports.ticket_id to support at least 37 characters; review the schema before applying.';
    END IF;
END;
$$;

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.reports FROM anon, authenticated;
GRANT SELECT ON TABLE public.reports TO authenticated;
GRANT INSERT (ticket_id, user_id, description, status, image_url, category,
              priority, latitude, longitude, is_approved)
ON public.reports TO authenticated;

-- If the existing id column uses a sequence, allow its default to allocate an ID.
DO $$
DECLARE sequence_name text;
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'id') THEN
        sequence_name := pg_get_serial_sequence('public.reports', 'id');
        IF sequence_name IS NOT NULL THEN
            EXECUTE format('GRANT USAGE ON SEQUENCE %s TO authenticated', sequence_name);
        END IF;
    END IF;
END;
$$;

DROP POLICY IF EXISTS enclave_owner_select_guard ON public.reports;
CREATE POLICY enclave_owner_select_guard ON public.reports AS RESTRICTIVE
FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS enclave_owner_select_allow ON public.reports;
CREATE POLICY enclave_owner_select_allow ON public.reports
FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);

DROP POLICY IF EXISTS enclave_owner_insert_guard ON public.reports;
CREATE POLICY enclave_owner_insert_guard ON public.reports AS RESTRICTIVE
FOR INSERT TO authenticated
WITH CHECK ((SELECT auth.uid()) = user_id AND status::text = 'pending' AND is_approved IS FALSE);

DROP POLICY IF EXISTS enclave_owner_insert_allow ON public.reports;
CREATE POLICY enclave_owner_insert_allow ON public.reports
FOR INSERT TO authenticated
WITH CHECK ((SELECT auth.uid()) = user_id AND status::text = 'pending' AND is_approved IS FALSE);

DROP POLICY IF EXISTS enclave_signed_in_update_guard ON public.reports;
CREATE POLICY enclave_signed_in_update_guard ON public.reports AS RESTRICTIVE
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS enclave_signed_in_delete_guard ON public.reports;
CREATE POLICY enclave_signed_in_delete_guard ON public.reports AS RESTRICTIVE
FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS enclave_anon_guard ON public.reports;
CREATE POLICY enclave_anon_guard ON public.reports AS RESTRICTIVE
FOR ALL TO anon USING (false) WITH CHECK (false);

COMMIT;
