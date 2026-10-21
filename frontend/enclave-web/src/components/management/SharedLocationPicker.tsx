"use client";
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { DataSkeleton } from '@/components/ui/DataSkeleton';

type Point = { latitude: number; longitude: number };
type Location = Point & { id: string; name: string; address: string; distance_meters: number | null };
type Page = { area_id: string; items: Location[]; storage: 'database' };
export default function SharedLocationPicker({ label, point, onChoose }: {
  label: string; point: Point | null; onChoose: (point: Point) => void;
}) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ scope: string; items: Location[] } | null>(null);
  const [named, setNamed] = useState<{ key: string; text: string } | null>(null);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const version = useRef(0);
  const latitude = point?.latitude; const longitude = point?.longitude;
  const key = `${latitude},${longitude}`;
  // What-if currently supports the KL East community reporting area.
  useEffect(() => {
    let current = true;
    if (latitude === undefined || longitude === undefined) return;
    const params = new URLSearchParams({ area_id: 'kl-east-pilot', latitude: String(latitude), longitude: String(longitude), limit: '1' });
    const timer = setTimeout(() => {
      apiRequest<Page>(`/api/v1/locations?${params}`).then(page => {
        if (!current) return;
        if (page.area_id !== 'kl-east-pilot' || page.storage !== 'database') throw new Error('Location results do not match this area.');
        const item = page.items[0];
        setNamed({ key, text: item ? `${(item.distance_meters ?? 0) > 1 ? 'Near ' : ''}${item.name}` : 'Selected map point' });
      }).catch(() => { if (current) setNamed({ key, text: 'Selected map point · place lookup unavailable' }); });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  }, [latitude, longitude, key]);
  useEffect(() => () => { version.current += 1; }, []);
  async function search() {
    if (query.trim().length < 2) return;
    const request = ++version.current; const scope = query.trim();
    setBusy(true); setFailure('');
    try {
      const params = new URLSearchParams({ area_id: 'kl-east-pilot', q: scope, limit: '8' });
      const page = await apiRequest<Page>(`/api/v1/locations?${params}`);
      if (page.area_id !== 'kl-east-pilot' || page.storage !== 'database') throw new Error('Location results do not match this area.');
      if (request === version.current) setResult({ scope, items: page.items });
    } catch (error) {
      if (request === version.current) setFailure(error instanceof Error ? error.message : 'Place search unavailable.');
    } finally { if (request === version.current) setBusy(false); }
  }
  const items = result?.scope === query.trim() ? result.items : [];
  return <div className="flex flex-col gap-2 rounded-2xl border border-border p-3">
    <label className="text-xs font-semibold text-primary">{label}
      <input aria-label={`${label} place name`} value={query} onChange={event => { version.current += 1; setBusy(false); setQuery(event.target.value); }} maxLength={160}
        placeholder="Search a place, road or section" className="mt-1 min-h-11 w-full rounded-xl border border-border px-3 font-normal" />
    </label>
    <button type="button" disabled={busy || query.trim().length < 2} onClick={search} className="min-h-11 rounded-xl bg-enclave-lavender px-3 text-xs font-semibold text-primary disabled:opacity-50">Search locations</button>
    {busy && <DataSkeleton rows={2} variant="line" />}
    {items.map(item => <button key={item.id} type="button" onClick={() => { onChoose(item); setQuery(item.name); setResult(null); }} className="min-h-11 rounded-xl border border-border p-2 text-left text-sm text-primary">
      {item.name}{item.address && <span className="block text-xs text-muted-foreground">{item.address}</span>}
    </button>)}
    {result?.scope === query.trim() && !items.length && <p className="text-xs text-muted-foreground">No matching location. Choose the exact point on the map.</p>}
    {point && (named?.key === key ? <p className="text-sm text-primary">{named.text}</p> : <DataSkeleton rows={1} variant="line" />)}
    {failure && <p role="alert" className="text-xs text-status-red">{failure}</p>}
  </div>;
}
