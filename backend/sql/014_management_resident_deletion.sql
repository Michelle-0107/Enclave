-- Management-only, retryable deletion of one resident and their private records.
BEGIN;

CREATE TABLE IF NOT EXISTS public.resident_deletion_jobs (
    resident_id uuid PRIMARY KEY REFERENCES public.residents(id) ON DELETE CASCADE,
    auth_user_id uuid,
    image_urls jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(image_urls) = 'array'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.resident_deletion_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.resident_deletion_jobs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.resident_deletion_jobs TO service_role;
GRANT DELETE ON TABLE public.residents, public.resident_invitations,
    public.email_verification_challenges, public.reports, public.notifications TO service_role;

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'report_status_events', 'report_routing_impacts', 'routing_impact_events',
        'community_issue_reports'
    ] LOOP
        IF to_regclass('public.' || table_name) IS NOT NULL THEN
            EXECUTE format('GRANT DELETE ON TABLE public.%I TO service_role', table_name);
        END IF;
    END LOOP;
    IF to_regclass('public.community_facilities') IS NOT NULL THEN
        EXECUTE 'GRANT UPDATE (created_by) ON TABLE public.community_facilities TO service_role';
    END IF;
END;
$$;

DO $$
BEGIN
    IF to_regclass('public.community_facilities') IS NOT NULL
       AND EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'community_facilities'
             AND column_name = 'created_by' AND is_nullable = 'NO'
       ) THEN
        ALTER TABLE public.community_facilities ALTER COLUMN created_by DROP NOT NULL;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enclave_management_resident_purge(p_action text, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_actor uuid;
    v_resident_id uuid;
    v_user_id uuid;
    v_role text;
    v_resident public.residents%ROWTYPE;
    v_job public.resident_deletion_jobs%ROWTYPE;
    v_report_ids bigint[] := ARRAY[]::bigint[];
    v_image_urls jsonb := '[]'::jsonb;
    v_resident_found boolean := false;
    v_existing_job boolean := false;
BEGIN
    IF jsonb_typeof(p_args) IS DISTINCT FROM 'object'
       OR p_action NOT IN ('prepare', 'finalize') THEN
        RETURN jsonb_build_object('state', 'invalid');
    END IF;

    BEGIN
        v_actor := (p_args->>'actor_id')::uuid;
        v_resident_id := (p_args->>'resident_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('state', 'invalid');
    END;

    SELECT role INTO v_role FROM public.profiles WHERE id = v_actor FOR SHARE;
    IF NOT FOUND OR v_role IS DISTINCT FROM 'management' THEN
        RETURN jsonb_build_object('state', 'forbidden');
    END IF;

    IF p_action = 'prepare' THEN
        SELECT * INTO v_resident FROM public.residents WHERE id = v_resident_id FOR UPDATE;
        v_resident_found := FOUND;
        SELECT * INTO v_job FROM public.resident_deletion_jobs WHERE resident_id = v_resident_id FOR UPDATE;
        v_existing_job := FOUND;

        IF NOT v_resident_found AND NOT v_existing_job THEN
            RETURN jsonb_build_object('state', 'not_found');
        END IF;

        IF v_existing_job THEN
            v_user_id := v_job.auth_user_id;
            v_image_urls := v_job.image_urls;
        ELSE
            v_user_id := v_resident.profile_id;
            IF v_user_id IS NOT NULL THEN
                SELECT COALESCE(array_agg(id), ARRAY[]::bigint[]),
                       COALESCE(jsonb_agg(image_url) FILTER (WHERE image_url IS NOT NULL), '[]'::jsonb)
                INTO v_report_ids, v_image_urls
                FROM public.reports WHERE user_id = v_user_id;
            END IF;

            INSERT INTO public.resident_deletion_jobs(resident_id, auth_user_id, image_urls)
            VALUES (v_resident_id, v_user_id, v_image_urls);

            IF v_user_id IS NOT NULL THEN
                IF to_regclass('public.community_issue_reports') IS NOT NULL THEN
                    EXECUTE 'DELETE FROM public.community_issue_reports WHERE user_id = $1 OR report_id = ANY($2)'
                        USING v_user_id, v_report_ids;
                END IF;
                IF to_regclass('public.report_status_events') IS NOT NULL THEN
                    EXECUTE 'DELETE FROM public.report_status_events WHERE report_id = ANY($1)'
                        USING v_report_ids;
                END IF;
                IF to_regclass('public.report_routing_impacts') IS NOT NULL THEN
                    EXECUTE 'DELETE FROM public.report_routing_impacts WHERE report_id = ANY($1)'
                        USING v_report_ids;
                END IF;
                IF to_regclass('public.routing_impact_events') IS NOT NULL THEN
                    EXECUTE 'DELETE FROM public.routing_impact_events WHERE report_id = ANY($1)'
                        USING v_report_ids;
                END IF;
                IF to_regclass('public.notifications') IS NOT NULL THEN
                    DELETE FROM public.notifications
                    WHERE user_id = v_user_id AND audience = 'individual';
                END IF;
                IF to_regclass('public.community_facilities') IS NOT NULL THEN
                    EXECUTE 'UPDATE public.community_facilities SET created_by = NULL WHERE created_by = $1'
                        USING v_user_id;
                END IF;
                DELETE FROM public.reports WHERE user_id = v_user_id;
            END IF;

            DELETE FROM public.email_verification_challenges WHERE resident_id = v_resident_id;
            DELETE FROM public.resident_invitations WHERE resident_id = v_resident_id;
            UPDATE public.residents
            SET status = 'inactive', profile_id = NULL, verified_at = NULL
            WHERE id = v_resident_id;
        END IF;

        RETURN jsonb_build_object(
            'state', 'prepared',
            'auth_user_id', v_user_id,
            'image_urls', v_image_urls
        );
    END IF;

    SELECT * INTO v_job FROM public.resident_deletion_jobs WHERE resident_id = v_resident_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'not_found');
    END IF;
    DELETE FROM public.residents WHERE id = v_resident_id;
    RETURN jsonb_build_object('state', 'deleted');
EXCEPTION
    WHEN foreign_key_violation THEN
        RETURN jsonb_build_object('state', 'blocked');
END;
$$;

REVOKE ALL ON FUNCTION public.enclave_management_resident_purge(text, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_management_resident_purge(text, jsonb) TO service_role;

COMMIT;
