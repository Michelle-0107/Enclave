-- Apply AFTER the existing 003 tables and 004 profile-access SQL. Do not rerun 003.
-- Adds shared rate-limit counters and backend-only atomic registration transitions.
-- No existing resident/profile/report rows are changed by installing these objects.
BEGIN;

CREATE TABLE IF NOT EXISTS public.registration_rate_limits (
    scope text NOT NULL CHECK (scope IN ('request-ip', 'request-email', 'verify-ip', 'verify-email')),
    subject_digest bytea NOT NULL CHECK (octet_length(subject_digest) = 32),
    bucket bigint NOT NULL,
    request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, subject_digest, bucket)
);
ALTER TABLE public.registration_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.registration_rate_limits FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.registration_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.enclave_registration_transition(p_action text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
    r record;
    i record;
    c record;
    pr record;
    v_now timestamptz := clock_timestamp();
    v_scope text;
    v_window integer;
    v_limit integer;
    v_count integer;
    v_bucket bigint;
BEGIN
    -- EXECUTE is restricted below. No anonymous/user JWT may call this function.
    IF p_action = 'rate' THEN
        v_scope := p_args->>'scope';
        CASE v_scope
            WHEN 'request-ip' THEN v_window := 60; v_limit := 20;
            WHEN 'request-email' THEN v_window := 900; v_limit := 3;
            WHEN 'verify-ip' THEN v_window := 60; v_limit := 20;
            WHEN 'verify-email' THEN v_window := 900; v_limit := 10;
            ELSE RETURN jsonb_build_object('state', 'invalid');
        END CASE;
        v_bucket := floor(extract(epoch FROM v_now) / v_window)::bigint;
        INSERT INTO public.registration_rate_limits AS counters (scope, subject_digest, bucket)
        VALUES (v_scope, decode(p_args->>'digest', 'hex'), v_bucket)
        ON CONFLICT (scope, subject_digest, bucket) DO UPDATE
            SET request_count = counters.request_count + 1
        RETURNING request_count INTO v_count;
        RETURN jsonb_build_object('allowed', v_count <= v_limit);
    ELSIF p_action = 'lookup_invitation' THEN
        SELECT inv.id AS invitation_id, res.id AS resident_id, res.registered_email AS email INTO pr
        FROM public.resident_invitations inv JOIN public.residents res ON res.id = inv.resident_id
        WHERE inv.invited_email = p_args->>'email' AND res.registered_email = inv.invited_email
          AND inv.used_at IS NULL AND inv.revoked_at IS NULL AND inv.expires_at > v_now
          AND res.status = 'active' AND res.profile_id IS NULL;
        IF NOT FOUND THEN RETURN NULL; END IF;
        RETURN to_jsonb(pr);
    ELSIF p_action = 'create_challenge' THEN
        SELECT * INTO r FROM public.residents WHERE id = (p_args->>'resident_id')::uuid FOR UPDATE;
        SELECT * INTO i FROM public.resident_invitations WHERE id = (p_args->>'invitation_id')::uuid FOR UPDATE;
        IF r.id IS NULL OR i.id IS NULL OR i.resident_id <> r.id OR r.status <> 'active'
           OR r.profile_id IS NOT NULL OR r.registered_email <> p_args->>'email'
           OR i.invited_email <> r.registered_email OR i.used_at IS NOT NULL
           OR i.revoked_at IS NOT NULL OR i.expires_at <= v_now THEN
            RETURN jsonb_build_object('created', false);
        END IF;
        SELECT * INTO c FROM public.email_verification_challenges
        WHERE resident_id = r.id AND revoked_at IS NULL AND completed_at IS NULL FOR UPDATE;
        IF c.id IS NOT NULL AND c.verified_at IS NOT NULL THEN
            RETURN jsonb_build_object('created', false);
        END IF;
        IF EXISTS (SELECT 1 FROM public.email_verification_challenges
                   WHERE resident_id = r.id AND created_at > v_now - interval '60 seconds') THEN
            RETURN jsonb_build_object('created', false);
        END IF;
        UPDATE public.email_verification_challenges SET revoked_at = v_now
        WHERE resident_id = r.id AND revoked_at IS NULL AND completed_at IS NULL;
        INSERT INTO public.email_verification_challenges
            (id, invitation_id, resident_id, email, otp_digest, pepper_version)
        VALUES ((p_args->>'id')::uuid, i.id, r.id, r.registered_email,
                decode(p_args->>'otp_digest', 'hex'), (p_args->>'pepper_version')::smallint);
        RETURN jsonb_build_object('created', true);
    ELSIF p_action = 'delivery' THEN
        IF p_args->>'status' = 'accepted' THEN
            UPDATE public.email_verification_challenges
            SET send_status = 'accepted', send_accepted_at = v_now,
                provider_message_id = p_args->>'message_id'
            WHERE id = (p_args->>'id')::uuid AND send_status = 'pending' AND revoked_at IS NULL
              AND verified_at IS NULL AND expires_at > v_now;
        ELSE
            UPDATE public.email_verification_challenges SET send_status = 'failed', revoked_at = v_now
            WHERE id = (p_args->>'id')::uuid AND send_status = 'pending' AND revoked_at IS NULL;
        END IF;
        RETURN jsonb_build_object('state', 'recorded');
    ELSIF p_action = 'challenge' THEN
        SELECT id, invitation_id, resident_id, email, encode(otp_digest, 'hex') AS otp_digest,
               pepper_version INTO pr FROM public.email_verification_challenges
        WHERE id = (p_args->>'id')::uuid;
        IF NOT FOUND THEN RETURN NULL; END IF;
        RETURN to_jsonb(pr);
    ELSIF p_action IN ('acquire', 'finish') THEN
        SELECT resident_id INTO pr FROM public.email_verification_challenges WHERE id = (p_args->>'id')::uuid;
        IF NOT FOUND THEN RETURN jsonb_build_object('state', 'invalid'); END IF;
        -- Consistent lock order: resident, invitation, challenge.
        SELECT * INTO r FROM public.residents WHERE id = pr.resident_id FOR UPDATE;
        SELECT inv.* INTO i FROM public.resident_invitations inv
        JOIN public.email_verification_challenges ch ON ch.invitation_id = inv.id
        WHERE ch.id = (p_args->>'id')::uuid FOR UPDATE OF inv;
        SELECT * INTO c FROM public.email_verification_challenges WHERE id = (p_args->>'id')::uuid FOR UPDATE;
        IF c.revoked_at IS NOT NULL OR r.status <> 'active' OR r.registered_email <> c.email
           OR i.revoked_at IS NOT NULL OR i.expires_at <= v_now THEN
            RETURN jsonb_build_object('state', 'invalid');
        END IF;
        IF p_action = 'acquire' THEN
            IF c.verified_at IS NULL THEN
                IF c.send_status <> 'accepted' OR c.expires_at <= v_now OR c.attempt_count >= c.max_attempts
                   OR r.profile_id IS NOT NULL OR i.used_at IS NOT NULL
                   OR c.otp_digest <> decode(p_args->>'expected_digest', 'hex') THEN
                    RETURN jsonb_build_object('state', 'invalid');
                END IF;
                -- matches was computed with hmac.compare_digest by the trusted backend.
                IF (p_args->>'matches')::boolean IS NOT TRUE THEN
                    UPDATE public.email_verification_challenges
                    SET attempt_count = attempt_count + 1, last_attempt_at = v_now WHERE id = c.id;
                    -- Return normally: raising would roll back the failed-attempt increment.
                    RETURN jsonb_build_object('state', 'invalid');
                END IF;
                UPDATE public.email_verification_challenges
                SET verified_at = v_now, signup_request_digest = decode(p_args->>'request_digest', 'hex'),
                    signup_deadline = v_now + interval '10 minutes' WHERE id = c.id;
                SELECT * INTO c FROM public.email_verification_challenges WHERE id = c.id;
            ELSIF c.signup_request_digest <> decode(p_args->>'request_digest', 'hex')
               OR c.signup_deadline <= v_now THEN
                RETURN jsonb_build_object('state', 'invalid');
            END IF;
            IF c.processing_token IS NOT NULL AND c.processing_expires_at > v_now THEN
                RETURN jsonb_build_object('state', 'busy');
            END IF;
            IF c.completed_at IS NULL AND (r.profile_id IS NOT NULL OR i.used_at IS NOT NULL) THEN
                RETURN jsonb_build_object('state', 'conflict');
            END IF;
            IF c.completed_at IS NOT NULL AND
               (r.profile_id IS DISTINCT FROM c.auth_user_id OR i.used_by IS DISTINCT FROM c.auth_user_id) THEN
                RETURN jsonb_build_object('state', 'conflict');
            END IF;
            UPDATE public.email_verification_challenges
            SET processing_token = (p_args->>'lease')::uuid, processing_expires_at = v_now + interval '2 minutes'
            WHERE id = c.id;
            RETURN jsonb_build_object('state', 'acquired', 'resident_id', r.id, 'email', c.email,
                                      'auth_user_id', c.auth_user_id, 'completed', c.completed_at IS NOT NULL);
        END IF;
        IF c.processing_token IS DISTINCT FROM (p_args->>'lease')::uuid
           OR c.processing_expires_at <= v_now OR c.signup_deadline <= v_now OR c.verified_at IS NULL
           OR c.auth_user_id IS DISTINCT FROM (p_args->>'user_id')::uuid THEN
            RETURN jsonb_build_object('state', 'invalid');
        END IF;
        IF c.completed_at IS NOT NULL THEN
            IF r.profile_id IS DISTINCT FROM c.auth_user_id OR i.used_by IS DISTINCT FROM c.auth_user_id THEN
                RETURN jsonb_build_object('state', 'conflict');
            END IF;
            RETURN jsonb_build_object('state', 'completed', 'resident_id', r.id);
        END IF;
        IF r.profile_id IS NOT NULL OR i.used_at IS NOT NULL OR EXISTS (
            SELECT 1 FROM public.residents WHERE profile_id = c.auth_user_id AND id <> r.id
        ) THEN RETURN jsonb_build_object('state', 'conflict'); END IF;
        INSERT INTO public.profiles (id, email, full_name, role)
        VALUES (c.auth_user_id, c.email, r.full_name, 'resident') ON CONFLICT (id) DO NOTHING;
        SELECT * INTO pr FROM public.profiles WHERE id = c.auth_user_id FOR UPDATE;
        IF lower(btrim(pr.email)) <> c.email THEN
            RETURN jsonb_build_object('state', 'conflict');
        END IF;
        UPDATE public.residents SET profile_id = c.auth_user_id, verified_at = v_now WHERE id = r.id;
        UPDATE public.resident_invitations SET used_at = v_now, used_by = c.auth_user_id WHERE id = i.id;
        UPDATE public.email_verification_challenges SET completed_at = v_now WHERE id = c.id;
        RETURN jsonb_build_object('state', 'completed', 'resident_id', r.id);
    ELSIF p_action = 'remember_auth' THEN
        UPDATE public.email_verification_challenges SET auth_user_id = (p_args->>'user_id')::uuid
        WHERE id = (p_args->>'id')::uuid AND processing_token = (p_args->>'lease')::uuid
          AND processing_expires_at > v_now AND signup_deadline > v_now AND revoked_at IS NULL
          AND (auth_user_id IS NULL OR auth_user_id = (p_args->>'user_id')::uuid);
        RETURN jsonb_build_object('recorded', FOUND);
    ELSIF p_action = 'release' THEN
        UPDATE public.email_verification_challenges SET processing_token = NULL, processing_expires_at = NULL
        WHERE id = (p_args->>'id')::uuid AND processing_token = (p_args->>'lease')::uuid;
        RETURN jsonb_build_object('state', 'released');
    ELSIF p_action IN ('create_resident', 'issue_invitation') THEN
        SELECT role INTO pr FROM public.profiles WHERE id = (p_args->>'actor_id')::uuid FOR SHARE;
        IF NOT FOUND OR pr.role IS DISTINCT FROM 'management' THEN
            RETURN jsonb_build_object('state', 'forbidden');
        END IF;
        IF p_action = 'create_resident' THEN
            INSERT INTO public.residents (resident_reference, full_name, unit_number, registered_email)
            VALUES (p_args->>'resident_reference', p_args->>'full_name', p_args->>'unit_number', p_args->>'registered_email')
            RETURNING id INTO pr;
            RETURN jsonb_build_object('state', 'created', 'resident_id', pr.id);
        END IF;
        SELECT * INTO r FROM public.residents WHERE id = (p_args->>'resident_id')::uuid FOR UPDATE;
        IF NOT FOUND THEN RETURN jsonb_build_object('state', 'not_found'); END IF;
        IF r.status <> 'active' OR r.profile_id IS NOT NULL OR EXISTS (
            SELECT 1 FROM public.email_verification_challenges
            WHERE resident_id = r.id AND revoked_at IS NULL AND completed_at IS NULL AND verified_at IS NOT NULL
        ) THEN RETURN jsonb_build_object('state', 'conflict'); END IF;
        UPDATE public.email_verification_challenges SET revoked_at = v_now
        WHERE resident_id = r.id AND revoked_at IS NULL AND completed_at IS NULL;
        UPDATE public.resident_invitations SET revoked_at = v_now
        WHERE resident_id = r.id AND used_at IS NULL AND revoked_at IS NULL;
        INSERT INTO public.resident_invitations (id, resident_id, invited_email, token_digest, created_by)
        VALUES ((p_args->>'id')::uuid, r.id, r.registered_email, decode(p_args->>'token_digest', 'hex'),
                (p_args->>'actor_id')::uuid) RETURNING id, expires_at INTO pr;
        RETURN jsonb_build_object('state', 'created', 'invitation_id', pr.id, 'expires_at', pr.expires_at);
    ELSIF p_action = 'residency' THEN
        SELECT id AS resident_id, unit_number, status, verified_at INTO pr FROM public.residents
        WHERE profile_id = (p_args->>'user_id')::uuid;
        IF NOT FOUND THEN RETURN NULL; END IF;
        RETURN to_jsonb(pr);
    END IF;
    RETURN jsonb_build_object('state', 'invalid');
EXCEPTION WHEN unique_violation OR foreign_key_violation THEN
    -- PostgreSQL rolls back this function's changes before returning a conflict.
    RETURN jsonb_build_object('state', 'conflict');
END;
$$;

REVOKE ALL ON FUNCTION public.enclave_registration_transition(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_registration_transition(text, jsonb) TO service_role;
COMMIT;
