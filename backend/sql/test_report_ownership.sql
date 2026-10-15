-- Run after SQL 003, 004, 005, and 006 in a staging project.
-- Creates synthetic Auth/profile/resident/report/notification fixtures in a transaction,
-- tests direct Data API role policies, and rolls all fixtures back. No email is sent.
BEGIN;

INSERT INTO auth.users (id, aud, role, email)
VALUES ('00000000-0000-4000-8000-000000000501', 'authenticated', 'authenticated', 'enclave-rls-a@example.invalid'),
       ('00000000-0000-4000-8000-000000000502', 'authenticated', 'authenticated', 'enclave-rls-b@example.invalid'),
       ('00000000-0000-4000-8000-000000000503', 'authenticated', 'authenticated', 'enclave-rls-inactive@example.invalid'),
       ('00000000-0000-4000-8000-000000000504', 'authenticated', 'authenticated', 'enclave-rls-unbound@example.invalid');

INSERT INTO public.profiles (id, email, full_name, role)
VALUES ('00000000-0000-4000-8000-000000000501', 'enclave-rls-a@example.invalid', 'RLS A', 'resident'),
       ('00000000-0000-4000-8000-000000000502', 'enclave-rls-b@example.invalid', 'RLS B', 'resident'),
       ('00000000-0000-4000-8000-000000000503', 'enclave-rls-inactive@example.invalid', 'RLS Inactive', 'resident'),
       ('00000000-0000-4000-8000-000000000504', 'enclave-rls-unbound@example.invalid', 'RLS Unbound', 'resident');

INSERT INTO public.residents
    (resident_reference, full_name, unit_number, registered_email, status, profile_id, verified_at)
VALUES ('RLS-TEST-A', 'RLS A', 'RLS-1', 'enclave-rls-a@example.invalid', 'active',
        '00000000-0000-4000-8000-000000000501', now()),
       ('RLS-TEST-B', 'RLS B', 'RLS-1', 'enclave-rls-b@example.invalid', 'active',
        '00000000-0000-4000-8000-000000000502', now()),
       ('RLS-TEST-INACTIVE', 'RLS Inactive', 'RLS-2', 'enclave-rls-inactive@example.invalid', 'inactive',
        '00000000-0000-4000-8000-000000000503', now());

INSERT INTO public.categories (name, description)
VALUES ('Streetlight', 'Temporary RLS fixture') ON CONFLICT (name) DO NOTHING;

INSERT INTO public.reports (ticket_id, user_id, description, status, image_url, category, priority,
                            latitude, longitude, is_approved)
VALUES ('TICK-RLS-TEST-A', '00000000-0000-4000-8000-000000000501', 'RLS test A', 'pending',
        'https://example.invalid/a.jpg', 'Streetlight', 'low', 3.139, 101.687, false),
       ('TICK-RLS-TEST-B', '00000000-0000-4000-8000-000000000502', 'RLS test B', 'pending',
        'https://example.invalid/b.jpg', 'Streetlight', 'low', 3.139, 101.687, false);

INSERT INTO public.notifications (user_id, title, message, is_read)
VALUES ('00000000-0000-4000-8000-000000000501', 'RLS test A', 'Private notification A', false),
       ('00000000-0000-4000-8000-000000000502', 'RLS test B', 'Private notification B', false);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000501', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000501","role":"authenticated"}', true);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.reports WHERE ticket_id = 'TICK-RLS-TEST-B') THEN
        RAISE EXCEPTION 'RLS failed: A can read B report.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.reports WHERE ticket_id = 'TICK-RLS-TEST-A') THEN
        RAISE EXCEPTION 'RLS failed: A cannot read own report.';
    END IF;
    IF (SELECT count(*) FROM public.notifications) <> 1 OR
       EXISTS (SELECT 1 FROM public.notifications WHERE message = 'Private notification B') THEN
        RAISE EXCEPTION 'RLS failed: A notification visibility is not owner-only.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.categories WHERE name = 'Streetlight') THEN
        RAISE EXCEPTION 'RLS failed: active resident cannot read categories.';
    END IF;
    BEGIN
        UPDATE public.notifications SET title = 'tampered' WHERE message = 'Private notification A';
        RAISE EXCEPTION 'RLS failed: A changed a notification field other than is_read.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    UPDATE public.notifications SET is_read = true WHERE message = 'Private notification A';
    IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE message = 'Private notification A' AND is_read) THEN
        RAISE EXCEPTION 'RLS failed: A cannot mark own notification read.';
    END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000502', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000502","role":"authenticated"}', true);
