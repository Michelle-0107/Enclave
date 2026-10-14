-- ARCHIVED ALTERNATIVE: current single-community proposal is 003_single_community_registration_draft.sql.
-- Do not apply both drafts. Review any already-created tables and data before migrating.
-- PROPOSAL ONLY: review existing tables and roles with the Enclave project owner.
-- FastAPI manages six-digit OTPs; Resend delivers the email; Supabase Auth keeps accounts/passwords.
-- No OTP plaintext, password, API key, or HMAC secret is stored in these tables.
-- This draft adds tables only. It does not implement signup endpoints or change reports policies.
BEGIN;

CREATE TABLE public.communities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 150),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Management roles are assigned by a trusted administrator, never by signup metadata.
CREATE TABLE public.community_staff (
    community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    role text NOT NULL CHECK (role IN ('manager', 'maintainer')),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, user_id)
);

-- One row per person on management's resident register, including family members sharing a unit.
CREATE TABLE public.residents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    community_id uuid NOT NULL REFERENCES public.communities(id) ON DELETE RESTRICT,
    resident_reference text NOT NULL CHECK (length(btrim(resident_reference)) BETWEEN 1 AND 100),
    full_name text NOT NULL CHECK (length(btrim(full_name)) BETWEEN 1 AND 150),
    unit_number text NOT NULL CHECK (length(btrim(unit_number)) BETWEEN 1 AND 100),
    registered_email text NOT NULL CHECK (
        registered_email = lower(btrim(registered_email)) AND length(registered_email) BETWEEN 3 AND 254
    ),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (community_id, resident_reference),
    UNIQUE (id, community_id)
);
CREATE UNIQUE INDEX resident_active_email_unique ON public.residents (community_id, registered_email)
    WHERE status = 'active';

-- Invitation tokens must be high-entropy random values, distinct from the six-digit email OTP.
CREATE TABLE public.resident_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id uuid NOT NULL,
    community_id uuid NOT NULL,
    token_digest bytea NOT NULL UNIQUE CHECK (octet_length(token_digest) = 32),
    invited_email text NOT NULL CHECK (
        invited_email = lower(btrim(invited_email)) AND length(invited_email) BETWEEN 3 AND 254
    ),
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
    revoked_at timestamptz,
    used_at timestamptz,
    used_by uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
    FOREIGN KEY (resident_id, community_id) REFERENCES public.residents(id, community_id) ON DELETE RESTRICT,
    UNIQUE (id, resident_id, community_id),
    UNIQUE (id, resident_id, community_id, invited_email),
    CHECK (expires_at > created_at),
    CHECK ((used_at IS NULL) = (used_by IS NULL)),
    CHECK (used_at IS NULL OR (used_at >= created_at AND used_at <= expires_at)),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
-- Expired invitations are explicitly revoked before issuing a replacement.
CREATE UNIQUE INDEX resident_one_open_invitation ON public.resident_invitations (resident_id)
    WHERE used_at IS NULL AND revoked_at IS NULL;

