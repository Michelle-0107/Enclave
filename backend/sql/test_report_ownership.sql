-- Run after 001_report_ownership.sql in a staging project or review with its owner.
-- Two temporary Auth users and reports are inserted inside a transaction and
-- rolled back. No emails are sent. Stop on any assertion or schema error.
BEGIN;

INSERT INTO auth.users (id, aud, role, email)
VALUES ('00000000-0000-4000-8000-000000000501', 'authenticated', 'authenticated', 'enclave-rls-a@example.invalid'),
       ('00000000-0000-4000-8000-000000000502', 'authenticated', 'authenticated', 'enclave-rls-b@example.invalid');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000501', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000501","role":"authenticated"}', true);
INSERT INTO public.reports (ticket_id, user_id, description, status, image_url, category, priority,
                            latitude, longitude, is_approved)
VALUES ('TICK-RLS-TEST-A', '00000000-0000-4000-8000-000000000501', 'RLS test A', 'pending',
        'https://example.invalid/a.jpg', 'Streetlight', 'low', 3.139, 101.687, false);

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000502', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000502","role":"authenticated"}', true);
INSERT INTO public.reports (ticket_id, user_id, description, status, image_url, category, priority,
                            latitude, longitude, is_approved)
VALUES ('TICK-RLS-TEST-B', '00000000-0000-4000-8000-000000000502', 'RLS test B', 'pending',
        'https://example.invalid/b.jpg', 'Streetlight', 'low', 3.139, 101.687, false);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.reports WHERE ticket_id = 'TICK-RLS-TEST-A') THEN
        RAISE EXCEPTION 'RLS failed: B can read A.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.reports WHERE ticket_id = 'TICK-RLS-TEST-B') THEN
        RAISE EXCEPTION 'RLS failed: B cannot read their own report.';
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
END;
$$;

DO $$
DECLARE affected integer;
BEGIN
    BEGIN
        UPDATE public.reports SET is_approved = true WHERE ticket_id = 'TICK-RLS-TEST-B';
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN RAISE EXCEPTION 'RLS failed: B updated approval.'; END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        DELETE FROM public.reports WHERE ticket_id = 'TICK-RLS-TEST-B';
        GET DIAGNOSTICS affected = ROW_COUNT;
        IF affected <> 0 THEN RAISE EXCEPTION 'RLS failed: B deleted a report.'; END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END;
$$;

SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000501', true);
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000501","role":"authenticated"}', true);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.reports WHERE ticket_id = 'TICK-RLS-TEST-B') THEN
        RAISE EXCEPTION 'RLS failed: A can read B.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.reports WHERE ticket_id = 'TICK-RLS-TEST-A') THEN
        RAISE EXCEPTION 'RLS failed: A cannot read their own report.';
    END IF;
END;
$$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claims', '{}', true);
DO $$
BEGIN
    BEGIN
        IF EXISTS (SELECT 1 FROM public.reports WHERE ticket_id IN ('TICK-RLS-TEST-A', 'TICK-RLS-TEST-B')) THEN
            RAISE EXCEPTION 'RLS failed: anonymous users can read private reports.';
        END IF;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
END;
$$;
RESET ROLE;
ROLLBACK;
