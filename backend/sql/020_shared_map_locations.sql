-- Shared public geography only. Never import private saved pins or resident GPS history.
-- Requires 009, 015, 017, 018, 019. Apply 021 afterwards to load the fixed road sections.
BEGIN;
CREATE TABLE IF NOT EXISTS public.map_locations (
 id uuid PRIMARY KEY,
 area_id text NOT NULL CHECK (area_id ~ '^[a-z][a-z0-9-]{1,63}$'),
 name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 250),
 address text NOT NULL DEFAULT '' CHECK (char_length(address) <= 1000),
 latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
 longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
 kind text NOT NULL CHECK (kind IN ('place','road_section','facility')),
 source text NOT NULL CHECK (source IN ('openstreetmap','community')),
 position_basis text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_locations_area_position ON public.map_locations(area_id,latitude,longitude) WHERE active;
ALTER TABLE public.map_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_locations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.map_locations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.map_locations TO service_role;

CREATE OR REPLACE FUNCTION public.enclave_location_area(lat double precision,lon double precision)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN lat BETWEEN 3.217 AND 3.235 AND lon BETWEEN 101.721 AND 101.741 THEN 'kl-east-pilot'
 WHEN lat BETWEEN 2.999 AND 3.018 AND lon BETWEEN 101.795 AND 101.815 THEN 'kajang-prima-saujana' END
$$;
CREATE OR REPLACE FUNCTION public.enclave_location_distance(a double precision,b double precision,c double precision,d double precision)
RETURNS double precision LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT 12742000 * asin(sqrt(least(1.0, power(sin(radians(c-a)/2),2)+cos(radians(a))*cos(radians(c))*power(sin(radians(d-b)/2),2))))
$$;
REVOKE ALL ON FUNCTION public.enclave_location_area(double precision,double precision),public.enclave_location_distance(double precision,double precision,double precision,double precision) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_location_area(double precision,double precision),public.enclave_location_distance(double precision,double precision,double precision,double precision) TO service_role;

INSERT INTO public.map_locations(id,area_id,name,address,latitude,longitude,kind,source,position_basis)
 SELECT id,area_id,name,address,latitude,longitude,'place',source,position_basis FROM public.map_places
 ON CONFLICT(id) DO NOTHING;
INSERT INTO public.map_locations(id,area_id,name,latitude,longitude,kind,source,position_basis)
 SELECT id,public.enclave_location_area(latitude,longitude),name,latitude,longitude,'facility','community','Community facility point'
 FROM public.community_facilities WHERE public.enclave_location_area(latitude,longitude) IS NOT NULL
 ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.enclave_sync_map_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE area text;
