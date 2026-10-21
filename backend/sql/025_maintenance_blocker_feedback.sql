-- Run after SQL 023/024. Adds management replies without changing report groups.
BEGIN;
CREATE TABLE IF NOT EXISTS public.maintenance_blocker_responses (
 blocker_event_id bigint PRIMARY KEY REFERENCES public.maintenance_task_events(id) ON DELETE RESTRICT,
 response_event_id bigint NOT NULL UNIQUE REFERENCES public.maintenance_task_events(id) ON DELETE RESTRICT,
 previous_target_date date NOT NULL,
 target_date date NOT NULL
);
ALTER TABLE public.maintenance_blocker_responses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.maintenance_blocker_responses FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.maintenance_blocker_responses TO service_role;

DO $$ BEGIN
 IF to_regprocedure('public.enclave_maintenance_workflow_before_blocker_feedback(text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.enclave_maintenance_workflow(text,jsonb) RENAME TO enclave_maintenance_workflow_before_blocker_feedback;
 END IF;
 IF to_regprocedure('public.enclave_maintenance_task_projection_before_blocker_feedback(uuid)') IS NULL THEN
  ALTER FUNCTION public.enclave_maintenance_task_projection(uuid) RENAME TO enclave_maintenance_task_projection_before_blocker_feedback;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enclave_maintenance_task_projection(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT public.enclave_maintenance_task_projection_before_blocker_feedback(p_id) || jsonb_build_object(
  'pending_blocker',(SELECT jsonb_build_object('id',e.id,'note',e.note,'created_at',e.created_at)
   FROM public.maintenance_task_events e WHERE e.task_id=p_id AND e.action='blocker' AND e.actor_role='maintenance'
    AND NOT EXISTS(SELECT 1 FROM public.maintenance_blocker_responses a WHERE a.blocker_event_id=e.id)
   ORDER BY e.id LIMIT 1),
  'pending_blocker_count',(SELECT count(*) FROM public.maintenance_task_events e WHERE e.task_id=p_id AND e.action='blocker' AND e.actor_role='maintenance'
    AND NOT EXISTS(SELECT 1 FROM public.maintenance_blocker_responses a WHERE a.blocker_event_id=e.id)))
$$;

CREATE OR REPLACE FUNCTION public.enclave_maintenance_workflow(p_action text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actor uuid; t public.maintenance_tasks%ROWTYPE; report bigint; blocker bigint; event_id bigint;
 feedback text; new_date date; message text; change_date boolean;
BEGIN
 IF p_action IS DISTINCT FROM 'task_blocker_feedback' THEN
  RETURN public.enclave_maintenance_workflow_before_blocker_feedback(p_action,p_args);
 END IF;
 IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('state','invalid'); END IF;
 actor:=(p_args->>'actor_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=actor AND role='management') THEN RETURN jsonb_build_object('state','forbidden'); END IF;
 feedback:=btrim(p_args->>'notes');blocker:=(p_args->>'blocker_event_id')::bigint;
 IF feedback IS NULL OR length(feedback) NOT BETWEEN 1 AND 2000 OR blocker IS NULL OR blocker<1
  OR jsonb_typeof(p_args->'change_due_date') IS DISTINCT FROM 'boolean'
  OR jsonb_typeof(p_args->'expected_version') IS DISTINCT FROM 'number' THEN RETURN jsonb_build_object('state','invalid'); END IF;
 change_date:=(p_args->>'change_due_date')::boolean;
 IF change_date AND coalesce(p_args->>'target_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RETURN jsonb_build_object('state','invalid'); END IF;
 IF NOT change_date AND p_args->>'target_date' IS NOT NULL THEN RETURN jsonb_build_object('state','invalid'); END IF;
 SELECT report_id INTO report FROM public.maintenance_tasks WHERE id=(p_args->>'task_id')::uuid;
 IF report IS NOT NULL AND to_regprocedure('public.enclave_lock_report_group(bigint,uuid)') IS NOT NULL THEN
  PERFORM public.enclave_lock_report_group(report);
 END IF;
 SELECT * INTO t FROM public.maintenance_tasks WHERE id=(p_args->>'task_id')::uuid FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
 IF t.status='resolved' OR t.version IS DISTINCT FROM (p_args->>'expected_version')::integer THEN RETURN jsonb_build_object('state','conflict'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.maintenance_task_events e WHERE e.id=blocker AND e.task_id=t.id AND e.action='blocker' AND e.actor_role='maintenance') THEN RETURN jsonb_build_object('state','not_found'); END IF;
 IF EXISTS(SELECT 1 FROM public.maintenance_blocker_responses WHERE blocker_event_id=blocker) THEN RETURN jsonb_build_object('state','conflict'); END IF;
 new_date:=CASE WHEN change_date THEN (p_args->>'target_date')::date ELSE t.target_date END;
 IF new_date IS NULL OR (change_date AND new_date=t.target_date) THEN RETURN jsonb_build_object('state','invalid'); END IF;
 message:='Feedback for blocker #' || blocker || E'\n' || feedback || E'\n' ||
  CASE WHEN change_date THEN 'Due date changed: ' || t.target_date || ' to ' || new_date ELSE 'Due date unchanged: ' || t.target_date END;
 INSERT INTO public.maintenance_task_events(task_id,action,actor_id,actor_role,note)
  VALUES(t.id,'blocker_feedback',actor,'management',message) RETURNING id INTO event_id;
 INSERT INTO public.maintenance_blocker_responses(blocker_event_id,response_event_id,previous_target_date,target_date)
  VALUES(blocker,event_id,t.target_date,new_date);
 UPDATE public.maintenance_tasks SET target_date=new_date,version=version+1,updated_at=clock_timestamp() WHERE id=t.id;
 PERFORM public.enclave_maintenance_notify(t.id,false,'Management replied to blocker',message);
 RETURN jsonb_build_object('state','ok','task',public.enclave_maintenance_task_projection(t.id));
END $$;

REVOKE ALL ON FUNCTION public.enclave_maintenance_workflow(text,jsonb),public.enclave_maintenance_workflow_before_blocker_feedback(text,jsonb),
 public.enclave_maintenance_task_projection(uuid),public.enclave_maintenance_task_projection_before_blocker_feedback(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_maintenance_workflow(text,jsonb),public.enclave_maintenance_workflow_before_blocker_feedback(text,jsonb),
 public.enclave_maintenance_task_projection(uuid),public.enclave_maintenance_task_projection_before_blocker_feedback(uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
