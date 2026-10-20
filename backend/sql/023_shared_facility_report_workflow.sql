-- Apply after 017, 020, 022. Shared workflows are scoped to one incident
-- and one nonempty category; resolved incidents never absorb new reports.
BEGIN;
CREATE OR REPLACE FUNCTION public.enclave_related_reports(p_report bigint)
RETURNS TABLE(id bigint) LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 WITH source AS (SELECT * FROM public.reports WHERE reports.id=p_report),
 incident AS (
  SELECT i.* FROM public.community_issues i,source s WHERE
   EXISTS(SELECT 1 FROM public.community_issue_reports v WHERE v.issue_id=i.id AND v.report_id=s.id)
   OR ((i.status='open' OR (s.status='resolved' AND s.created_at<=i.resolved_at)) AND i.facility_id=s.location_id AND NOT EXISTS(SELECT 1 FROM public.community_issue_reports v WHERE v.report_id=s.id)
    AND s.created_at >= (SELECT min(r.created_at) FROM public.community_issue_reports v JOIN public.reports r ON r.id=v.report_id WHERE v.issue_id=i.id))
 ), members AS (
  SELECT r.id FROM public.reports r,source s,incident i
  WHERE nullif(btrim(s.category),'') IS NOT NULL AND lower(btrim(r.category))=lower(btrim(s.category))
   AND r.status<>'rejected' AND (
    EXISTS(SELECT 1 FROM public.community_issue_reports v WHERE v.issue_id=i.id AND v.report_id=r.id)
    OR (r.location_id=i.facility_id AND NOT EXISTS(SELECT 1 FROM public.community_issue_reports v WHERE v.report_id=r.id)
     AND r.created_at >= (SELECT min(a.created_at) FROM public.community_issue_reports v JOIN public.reports a ON a.id=v.report_id WHERE v.issue_id=i.id)
     AND (i.resolved_at IS NULL OR r.created_at<=i.resolved_at)))
 ) SELECT p_report UNION SELECT members.id FROM members
$$;

CREATE OR REPLACE FUNCTION public.enclave_lock_report_group(p_report bigint,p_facility uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE group_key text;
BEGIN
 SELECT coalesce(p_facility,(SELECT i.facility_id FROM public.community_issue_reports v JOIN public.community_issues i ON i.id=v.issue_id WHERE v.report_id=r.id),r.location_id)::text
  ||':'||lower(btrim(r.category)) INTO group_key FROM public.reports r WHERE r.id=p_report;
 IF group_key IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(group_key,0)); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enclave_sync_related_report(p_source bigint,p_target bigint)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE original public.reports%ROWTYPE; desired text; next_status text; event public.report_status_events%ROWTYPE;
BEGIN
 IF p_source=p_target THEN RETURN; END IF;
 SELECT status INTO desired FROM public.reports WHERE id=p_source;
 IF desired NOT IN ('approved','in_progress','resolved') THEN RETURN; END IF;
 SELECT * INTO original FROM public.reports WHERE id=p_target FOR UPDATE;
 IF NOT FOUND OR original.status IN ('resolved','rejected') THEN RETURN; END IF;
 WHILE original.status IS DISTINCT FROM desired LOOP
  next_status:=CASE original.status WHEN 'pending' THEN 'approved' WHEN 'approved' THEN 'in_progress' WHEN 'in_progress' THEN 'resolved' END;
  IF next_status IS NULL OR (desired='approved' AND next_status<>'approved') OR (desired='in_progress' AND next_status='resolved') THEN RETURN; END IF;
  SELECT * INTO event FROM public.report_status_events WHERE report_id=p_source AND to_status=next_status ORDER BY id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.reports SET status=next_status,is_approved=true WHERE id=p_target;
  INSERT INTO public.report_status_events(report_id,from_status,to_status,changed_by,note,repair_verified,staff_actor_role)
   VALUES(p_target,original.status,next_status,event.changed_by,event.note,event.repair_verified,event.staff_actor_role);
  original.status:=next_status;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.enclave_sync_report_group_event() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE member bigint;
