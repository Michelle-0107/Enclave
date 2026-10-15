-- TRUSTED, MANUAL SETUP IN THE ENCLAVE PROJECT'S SQL EDITOR ONLY.
-- First create/confirm the intended management App account in Authentication > Users.
-- Replace BOTH placeholders below with that account's UUID and exact email.
-- This does not create an Auth account or grant any public role-changing endpoint.
-- Do not put this in automatic migrations or run it against a resident account.
BEGIN;

DO $$
DECLARE
    v_user_id uuid := '00000000-0000-0000-0000-000000000000'; -- REPLACE_WITH_AUTH_USER_UUID
    v_expected_email text := 'REPLACE_WITH_MANAGEMENT_APP_EMAIL';
    v_name text := 'Enclave Management';
    v_email text;
    v_confirmed timestamptz;
    v_profile record;
BEGIN
    IF v_user_id = '00000000-0000-0000-0000-000000000000'::uuid
       OR v_expected_email = 'REPLACE_WITH_MANAGEMENT_APP_EMAIL' THEN
        RAISE EXCEPTION 'Fill the intended management App UUID and email before running this script.';
    END IF;
    SELECT lower(btrim(email)), email_confirmed_at INTO v_email, v_confirmed
    FROM auth.users WHERE id = v_user_id FOR SHARE;
    IF NOT FOUND OR v_confirmed IS NULL OR v_email IS DISTINCT FROM lower(btrim(v_expected_email)) THEN
        RAISE EXCEPTION 'The intended Auth account is missing, unconfirmed, or has a different email.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.residents WHERE profile_id = v_user_id)
       OR EXISTS (SELECT 1 FROM public.resident_invitations WHERE used_by = v_user_id)
       OR EXISTS (SELECT 1 FROM public.email_verification_challenges WHERE auth_user_id = v_user_id) THEN
        RAISE EXCEPTION 'This account has resident registration history; review it instead of converting it.';
    END IF;
    INSERT INTO public.profiles (id, email, full_name, role)
    VALUES (v_user_id, v_email, v_name, 'management') ON CONFLICT (id) DO NOTHING;
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_user_id FOR UPDATE;
    IF lower(btrim(v_profile.email)) IS DISTINCT FROM v_email THEN
        RAISE EXCEPTION 'Existing profile email does not match; no profile overwrite performed.';
    END IF;
    UPDATE public.profiles SET role = 'management' WHERE id = v_user_id;
END;
$$;

COMMIT;
