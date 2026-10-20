-- Apply after 020 and all 021 seed parts. Keeps existing RLS/ownership checks.
BEGIN;
-- SQL 020 added location_id after the original column-level INSERT grants.
GRANT INSERT (location_id) ON public.reports TO authenticated;

DO $$ BEGIN
 IF to_regprocedure('public.enclave_community_issues_before_places(text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.enclave_community_issues(text,jsonb) RENAME TO enclave_community_issues_before_places;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.enclave_community_issues(p_action text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actor uuid; loc public.map_locations%ROWTYPE; saved public.community_facilities%ROWTYPE; outcome jsonb;
BEGIN
 IF p_action IS DISTINCT FROM 'open_place_issue' THEN
  RETURN public.enclave_community_issues_before_places(p_action,p_args);
 END IF;
 IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('state','invalid','place_reporting_version',1); END IF;
 actor:=(p_args->>'actor_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.residents r JOIN public.profiles p ON p.id=r.profile_id
  WHERE r.profile_id=actor AND r.status='active' AND r.verified_at IS NOT NULL AND p.role IN ('resident','management')) THEN
  RETURN jsonb_build_object('state','forbidden','place_reporting_version',1);
 END IF;
 SELECT * INTO loc FROM public.map_locations WHERE id=(p_args->>'facility_id')::uuid AND active AND kind='place';
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found','place_reporting_version',1); END IF;
 IF loc.area_id<>'kl-east-pilot' OR NOT(loc.latitude BETWEEN 3.2171 AND 3.2349 AND loc.longitude BETWEEN 101.7211 AND 101.7409) THEN
  RETURN jsonb_build_object('state','invalid','place_reporting_version',1);
 END IF;
 -- Canonical registry values only. The original RPC validates evidence owner,
 -- exact 100m distance, repeat reporter counting, category and incident lifecycle.
 BEGIN
  INSERT INTO public.community_facilities(id,name,facility_type,latitude,longitude,created_by)
   VALUES(loc.id,left(loc.name,120),'other',loc.latitude,loc.longitude,actor) ON CONFLICT(id) DO NOTHING;
  SELECT * INTO saved FROM public.community_facilities WHERE id=loc.id FOR UPDATE;
  IF saved.facility_type<>'other' OR abs(saved.latitude-loc.latitude)>0.000000001 OR abs(saved.longitude-loc.longitude)>0.000000001 THEN
   outcome:=jsonb_build_object('state','conflict');RAISE no_data_found;
  END IF;
  outcome:=public.enclave_community_issues_before_places('open_issue',p_args);
  IF outcome->>'state' IS DISTINCT FROM 'ok' THEN RAISE no_data_found; END IF;
  -- Keep the full canonical place label if the facility projection was truncated.
  UPDATE public.map_locations SET name=loc.name WHERE id=loc.id AND name IS DISTINCT FROM loc.name;
  RETURN outcome || jsonb_build_object('place_reporting_version',1);
 EXCEPTION WHEN no_data_found THEN RETURN outcome || jsonb_build_object('place_reporting_version',1);
  WHEN unique_violation THEN RETURN jsonb_build_object('state','conflict','place_reporting_version',1);
 END;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('state','invalid','place_reporting_version',1);
END $$;
REVOKE ALL ON FUNCTION public.enclave_community_issues(text,jsonb),public.enclave_community_issues_before_places(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_community_issues(text,jsonb),public.enclave_community_issues_before_places(text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