BEGIN
 IF pg_trigger_depth()>1 OR NEW.to_status NOT IN ('approved','in_progress','resolved') THEN RETURN NEW; END IF;
 FOR member IN SELECT id FROM public.enclave_related_reports(NEW.report_id) ORDER BY id LOOP
  PERFORM public.enclave_sync_related_report(NEW.report_id,member);
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS enclave_group_report_event ON public.report_status_events;
CREATE TRIGGER enclave_group_report_event AFTER INSERT ON public.report_status_events FOR EACH ROW EXECUTE FUNCTION public.enclave_sync_report_group_event();

-- One resolved category must not close a different unresolved category.
CREATE OR REPLACE FUNCTION public.enclave_close_repaired_issue() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF NEW.to_status='resolved' AND NEW.repair_verified IS TRUE THEN
  UPDATE public.community_issues i SET status='resolved',resolved_at=NEW.created_at
  WHERE i.status='open' AND EXISTS(SELECT 1 FROM public.reports source WHERE source.id=NEW.report_id AND (
    EXISTS(SELECT 1 FROM public.community_issue_reports v WHERE v.issue_id=i.id AND v.report_id=source.id)
    OR (source.location_id=i.facility_id AND NOT EXISTS(SELECT 1 FROM public.community_issue_reports v WHERE v.report_id=source.id)
      AND source.created_at >= (SELECT min(a.created_at) FROM public.community_issue_reports v JOIN public.reports a ON a.id=v.report_id WHERE v.issue_id=i.id))))
   AND NOT EXISTS(SELECT 1 FROM public.reports r WHERE r.status NOT IN ('resolved','rejected') AND (
    EXISTS(SELECT 1 FROM public.community_issue_reports v WHERE v.issue_id=i.id AND v.report_id=r.id)
    OR (r.location_id=i.facility_id AND NOT EXISTS(SELECT 1 FROM public.community_issue_reports v WHERE v.report_id=r.id)
      AND r.created_at >= (SELECT min(a.created_at) FROM public.community_issue_reports v JOIN public.reports a ON a.id=v.report_id WHERE v.issue_id=i.id)
      AND r.created_at<=NEW.created_at)));
 END IF;
 RETURN NEW;
END $$;

