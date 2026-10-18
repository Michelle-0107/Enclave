-- Searchable shared catalogue. Personal pins remain in user_saved_places (012).
BEGIN;
CREATE TABLE IF NOT EXISTS public.map_places (
    id uuid PRIMARY KEY,
    area_id text NOT NULL CHECK (area_id ~ '^[a-z][a-z0-9-]{1,63}$'),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 250),
    address text NOT NULL DEFAULT '' CHECK (char_length(address) <= 1000),
    longitude double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    latitude double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    position_basis text NOT NULL CHECK (char_length(position_basis) BETWEEN 1 AND 250),
    source text NOT NULL DEFAULT 'openstreetmap' CHECK (source = 'openstreetmap'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS map_places_area ON public.map_places (area_id);
ALTER TABLE public.map_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_places FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.map_places FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.map_places TO authenticated;
GRANT ALL ON public.map_places TO service_role;
DROP POLICY IF EXISTS map_places_resident_read ON public.map_places;
CREATE POLICY map_places_resident_read ON public.map_places FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.residents r WHERE r.profile_id = (SELECT auth.uid())
        AND r.status = 'active' AND r.verified_at IS NOT NULL));

CREATE OR REPLACE FUNCTION public.search_map_places(p_area_id text, p_query text, p_limit integer DEFAULT 8)
RETURNS TABLE (id uuid, area_id text, name text, address text, longitude double precision,
    latitude double precision, position_basis text, source text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
    WITH tokens AS (
        SELECT token FROM regexp_split_to_table(lower(btrim(p_query)), '[^[:alnum:]]+') AS token
        WHERE token <> ''
    )
    SELECT p.id, p.area_id, p.name, p.address, p.longitude, p.latitude, p.position_basis, p.source
    FROM public.map_places p
    WHERE p.area_id = p_area_id AND char_length(btrim(p_query)) BETWEEN 2 AND 160
      AND EXISTS (SELECT 1 FROM tokens)
      AND NOT EXISTS (SELECT 1 FROM tokens WHERE strpos(lower(p.name || ' ' || p.address), token) = 0)
    ORDER BY (lower(p.name) = lower(btrim(p_query))) DESC,
        (strpos(lower(p.name), lower(btrim(p_query))) = 1) DESC, char_length(p.name), p.name, p.id
    LIMIT greatest(1, least(coalesce(p_limit, 8), 8));
$$;
REVOKE ALL ON FUNCTION public.search_map_places(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_map_places(text, text, integer) TO authenticated;
COMMENT ON TABLE public.map_places IS 'OSM named places, addresses and reference coordinates; ODbL. Not access or safety evidence.';
NOTIFY pgrst, 'reload schema';
COMMIT;