CREATE TABLE public.email_verification_challenges (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invitation_id uuid NOT NULL,
    resident_id uuid NOT NULL,
    community_id uuid NOT NULL,
    email text NOT NULL CHECK (email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 254),
    purpose text NOT NULL DEFAULT 'resident_signup' CHECK (purpose = 'resident_signup'),
    otp_digest bytea NOT NULL CHECK (octet_length(otp_digest) = 32),
    pepper_version smallint NOT NULL DEFAULT 1 CHECK (pepper_version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
    attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    max_attempts smallint NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 10),
    last_attempt_at timestamptz,
    send_status text NOT NULL DEFAULT 'pending' CHECK (send_status IN ('pending', 'accepted', 'failed')),
    send_accepted_at timestamptz,
    provider_message_id text,
    revoked_at timestamptz,
    verified_at timestamptz,
    verification_token_digest bytea CHECK (octet_length(verification_token_digest) = 32),
    verification_expires_at timestamptz,
    signup_started_at timestamptz,
    auth_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
    completed_at timestamptz,
    FOREIGN KEY (invitation_id, resident_id, community_id, email)
        REFERENCES public.resident_invitations(id, resident_id, community_id, invited_email) ON DELETE RESTRICT,
    CHECK (expires_at > created_at),
    CHECK (attempt_count <= max_attempts),
    CHECK (last_attempt_at IS NULL OR last_attempt_at >= created_at),
    CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    CHECK ((send_status = 'accepted') = (send_accepted_at IS NOT NULL)),
    CHECK (send_status <> 'accepted' OR (provider_message_id IS NOT NULL AND length(provider_message_id) > 0)),
    CHECK (verified_at IS NULL OR
           (send_status = 'accepted' AND send_accepted_at IS NOT NULL AND send_accepted_at <= verified_at)),
    CHECK (
        (verified_at IS NULL AND verification_token_digest IS NULL AND verification_expires_at IS NULL)
        OR (verified_at IS NOT NULL AND verified_at >= created_at AND verified_at <= expires_at
            AND verification_token_digest IS NOT NULL AND verification_expires_at > verified_at)
    ),
    CHECK (signup_started_at IS NULL OR
           (verified_at IS NOT NULL AND signup_started_at >= verified_at AND signup_started_at < verification_expires_at)),
    CHECK (auth_user_id IS NULL OR signup_started_at IS NOT NULL),
    CHECK (completed_at IS NULL OR
           (signup_started_at IS NOT NULL AND auth_user_id IS NOT NULL AND completed_at >= signup_started_at))
);
-- A resend revokes the prior unfinished challenge; do not reset attempts on the same OTP.
CREATE UNIQUE INDEX resident_one_open_challenge ON public.email_verification_challenges (resident_id, purpose)
    WHERE revoked_at IS NULL AND completed_at IS NULL;
CREATE INDEX email_challenge_rate_window ON public.email_verification_challenges (email, created_at DESC);
CREATE INDEX email_challenge_invitation ON public.email_verification_challenges (invitation_id);

CREATE TABLE public.resident_memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    resident_id uuid NOT NULL UNIQUE,
    community_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    invitation_id uuid UNIQUE,
    verification_method text NOT NULL CHECK (verification_method IN ('invitation', 'manual_review')),
    status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'suspended')),
    verified_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (resident_id, community_id) REFERENCES public.residents(id, community_id) ON DELETE RESTRICT,
    FOREIGN KEY (invitation_id, resident_id, community_id)
        REFERENCES public.resident_invitations(id, resident_id, community_id) ON DELETE RESTRICT,
    UNIQUE (community_id, user_id),
    CHECK ((verification_method = 'invitation') = (invitation_id IS NOT NULL))
);

ALTER TABLE public.communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.residents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_verification_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resident_memberships ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.communities, public.community_staff, public.residents,
    public.resident_invitations, public.email_verification_challenges, public.resident_memberships
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.communities, public.community_staff, public.residents, public.resident_memberships
    TO authenticated;
-- Privileged backend access must still authorize management actions and validate resident signup.
GRANT SELECT, INSERT, UPDATE ON TABLE public.communities, public.community_staff, public.residents,
    public.resident_invitations, public.email_verification_challenges, public.resident_memberships
    TO service_role;
-- No anon/authenticated policies or grants for invitations and OTP challenges: server-only access.

CREATE POLICY enclave_staff_read_self ON public.community_staff FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = user_id);

CREATE POLICY enclave_membership_read_self_or_manager ON public.resident_memberships FOR SELECT TO authenticated
    USING ((SELECT auth.uid()) = user_id OR EXISTS (
        SELECT 1 FROM public.community_staff staff
        WHERE staff.community_id = resident_memberships.community_id
          AND staff.user_id = (SELECT auth.uid()) AND staff.role = 'manager' AND staff.status = 'active'
    ));

CREATE POLICY enclave_resident_read_self_or_manager ON public.residents FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.resident_memberships membership
        WHERE membership.resident_id = residents.id AND membership.user_id = (SELECT auth.uid())
    ) OR EXISTS (
        SELECT 1 FROM public.community_staff staff
        WHERE staff.community_id = residents.community_id
          AND staff.user_id = (SELECT auth.uid()) AND staff.role = 'manager' AND staff.status = 'active'
    ));

CREATE POLICY enclave_community_read_member_or_staff ON public.communities FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.resident_memberships membership
        WHERE membership.community_id = communities.id AND membership.user_id = (SELECT auth.uid())
    ) OR EXISTS (
        SELECT 1 FROM public.community_staff staff
        WHERE staff.community_id = communities.id AND staff.user_id = (SELECT auth.uid()) AND staff.status = 'active'
    ));

COMMIT;
