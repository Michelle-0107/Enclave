-- Management-only resident directory and updates through a service-role RPC.
BEGIN;

CREATE OR REPLACE FUNCTION public.enclave_management_resident_directory(p_action text, p_args jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_role text;
    v_resident public.residents%ROWTYPE;
    v_items jsonb;
    v_email text := lower(btrim(p_args->>'registered_email'));
    v_new_status text := p_args->>'status';
BEGIN
    SELECT role INTO v_role
    FROM public.profiles
    WHERE id = (p_args->>'actor_id')::uuid
    FOR SHARE;

    IF NOT FOUND OR v_role IS DISTINCT FROM 'management' THEN
        RETURN jsonb_build_object('state', 'forbidden');
    END IF;

    IF p_action = 'list' THEN
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'resident_id', id,
                    'resident_reference', resident_reference,
                    'full_name', full_name,
                    'unit_number', unit_number,
                    'registered_email', registered_email,
                    'status', status,
                    'account_linked', profile_id IS NOT NULL,
                    'verified_at', verified_at,
                    'created_at', created_at
                ) ORDER BY created_at DESC, id
            ),
            '[]'::jsonb
        ) INTO v_items
        FROM public.residents;

        RETURN jsonb_build_object('state', 'listed', 'residents', v_items);
    ELSIF p_action = 'update' THEN
        SELECT * INTO v_resident
        FROM public.residents
        WHERE id = (p_args->>'resident_id')::uuid
        FOR UPDATE;

        IF NOT FOUND THEN
            RETURN jsonb_build_object('state', 'not_found');
        END IF;

        IF COALESCE(v_new_status NOT IN ('active', 'inactive'), true)
           OR COALESCE(length(btrim(p_args->>'resident_reference')), 0) NOT BETWEEN 1 AND 100
           OR COALESCE(length(btrim(p_args->>'full_name')), 0) NOT BETWEEN 1 AND 150
           OR COALESCE(length(btrim(p_args->>'unit_number')), 0) NOT BETWEEN 1 AND 100
           OR COALESCE(length(v_email), 0) NOT BETWEEN 3 AND 254
           OR COALESCE(v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$', true) THEN
            RETURN jsonb_build_object('state', 'invalid');
        END IF;

        IF v_resident.profile_id IS NOT NULL AND v_email <> v_resident.registered_email THEN
            RETURN jsonb_build_object('state', 'conflict');
        END IF;

        IF v_email <> v_resident.registered_email OR v_new_status = 'inactive' THEN
            UPDATE public.email_verification_challenges
            SET revoked_at = clock_timestamp()
            WHERE resident_id = v_resident.id
              AND revoked_at IS NULL
              AND completed_at IS NULL;

            UPDATE public.resident_invitations
            SET revoked_at = clock_timestamp()
            WHERE resident_id = v_resident.id
              AND used_at IS NULL
              AND revoked_at IS NULL;
        END IF;

        UPDATE public.residents
        SET resident_reference = btrim(p_args->>'resident_reference'),
            full_name = btrim(p_args->>'full_name'),
            unit_number = btrim(p_args->>'unit_number'),
            registered_email = v_email,
            status = v_new_status
        WHERE id = v_resident.id;

        RETURN jsonb_build_object('state', 'updated', 'resident_id', v_resident.id);
    END IF;

    RETURN jsonb_build_object('state', 'invalid');
EXCEPTION WHEN not_null_violation THEN
    RETURN jsonb_build_object('state', 'invalid');
WHEN unique_violation OR foreign_key_violation OR check_violation THEN
    RETURN jsonb_build_object('state', 'conflict');
END;
$$;

REVOKE ALL ON FUNCTION public.enclave_management_resident_directory(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enclave_management_resident_directory(text, jsonb) TO service_role;

COMMIT;