BEGIN
 IF TG_OP='DELETE' THEN
  UPDATE public.map_locations SET active=false,updated_at=now() WHERE id=OLD.id;
  RETURN OLD;
 END IF;
 area:=public.enclave_location_area(NEW.latitude,NEW.longitude);
 IF TG_TABLE_NAME='map_places' THEN area:=NEW.area_id; END IF;
 IF area IS NOT NULL THEN
  INSERT INTO public.map_locations(id,area_id,name,address,latitude,longitude,kind,source,position_basis)
  VALUES(NEW.id,area,NEW.name,CASE WHEN TG_TABLE_NAME='map_places' THEN to_jsonb(NEW)->>'address' ELSE '' END,
   NEW.latitude,NEW.longitude,CASE WHEN TG_TABLE_NAME='map_places' THEN 'place' ELSE 'facility' END,
   CASE WHEN TG_TABLE_NAME='map_places' THEN 'openstreetmap' ELSE 'community' END,
   CASE WHEN TG_TABLE_NAME='map_places' THEN to_jsonb(NEW)->>'position_basis' ELSE 'Community facility point' END)
  ON CONFLICT(id) DO UPDATE SET name=excluded.name,address=excluded.address,
   latitude=excluded.latitude,longitude=excluded.longitude,area_id=excluded.area_id,active=true,updated_at=now();
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_map_location ON public.map_places;
CREATE TRIGGER sync_map_location AFTER INSERT OR UPDATE OR DELETE ON public.map_places FOR EACH ROW EXECUTE FUNCTION public.enclave_sync_map_location();
DROP TRIGGER IF EXISTS sync_map_location ON public.community_facilities;
CREATE TRIGGER sync_map_location AFTER INSERT OR UPDATE OR DELETE ON public.community_facilities FOR EACH ROW EXECUTE FUNCTION public.enclave_sync_map_location();

ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.map_locations(id) ON DELETE RESTRICT;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS location_name text;
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS location_address text;
CREATE INDEX IF NOT EXISTS reports_location ON public.reports(location_id);
CREATE OR REPLACE FUNCTION public.enclave_report_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE loc public.map_locations; dist double precision;
BEGIN
 IF TG_OP='UPDATE' AND NEW.location_id IS NOT DISTINCT FROM OLD.location_id
  AND NEW.latitude IS NOT DISTINCT FROM OLD.latitude AND NEW.longitude IS NOT DISTINCT FROM OLD.longitude
  AND (OLD.location_id IS NOT NULL OR OLD.location_name IS NOT NULL) THEN
  NEW.location_name:=OLD.location_name; NEW.location_address:=OLD.location_address; RETURN NEW;
 END IF;
 IF NEW.location_id IS NOT NULL THEN
  SELECT * INTO loc FROM public.map_locations WHERE id=NEW.location_id AND active;
  IF loc.id IS NULL OR public.enclave_location_distance(NEW.latitude,NEW.longitude,loc.latitude,loc.longitude)>100 THEN
   RAISE EXCEPTION 'Selected location must be active and within 100 metres' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO loc FROM public.map_locations l WHERE l.active
   AND l.area_id=public.enclave_location_area(NEW.latitude,NEW.longitude)
   AND l.latitude BETWEEN NEW.latitude-0.001 AND NEW.latitude+0.001
   AND l.longitude BETWEEN NEW.longitude-0.001 AND NEW.longitude+0.001
   AND public.enclave_location_distance(NEW.latitude,NEW.longitude,l.latitude,l.longitude)<=100
   ORDER BY public.enclave_location_distance(NEW.latitude,NEW.longitude,l.latitude,l.longitude),l.id LIMIT 1;
 END IF;
 dist:=public.enclave_location_distance(NEW.latitude,NEW.longitude,loc.latitude,loc.longitude);
 NEW.location_id:=loc.id;
 NEW.location_name:=CASE WHEN loc.id IS NULL THEN NULL WHEN dist<=1 THEN loc.name
  ELSE 'Near '||loc.name||' ('||round(dist)::text||' m)' END;
 NEW.location_address:=loc.address;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS resolve_report_location ON public.reports;
CREATE TRIGGER resolve_report_location BEFORE INSERT OR UPDATE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.enclave_report_location();

-- Selecting a facility/section is authoritative for grouping; preserve the photo's actual pin.
CREATE OR REPLACE FUNCTION public.enclave_link_report_location() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE fid uuid;
BEGIN
 SELECT i.facility_id INTO fid FROM public.community_issues i WHERE i.id=NEW.issue_id;
 UPDATE public.reports r SET location_id=fid WHERE r.id=NEW.report_id
  AND EXISTS(SELECT 1 FROM public.map_locations l WHERE l.id=fid AND l.active
   AND public.enclave_location_distance(r.latitude,r.longitude,l.latitude,l.longitude)<=100);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS link_report_location ON public.community_issue_reports;
CREATE TRIGGER link_report_location AFTER INSERT OR UPDATE ON public.community_issue_reports FOR EACH ROW EXECUTE FUNCTION public.enclave_link_report_location();