DO $$
DECLARE affected integer;
BEGIN
    IF EXISTS (SELECT 1 FROM public.reports WHERE ticket_id = 'TICK-RLS-TEST-A') THEN
        RAISE EXCEPTION 'RLS failed: B can read A report.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.reports WHERE ticket_id = 'TICK-RLS-TEST-B') THEN
        RAISE EXCEPTION 'RLS failed: B cannot read own report.';
    END IF;
    IF (SELECT count(*) FROM public.notifications) <> 1 OR
       EXISTS (SELECT 1 FROM public.notifications WHERE message = 'Private notification A') THEN
        RAISE EXCEPTION 'RLS failed: B notification visibility is not owner-only.';
    END IF;
    BEGIN
        INSERT INTO public.reports (ticket_id, user_id, description, status, latitude, longitude, is_approved)
        VALUES ('TICK-RLS-SPOOF', '00000000-0000-4000-8000-000000000501', 'Spoof attempt', 'pending', 3.139, 101.687, false);
        RAISE EXCEPTION 'RLS failed: B inserted a report owned by A.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        INSERT INTO public.reports (ticket_id, user_id, description, status, latitude, longitude, is_approved)
        VALUES ('TICK-RLS-APPROVED', '00000000-0000-4000-8000-000000000502', 'Approval attempt', 'pending', 3.139, 101.687, true);
        RAISE EXCEPTION 'RLS failed: B inserted an approved report.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        UPDATE public.reports SET is_approved = true WHERE ticket_id = 'TICK-RLS-TEST-B';
        RAISE EXCEPTION 'RLS failed: B updated report approval.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM public.reports WHERE ticket_id = 'TICK-RLS-TEST-B';
        RAISE EXCEPTION 'RLS failed: B deleted a report.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    UPDATE public.notifications SET is_read = true WHERE message = 'Private notification A';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'RLS failed: B marked A notification read.'; END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000503', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000503","role":"authenticated"}', true);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.reports) OR EXISTS (SELECT 1 FROM public.notifications)
       OR EXISTS (SELECT 1 FROM public.categories) THEN
        RAISE EXCEPTION 'RLS failed: inactive resident can access resident features.';
    END IF;
    BEGIN
        INSERT INTO public.reports (ticket_id, user_id, description, status, latitude, longitude, is_approved)
        VALUES ('TICK-RLS-INACTIVE', '00000000-0000-4000-8000-000000000503', 'Inactive attempt', 'pending', 3.139, 101.687, false);
        RAISE EXCEPTION 'RLS failed: inactive resident inserted a report.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000504', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000504","role":"authenticated"}', true);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.reports) OR EXISTS (SELECT 1 FROM public.notifications)
       OR EXISTS (SELECT 1 FROM public.categories) THEN
        RAISE EXCEPTION 'RLS failed: unbound account can access resident features.';
    END IF;
    BEGIN
        INSERT INTO public.reports (ticket_id, user_id, description, status, latitude, longitude, is_approved)
        VALUES ('TICK-RLS-UNBOUND', '00000000-0000-4000-8000-000000000504', 'Unbound attempt', 'pending', 3.139, 101.687, false);
        RAISE EXCEPTION 'RLS failed: unbound account inserted a report.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END;
$$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{}', true);
DO $$
BEGIN
    BEGIN
        PERFORM * FROM public.reports;
        RAISE EXCEPTION 'RLS failed: anonymous users can read reports.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM * FROM public.notifications;
        RAISE EXCEPTION 'RLS failed: anonymous users can read notifications.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        PERFORM * FROM public.categories;
        RAISE EXCEPTION 'RLS failed: anonymous users can read categories.';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END;
$$;
RESET ROLE;
ROLLBACK;
