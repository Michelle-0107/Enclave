-- Personal map presets. Run in the app's Supabase SQL Editor before using saved places.
-- Independent of report/repair data and migrations 009-011; never creates public facilities.
BEGIN;

CREATE TABLE IF NOT EXISTS public.user_saved_places (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 60),
    latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS user_saved_places_owner_name
    ON public.user_saved_places (user_id, lower(name));

ALTER TABLE public.user_saved_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_saved_places FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_saved_places FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.user_saved_places TO authenticated;
GRANT INSERT (user_id, name, latitude, longitude) ON public.user_saved_places TO authenticated;
GRANT UPDATE (name, latitude, longitude) ON public.user_saved_places TO authenticated;

-- Restrictive guard also holds if another permissive policy is added later.
DROP POLICY IF EXISTS user_saved_places_owner_guard ON public.user_saved_places;
CREATE POLICY user_saved_places_owner_guard ON public.user_saved_places AS RESTRICTIVE
    FOR ALL TO authenticated USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS user_saved_places_select ON public.user_saved_places;
CREATE POLICY user_saved_places_select ON public.user_saved_places
    FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS user_saved_places_insert ON public.user_saved_places;
CREATE POLICY user_saved_places_insert ON public.user_saved_places
    FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS user_saved_places_update ON public.user_saved_places;
CREATE POLICY user_saved_places_update ON public.user_saved_places
    FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid()))
    WITH CHECK (user_id = (SELECT auth.uid()));
DROP POLICY IF EXISTS user_saved_places_delete ON public.user_saved_places;
CREATE POLICY user_saved_places_delete ON public.user_saved_places
    FOR DELETE TO authenticated USING (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.user_saved_places IS
    'Private named map coordinates for each signed-in user; not facilities or accessibility evidence.';
NOTIFY pgrst, 'reload schema';
COMMIT;
