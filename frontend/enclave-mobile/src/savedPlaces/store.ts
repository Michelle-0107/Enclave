import type { SupabaseClient } from '@supabase/supabase-js';

export type PlacePoint = { label: string; coordinate: [number, number] };
export type SavedPlace = PlacePoint & { id: string };
const columns = 'id,name,latitude,longitude';

export function placeInput(point: PlacePoint) {
  const name = point.label.trim().replace(/\s+/g, ' ');
  const [longitude, latitude] = point.coordinate;
  if (!name || name.length > 60) throw new Error('Use a place name between 1 and 60 characters.');
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Choose a valid point on the map first.');
  }
  return { name, latitude, longitude };
}

function fail(error: { code?: string } | null) {
  if (!error) return;
  if (error.code === '23505') throw new Error('You already have a place with this name. Edit it or choose another name.');
  if (error.code === '42P01' || error.code === 'PGRST205') {
    throw new Error('Saved places are not enabled yet. Ask the team to apply database migration 012.');
  }
  if (error.code === '42501') throw new Error('Saved places access was denied. Please sign in again or contact the team.');
  throw new Error('Could not sync saved places. Check your connection and retry.');
}

function place(row: { id: string; name: string; latitude: number; longitude: number }): SavedPlace {
  return { id: row.id, label: row.name, coordinate: [row.longitude, row.latitude] };
}

// The public client uses the signed-in user's JWT. SQL 012 enforces ownership;
// explicit owner filters are an additional guard, never a substitute for RLS.
export function createSavedPlacesStore(client: SupabaseClient) {
  async function owner() {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw new Error('Please sign in again to use your saved places.');
    return data.user.id;
  }
  return {
    async list(): Promise<SavedPlace[]> {
      const userId = await owner();
      const { data, error } = await client.from('user_saved_places').select(columns).eq('user_id', userId).order('name');
      fail(error);
      return (data ?? []).map(place);
    },
    async save(point: PlacePoint, id?: string): Promise<SavedPlace> {
      const values = placeInput(point);
      const userId = await owner();
      const query = id
        ? client.from('user_saved_places').update(values).eq('id', id).eq('user_id', userId)
        : client.from('user_saved_places').insert({ ...values, user_id: userId });
      const { data, error } = await query.select(columns).single();
      fail(error);
      if (!data) throw new Error('This saved place no longer exists. Refresh and try again.');
      return place(data);
    },
    async remove(id: string): Promise<void> {
      const userId = await owner();
      const { error } = await client.from('user_saved_places').delete().eq('id', id).eq('user_id', userId);
      fail(error);
    },
  };
}
