-- Run manually in Supabase SQL Editor after SQL 007. Adds owned tables/RPC only.
-- No existing report/resident data, policies, teammate tables, or Auth are changed.
-- Approved reports do not become obstacles automatically. Management confirms
-- a small exclusion square near the report, with a mandatory expiry <= 7 days.
BEGIN;

CREATE TABLE IF NOT EXISTS public.report_routing_impacts (
    report_id bigint PRIMARY KEY REFERENCES public.reports(id) ON DELETE RESTRICT,
    version bigint NOT NULL CHECK (version > 0),
    impact text NOT NULL CHECK (impact IN ('blocked','none')),
    latitude double precision,
    longitude double precision,
    half_width_meters double precision,
    expires_at timestamptz,
    note text NOT NULL CHECK (length(btrim(note)) BETWEEN 1 AND 1000),
    confirmed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((impact = 'none' AND latitude IS NULL AND longitude IS NULL
                AND half_width_meters IS NULL AND expires_at IS NULL) OR
           (impact = 'blocked' AND latitude IS NOT NULL AND longitude IS NOT NULL
                AND half_width_meters IS NOT NULL AND expires_at IS NOT NULL
                AND latitude BETWEEN 3.217 AND 3.235 AND longitude BETWEEN 101.721 AND 101.741
                AND half_width_meters BETWEEN 3 AND 30))
);
CREATE TABLE IF NOT EXISTS public.routing_impact_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id bigint NOT NULL REFERENCES public.reports(id) ON DELETE RESTRICT,
    version bigint NOT NULL,
    changed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    previous_impact jsonb,
    current_impact jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (report_id,version)
);
ALTER TABLE public.report_routing_impacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.routing_impact_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_routing_impacts, public.routing_impact_events
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.report_routing_impacts TO service_role;
GRANT SELECT, INSERT ON public.routing_impact_events TO service_role;
REVOKE ALL ON SEQUENCE public.routing_impact_events_id_seq FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SEQUENCE public.routing_impact_events_id_seq TO service_role;
GRANT SELECT ON public.reports, public.profiles, public.residents TO service_role;
-- PostgreSQL requires UPDATE privilege for SELECT FOR UPDATE; no broad grant.
GRANT UPDATE (status) ON public.reports TO service_role;