DO $$ BEGIN
 IF to_regprocedure('public.enclave_report_workflow_before_groups(text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.enclave_report_workflow(text,jsonb) RENAME TO enclave_report_workflow_before_groups;
 END IF;
 IF to_regprocedure('public.enclave_community_issues_before_groups(text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.enclave_community_issues(text,jsonb) RENAME TO enclave_community_issues_before_groups;
 END IF;
 IF to_regprocedure('public.enclave_maintenance_workflow_before_groups(text,jsonb)') IS NULL THEN
  ALTER FUNCTION public.enclave_maintenance_workflow(text,jsonb) RENAME TO enclave_maintenance_workflow_before_groups;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.enclave_report_workflow(p_action text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE report bigint; t public.maintenance_tasks%ROWTYPE;
BEGIN
 IF p_action='update' THEN
  SELECT id INTO report FROM public.reports WHERE ticket_id=p_args->>'ticket_id';
  PERFORM public.enclave_lock_report_group(report);
  SELECT * INTO t FROM public.maintenance_tasks WHERE report_id IN(SELECT id FROM public.enclave_related_reports(report)) LIMIT 1;
  IF FOUND AND ((p_args->>'status'='resolved' AND t.status<>'resolved') OR (p_args->>'status'='in_progress' AND t.status='assigned')) THEN RETURN jsonb_build_object('state','conflict'); END IF;
 END IF;
 RETURN public.enclave_report_workflow_before_groups(p_action,p_args);
END $$;

CREATE OR REPLACE FUNCTION public.enclave_community_issues(p_action text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE report bigint; facility uuid; source bigint; outcome jsonb;
BEGIN
 IF p_action IN ('open_issue','open_road_issue','open_place_issue','report_issue') THEN
  SELECT id INTO report FROM public.reports WHERE ticket_id=p_args->>'report_ticket_id';
  facility:=coalesce((p_args->>'facility_id')::uuid,(SELECT facility_id FROM public.community_issues WHERE id=(p_args->>'issue_id')::uuid));
  PERFORM public.enclave_lock_report_group(report,facility);
 END IF;
 outcome:=public.enclave_community_issues_before_groups(p_action,p_args);
 IF report IS NOT NULL AND outcome->>'state'='ok' THEN
  SELECT r.id INTO source FROM public.reports r JOIN public.enclave_related_reports(report) g ON g.id=r.id
   WHERE r.status IN ('approved','in_progress') AND EXISTS(SELECT 1 FROM public.report_status_events e WHERE e.report_id=r.id AND e.to_status='approved')
   ORDER BY CASE r.status WHEN 'in_progress' THEN 2 ELSE 1 END DESC,r.id LIMIT 1;
  IF source IS NOT NULL THEN PERFORM public.enclave_sync_related_report(source,report); END IF;
 END IF;
 RETURN outcome;
END $$;

CREATE OR REPLACE FUNCTION public.enclave_maintenance_workflow(p_action text,p_args jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE report bigint; existing uuid;
BEGIN
 IF p_action='task_create' THEN
  SELECT id INTO report FROM public.reports WHERE ticket_id=p_args->>'ticket_id';
 ELSE
  SELECT report_id INTO report FROM public.maintenance_tasks WHERE id=(p_args->>'task_id')::uuid;
 END IF;
 IF report IS NOT NULL THEN PERFORM public.enclave_lock_report_group(report); END IF;
 IF p_action='task_create' AND EXISTS(SELECT 1 FROM public.profiles WHERE id=(p_args->>'actor_id')::uuid AND role='management') THEN
  SELECT id INTO existing FROM public.maintenance_tasks WHERE report_id<>report AND report_id IN(SELECT id FROM public.enclave_related_reports(report)) ORDER BY created_at,id LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('state','ok','task',public.enclave_maintenance_task_projection(existing)); END IF;
 END IF;
 RETURN public.enclave_maintenance_workflow_before_groups(p_action,p_args);
END $$;

CREATE OR REPLACE FUNCTION public.enclave_maintenance_task_projection(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT (to_jsonb(t)-'report_id') || jsonb_build_object('ticket_id',r.ticket_id,'description',r.description,
  'latitude',r.latitude,'longitude',r.longitude,'before_photo_url',r.image_url,'report_status',r.status,
  'related_ticket_ids',(SELECT coalesce(jsonb_agg(member.ticket_id ORDER BY member.id),'[]'::jsonb) FROM public.reports member JOIN public.enclave_related_reports(r.id) g ON g.id=member.id))
 FROM public.maintenance_tasks t JOIN public.reports r ON r.id=t.report_id WHERE t.id=p_id
$$;

REVOKE ALL ON FUNCTION public.enclave_related_reports(bigint),public.enclave_lock_report_group(bigint,uuid),public.enclave_sync_related_report(bigint,bigint),public.enclave_sync_report_group_event(),
 public.enclave_report_workflow(text,jsonb),public.enclave_report_workflow_before_groups(text,jsonb),public.enclave_community_issues(text,jsonb),public.enclave_community_issues_before_groups(text,jsonb),
 public.enclave_maintenance_workflow(text,jsonb),public.enclave_maintenance_workflow_before_groups(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_related_reports(bigint),public.enclave_lock_report_group(bigint,uuid),public.enclave_sync_related_report(bigint,bigint),public.enclave_sync_report_group_event(),
 public.enclave_report_workflow(text,jsonb),public.enclave_report_workflow_before_groups(text,jsonb),public.enclave_community_issues(text,jsonb),public.enclave_community_issues_before_groups(text,jsonb),
 public.enclave_maintenance_workflow(text,jsonb),public.enclave_maintenance_workflow_before_groups(text,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
