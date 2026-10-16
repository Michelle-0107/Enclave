BEGIN;

-- Extend the existing notification table to support management broadcasts.
ALTER TABLE public.notifications
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'individual'
        CHECK (audience IN ('all_residents', 'individual')),
    ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS published_at timestamptz,
    ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Preserve existing user-specific notifications during the migration.
UPDATE public.notifications
SET is_published = true,
    published_at = COALESCE(published_at, created_at)
WHERE audience = 'individual';

CREATE INDEX IF NOT EXISTS notifications_broadcast_feed_idx
    ON public.notifications (published_at DESC, created_at DESC)
    WHERE audience = 'all_residents' AND is_published = true;

CREATE TABLE IF NOT EXISTS public.notification_reads (
    notification_id bigint NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    read_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT notification_reads_pkey PRIMARY KEY (notification_id, user_id)
);

CREATE INDEX IF NOT EXISTS notification_reads_user_idx
    ON public.notification_reads (user_id, notification_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_resident_read ON public.notifications;
CREATE POLICY notifications_resident_read
ON public.notifications
FOR SELECT
TO authenticated
USING (
    is_published = true
    AND (published_at IS NULL OR published_at <= timezone('utc'::text, now()))
    AND (expires_at IS NULL OR expires_at > timezone('utc'::text, now()))
    AND (
        audience = 'all_residents'
        OR (audience = 'individual' AND user_id = auth.uid())
    )
);

DROP POLICY IF EXISTS notifications_management_write ON public.notifications;
CREATE POLICY notifications_management_write
ON public.notifications
FOR ALL
TO authenticated
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'management'
    )
)
WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'management'
    )
);

DROP POLICY IF EXISTS notification_reads_owner_read ON public.notification_reads;
CREATE POLICY notification_reads_owner_read
ON public.notification_reads
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS notification_reads_owner_insert ON public.notification_reads;
CREATE POLICY notification_reads_owner_insert
ON public.notification_reads
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_reads_owner_update ON public.notification_reads;
CREATE POLICY notification_reads_owner_update
ON public.notification_reads
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.notifications_id_seq TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.notification_reads TO authenticated;

COMMIT;
