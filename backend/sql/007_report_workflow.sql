-- Review and run manually in Supabase SQL Editor. Does not change existing rows,
-- Auth, resident policies, teammate tables, or environment variables.
-- Requires profiles/residents and reports with the existing owner-only RLS.
-- Duplicate non-null ticket IDs cause this whole migration to roll back.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS enclave_reports_ticket_unique ON public.reports(ticket_id);

CREATE TABLE IF NOT EXISTS public.report_status_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id bigint NOT NULL REFERENCES public.reports(id) ON DELETE RESTRICT,
    from_status text NOT NULL,
    to_status text NOT NULL,
    changed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 1000),
    repair_verified boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((from_status = 'pending' AND to_status IN ('approved', 'rejected')) OR
           (from_status = 'approved' AND to_status = 'in_progress') OR
           (from_status = 'in_progress' AND to_status = 'resolved')),
    CHECK (repair_verified = (to_status = 'resolved'))
);
CREATE INDEX IF NOT EXISTS enclave_report_events_lookup
    ON public.report_status_events(report_id, id);
ALTER TABLE public.report_status_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_status_events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.report_status_events TO service_role;
REVOKE ALL ON SEQUENCE public.report_status_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.report_status_events_id_seq TO service_role;
GRANT SELECT ON public.reports, public.profiles, public.residents TO service_role;
GRANT UPDATE (status, is_approved) ON public.reports TO service_role;

CREATE OR REPLACE FUNCTION public.enclave_report_workflow(p_action text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    actor uuid;
    actor_role text;
    ticket text;
    desired text;
    expected text;
    review_note text;
    verified boolean;
    page_limit integer;
    page_offset integer;
    report_row public.reports%ROWTYPE;
    event_row public.report_status_events%ROWTYPE;
    entries jsonb;
    more boolean;
BEGIN
    -- EXECUTE is granted only to service_role. actor_id comes from a verified JWT
    -- in FastAPI, never from a caller-controlled request field.
    IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN
        RETURN jsonb_build_object('state', 'invalid');
    END IF;
    actor := (p_args->>'actor_id')::uuid;
    SELECT p.role INTO actor_role FROM public.profiles p WHERE p.id = actor;
    IF actor_role IS NULL OR actor_role NOT IN ('management', 'resident') THEN
        RETURN jsonb_build_object('state', 'forbidden');
    END IF;
    IF p_action IN ('list', 'update') AND actor_role <> 'management' THEN
        RETURN jsonb_build_object('state', 'forbidden');
    END IF;
    IF p_action NOT IN ('list', 'update', 'history') OR p_action IS NULL THEN
        RETURN jsonb_build_object('state', 'invalid');
    END IF;
    IF p_action IN ('list', 'history') THEN
        page_limit := (p_args->>'limit')::integer;
        page_offset := (p_args->>'offset')::integer;
        IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 100 OR
           page_offset IS NULL OR page_offset < 0 THEN
            RETURN jsonb_build_object('state', 'invalid');
        END IF;
    END IF;
    IF p_action = 'list' THEN
        desired := p_args->>'status';
        IF desired IS NOT NULL AND desired NOT IN ('pending','approved','rejected','in_progress','resolved') THEN
            RETURN jsonb_build_object('state', 'invalid');
        END IF;
        SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC NULLS LAST, q.id DESC), '[]'::jsonb)
        INTO entries FROM (
            SELECT r.* FROM public.reports r WHERE desired IS NULL OR r.status = desired
            ORDER BY r.created_at DESC NULLS LAST, r.id DESC LIMIT page_limit + 1 OFFSET page_offset
        ) q;
        more := jsonb_array_length(entries) > page_limit;
        IF more THEN entries := entries - page_limit; END IF;
        RETURN jsonb_build_object('state','ok','items',entries,'has_more',more);
    END IF;

    ticket := p_args->>'ticket_id';
    IF ticket IS NULL OR length(ticket) NOT BETWEEN 1 AND 128 OR ticket !~ '^[A-Za-z0-9_-]+$' THEN
        RETURN jsonb_build_object('state', 'invalid');
    END IF;
    IF actor_role = 'resident' THEN
        IF NOT EXISTS (SELECT 1 FROM public.residents r WHERE r.profile_id = actor
                       AND r.status = 'active' AND r.verified_at IS NOT NULL) THEN
            RETURN jsonb_build_object('state', 'forbidden');
        END IF;
    END IF;
    -- Lock serializes updates and provides a consistent history snapshot.
    SELECT r.* INTO report_row FROM public.reports r
    WHERE r.ticket_id = ticket AND (actor_role = 'management' OR r.user_id = actor)
    FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
    IF p_action = 'history' THEN
        SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id), '[]'::jsonb)
        INTO entries FROM (
            SELECT e.id, e.from_status, e.to_status, e.note, e.repair_verified, e.created_at,
                   'management'::text AS actor_role,
                   CASE WHEN actor_role = 'management' THEN e.changed_by ELSE NULL END AS changed_by
            FROM public.report_status_events e WHERE e.report_id = report_row.id
            ORDER BY e.id LIMIT page_limit + 1 OFFSET page_offset
        ) q;
        more := jsonb_array_length(entries) > page_limit;
        IF more THEN entries := entries - page_limit; END IF;
        RETURN jsonb_build_object('state','ok','items',entries,'has_more',more,
                                 'is_management',actor_role = 'management');
    END IF;

    desired := p_args->>'status'; expected := p_args->>'expected_status';
    review_note := btrim(p_args->>'note');
    IF jsonb_typeof(p_args->'repair_verified') IS DISTINCT FROM 'boolean' THEN
        RETURN jsonb_build_object('state','invalid');
    END IF;
    verified := (p_args->>'repair_verified')::boolean;
    IF desired IS NULL OR expected IS NULL OR review_note IS NULL OR length(review_note) NOT BETWEEN 1 AND 1000
       OR NOT ((expected = 'pending' AND desired IN ('approved','rejected')) OR
               (expected = 'approved' AND desired = 'in_progress') OR
               (expected = 'in_progress' AND desired = 'resolved'))
       OR verified IS DISTINCT FROM (desired = 'resolved') THEN
        RETURN jsonb_build_object('state','invalid');
    END IF;
    IF report_row.status IS DISTINCT FROM expected OR
       report_row.is_approved IS DISTINCT FROM (expected IN ('approved','in_progress','resolved')) THEN
        RETURN jsonb_build_object('state','conflict');
    END IF;
    UPDATE public.reports SET status = desired,
        is_approved = (desired IN ('approved','in_progress','resolved'))
        WHERE id = report_row.id RETURNING * INTO report_row;
    INSERT INTO public.report_status_events(report_id,from_status,to_status,changed_by,note,repair_verified)
        VALUES(report_row.id,expected,desired,actor,review_note,verified) RETURNING * INTO event_row;
    -- Update and event insertion commit together. Do not catch audit failures.
    RETURN jsonb_build_object('state','ok','report',to_jsonb(report_row),
                             'event',to_jsonb(event_row) || jsonb_build_object('actor_role','management'));
END;
$$;
REVOKE ALL ON FUNCTION public.enclave_report_workflow(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_report_workflow(text,jsonb) TO service_role;
COMMIT;
