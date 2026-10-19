'use client';

import { TaskStatusBadge, PriorityBadge } from '@/components/ui/ReportBadges';
import { taskTones, tones } from '@/lib/report-presentation';
import { useState } from 'react';
import Link from 'next/link';
import { Bell, ClipboardList, Wrench, ArrowUpRight } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMaintenance } from './MaintenanceProvider';
import { Heading, control } from './Common';
import { statusLabels, type MaintenanceTask } from '@/lib/maintenance/types';

export default function MyTasks() {
  const { tasks, loading, error, refresh } = useMaintenance();
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const assigned = tasks.find(t => t.status === 'assigned');
  const ongoing = tasks.find(t => t.status === 'changes-requested') ?? tasks.find(t => t.status === 'in-progress');
  const filtered = [...tasks].sort((a, b) => Number(b.status === 'changes-requested') - Number(a.status === 'changes-requested')).filter(t => (!status || t.status === status) && (!priority || t.priority === priority) && `${t.id} ${t.ticketId ?? ''} ${t.title} ${t.location}`.toLowerCase().includes(search.toLowerCase()));
  const stats = Object.entries(statusLabels).map(([status, label]) => ({ label, status, count: tasks.filter(task => task.status === status).length, tone: tones[taskTones[status as MaintenanceTask['status']]] }));
  function taskRow(task: MaintenanceTask) {
    const step = task.status === 'assigned' ? 'Review instructions & start work' : task.status === 'changes-requested' ? 'Review feedback & update evidence' : task.status === 'in-progress' ? 'Continue repair' : task.status === 'awaiting-verification' ? 'Waiting for management review' : 'View completed repair';
    return <Link key={task.id} href={`/maintenance/tasks/${encodeURIComponent(task.id)}`} className="flex items-center gap-4 py-5 focus-visible:outline-2 focus-visible:outline-ring"><span className="flex min-w-0 flex-1 flex-col gap-2"><span className="line-clamp-2 text-sm font-semibold">{task.title}</span><span className="line-clamp-1 text-xs text-muted-foreground">{task.location}</span><span className="text-xs font-semibold">{step} →</span></span><span className="report-row-badges"><TaskStatusBadge status={task.status} /><PriorityBadge priority={task.priority} /></span><ArrowUpRight size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" /></Link>;
  }
  return <section className="flex flex-col gap-7">
    <Heading title="Your tasks." subtitle="KL East · Your repair workspace." back={null} />
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">{stats.map(item => <button key={item.label} type="button" onClick={() => { setShowAll(true); setStatus(item.status); document.getElementById('task-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} style={item.tone} className="min-h-[124px] rounded-3xl p-5 text-left focus-visible:outline-2 focus-visible:outline-ring"><p className="text-[28px] font-semibold">{loading || error ? '—' : String(item.count).padStart(2, '0')}</p><p className="mt-3 text-xs font-semibold">{item.label}</p></button>)}</div>
    <section aria-labelledby="quick-heading"><h2 id="quick-heading" className="mb-4 text-lg font-semibold">Quick access</h2><div className="quick-access">
      <Link href={assigned ? `/maintenance/tasks/${encodeURIComponent(assigned.id)}` : '#task-list'}><ClipboardList size={23} aria-hidden="true" /><span className="font-semibold">Assigned task</span><span className="hidden text-xs text-muted-foreground sm:block">Check instructions</span></Link>
      <Link href={ongoing ? `/maintenance/tasks/${encodeURIComponent(ongoing.id)}/${ongoing.status === 'changes-requested' ? 'rework' : 'update'}` : '#task-list'}><Wrench size={23} aria-hidden="true" /><span className="font-semibold">Continue repair</span><span className="hidden text-xs text-muted-foreground sm:block">Update your progress</span></Link>
      <Link href="/maintenance/notifications"><Bell size={23} aria-hidden="true" /><span className="font-semibold">Notifications</span><span className="hidden text-xs text-muted-foreground sm:block">Assignments and feedback</span></Link>
    </div></section>
    <section id="task-list" className="scroll-mt-28" aria-labelledby="tasks-heading"><h2 id="tasks-heading" className="mb-4 text-lg font-semibold">Task overview</h2>
      <div className="mb-4 rounded-2xl border bg-card p-4"><Label htmlFor="task-search">Search tasks</Label><Input id="task-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search task ID, issue or location" className={`${control} mt-2`} />
        <div className="mt-3 grid grid-cols-2 gap-3"><label className="text-xs text-muted-foreground">Status<select value={status} onChange={e => setStatus(e.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-card px-3 text-sm"><option value="">All statuses</option>{Object.entries(statusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label className="text-xs text-muted-foreground">Priority<select value={priority} onChange={e => setPriority(e.target.value)} className="mt-2 h-11 w-full rounded-xl border bg-card px-3 text-sm"><option value="">All priorities</option>{['High', 'Medium', 'Low'].map(p => <option key={p}>{p}</option>)}</select></label></div>
      </div>
      {error && <p role="alert" className="mb-4 text-sm text-status-red">{error}</p>}
      <div className="divide-y rounded-3xl border bg-card px-5">{loading ? <p role="status" className="py-6 text-sm">Loading tasks…</p> : filtered.length ? (showAll ? filtered : filtered.slice(0, 3)).map(taskRow) : <p className="py-6 text-sm text-muted-foreground">No tasks match your search.</p>}</div>
      {filtered.length > 3 && <button type="button" onClick={() => setShowAll(value => !value)} className="mt-3 mr-5 min-h-11 text-sm font-semibold underline">{showAll ? 'Show fewer tasks' : `View all ${filtered.length} tasks`}</button>}
      <button type="button" disabled={loading} onClick={() => void refresh()} className="mt-3 min-h-11 text-sm font-semibold underline disabled:opacity-60">Refresh tasks</button>
    </section>

  </section>;
}
