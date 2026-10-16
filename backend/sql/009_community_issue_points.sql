-- Run manually after SQL 007. SQL 008 is optional/historical and is NOT used by
-- the new route modes. Existing reports are not guessed into issue groups.
BEGIN;
CREATE TABLE IF NOT EXISTS public.community_facilities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
    facility_type text NOT NULL CHECK(facility_type IN
        ('path_surface','ramp','stairs','kerb','crossing','elevator','streetlight','drainage','bench','other')),
    latitude double precision NOT NULL CHECK(latitude BETWEEN 3.2171 AND 3.2349),
    longitude double precision NOT NULL CHECK(longitude BETWEEN 101.7211 AND 101.7409),
    created_by uuid NOT NULL REFERENCES public.profiles(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(name,facility_type,latitude,longitude)
);
CREATE TABLE IF NOT EXISTS public.community_issues (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id uuid NOT NULL REFERENCES public.community_facilities(id),
    fault_kind text NOT NULL CHECK(fault_kind IN ('damage','obstruction')),
    status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    resolved_at timestamptz,
    CHECK((status='open')=(resolved_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS enclave_open_facility_issue
    ON public.community_issues(facility_id,fault_kind) WHERE status='open';
CREATE TABLE IF NOT EXISTS public.community_issue_reports (
    issue_id uuid NOT NULL REFERENCES public.community_issues(id),
    user_id uuid NOT NULL REFERENCES public.profiles(id),
    report_id bigint NOT NULL UNIQUE REFERENCES public.reports(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(issue_id,user_id)
);
ALTER TABLE public.community_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_issue_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_facilities,public.community_issues,public.community_issue_reports
    FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.community_facilities,public.community_issue_reports TO service_role;
-- Minimal column privilege required by PostgreSQL for the facility row lock.
GRANT UPDATE(name) ON public.community_facilities TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.community_issues TO service_role;
GRANT SELECT ON public.reports TO service_role;
GRANT SELECT ON public.profiles,public.residents TO service_role;

-- Internal projection never exposes reporter IDs, photos, descriptions, or staff notes.
CREATE OR REPLACE FUNCTION public.enclave_issue_projection(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
    SELECT jsonb_build_object('id',i.id,'facility_id',f.id,'facility_name',f.name,
        'facility_type',f.facility_type,'latitude',f.latitude,'longitude',f.longitude,
        'fault_kind',i.fault_kind,'status',i.status,'created_at',i.created_at,'resolved_at',i.resolved_at,
        'reporter_count',(SELECT count(*) FROM public.community_issue_reports v WHERE v.issue_id=i.id),
        'affects_routes',f.facility_type NOT IN ('bench','other'))
    FROM public.community_issues i JOIN public.community_facilities f ON f.id=i.facility_id WHERE i.id=p_id
$$;
REVOKE ALL ON FUNCTION public.enclave_issue_projection(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_issue_projection(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enclave_community_issues(p_action text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
    actor uuid;
    facility uuid;
    issue uuid;
    r_id bigint;
    r public.reports%ROWTYPE;
    point public.community_facilities%ROWTYPE;
    incident public.community_issues%ROWTYPE;
    kind text;
    title text;
    ftype text;
    lat double precision;
    lon double precision;
    page_limit integer;
    page_offset integer;
    w double precision;
    s double precision;
    e double precision;
    n double precision;
    include_resolved boolean;
    items jsonb;
    total_more boolean;
    checked timestamptz:=clock_timestamp();
BEGIN
    IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR p_action IS NULL OR
        p_action NOT IN ('facilities','create_facility','issues','open_issue','report_issue','map','obstacles') THEN
        RETURN jsonb_build_object('state','invalid');
    END IF;
    BEGIN actor:=(p_args->>'actor_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('state','invalid'); END;
    IF NOT EXISTS(SELECT 1 FROM public.residents x JOIN public.profiles p ON p.id=x.profile_id
        WHERE x.profile_id=actor AND x.status='active' AND x.verified_at IS NOT NULL
            AND p.role IN ('resident','management')) THEN
        RETURN jsonb_build_object('state','forbidden');
    END IF;
    IF p_action IN ('facilities','issues','map') THEN
        BEGIN
            page_limit:=(p_args->>'limit')::integer; page_offset:=(p_args->>'offset')::integer;
            w:=(p_args->>'west')::double precision; s:=(p_args->>'south')::double precision;
            e:=(p_args->>'east')::double precision; n:=(p_args->>'north')::double precision;
            include_resolved:=coalesce((p_args->>'include_resolved')::boolean,false);
        EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RETURN jsonb_build_object('state','invalid');
        END;
        IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 200 OR page_offset IS NULL OR page_offset<0
            OR w IS NULL OR s IS NULL OR e IS NULL OR n IS NULL OR NOT
            (w BETWEEN -180 AND 180 AND e BETWEEN w AND 180 AND s BETWEEN -90 AND 90 AND n BETWEEN s AND 90) THEN
            RETURN jsonb_build_object('state','invalid');
        END IF;
        IF p_action='facilities' THEN
            SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO items FROM (
                SELECT f.id,f.name,f.facility_type,f.latitude,f.longitude,f.created_at
                FROM public.community_facilities f WHERE f.longitude BETWEEN w AND e AND f.latitude BETWEEN s AND n
                ORDER BY f.created_at,f.id LIMIT page_limit+1 OFFSET page_offset
            ) q;
        ELSE
            SELECT coalesce(jsonb_agg(q.item ORDER BY q.created_at,q.id),'[]'::jsonb) INTO items FROM (
                SELECT i.id,i.created_at,public.enclave_issue_projection(i.id) AS item
                FROM public.community_issues i JOIN public.community_facilities f ON f.id=i.facility_id
                WHERE f.longitude BETWEEN w AND e AND f.latitude BETWEEN s AND n
                    AND (i.status='open' OR include_resolved)
                    AND (p_action='issues' OR (SELECT count(*) FROM public.community_issue_reports v WHERE v.issue_id=i.id)>=2)
                ORDER BY i.created_at,i.id LIMIT page_limit+1 OFFSET page_offset
            ) q;
        END IF;
        total_more:=jsonb_array_length(items)>page_limit;
        IF total_more THEN items:=items-page_limit; END IF;
        RETURN jsonb_build_object('state','ok','items',items,'has_more',total_more);
    END IF;
    IF p_action='obstacles' THEN
        SELECT coalesce(jsonb_agg(q.item ORDER BY q.id),'[]'::jsonb) INTO items FROM (
            SELECT i.id,public.enclave_issue_projection(i.id) AS item
            FROM public.community_issues i JOIN public.community_facilities f ON f.id=i.facility_id
            WHERE i.status='open' AND f.facility_type NOT IN ('bench','other')
                AND (SELECT count(*) FROM public.community_issue_reports v WHERE v.issue_id=i.id)>=2
            ORDER BY i.id LIMIT 101
        ) q;
        IF jsonb_array_length(items)>100 THEN RETURN jsonb_build_object('state','too_many'); END IF;
        RETURN jsonb_build_object('state','ok','items',items,'checked_at',checked);
    END IF;
    IF p_action='create_facility' THEN
        BEGIN
            title:=btrim(p_args->>'name'); ftype:=p_args->>'facility_type';
            IF jsonb_typeof(p_args->'latitude') IS DISTINCT FROM 'number'
                OR jsonb_typeof(p_args->'longitude') IS DISTINCT FROM 'number' THEN
                RETURN jsonb_build_object('state','invalid');
            END IF;
            lat:=(p_args->>'latitude')::double precision; lon:=(p_args->>'longitude')::double precision;
        EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
            RETURN jsonb_build_object('state','invalid');
        END;
        IF title IS NULL OR length(title) NOT BETWEEN 1 AND 120 OR ftype IS NULL OR ftype NOT IN
            ('path_surface','ramp','stairs','kerb','crossing','elevator','streetlight','drainage','bench','other')
            OR NOT(lat BETWEEN 3.2171 AND 3.2349 AND lon BETWEEN 101.7211 AND 101.7409) THEN
            RETURN jsonb_build_object('state','invalid');
        END IF;
        INSERT INTO public.community_facilities(name,facility_type,latitude,longitude,created_by)
            VALUES(title,ftype,lat,lon,actor) ON CONFLICT(name,facility_type,latitude,longitude) DO NOTHING;
        SELECT f.* INTO point FROM public.community_facilities f
            WHERE f.name=title AND f.facility_type=ftype AND f.latitude=lat AND f.longitude=lon;
        RETURN jsonb_build_object('state','ok','item',to_jsonb(point)-'created_by');
    END IF;
    -- Existing private evidence stays in reports. Only its verified owner can link
    -- it. Opening the incident and distinct-resident linkage commit together.
    BEGIN
        facility:=nullif(p_args->>'facility_id','')::uuid;
        issue:=nullif(p_args->>'issue_id','')::uuid;
        kind:=p_args->>'fault_kind';
    EXCEPTION WHEN invalid_text_representation THEN RETURN jsonb_build_object('state','invalid'); END;
    IF (facility IS NULL)=(issue IS NULL) OR kind IS NULL OR kind NOT IN ('damage','obstruction') THEN
        RETURN jsonb_build_object('state','invalid');
    END IF;
    IF p_action='open_issue' AND facility IS NULL OR p_action='report_issue' AND issue IS NULL THEN
        RETURN jsonb_build_object('state','invalid');
    END IF;
    SELECT t.* INTO r FROM public.reports t WHERE t.ticket_id=p_args->>'report_ticket_id' AND t.user_id=actor FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
    IF r.status='resolved' OR r.latitude IS NULL OR r.longitude IS NULL
        OR NOT(r.latitude BETWEEN -90 AND 90 AND r.longitude BETWEEN -180 AND 180) THEN
        RETURN jsonb_build_object('state','invalid');
    END IF;
    IF EXISTS(SELECT 1 FROM public.community_issue_reports v WHERE v.report_id=r.id
        AND (issue IS NULL OR v.issue_id<>issue)) THEN
        -- Opening the same facility issue again is handled after locking below.
        IF issue IS NOT NULL THEN RETURN jsonb_build_object('state','conflict'); END IF;
    END IF;
    IF issue IS NOT NULL THEN
        SELECT i.* INTO incident FROM public.community_issues i WHERE i.id=issue FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
        IF incident.status<>'open' THEN RETURN jsonb_build_object('state','closed'); END IF;
        SELECT f.* INTO point FROM public.community_facilities f WHERE f.id=incident.facility_id;
    ELSE
        SELECT f.* INTO point FROM public.community_facilities f WHERE f.id=facility FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
        IF sqrt(power((r.latitude-point.latitude)*111195.08,2)
            +power((r.longitude-point.longitude)*111195.08*cos(radians(r.latitude)),2))>100 THEN
            RETURN jsonb_build_object('state','invalid');
        END IF;
        SELECT i.* INTO incident FROM public.community_issues i WHERE i.facility_id=facility AND i.fault_kind=kind AND i.status='open' FOR UPDATE;
        IF NOT FOUND THEN
            IF EXISTS(SELECT 1 FROM public.community_issue_reports v WHERE v.report_id=r.id) THEN
                RETURN jsonb_build_object('state','conflict');
            END IF;
            IF EXISTS(SELECT 1 FROM public.community_issues old WHERE old.facility_id=facility
                AND old.fault_kind=kind AND old.status='resolved' AND (r.created_at IS NULL OR r.created_at<=old.resolved_at)) THEN
                RETURN jsonb_build_object('state','closed');
            END IF;
            INSERT INTO public.community_issues(facility_id,fault_kind) VALUES(facility,kind) RETURNING * INTO incident;
        END IF;
    END IF;
    IF sqrt(power((r.latitude-point.latitude)*111195.08,2)
        +power((r.longitude-point.longitude)*111195.08*cos(radians(r.latitude)),2))>100 THEN
        RETURN jsonb_build_object('state','invalid');
    END IF;
    IF EXISTS(SELECT 1 FROM public.community_issues old WHERE old.facility_id=point.id
        AND old.fault_kind=incident.fault_kind AND old.status='resolved'
        AND (r.created_at IS NULL OR r.created_at<=old.resolved_at)) THEN
        RETURN jsonb_build_object('state','closed');
    END IF;
    SELECT v.report_id INTO r_id FROM public.community_issue_reports v WHERE v.issue_id=incident.id AND v.user_id=actor;
    IF FOUND THEN
        RETURN jsonb_build_object('state','ok','issue',public.enclave_issue_projection(incident.id),'deduplicated',true);
    END IF;
    IF EXISTS(SELECT 1 FROM public.community_issue_reports v WHERE v.report_id=r.id) THEN
        RETURN jsonb_build_object('state','conflict');
    END IF;
    INSERT INTO public.community_issue_reports(issue_id,user_id,report_id) VALUES(incident.id,actor,r.id);
    RETURN jsonb_build_object('state','ok','issue',public.enclave_issue_projection(incident.id),'deduplicated',false);
END;
$$;
REVOKE ALL ON FUNCTION public.enclave_community_issues(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_community_issues(text,jsonb) TO service_role;

-- Only the existing verified repair audit event closes an incident. Approval or
-- rejection changes maintenance state only. The audit and closure roll back together.
CREATE OR REPLACE FUNCTION public.enclave_close_repaired_issue()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
    IF NEW.to_status='resolved' AND NEW.repair_verified IS TRUE THEN
        UPDATE public.community_issues SET status='resolved',resolved_at=NEW.created_at
        WHERE id IN (SELECT v.issue_id FROM public.community_issue_reports v WHERE v.report_id=NEW.report_id)
            AND status='open';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enclave_close_repaired_issue() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_close_repaired_issue() TO service_role;
DROP TRIGGER IF EXISTS enclave_repaired_community_issue ON public.report_status_events;
CREATE TRIGGER enclave_repaired_community_issue AFTER INSERT ON public.report_status_events
    FOR EACH ROW EXECUTE FUNCTION public.enclave_close_repaired_issue();
COMMIT;