-- The existing mobile search URL now reads the unified registry, with its original contract.
CREATE OR REPLACE FUNCTION public.search_map_places(p_area_id text,p_query text,p_limit integer DEFAULT 8)
RETURNS TABLE(id uuid,area_id text,name text,address text,longitude double precision,latitude double precision,position_basis text,source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT l.id,l.area_id,l.name,l.address,l.longitude,l.latitude,l.position_basis,l.source
 FROM public.map_locations l WHERE l.active AND l.area_id=p_area_id
 AND char_length(btrim(p_query)) BETWEEN 2 AND 160
 AND EXISTS(SELECT 1 FROM public.residents r WHERE r.profile_id=(SELECT auth.uid()) AND r.status='active' AND r.verified_at IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM regexp_split_to_table(lower(btrim(p_query)),'[^[:alnum:]]+') token
  WHERE token<>'' AND strpos(lower(l.name||' '||l.address),token)=0)
 ORDER BY (lower(l.name)=lower(btrim(p_query))) DESC,(l.kind='place') DESC,char_length(l.name),l.name,l.id
 LIMIT greatest(1,least(coalesce(p_limit,8),8))
$$;

CREATE OR REPLACE FUNCTION public.enclave_map_locations(p_action text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; area text; lat double precision; lon double precision; rows jsonb; lim integer; offst integer; q text;
BEGIN
 -- Only the backend can execute. Internal batch labels follow an already-authorized report/task read.
 IF p_action<>'labels' THEN
  actor:=(p_args->>'actor_id')::uuid;
  IF NOT (EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND role='management')
   OR EXISTS(SELECT 1 FROM public.maintenance_staff WHERE profile_id=actor AND active)
   OR EXISTS(SELECT 1 FROM public.residents WHERE profile_id=actor AND status='active' AND verified_at IS NOT NULL)) THEN
   RETURN jsonb_build_object('state','forbidden');
  END IF;
 END IF;
 IF p_action='labels' THEN
  IF jsonb_typeof(p_args->'points')<>'array' OR jsonb_array_length(p_args->'points')>100 THEN RETURN jsonb_build_object('state','invalid'); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('location_id',coalesce(r.location_id,l.id),
   'location_name',coalesce(r.location_name,CASE WHEN l.id IS NULL THEN NULL WHEN public.enclave_location_distance((p->>'latitude')::float8,(p->>'longitude')::float8,l.latitude,l.longitude)<=1 THEN l.name
    ELSE 'Near '||l.name||' ('||round(public.enclave_location_distance((p->>'latitude')::float8,(p->>'longitude')::float8,l.latitude,l.longitude))::text||' m)' END),
   'location_address',coalesce(r.location_address,l.address)) ORDER BY ord),'[]'::jsonb) INTO rows
  FROM jsonb_array_elements(p_args->'points') WITH ORDINALITY AS input(p,ord)
  LEFT JOIN public.reports r ON r.ticket_id=p->>'ticket_id'
  LEFT JOIN LATERAL(SELECT * FROM public.map_locations m WHERE m.active
   AND m.area_id=public.enclave_location_area((p->>'latitude')::float8,(p->>'longitude')::float8)
   AND m.latitude BETWEEN (p->>'latitude')::float8-0.001 AND (p->>'latitude')::float8+0.001
   AND m.longitude BETWEEN (p->>'longitude')::float8-0.001 AND (p->>'longitude')::float8+0.001
   AND public.enclave_location_distance((p->>'latitude')::float8,(p->>'longitude')::float8,m.latitude,m.longitude)<=100
   ORDER BY public.enclave_location_distance((p->>'latitude')::float8,(p->>'longitude')::float8,m.latitude,m.longitude),m.id LIMIT 1) l ON true;
  RETURN jsonb_build_object('state','ok','items',rows);
 END IF;
 IF p_action='point' THEN
  SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) INTO rows FROM public.map_locations l WHERE l.id=(p_args->>'id')::uuid AND l.active;
  RETURN jsonb_build_object('state','ok','items',rows);
 END IF;
 area:=p_args->>'area_id'; q:=btrim(coalesce(p_args->>'query',''));
 lim:=greatest(1,least(coalesce((p_args->>'limit')::int,20),201)); offst:=greatest(0,coalesce((p_args->>'offset')::int,0));
 lat:=(p_args->>'latitude')::float8;lon:=(p_args->>'longitude')::float8;
 IF p_action NOT IN ('search','nearby','resolve','road_sections') OR (p_action='search' AND char_length(q) NOT BETWEEN 2 AND 160)
  OR (p_action<>'search' AND (lat IS NULL OR lon IS NULL OR NOT(lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180))) THEN RETURN jsonb_build_object('state','invalid'); END IF;
 IF p_action='resolve' THEN lim:=1;offst:=0; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(item)),'[]'::jsonb) INTO rows FROM (
  SELECT l.*,CASE WHEN lat IS NOT NULL THEN public.enclave_location_distance(lat,lon,l.latitude,l.longitude) END distance_meters
  FROM public.map_locations l WHERE l.active AND l.area_id=area
  AND (p_action<>'road_sections' OR l.kind='road_section')
  AND CASE WHEN p_action='search' THEN NOT EXISTS(SELECT 1 FROM regexp_split_to_table(lower(q),'[^[:alnum:]]+') token WHERE token<>'' AND strpos(lower(l.name||' '||l.address),token)=0)
   ELSE l.latitude BETWEEN lat-0.001 AND lat+0.001 AND l.longitude BETWEEN lon-0.001 AND lon+0.001 AND public.enclave_location_distance(lat,lon,l.latitude,l.longitude)<=100 END
  ORDER BY CASE WHEN p_action='search' THEN (lower(l.name)=lower(q))::int END DESC,
   CASE WHEN p_action='search' THEN (l.kind='place')::int END DESC,
   CASE WHEN p_action<>'search' THEN public.enclave_location_distance(lat,lon,l.latitude,l.longitude) END,l.name,l.id
  LIMIT lim OFFSET offst
 ) item;
 RETURN jsonb_build_object('state','ok','items',rows);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RETURN jsonb_build_object('state','invalid');
