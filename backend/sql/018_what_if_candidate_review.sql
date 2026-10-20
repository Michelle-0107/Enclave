-- Run after SQL 010 (and 017 for the current maintenance workflow).
-- Read-only management snapshot; no tables, report mutations or public grants.
-- All qualified open issues remain obstacles. Only never-approved issues with
-- pending evidence receive a management-only review ticket.
BEGIN;
CREATE OR REPLACE FUNCTION public.enclave_what_if_snapshot(p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE
    items jsonb;
BEGIN
    -- FastAPI supplies the UUID from a verified JWT. Do not expose this RPC to clients.
    IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_actor_id AND p.role='management') THEN
        RETURN jsonb_build_object('state','forbidden');
    END IF;
    -- STABLE uses the calling statement's snapshot. All plans use this same result.
    SELECT coalesce(jsonb_agg(q.item ORDER BY q.id),'[]'::jsonb) INTO items FROM (
        SELECT i.id,public.enclave_issue_projection(i.id) || jsonb_build_object(
            'review_ticket_id', CASE WHEN NOT EXISTS (
                SELECT 1 FROM public.community_issue_reports linked
                JOIN public.reports evidence ON evidence.id=linked.report_id
                WHERE linked.issue_id=i.id AND (evidence.is_approved IS TRUE
                    OR evidence.status IN ('approved','in_progress','resolved')
                    OR EXISTS (SELECT 1 FROM public.report_status_events event
                        WHERE event.report_id=evidence.id AND event.to_status='approved'))
            ) THEN (
                SELECT evidence.ticket_id FROM public.community_issue_reports linked
                JOIN public.reports evidence ON evidence.id=linked.report_id
                WHERE linked.issue_id=i.id AND evidence.status='pending'
                    AND evidence.is_approved IS NOT TRUE AND evidence.ticket_id IS NOT NULL
                ORDER BY evidence.created_at,evidence.id LIMIT 1
            ) ELSE NULL END) AS item
        FROM public.community_issues i
        WHERE i.status='open' AND
            (SELECT count(*) FROM public.community_issue_reports r WHERE r.issue_id=i.id)>=2
        ORDER BY i.id LIMIT 101
    ) q;
    IF jsonb_array_length(items)>100 THEN
        RETURN jsonb_build_object('state','too_many');
    END IF;
    RETURN jsonb_build_object('state','ok','checked_at',clock_timestamp(),'issues',items);
END;
$$;
REVOKE ALL ON FUNCTION public.enclave_what_if_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_what_if_snapshot(uuid) TO service_role;
COMMIT;
