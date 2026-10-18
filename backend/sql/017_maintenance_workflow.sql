-- Run manually after SQL 007 and 009. No Auth accounts, passwords or email are created.
-- Maintenance identity is an admin-managed registry, independent of the legacy
-- profiles.role CHECK/enum. This avoids broadening resident profile write policies.
BEGIN;

CREATE TABLE IF NOT EXISTS public.maintenance_teams (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE CHECK(length(btrim(name)) BETWEEN 1 AND 100),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.maintenance_staff (
    profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE RESTRICT,
    email text NOT NULL,
    display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 100),
    team_id uuid REFERENCES public.maintenance_teams(id) ON DELETE RESTRICT,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS enclave_maintenance_staff_team ON public.maintenance_staff(team_id) WHERE active;
CREATE TABLE IF NOT EXISTS public.maintenance_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id bigint NOT NULL UNIQUE REFERENCES public.reports(id) ON DELETE RESTRICT,
    title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
    instructions text NOT NULL CHECK(length(btrim(instructions)) BETWEEN 1 AND 2000),
    priority text NOT NULL CHECK(priority IN ('low','medium','high')),
    target_date date NOT NULL,
    assigned_staff_id uuid REFERENCES public.maintenance_staff(profile_id) ON DELETE RESTRICT,
    assigned_team_id uuid REFERENCES public.maintenance_teams(id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','in_progress','awaiting_verification','changes_requested','resolved')),
    version integer NOT NULL DEFAULT 1 CHECK(version>0),
    work_notes text NOT NULL DEFAULT '',
    completion_notes text NOT NULL DEFAULT '',
    after_photo_url text,
    checked_on_site boolean NOT NULL DEFAULT false,
    review_note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK ((assigned_staff_id IS NULL) <> (assigned_team_id IS NULL)),
    CHECK(status NOT IN ('awaiting_verification','resolved') OR
          (after_photo_url IS NOT NULL AND checked_on_site AND length(btrim(completion_notes))>0))
);
CREATE INDEX IF NOT EXISTS enclave_maintenance_task_staff ON public.maintenance_tasks(assigned_staff_id,status);
CREATE INDEX IF NOT EXISTS enclave_maintenance_task_team ON public.maintenance_tasks(assigned_team_id,status);
CREATE TABLE IF NOT EXISTS public.maintenance_task_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id uuid NOT NULL REFERENCES public.maintenance_tasks(id) ON DELETE RESTRICT,
    action text NOT NULL,
    actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    actor_role text NOT NULL CHECK(actor_role IN ('management','maintenance')),
    note text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS enclave_maintenance_events_task ON public.maintenance_task_events(task_id,id);
CREATE TABLE IF NOT EXISTS public.maintenance_evidence (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid NOT NULL REFERENCES public.maintenance_tasks(id) ON DELETE RESTRICT,
    submitted_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    photo_url text NOT NULL,
    notes text NOT NULL CHECK(length(btrim(notes)) BETWEEN 1 AND 2000),
    checked_on_site boolean NOT NULL CHECK(checked_on_site),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS public.maintenance_notifications (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    task_id uuid NOT NULL REFERENCES public.maintenance_tasks(id) ON DELETE RESTRICT,
    title text NOT NULL,
    message text NOT NULL,
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS enclave_maintenance_notifications_recipient ON public.maintenance_notifications(recipient_id,id DESC);

ALTER TABLE public.maintenance_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.maintenance_teams,public.maintenance_staff,public.maintenance_tasks,
    public.maintenance_task_events,public.maintenance_evidence,public.maintenance_notifications FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.maintenance_teams,public.maintenance_staff,public.maintenance_tasks,
    public.maintenance_notifications TO service_role;
GRANT SELECT,INSERT ON public.maintenance_task_events,public.maintenance_evidence TO service_role;
REVOKE ALL ON SEQUENCE public.maintenance_task_events_id_seq,public.maintenance_notifications_id_seq FROM PUBLIC,anon,authenticated,service_role;
GRANT USAGE ON SEQUENCE public.maintenance_task_events_id_seq,public.maintenance_notifications_id_seq TO service_role;
GRANT SELECT(id,email,email_confirmed_at) ON auth.users TO service_role;
GRANT INSERT(id,email,full_name,role) ON public.profiles TO service_role;

-- Avoid the legacy RPC's local variable named actor_role.
ALTER TABLE public.report_status_events ADD COLUMN IF NOT EXISTS staff_actor_role text NOT NULL DEFAULT 'management'
    CHECK(staff_actor_role IN ('management','maintenance'));

CREATE OR REPLACE FUNCTION public.enclave_maintenance_task_projection(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
    SELECT (to_jsonb(t)-'report_id') || jsonb_build_object('ticket_id',r.ticket_id,
        'description',r.description,'latitude',r.latitude,'longitude',r.longitude,
        'before_photo_url',r.image_url,'report_status',r.status)
    FROM public.maintenance_tasks t JOIN public.reports r ON r.id=t.report_id WHERE t.id=p_id;
$$;
CREATE OR REPLACE FUNCTION public.enclave_maintenance_notify(p_id uuid,p_managers boolean,p_title text,p_message text)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
    INSERT INTO public.maintenance_notifications(recipient_id,task_id,title,message)
    SELECT p.id,p_id,p_title,p_message FROM public.profiles p
    WHERE (p_managers AND p.role='management') OR (NOT p_managers AND EXISTS(
        SELECT 1 FROM public.maintenance_staff s JOIN public.maintenance_tasks t ON t.id=p_id
        WHERE s.profile_id=p.id AND s.active AND
              (s.profile_id=t.assigned_staff_id OR s.team_id=t.assigned_team_id)));
$$;
REVOKE ALL ON FUNCTION public.enclave_maintenance_task_projection(uuid),
    public.enclave_maintenance_notify(uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_maintenance_task_projection(uuid),
    public.enclave_maintenance_notify(uuid,boolean,text,text) TO service_role;

-- Keep the existing report RPC, including its verified-repair/incident trigger.
-- The wrapper prevents a legacy status PATCH from bypassing task evidence/review.
DO $$ BEGIN
    IF to_regprocedure('public.enclave_report_workflow_before_maintenance(text,jsonb)') IS NULL THEN
        ALTER FUNCTION public.enclave_report_workflow(text,jsonb) RENAME TO enclave_report_workflow_before_maintenance;
    END IF;
END $$;
CREATE OR REPLACE FUNCTION public.enclave_report_workflow(p_action text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t public.maintenance_tasks%ROWTYPE; result jsonb; entries jsonb;
BEGIN
    IF p_action='update' AND p_args->>'status' IN ('in_progress','resolved')
       AND EXISTS(SELECT 1 FROM public.profiles WHERE id=(p_args->>'actor_id')::uuid AND role='management') THEN
        SELECT m.* INTO t FROM public.maintenance_tasks m JOIN public.reports r ON r.id=m.report_id
        WHERE r.ticket_id=p_args->>'ticket_id' FOR UPDATE OF m;
        IF FOUND AND ((p_args->>'status'='resolved' AND t.status<>'resolved') OR
                      (p_args->>'status'='in_progress' AND t.status='assigned')) THEN
            RETURN jsonb_build_object('state','conflict');
        END IF;
    END IF;
    result:=public.enclave_report_workflow_before_maintenance(p_action,p_args);
    IF p_action='history' AND result->>'state'='ok' THEN
        SELECT coalesce(jsonb_agg(e || jsonb_build_object('actor_role',s.staff_actor_role) ORDER BY (e->>'id')::bigint),'[]'::jsonb)
        INTO entries FROM jsonb_array_elements(result->'items') e JOIN public.report_status_events s ON s.id=(e->>'id')::bigint;
        result:=jsonb_set(result,'{items}',entries);
    END IF;
    RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.enclave_report_workflow(text,jsonb),
    public.enclave_report_workflow_before_maintenance(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_report_workflow(text,jsonb),
    public.enclave_report_workflow_before_maintenance(text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.enclave_maintenance_workflow(p_action text,p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
    actor uuid; actor_role text; profile_role text; staff public.maintenance_staff%ROWTYPE;
    t public.maintenance_tasks%ROWTYPE; r public.reports%ROWTYPE;
    staff_id uuid; v_team uuid; recipient uuid; entries jsonb; result jsonb;
    n integer; page_offset integer; expected integer; more boolean; note text; event_action text;
    registered_email text; confirmed timestamptz;
BEGIN
    IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('state','invalid'); END IF;
    actor:=(p_args->>'actor_id')::uuid;
    SELECT role INTO profile_role FROM public.profiles WHERE id=actor;
    IF profile_role='management' THEN actor_role:='management';
    ELSE
        SELECT * INTO staff FROM public.maintenance_staff WHERE profile_id=actor FOR SHARE;
        IF NOT FOUND OR NOT staff.active OR profile_role IS NULL OR profile_role NOT IN ('resident','maintenance') OR
           EXISTS(SELECT 1 FROM public.residents WHERE profile_id=actor) THEN
            RETURN jsonb_build_object('state','forbidden');
        END IF;
        actor_role:='maintenance';
    END IF;
    IF actor_role IS NULL THEN RETURN jsonb_build_object('state','forbidden'); END IF;
    IF p_action='identity' THEN
        RETURN jsonb_build_object('state','ok','identity',jsonb_build_object('user_id',actor,'role',actor_role,
            'display_name',CASE WHEN actor_role='maintenance' THEN staff.display_name ELSE 'Management' END,
            'team_id',staff.team_id));
    END IF;
    IF p_action IN ('staff_list','staff_create','staff_update','team_list','team_create','task_create','task_reassign','task_review','management_list','management_get','management_history')
       AND actor_role<>'management' THEN RETURN jsonb_build_object('state','forbidden'); END IF;
    n:=coalesce((p_args->>'limit')::integer,20); page_offset:=coalesce((p_args->>'offset')::integer,0);
    IF n NOT BETWEEN 1 AND 100 OR page_offset<0 THEN RETURN jsonb_build_object('state','invalid'); END IF;
    IF p_action='team_create' THEN
        IF length(btrim(p_args->>'name')) NOT BETWEEN 1 AND 100 THEN RETURN jsonb_build_object('state','invalid'); END IF;
        IF EXISTS(SELECT 1 FROM public.maintenance_teams WHERE name=btrim(p_args->>'name')) THEN RETURN jsonb_build_object('state','conflict'); END IF;
        INSERT INTO public.maintenance_teams(name) VALUES(btrim(p_args->>'name')) RETURNING to_jsonb(maintenance_teams.*) INTO result;
        RETURN jsonb_build_object('state','ok','team',result);
    END IF;
    IF p_action IN ('team_list','staff_list') THEN
        IF p_action='team_list' THEN
            SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO entries FROM
                (SELECT * FROM public.maintenance_teams ORDER BY created_at,id LIMIT n+1 OFFSET page_offset) q;
        ELSE
            SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.profile_id),'[]'::jsonb) INTO entries FROM
                (SELECT * FROM public.maintenance_staff ORDER BY created_at,profile_id LIMIT n+1 OFFSET page_offset) q;
        END IF;
        more:=jsonb_array_length(entries)>n; IF more THEN entries:=entries-n; END IF;
        RETURN jsonb_build_object('state','ok','items',entries,'has_more',more);
    END IF;
    IF p_action IN ('staff_create','staff_update') THEN
        staff_id:=(p_args->>'profile_id')::uuid;
        IF EXISTS(SELECT 1 FROM public.residents WHERE profile_id=staff_id) OR
           EXISTS(SELECT 1 FROM public.profiles WHERE id=staff_id AND role='management') THEN
            RETURN jsonb_build_object('state','conflict');
        END IF;
        v_team:=(p_args->>'team_id')::uuid;
        IF v_team IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.maintenance_teams WHERE id=v_team) THEN RETURN jsonb_build_object('state','not_found'); END IF;
        IF p_action='staff_create' THEN
            SELECT lower(btrim(email)),email_confirmed_at INTO registered_email,confirmed FROM auth.users WHERE id=staff_id;
            IF NOT FOUND OR confirmed IS NULL OR registered_email IS DISTINCT FROM lower(btrim(p_args->>'email')) THEN RETURN jsonb_build_object('state','invalid'); END IF;
            IF EXISTS(SELECT 1 FROM public.maintenance_staff WHERE profile_id=staff_id) THEN RETURN jsonb_build_object('state','conflict'); END IF;
            IF EXISTS(SELECT 1 FROM public.profiles WHERE id=staff_id AND lower(btrim(email)) IS DISTINCT FROM registered_email) THEN RETURN jsonb_build_object('state','conflict'); END IF;
            INSERT INTO public.profiles(id,email,full_name,role) VALUES(staff_id,registered_email,p_args->>'display_name','resident') ON CONFLICT(id) DO NOTHING;
            INSERT INTO public.maintenance_staff(profile_id,email,display_name,team_id)
                VALUES(staff_id,registered_email,p_args->>'display_name',v_team) RETURNING * INTO staff;
        ELSE
            UPDATE public.maintenance_staff SET
                display_name=CASE WHEN p_args ? 'display_name' THEN p_args->>'display_name' ELSE display_name END,
                active=CASE WHEN p_args ? 'active' THEN (p_args->>'active')::boolean ELSE active END,
                team_id=CASE WHEN p_args ? 'team_id' THEN v_team ELSE maintenance_staff.team_id END
                WHERE profile_id=staff_id RETURNING * INTO staff;
            IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
        END IF;
        RETURN jsonb_build_object('state','ok','staff',to_jsonb(staff));
    END IF;
    IF p_action IN ('notifications','notification_read') THEN
        IF p_action='notification_read' THEN
            UPDATE public.maintenance_notifications SET is_read=true WHERE id=(p_args->>'notification_id')::bigint AND recipient_id=actor;
            IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
            RETURN jsonb_build_object('state','ok');
        END IF;
        SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id DESC),'[]'::jsonb) INTO entries FROM
            (SELECT id,task_id,title,message,is_read,created_at FROM public.maintenance_notifications WHERE recipient_id=actor ORDER BY id DESC LIMIT n+1 OFFSET page_offset) q;
        more:=jsonb_array_length(entries)>n; IF more THEN entries:=entries-n; END IF;
        RETURN jsonb_build_object('state','ok','items',entries,'has_more',more);
    END IF;
    IF p_action IN ('task_list','management_list') THEN
        SELECT coalesce(jsonb_agg(q.item ORDER BY q.created_at DESC,q.id),'[]'::jsonb) INTO entries FROM (
            SELECT m.id,m.created_at,public.enclave_maintenance_task_projection(m.id) item FROM public.maintenance_tasks m
            WHERE (p_action='management_list' OR m.assigned_staff_id=actor OR m.assigned_team_id=staff.team_id)
              AND (p_args->>'status' IS NULL OR m.status=p_args->>'status')
            ORDER BY m.created_at DESC,m.id LIMIT n+1 OFFSET page_offset) q;
        more:=jsonb_array_length(entries)>n; IF more THEN entries:=entries-n; END IF;
        RETURN jsonb_build_object('state','ok','items',entries,'has_more',more);
    END IF;
    IF p_action='task_create' THEN
        IF EXISTS(SELECT 1 FROM public.maintenance_tasks m JOIN public.reports x ON x.id=m.report_id
                  WHERE x.ticket_id=p_args->>'ticket_id') THEN RETURN jsonb_build_object('state','conflict'); END IF;
        SELECT * INTO r FROM public.reports WHERE ticket_id=p_args->>'ticket_id' FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('state','not_found'); END IF;
        IF r.status NOT IN ('approved','in_progress') OR NOT r.is_approved OR
           EXISTS(SELECT 1 FROM public.maintenance_tasks WHERE report_id=r.id) THEN RETURN jsonb_build_object('state','conflict'); END IF;
    ELSE
        SELECT * INTO t FROM public.maintenance_tasks WHERE id=(p_args->>'task_id')::uuid FOR UPDATE;
        IF NOT FOUND OR (actor_role<>'management' AND t.assigned_staff_id IS DISTINCT FROM actor
            AND (staff.team_id IS NULL OR t.assigned_team_id IS DISTINCT FROM staff.team_id)) THEN RETURN jsonb_build_object('state','not_found'); END IF;
        IF p_action IN ('task_get','management_get') THEN RETURN jsonb_build_object('state','ok','task',public.enclave_maintenance_task_projection(t.id)); END IF;
        IF p_action IN ('task_history','management_history') THEN
            SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.id),'[]'::jsonb) INTO entries FROM
                (SELECT * FROM public.maintenance_task_events WHERE task_id=t.id ORDER BY id LIMIT n+1 OFFSET page_offset) q;
            more:=jsonb_array_length(entries)>n; IF more THEN entries:=entries-n; END IF;
            RETURN jsonb_build_object('state','ok','items',entries,'has_more',more);
        END IF;
        expected:=(p_args->>'expected_version')::integer;
        IF expected IS NULL OR expected<>t.version OR t.status='resolved' THEN RETURN jsonb_build_object('state','conflict'); END IF;
    END IF;
    IF p_action IN ('task_create','task_reassign') THEN
        staff_id:=(p_args->>'assigned_staff_id')::uuid; v_team:=(p_args->>'assigned_team_id')::uuid;
        IF (staff_id IS NULL)=(v_team IS NULL) THEN RETURN jsonb_build_object('state','invalid'); END IF;
        IF staff_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.maintenance_staff s WHERE s.profile_id=staff_id AND s.active
             AND NOT EXISTS(SELECT 1 FROM public.residents WHERE profile_id=staff_id)) THEN RETURN jsonb_build_object('state','invalid'); END IF;
        IF v_team IS NOT NULL AND (NOT EXISTS(SELECT 1 FROM public.maintenance_teams WHERE id=v_team) OR
            NOT EXISTS(SELECT 1 FROM public.maintenance_staff s WHERE s.team_id=v_team AND s.active)) THEN RETURN jsonb_build_object('state','invalid'); END IF;
        IF p_action='task_create' THEN
            INSERT INTO public.maintenance_tasks(report_id,title,instructions,priority,target_date,assigned_staff_id,assigned_team_id)
                VALUES(r.id,p_args->>'title',p_args->>'instructions',p_args->>'priority',(p_args->>'target_date')::date,staff_id,v_team) RETURNING * INTO t;
            note:=p_args->>'instructions'; event_action:='assigned';
        ELSE
            IF t.status NOT IN ('assigned','in_progress','changes_requested') THEN RETURN jsonb_build_object('state','conflict'); END IF;
            UPDATE public.maintenance_tasks SET assigned_staff_id=staff_id,assigned_team_id=v_team,version=version+1,updated_at=clock_timestamp() WHERE id=t.id RETURNING * INTO t;
            note:=p_args->>'note'; event_action:='reassigned';
        END IF;
        PERFORM public.enclave_maintenance_notify(t.id,false,'Task assigned',t.title);
    ELSIF p_action IN ('task_start','task_progress','task_blocker','evidence_access','task_evidence') THEN
        IF actor_role<>'maintenance' THEN RETURN jsonb_build_object('state','forbidden'); END IF;
        IF p_action='task_start' THEN
            IF t.status NOT IN ('assigned','changes_requested') THEN RETURN jsonb_build_object('state','conflict'); END IF;
            SELECT * INTO r FROM public.reports WHERE id=t.report_id FOR UPDATE;
            IF r.status NOT IN ('approved','in_progress') THEN RETURN jsonb_build_object('state','conflict'); END IF;
            UPDATE public.maintenance_tasks SET status='in_progress',version=version+1,updated_at=clock_timestamp() WHERE id=t.id RETURNING * INTO t;
            IF r.status='approved' THEN
                UPDATE public.reports SET status='in_progress',is_approved=true WHERE id=r.id;
                INSERT INTO public.report_status_events(report_id,from_status,to_status,changed_by,note,repair_verified,staff_actor_role)
                    VALUES(r.id,'approved','in_progress',actor,'Assigned maintenance staff started repair work.',false,'maintenance');
            END IF;
            note:='Work started'; event_action:='started';
        ELSE
            IF t.status NOT IN ('in_progress','changes_requested') THEN RETURN jsonb_build_object('state','conflict'); END IF;
            IF p_action='evidence_access' THEN RETURN jsonb_build_object('state','ok','task',public.enclave_maintenance_task_projection(t.id)); END IF;
            note:=p_args->>'notes';
            IF p_action='task_progress' THEN
                UPDATE public.maintenance_tasks SET work_notes=note,version=version+1,updated_at=clock_timestamp() WHERE id=t.id RETURNING * INTO t;
                event_action:='progress';
            ELSIF p_action='task_blocker' THEN
                IF p_args->>'blocker_type' NOT IN ('parts','access','safety','other') THEN RETURN jsonb_build_object('state','invalid'); END IF;
                note:=(p_args->>'blocker_type') || ': ' || note;
                UPDATE public.maintenance_tasks SET work_notes=note,version=version+1,updated_at=clock_timestamp() WHERE id=t.id RETURNING * INTO t;
                event_action:='blocker';
                PERFORM public.enclave_maintenance_notify(t.id,true,'Task blocked',t.title);
            ELSE
                IF p_args->'checked_on_site' IS DISTINCT FROM 'true'::jsonb OR nullif(p_args->>'photo_url','') IS NULL THEN RETURN jsonb_build_object('state','invalid'); END IF;
                INSERT INTO public.maintenance_evidence(task_id,submitted_by,photo_url,notes,checked_on_site) VALUES(t.id,actor,p_args->>'photo_url',note,true);
                UPDATE public.maintenance_tasks SET completion_notes=note,after_photo_url=p_args->>'photo_url',checked_on_site=true,
                    status='awaiting_verification',version=version+1,updated_at=clock_timestamp() WHERE id=t.id RETURNING * INTO t;
                event_action:='submitted';
                PERFORM public.enclave_maintenance_notify(t.id,true,'Repair awaiting verification',t.title);
            END IF;
        END IF;
    ELSIF p_action='task_review' THEN
        IF t.status<>'awaiting_verification' THEN RETURN jsonb_build_object('state','conflict'); END IF;
        note:=p_args->>'note';
        IF p_args->>'decision'='rework' AND p_args->'repair_verified'='false'::jsonb THEN
            UPDATE public.maintenance_tasks SET status='changes_requested',review_note=note,version=version+1,updated_at=clock_timestamp() WHERE id=t.id RETURNING * INTO t;
            event_action:='rework';
            PERFORM public.enclave_maintenance_notify(t.id,false,'Changes requested',t.title);
        ELSIF p_args->>'decision'='approve' AND p_args->'repair_verified'='true'::jsonb AND nullif(btrim(p_args->>'public_note'),'') IS NOT NULL THEN
            SELECT * INTO r FROM public.reports WHERE id=t.report_id FOR UPDATE;
            IF r.status<>'in_progress' THEN RETURN jsonb_build_object('state','conflict'); END IF;
            UPDATE public.maintenance_tasks SET status='resolved',review_note=note,version=version+1,updated_at=clock_timestamp() WHERE id=t.id RETURNING * INTO t;
            result:=public.enclave_report_workflow('update',jsonb_build_object('actor_id',actor,'ticket_id',r.ticket_id,
                'expected_status','in_progress','status','resolved','note',p_args->>'public_note','repair_verified',true));
            IF result->>'state' IS DISTINCT FROM 'ok' THEN RAISE EXCEPTION 'Report resolution did not commit'; END IF;
            event_action:='verified';
            PERFORM public.enclave_maintenance_notify(t.id,false,'Repair verified',t.title);
        ELSE RETURN jsonb_build_object('state','invalid'); END IF;
    ELSE RETURN jsonb_build_object('state','invalid'); END IF;
    INSERT INTO public.maintenance_task_events(task_id,action,actor_id,actor_role,note) VALUES(t.id,event_action,actor,actor_role,note);
    RETURN jsonb_build_object('state','ok','task',public.enclave_maintenance_task_projection(t.id));
END $$;
REVOKE ALL ON FUNCTION public.enclave_maintenance_workflow(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_maintenance_workflow(text,jsonb) TO service_role;
COMMIT;