END $$;
REVOKE ALL ON FUNCTION public.enclave_sync_map_location(),public.enclave_report_location(),public.enclave_link_report_location(),public.enclave_map_locations(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_map_locations(text,jsonb) TO service_role;
DO $$ BEGIN
 IF to_regprocedure('public.enclave_what_if_snapshot(uuid)') IS NOT NULL
  AND to_regprocedure('public.enclave_what_if_snapshot_location_base(uuid)') IS NULL THEN
  ALTER FUNCTION public.enclave_what_if_snapshot(uuid) RENAME TO enclave_what_if_snapshot_location_base;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.enclave_what_if_snapshot(p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; items jsonb;
BEGIN
 result:=public.enclave_what_if_snapshot_location_base(p_actor_id);
 IF result->>'state'<>'ok' THEN RETURN result; END IF;
 SELECT coalesce(jsonb_agg(issue || jsonb_build_object('facility_name',coalesce(l.name,issue->>'facility_name')) ORDER BY ord),'[]'::jsonb)
 INTO items FROM jsonb_array_elements(result->'issues') WITH ORDINALITY AS x(issue,ord)
 LEFT JOIN public.map_locations l ON l.id=(issue->>'facility_id')::uuid;
 RETURN result || jsonb_build_object('issues',items);
END $$;
REVOKE ALL ON FUNCTION public.enclave_what_if_snapshot(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_what_if_snapshot(uuid) TO service_role;
DO $$ BEGIN
 IF to_regprocedure('public.enclave_what_if_snapshot_location_base(uuid)') IS NOT NULL THEN
  REVOKE ALL ON FUNCTION public.enclave_what_if_snapshot_location_base(uuid) FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION public.enclave_what_if_snapshot_location_base(uuid) TO service_role;
 END IF;
END $$;
COMMENT ON TABLE public.map_locations IS 'Shared location registry: public OSM places, road sections and community facilities; coordinates are references, not proof of walking access. ODbL attribution applies. No personal saved places or GPS histories.';
NOTIFY pgrst,'reload schema';
COMMIT;
