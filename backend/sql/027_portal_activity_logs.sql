-- Run after SQL 025/026. Staff history is private, immutable, and portal scoped.
-- Existing report/task events are imported once; future events log atomically.
BEGIN;
CREATE TABLE IF NOT EXISTS public.portal_activity_logs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source_key text UNIQUE,
 portal text NOT NULL CHECK(portal IN ('management','maintenance')),
 actor_id uuid NOT NULL,
 actor_name text NOT NULL,
 actor_role text NOT NULL CHECK(actor_role IN ('management','maintenance')),
 action text NOT NULL,
 target_label text NOT NULL,
 target_id text,
 result text NOT NULL CHECK(result IN ('success','failed')),
 summary text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(portal=actor_role)
);
CREATE INDEX IF NOT EXISTS enclave_activity_portal_time ON public.portal_activity_logs(portal,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS enclave_activity_actor_time ON public.portal_activity_logs(actor_id,created_at DESC,id DESC);
ALTER TABLE public.portal_activity_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.portal_activity_logs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.portal_activity_logs TO service_role;
REVOKE ALL ON SEQUENCE public.portal_activity_logs_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SEQUENCE public.portal_activity_logs_id_seq TO service_role;

-- Staff identity must follow the existing registry (legacy worker profiles may
-- have role=resident); a resident or disabled worker never receives staff logs.
CREATE OR REPLACE FUNCTION public.enclave_activity_role(p_actor uuid) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE WHEN p.role='management' THEN 'management'
  WHEN p.role IN ('resident','maintenance') AND EXISTS(
   SELECT 1 FROM public.maintenance_staff s WHERE s.profile_id=p.id AND s.active)
   AND NOT EXISTS(SELECT 1 FROM public.residents r WHERE r.profile_id=p.id)
  THEN 'maintenance' END FROM public.profiles p WHERE p.id=p_actor;
$$;

CREATE OR REPLACE FUNCTION public.enclave_activity_record(
 p_actor uuid,p_role text,p_action text,p_label text,p_target text,p_summary text,
 p_result text DEFAULT 'success',p_source text DEFAULT NULL,p_time timestamptz DEFAULT clock_timestamp())
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 INSERT INTO public.portal_activity_logs(source_key,portal,actor_id,actor_name,actor_role,action,target_label,target_id,result,summary,created_at)
 SELECT p_source,p_role,p_actor,
  coalesce(nullif(btrim(CASE WHEN p_role='maintenance' THEN s.display_name ELSE p.full_name END),''),nullif(p.email,''),initcap(p_role)),
  p_role,p_action,p_label,p_target,p_result,p_summary,p_time
 FROM public.profiles p LEFT JOIN public.maintenance_staff s ON s.profile_id=p.id WHERE p.id=p_actor
 ON CONFLICT(source_key) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION public.enclave_activity_event() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ticket text; title text;
BEGIN
 IF TG_TABLE_NAME='report_status_events' THEN
  SELECT r.ticket_id INTO ticket FROM public.reports r WHERE r.id=NEW.report_id;
  PERFORM public.enclave_activity_record(NEW.changed_by,NEW.staff_actor_role,
   'Report '||replace(NEW.to_status,'_',' '),'Report '||coalesce(ticket,NEW.report_id::text),
   coalesce(ticket,NEW.report_id::text),NEW.note,'success','report:'||NEW.id,NEW.created_at);
 ELSE
  SELECT t.title INTO title FROM public.maintenance_tasks t WHERE t.id=NEW.task_id;
  PERFORM public.enclave_activity_record(NEW.actor_id,NEW.actor_role,
   'Task '||replace(NEW.action,'_',' '),coalesce(title,'Maintenance task'),NEW.task_id::text,
   NEW.note,'success','task:'||NEW.id,NEW.created_at);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enclave_activity_report_event ON public.report_status_events;
CREATE TRIGGER enclave_activity_report_event AFTER INSERT ON public.report_status_events
 FOR EACH ROW EXECUTE FUNCTION public.enclave_activity_event();
DROP TRIGGER IF EXISTS enclave_activity_task_event ON public.maintenance_task_events;
CREATE TRIGGER enclave_activity_task_event AFTER INSERT ON public.maintenance_task_events
 FOR EACH ROW EXECUTE FUNCTION public.enclave_activity_event();

-- Preserve historical timestamps and actor roles; rerunning does not duplicate.
SELECT public.enclave_activity_record(e.changed_by,e.staff_actor_role,
 'Report '||replace(e.to_status,'_',' '),'Report '||coalesce(r.ticket_id,r.id::text),coalesce(r.ticket_id,r.id::text),
 e.note,'success','report:'||e.id,e.created_at)
FROM public.report_status_events e JOIN public.reports r ON r.id=e.report_id;
SELECT public.enclave_activity_record(e.actor_id,e.actor_role,'Task '||replace(e.action,'_',' '),
 t.title,e.task_id::text,e.note,'success','task:'||e.id,e.created_at)
FROM public.maintenance_task_events e JOIN public.maintenance_tasks t ON t.id=e.task_id;

-- Wrap the public RPCs once, retaining their transactional workflow and all
-- original checks. State rejections are logged, never request payloads/secrets.
DO $$ BEGIN
 IF to_regprocedure('public.enclave_maintenance_workflow_before_activity(text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.enclave_maintenance_workflow(text,jsonb) RENAME TO enclave_maintenance_workflow_before_activity;
 END IF;
 IF to_regprocedure('public.enclave_report_workflow_before_activity(text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.enclave_report_workflow(text,jsonb) RENAME TO enclave_report_workflow_before_activity;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.enclave_maintenance_workflow(p_action text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE output jsonb; actor uuid; staff_role text; target text;
BEGIN
 output:=public.enclave_maintenance_workflow_before_activity(p_action,p_args);
 IF p_action IN ('task_create','task_reassign','task_review','task_start','task_progress','task_blocker',
  'task_blocker_feedback','task_evidence','staff_create','staff_update','team_create') THEN
  actor:=(p_args->>'actor_id')::uuid; staff_role:=public.enclave_activity_role(actor);
  IF staff_role IS NOT NULL THEN
   target:=coalesce(p_args->>'task_id',p_args->>'profile_id',p_args->>'ticket_id',output->'team'->>'id');
   IF output->>'state'<>'ok' THEN
    PERFORM public.enclave_activity_record(actor,staff_role,replace(initcap(p_action),'_',' '),
     'Maintenance record',target,'Action was not completed ('||coalesce(output->>'state','unavailable')||').','failed');
   ELSIF p_action IN ('staff_create','staff_update','team_create') THEN
    PERFORM public.enclave_activity_record(actor,staff_role,replace(initcap(p_action),'_',' '),
     CASE WHEN p_action='team_create' THEN 'Maintenance team' ELSE 'Maintenance staff' END,target,'Staff registry updated.');
   END IF;
  END IF;
 END IF;
 RETURN output;
END $$;
CREATE OR REPLACE FUNCTION public.enclave_report_workflow(p_action text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE output jsonb; actor uuid; staff_role text;
BEGIN
 output:=public.enclave_report_workflow_before_activity(p_action,p_args);
 IF p_action='update' AND output->>'state'<>'ok' THEN
  actor:=(p_args->>'actor_id')::uuid; staff_role:=public.enclave_activity_role(actor);
  IF staff_role IS NOT NULL THEN
   PERFORM public.enclave_activity_record(actor,staff_role,'Report status update',
    'Report '||coalesce(p_args->>'ticket_id',''),p_args->>'ticket_id',
    'Action was not completed ('||coalesce(output->>'state','unavailable')||').','failed');
  END IF;
 END IF;
 RETURN output;
END $$;

CREATE OR REPLACE FUNCTION public.enclave_activity_logs(p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE actor uuid; staff_role text; scope text; n integer; skip integer; entries jsonb; more boolean;
 start_date date; end_date date; term text;
BEGIN
 actor:=(p_args->>'actor_id')::uuid; staff_role:=public.enclave_activity_role(actor); scope:=p_args->>'portal';
 IF scope IS NULL OR staff_role IS NULL OR scope<>staff_role THEN RETURN jsonb_build_object('state','forbidden'); END IF;
 n:=coalesce((p_args->>'limit')::integer,20); skip:=coalesce((p_args->>'offset')::integer,0);
 start_date:=(p_args->>'from')::date; end_date:=(p_args->>'to')::date; term:=coalesce(p_args->>'search','');
 IF n NOT BETWEEN 1 AND 100 OR skip NOT BETWEEN 0 AND 100000 OR length(term)>200 OR start_date>end_date
  OR (p_args->>'result' IS NOT NULL AND p_args->>'result' NOT IN ('success','failed')) THEN
  RETURN jsonb_build_object('state','invalid');
 END IF;
 SELECT coalesce(jsonb_agg(q.item ORDER BY q.created_at DESC,q.id DESC),'[]'::jsonb) INTO entries FROM (
  SELECT l.id,l.created_at,jsonb_build_object('id',l.id::text,'created_at',l.created_at,
   'actor_name',l.actor_name,'actor_role',l.actor_role,'action',l.action,'target_label',l.target_label,
   'target_id',l.target_id,'result',l.result,'summary',l.summary) AS item
  FROM public.portal_activity_logs l WHERE l.portal=scope AND (scope='management' OR l.actor_id=actor)
   AND (p_args->>'role' IS NULL OR l.actor_role=p_args->>'role')
   AND (p_args->>'result' IS NULL OR l.result=p_args->>'result')
   AND (start_date IS NULL OR l.created_at >= start_date::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
   AND (end_date IS NULL OR l.created_at < (end_date+1)::timestamp AT TIME ZONE 'Asia/Kuala_Lumpur')
   AND (term='' OR strpos(lower(concat_ws(' ',l.actor_name,l.action,l.target_label,l.target_id,l.summary)),lower(term))>0)
  ORDER BY l.created_at DESC,l.id DESC LIMIT n+1 OFFSET skip
 ) q;
 more:=jsonb_array_length(entries)>n; IF more THEN entries:=entries-n; END IF;
 RETURN jsonb_build_object('state','ok','items',entries,'has_more',more);
END $$;

REVOKE ALL ON FUNCTION public.enclave_activity_role(uuid),
 public.enclave_activity_record(uuid,text,text,text,text,text,text,text,timestamptz),
 public.enclave_activity_event(),public.enclave_activity_logs(jsonb),
 public.enclave_maintenance_workflow(text,jsonb),public.enclave_maintenance_workflow_before_activity(text,jsonb),
 public.enclave_report_workflow(text,jsonb),public.enclave_report_workflow_before_activity(text,jsonb)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_activity_role(uuid),
 public.enclave_activity_record(uuid,text,text,text,text,text,text,text,timestamptz),
 public.enclave_activity_event(),public.enclave_activity_logs(jsonb),
 public.enclave_maintenance_workflow(text,jsonb),public.enclave_maintenance_workflow_before_activity(text,jsonb),
 public.enclave_report_workflow(text,jsonb),public.enclave_report_workflow_before_activity(text,jsonb)
 TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
