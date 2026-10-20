-- Run after SQL 009/018. No existing reports or facilities are reassigned.
-- Catalog points are created only when an owned report is successfully linked.
-- FastAPI supplies canonical point coordinates, never arbitrary client geometry.
BEGIN;
DO $$ BEGIN
    IF to_regprocedure('public.enclave_community_issues_base(text,jsonb)') IS NULL THEN
        ALTER FUNCTION public.enclave_community_issues(text,jsonb) RENAME TO enclave_community_issues_base;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enclave_community_issues(p_action text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
    actor uuid; point_id uuid; title text; lat float8; lon float8; point jsonb;
    saved public.community_facilities%ROWTYPE;
    outcome jsonb;
BEGIN
    IF p_action IS DISTINCT FROM 'open_road_issue' THEN
        RETURN public.enclave_community_issues_base(p_action,p_args);
    END IF;
    IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('state','invalid','road_reporting_version',1); END IF;
    BEGIN
        actor:=(p_args->>'actor_id')::uuid; point:=p_args->'road_point';
        point_id:=(point->>'id')::uuid;
        title:=btrim(point->>'name');lat:=(point->>'latitude')::float8;lon:=(point->>'longitude')::float8;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
        RETURN jsonb_build_object('state','invalid','road_reporting_version',1);
    END;
    IF NOT EXISTS(SELECT 1 FROM public.residents r JOIN public.profiles p ON p.id=r.profile_id
        WHERE r.profile_id=actor AND r.status='active' AND r.verified_at IS NOT NULL AND p.role IN ('resident','management')) THEN
        RETURN jsonb_build_object('state','forbidden','road_reporting_version',1);
    END IF;
    IF point_id IS NULL OR point_id::text IS DISTINCT FROM p_args->>'facility_id'
        OR jsonb_typeof(point) IS DISTINCT FROM 'object' OR point->>'facility_type' IS DISTINCT FROM 'path_surface'
        OR title IS NULL OR length(title) NOT BETWEEN 1 AND 120 OR lat IS NULL OR lon IS NULL
        OR NOT(lat BETWEEN 3.2171 AND 3.2349 AND lon BETWEEN 101.7211 AND 101.7409) THEN
        RETURN jsonb_build_object('state','invalid','road_reporting_version',1);
    END IF;
    -- Roll back the lazily created point too when evidence ownership, distance,
    -- duplicate linkage or issue lifecycle validation fails in the original RPC.
    BEGIN
        INSERT INTO public.community_facilities(id,name,facility_type,latitude,longitude,created_by)
            VALUES(point_id,title,'path_surface',lat,lon,actor) ON CONFLICT(id) DO NOTHING;
        SELECT * INTO saved FROM public.community_facilities WHERE id=point_id FOR UPDATE;
        IF saved.name IS DISTINCT FROM title OR saved.facility_type<>'path_surface'
            OR abs(saved.latitude-lat)>0.000000001 OR abs(saved.longitude-lon)>0.000000001 THEN
            outcome:=jsonb_build_object('state','conflict','road_reporting_version',1);RAISE no_data_found;
        END IF;
        outcome:=public.enclave_community_issues_base('open_issue',p_args-'road_point');
        IF outcome->>'state' IS DISTINCT FROM 'ok' THEN RAISE no_data_found; END IF;
        RETURN outcome || jsonb_build_object('road_reporting_version',1);
    EXCEPTION WHEN no_data_found THEN RETURN outcome || jsonb_build_object('road_reporting_version',1);
        WHEN unique_violation THEN RETURN jsonb_build_object('state','conflict','road_reporting_version',1);
    END;
END;
$$;
REVOKE ALL ON FUNCTION public.enclave_community_issues(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enclave_community_issues_base(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_community_issues(text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.enclave_community_issues_base(text,jsonb) TO service_role;
COMMIT;
