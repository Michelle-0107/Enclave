'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { getActivityLogs, type ActivityLog, type ActivityLogPage } from '@/lib/activity-logs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
const empty = { search: '', role: '', result: '', from: '', to: '', offset: 0 };
function date(value: string) { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Date unavailable' : d.toLocaleString(); }
function Result({ value }: { value: ActivityLog['result'] }) { return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${value === 'success' ? 'bg-[#DFF3F2] text-[#216E71]' : 'bg-[#F9E7E5] text-[#A13832]'}`}>{value === 'success' ? 'Successful' : 'Failed'}</span>; }
export default function ActivityLogs() {
  const [draft, setDraft] = useState(empty);
  const [filters, setFilters] = useState(empty);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<ActivityLogPage>({ items: [], has_more: false });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<ActivityLog | null>(null);
  useEffect(() => {
    let live = true;
    async function load() {
      setBusy(true); setError(''); setData({ items: [], has_more: false });
      try { const value = await getActivityLogs(filters); if (live) setData(value); }
      catch (reason) { if (live) setError(reason instanceof Error ? reason.message : 'Unable to load activity logs.'); }
      finally { if (live) setBusy(false); }
    }
    void load();
    return () => { live = false; };
  }, [filters, revision]);
  function search(event: FormEvent) { event.preventDefault(); if (draft.from && draft.to && draft.from > draft.to) { setError('Choose an end date on or after the start date.'); return; } setFilters({ ...draft, offset: 0 }); }
  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-[30px] font-semibold lg:text-[36px]">Activity logs.</h1><p className="mt-2 text-sm text-muted-foreground">See who took action, what changed, and when.</p></div><Button variant="outline" disabled={busy} onClick={() => setRevision(v => v + 1)} className="min-h-11 rounded-xl"><RefreshCw size={16} />Refresh</Button></div>
    <form onSubmit={search} className="grid gap-4 rounded-3xl border bg-white p-5 sm:grid-cols-2 xl:grid-cols-3">
      <label className="flex flex-col gap-2 text-sm font-semibold">Search activity<input value={draft.search} onChange={e => setDraft({ ...draft, search: e.target.value })} placeholder="Name, action or record ID" className="min-h-11 rounded-xl border px-3 font-normal" /></label>
      <label className="flex flex-col gap-2 text-sm font-semibold">Role<select value={draft.role} onChange={e => setDraft({ ...draft, role: e.target.value })} className="min-h-11 rounded-xl border px-3 font-normal"><option value="">All roles</option><option value="management">Management</option><option value="maintenance">Maintenance</option><option value="resident">Resident</option><option value="system">System</option></select></label>
      <label className="flex flex-col gap-2 text-sm font-semibold">Result<select value={draft.result} onChange={e => setDraft({ ...draft, result: e.target.value })} className="min-h-11 rounded-xl border px-3 font-normal"><option value="">All results</option><option value="success">Successful</option><option value="failed">Failed</option></select></label>
      <label className="flex flex-col gap-2 text-sm font-semibold">From<input type="date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} className="min-h-11 min-w-0 rounded-xl border px-3 font-normal" /></label>
      <label className="flex flex-col gap-2 text-sm font-semibold">To<input type="date" value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} className="min-h-11 min-w-0 rounded-xl border px-3 font-normal" /></label>
      <div className="flex items-end gap-2"><Button type="submit" disabled={busy} className="min-h-11 flex-1 rounded-xl bg-brand text-white">Apply filters</Button><Button type="button" variant="outline" disabled={busy} className="min-h-11 rounded-xl" onClick={() => { setDraft(empty); setFilters({ ...empty }); }}>Clear</Button></div>
    </form>
    {error ? <div role="alert" className="rounded-2xl border border-[#F9E7E5] bg-white p-5 text-[#A13832]">{error}</div> : busy ? <p role="status" className="p-6 text-muted-foreground">Loading activity…</p> : !data.items.length ? <div className="flex flex-col items-center gap-3 rounded-3xl border bg-white p-10 text-center"><History className="text-muted-foreground" /><h2 className="font-semibold">No activity found</h2><p className="text-sm text-muted-foreground">Try changing your filters.</p></div> : <>
      <div className="hidden overflow-x-auto rounded-3xl border bg-white lg:block"><table className="w-full text-left text-sm"><caption className="sr-only">Management action history</caption><thead className="bg-[#EEF2F6] text-muted-foreground"><tr>{['Time', 'Performed by', 'Action', 'Record', 'Result', ''].map((label, i) => <th key={i} scope="col" className="p-4 font-semibold">{label}</th>)}</tr></thead><tbody>{data.items.map(item => <tr key={item.id} className="border-t"><td className="p-4 text-muted-foreground">{date(item.created_at)}</td><td className="p-4 font-semibold">{item.actor_name}<span className="mt-1 block text-xs font-normal capitalize text-muted-foreground">{item.actor_role}</span></td><td className="p-4">{item.action}</td><td className="p-4 break-words">{item.target_label}</td><td className="p-4"><Result value={item.result} /></td><td className="p-4"><button className="min-h-11 font-semibold text-[#526B8A] underline" onClick={() => setSelected(item)} aria-label={`View ${item.action} details`}>View details</button></td></tr>)}</tbody></table></div>
      <div className="flex flex-col gap-4 lg:hidden">{data.items.map(item => <article key={item.id} className="flex flex-col gap-3 rounded-2xl border bg-white p-5"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{item.action}</h2><Result value={item.result} /></div><p className="text-sm">{item.target_label}</p><p className="text-sm text-muted-foreground">{item.actor_name} · {item.actor_role}</p><time className="text-xs text-muted-foreground">{date(item.created_at)}</time><Button variant="outline" className="min-h-11 rounded-xl" onClick={() => setSelected(item)}>View details</Button></article>)}</div>
    </>}
    <div className="flex items-center justify-between gap-3 text-sm"><Button variant="outline" disabled={busy || filters.offset === 0} onClick={() => setFilters({ ...filters, offset: Math.max(0, filters.offset - 20) })}>Previous</Button><span>Page {Math.floor(filters.offset / 20) + 1}</span><Button variant="outline" disabled={busy || !!error || !data.has_more} onClick={() => setFilters({ ...filters, offset: filters.offset + 20 })}>Next</Button></div>
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-h-[85dvh] overflow-y-auto rounded-3xl p-6 sm:max-w-lg"><DialogTitle className="text-xl font-semibold">Activity details</DialogTitle><DialogDescription>Read-only record of a system action.</DialogDescription>{selected && <dl className="grid gap-3 text-sm">{[['Action', selected.action], ['Performed by', selected.actor_name], ['Role', selected.actor_role], ['Time', date(selected.created_at)], ['Record', selected.target_label], ['Record ID', selected.target_id || 'Not applicable'], ['Summary', selected.summary]].map(([label, value]) => <div key={label} className="border-b pb-3"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 break-words font-medium">{value}</dd></div>)}<div><dt className="mb-2 text-muted-foreground">Result</dt><dd><Result value={selected.result} /></dd></div></dl>}</DialogContent></Dialog>
  </div>;
}
