-- Run manually after SQL 018. The starter amounts below are provisional
-- benchmarks authorized for planning; they are NOT completed-repair history.
-- Insert verified actuals later with record_kind='completed_actual'.
BEGIN;

CREATE TABLE IF NOT EXISTS public.repair_cost_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_reference text NOT NULL UNIQUE CHECK (length(btrim(source_reference)) BETWEEN 1 AND 160),
    facility_type text NOT NULL CHECK (facility_type IN
        ('path_surface','ramp','stairs','kerb','crossing','elevator','streetlight','drainage','bench','other')),
    record_kind text NOT NULL CHECK (record_kind IN ('provisional_benchmark','completed_actual')),
    cost_myr numeric(12,2) NOT NULL CHECK (cost_myr > 0),
    completed_on date,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((record_kind='completed_actual' AND completed_on IS NOT NULL AND completed_on<=CURRENT_DATE)
        OR (record_kind='provisional_benchmark' AND completed_on IS NULL))
);
CREATE INDEX IF NOT EXISTS enclave_repair_cost_history_type
    ON public.repair_cost_history (facility_type, record_kind, cost_myr);

ALTER TABLE public.repair_cost_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.repair_cost_history FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.repair_cost_history TO service_role;
-- Browser roles cannot read or edit this source. A database administrator must
-- verify completion and actual paid amount before inserting completed_actual.

INSERT INTO public.repair_cost_history (source_reference,facility_type,record_kind,cost_myr)
VALUES
    ('starter-path-surface-v1','path_surface','provisional_benchmark',12000.00),
    ('starter-ramp-v1','ramp','provisional_benchmark',9000.00),
    ('starter-stairs-v1','stairs','provisional_benchmark',6500.00),
    ('starter-kerb-v1','kerb','provisional_benchmark',2500.00),
    ('starter-crossing-v1','crossing','provisional_benchmark',8500.00),
    ('starter-elevator-v1','elevator','provisional_benchmark',15000.00),
    ('starter-streetlight-v1','streetlight','provisional_benchmark',3500.00),
    ('starter-drainage-v1','drainage','provisional_benchmark',6000.00),
    ('starter-bench-v1','bench','provisional_benchmark',1800.00),
    ('starter-other-v1','other','provisional_benchmark',3000.00)
ON CONFLICT (source_reference) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enclave_what_if_snapshot(p_actor_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE
    items jsonb;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_actor_id AND p.role='management') THEN
        RETURN jsonb_build_object('state','forbidden');
    END IF;

    SELECT coalesce(jsonb_agg(q.item ORDER BY q.id),'[]'::jsonb) INTO items FROM (
        SELECT i.id, public.enclave_issue_projection(i.id) || jsonb_build_object(
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
            ) ELSE NULL END,
            'estimated_cost_myr', estimate.estimated_cost,
            'cost_estimate_source', estimate.estimate_source,
            'cost_estimate_sample_count', estimate.sample_count
        ) AS item
        FROM public.community_issues i
        JOIN public.community_facilities f ON f.id=i.facility_id
        CROSS JOIN LATERAL (
            SELECT coalesce(actual.median_cost, benchmark.median_cost) AS estimated_cost,
                   CASE WHEN actual.sample_count>0 THEN 'historical_median'
                        WHEN benchmark.sample_count>0 THEN 'provisional_benchmark'
                        ELSE 'none' END AS estimate_source,
                   CASE WHEN actual.sample_count>0 THEN actual.sample_count
                        ELSE benchmark.sample_count END AS sample_count
            FROM (
                SELECT round((percentile_cont(0.5) WITHIN GROUP
                    (ORDER BY h.cost_myr::double precision))::numeric,2) AS median_cost,
                       count(*)::integer AS sample_count
                FROM public.repair_cost_history h
                WHERE h.facility_type=f.facility_type AND h.record_kind='completed_actual'
            ) actual
            CROSS JOIN (
                SELECT round((percentile_cont(0.5) WITHIN GROUP
                    (ORDER BY h.cost_myr::double precision))::numeric,2) AS median_cost,
                       count(*)::integer AS sample_count
                FROM public.repair_cost_history h
                WHERE h.facility_type=f.facility_type AND h.record_kind='provisional_benchmark'
            ) benchmark
        ) estimate
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
REVOKE ALL ON FUNCTION public.enclave_what_if_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_what_if_snapshot(uuid) TO service_role;

COMMIT;
