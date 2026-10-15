-- PROPOSAL ONLY: single-community MVP, reusing existing public.profiles.
-- Inspect the real schema before running. Do not apply alongside the earlier six-table draft.
-- These table names must be unused; CREATE TABLE fails and rolls back on conflicts.
-- No signup APIs, processing RPCs, profile/role changes, or report RLS changes are implemented here.
BEGIN;

CREATE TABLE public.residents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_reference text NOT NULL UNIQUE CHECK (length(btrim(resident_reference)) BETWEEN 1 AND 100),
    full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 150),
    unit_number text NOT NULL CHECK (length(btrim(unit_number)) BETWEEN 1 AND 100),
    registered_email text NOT NULL UNIQUE CHECK (
        registered_email = lower(btrim(registered_email)) AND length(registered_email) BETWEEN 3 AND 254
    ),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
    verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((profile_id IS NULL) = (verified_at IS NULL)),
    CHECK (verified_at IS NULL OR verified_at >= created_at)
);
-- Multiple people can share a unit. Management must prevent duplicate real-person records.

CREATE TABLE public.resident_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id uuid NOT NULL REFERENCES public.residents(id) ON DELETE RESTRICT,
    invited_email text NOT NULL CHECK (
        invited_email = lower(btrim(invited_email)) AND length(invited_email) BETWEEN 3 AND 254
    ),
    token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
    created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    revoked_at timestamptz,
    used_at timestamptz,
    used_by uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
    UNIQUE (id, resident_id, invited_email),
    CHECK (expires_at > created_at),
    CHECK ((used_at IS NULL) = (used_by IS NULL)),
    CHECK (used_at IS NULL OR (used_at >= created_at AND used_at <= expires_at)),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    CHECK (used_at IS NULL OR revoked_at IS NULL)
);
-- Explicitly revoke an expired open invitation before issuing its replacement.
CREATE UNIQUE INDEX resident_mvp_one_open_invitation ON public.resident_invitations (resident_id)
    WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE public.email_verification_challenges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invitation_id uuid NOT NULL,
    resident_id uuid NOT NULL,
    email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
    purpose text NOT NULL DEFAULT 'resident_signup' CHECK (purpose = 'resident_signup'),
    otp_digest bytea NOT NULL CHECK (octet_length(otp_digest) = 32),
    pepper_version smallint NOT NULL DEFAULT 1 CHECK (pepper_version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
    attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts smallint NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 5),
    last_attempt_at timestamptz,
    send_status text NOT NULL DEFAULT 'pending' CHECK (send_status IN ('pending', 'accepted', 'failed')),
    send_accepted_at timestamptz,
    provider_message_id text,
    revoked_at timestamptz,
    verified_at timestamptz,
    signup_request_digest bytea CHECK (octet_length(signup_request_digest) = 32),
    signup_deadline timestamptz,
    processing_token uuid,
    processing_expires_at timestamptz,
    auth_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
    completed_at timestamptz,
    FOREIGN KEY (invitation_id, resident_id, email)
        REFERENCES public.resident_invitations(id, resident_id, invited_email) ON DELETE RESTRICT,
    CHECK (expires_at > created_at),
    CHECK (attempt_count <= max_attempts),
    CHECK (last_attempt_at IS NULL OR last_attempt_at >= created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    CHECK ((send_status = 'accepted') = (send_accepted_at IS NOT NULL)),
    CHECK (send_accepted_at IS NULL OR send_accepted_at >= created_at),
    CHECK (send_status <> 'accepted' OR (provider_message_id IS NOT NULL AND length(provider_message_id) > 0)),
    CHECK (
        (verified_at IS NULL AND signup_request_digest IS NULL AND signup_deadline IS NULL)
        OR (verified_at IS NOT NULL AND verified_at >= created_at AND verified_at <= expires_at
            AND send_status = 'accepted' AND send_accepted_at <= verified_at
            AND signup_request_digest IS NOT NULL AND signup_deadline IS NOT NULL
            AND signup_deadline > verified_at)
    ),
    CHECK ((processing_token IS NULL) = (processing_expires_at IS NULL)),
    CHECK (processing_token IS NULL OR (verified_at IS NOT NULL AND processing_expires_at > verified_at)),
    CHECK (auth_user_id IS NULL OR verified_at IS NOT NULL),
    CHECK (completed_at IS NULL OR
           (auth_user_id IS NOT NULL AND verified_at IS NOT NULL
            AND completed_at >= verified_at AND completed_at <= signup_deadline AND revoked_at IS NULL))
);
-- A resend revokes the old unverified row. Reconcile provisioning attempts before replacing them.
CREATE UNIQUE INDEX resident_mvp_one_open_challenge ON public.email_verification_challenges (resident_id, purpose)
    WHERE revoked_at IS NULL AND completed_at IS NULL;
CREATE INDEX resident_mvp_challenge_rate_window ON public.email_verification_challenges (email, created_at DESC);
CREATE INDEX resident_mvp_challenge_invitation ON public.email_verification_challenges (invitation_id);

ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verification_challenges ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.residents, public.resident_invitations, public.email_verification_challenges
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.residents TO authenticated;
-- Backend must authorize each management action and validate every signup transition.
GRANT SELECT, INSERT, UPDATE ON TABLE public.residents, public.resident_invitations,
    public.email_verification_challenges TO service_role;

CREATE POLICY enclave_resident_mvp_read_self ON public.residents FOR SELECT TO authenticated
    USING (profile_id = (SELECT auth.uid()));
-- No anon/authenticated privileges or policies for invitations/challenges, and no client writes.
-- Role protection, cross-row state transitions, current eligibility, and rate limits need backend/RPC checks.

COMMIT;
