-- Stable private S3 object URLs are stored on the matching profile row.
-- FastAPI writes with its backend-only Supabase admin key after JWT verification;
-- this migration adds no authenticated-client grants or RLS policies.
BEGIN;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.profiles.avatar_url IS
    'Stable private S3 object URL; API responses use short-lived signed URLs.';

COMMIT;