CREATE OR REPLACE FUNCTION public.enclave_routing_obstacles(p_action text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    actor uuid;
    actor_role text;
    ticket text;
    expected bigint;
    expected_status text;
    desired text;
    review_note text;
    lat double precision;
    lon double precision;
    half_width double precision;
    expiry timestamptz;
    checked timestamptz := clock_timestamp();
    dx double precision;
    dy double precision;
    r public.reports%ROWTYPE;
    old_row public.report_routing_impacts%ROWTYPE;
    new_row public.report_routing_impacts%ROWTYPE;
    entries jsonb;
    item jsonb;
BEGIN
    IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR p_action IS NULL
        OR p_action NOT IN ('get','set','active') THEN
        RETURN jsonb_build_object('state','invalid');
    END IF;
    BEGIN
        actor := (p_args->>'actor_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
        RETURN jsonb_build_object('state','invalid');
    END;
    SELECT p.role INTO actor_role FROM public.profiles p WHERE p.id=actor;
    IF actor_role IS NULL OR actor_role NOT IN ('resident','management') THEN
        RETURN jsonb_build_object('state','forbidden');
    END IF;
    IF p_action IN ('get','set') AND actor_role <> 'management' THEN
        RETURN jsonb_build_object('state','forbidden');
    END IF;
    IF p_action='active' THEN
        IF actor_role='resident' AND NOT EXISTS (SELECT 1 FROM public.residents s
            WHERE s.profile_id=actor AND s.status='active' AND s.verified_at IS NOT NULL) THEN
            RETURN jsonb_build_object('state','forbidden');
        END IF;
        SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.ticket_id),'[]'::jsonb) INTO entries FROM (
            SELECT t.ticket_id,t.status AS report_status,t.is_approved,o.version,o.impact,
                jsonb_build_object('latitude',o.latitude,'longitude',o.longitude) AS center,
                o.half_width_meters,o.expires_at
            FROM public.report_routing_impacts o JOIN public.reports t ON t.id=o.report_id
            WHERE o.impact='blocked' AND o.expires_at>checked AND t.is_approved IS TRUE
                AND t.status IN ('approved','in_progress')
            ORDER BY t.ticket_id LIMIT 101
        ) q;
        IF jsonb_array_length(entries)>100 THEN
            RETURN jsonb_build_object('state','too_many'); -- Never silently drop restrictions.
        END IF;
        RETURN jsonb_build_object('state','ok','checked_at',checked,'items',entries);
    END IF;
    ticket:=p_args->>'ticket_id';
    IF ticket IS NULL OR length(ticket) NOT BETWEEN 1 AND 128 OR ticket !~ '^[A-Za-z0-9_-]+$' THEN
        RETURN jsonb_build_object('state','invalid');
    END IF;
    -- Same report lock as SQL 007: review/resolution and routing updates serialize.
    SELECT t.* INTO r FROM public.reports t WHERE t.ticket_id=ticket FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
    SELECT o.* INTO old_row FROM public.report_routing_impacts o WHERE o.report_id=r.id;
    IF p_action='set' THEN
        BEGIN
            IF jsonb_typeof(p_args->'expected_version') IS DISTINCT FROM 'number'
                OR (p_args->>'expected_version') !~ '^[0-9]+$' THEN
                RETURN jsonb_build_object('state','invalid');
            END IF;
            expected:=(p_args->>'expected_version')::bigint;
            expected_status:=p_args->>'expected_report_status';
            desired:=p_args->>'impact';
            review_note:=btrim(p_args->>'note');
            IF expected<0 OR expected>2000000000 OR desired IS NULL OR desired NOT IN ('blocked','none')
                OR expected_status IS NULL OR review_note IS NULL OR length(review_note) NOT BETWEEN 1 AND 1000 THEN
                RETURN jsonb_build_object('state','invalid');
            END IF;
            IF coalesce(old_row.version,0)<>expected OR r.status IS DISTINCT FROM expected_status THEN
                RETURN jsonb_build_object('state','conflict');
            END IF;
            IF desired='blocked' THEN
                IF r.status NOT IN ('approved','in_progress') OR r.status IS NULL OR r.is_approved IS DISTINCT FROM true
                    OR jsonb_typeof(p_args->'center') IS DISTINCT FROM 'object'
                    OR jsonb_typeof(p_args->'center'->'latitude') IS DISTINCT FROM 'number'
                    OR jsonb_typeof(p_args->'center'->'longitude') IS DISTINCT FROM 'number'
                    OR jsonb_typeof(p_args->'half_width_meters') IS DISTINCT FROM 'number'
                    OR jsonb_typeof(p_args->'expires_at') IS DISTINCT FROM 'string' THEN
                    RETURN jsonb_build_object('state','invalid');
                END IF;
                lat:=(p_args->'center'->>'latitude')::double precision;
                lon:=(p_args->'center'->>'longitude')::double precision;
                half_width:=(p_args->>'half_width_meters')::double precision;
                expiry:=(p_args->>'expires_at')::timestamptz;
                IF NOT (lat BETWEEN 3.217 AND 3.235 AND lon BETWEEN 101.721 AND 101.741
                    AND half_width BETWEEN 3 AND 30 AND expiry>checked AND expiry<=checked+interval '7 days')
                    OR r.latitude IS NULL OR r.longitude IS NULL
                    OR NOT (r.latitude BETWEEN -90 AND 90 AND r.longitude BETWEEN -180 AND 180) THEN
                    RETURN jsonb_build_object('state','invalid');
                END IF;
                dy:=half_width/111195.08; dx:=dy/cos(radians(lat));
                IF lat-dy<3.217 OR lat+dy>3.235 OR lon-dx<101.721 OR lon+dx>101.741
                    OR sqrt(power((lat-r.latitude)*111195.08,2)
                        +power((lon-r.longitude)*111195.08*cos(radians(lat)),2))>100 THEN
                    RETURN jsonb_build_object('state','invalid');
                END IF;
            ELSE
                IF (p_args->'center' IS NOT NULL AND p_args->'center'<>'null'::jsonb)
                    OR (p_args->'half_width_meters' IS NOT NULL AND p_args->'half_width_meters'<>'null'::jsonb)
                    OR (p_args->'expires_at' IS NOT NULL AND p_args->'expires_at'<>'null'::jsonb) THEN
                    RETURN jsonb_build_object('state','invalid');
                END IF;
            END IF;
        EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format
            OR numeric_value_out_of_range THEN
            RETURN jsonb_build_object('state','invalid');
        END;
        INSERT INTO public.report_routing_impacts(report_id,version,impact,latitude,longitude,
            half_width_meters,expires_at,note,confirmed_by,updated_at)
        VALUES(r.id,expected+1,desired,lat,lon,half_width,expiry,review_note,actor,checked)
        ON CONFLICT(report_id) DO UPDATE SET version=EXCLUDED.version,impact=EXCLUDED.impact,
            latitude=EXCLUDED.latitude,longitude=EXCLUDED.longitude,half_width_meters=EXCLUDED.half_width_meters,
            expires_at=EXCLUDED.expires_at,note=EXCLUDED.note,confirmed_by=EXCLUDED.confirmed_by,updated_at=EXCLUDED.updated_at
        RETURNING * INTO new_row;
        INSERT INTO public.routing_impact_events(report_id,version,changed_by,previous_impact,current_impact)
            VALUES(r.id,new_row.version,actor,CASE WHEN old_row.report_id IS NULL THEN NULL ELSE to_jsonb(old_row) END,to_jsonb(new_row));
        old_row:=new_row;
    END IF;
    item:=jsonb_build_object('ticket_id',r.ticket_id,'report_status',r.status,'is_approved',r.is_approved,
        'version',coalesce(old_row.version,0),'impact',coalesce(old_row.impact,'none'),
        'center',CASE WHEN old_row.impact='blocked' THEN jsonb_build_object('latitude',old_row.latitude,'longitude',old_row.longitude) ELSE NULL END,
        'half_width_meters',old_row.half_width_meters,'expires_at',old_row.expires_at,
        'note',old_row.note,'updated_at',old_row.updated_at);
    RETURN jsonb_build_object('state','ok','item',item);
END;
$$;
REVOKE ALL ON FUNCTION public.enclave_routing_obstacles(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_routing_obstacles(text,jsonb) TO service_role;
COMMIT;
