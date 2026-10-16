-- Review and run manually after SQL 009. Read-only simulation source only.
-- No new tables, saved scenarios, repaired states, env vars, or resident policies.
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
        SELECT i.id,public.enclave_issue_projection(i.id) AS item
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
