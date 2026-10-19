'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, type ManagementReport } from '@/lib/api';
import { assignMaintenance, getMaintenanceStaff, getMaintenanceTeams, getReportTask, reassignMaintenance, reviewMaintenance,
  type BackendTask, type Staff, type Team } from '@/lib/maintenance/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Photo, control } from '@/components/maintenance/Common';
import WorkflowGuide from '@/components/ui/WorkflowGuide';
import TaskHistory from '@/components/maintenance/TaskHistory';

export default function MaintenanceTaskPanel({ report, onChange }: { report: ManagementReport; onChange: (task: BackendTask) => void }) {
  const [task, setTask] = useState<BackendTask | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [assignee, setAssignee] = useState('');
  const [date, setDate] = useState('');
  const [instructions, setInstructions] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(report.priority === 'High' ? 'high' : report.priority === 'Low' ? 'low' : 'medium');
  const [note, setNote] = useState('');
  const [publicNote, setPublicNote] = useState('');
  const [verified, setVerified] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [task, staff, teams] = await Promise.all([getReportTask(report.id), getMaintenanceStaff(), getMaintenanceTeams()]);
      setTask(task); setStaff(staff.filter(person => person.active)); setTeams(teams); setLoaded(true);
      if (task) onChange(task);
    } catch (reason) { setLoaded(false); setError(reason instanceof Error ? reason.message : 'Unable to load maintenance assignment.'); }
    finally { setLoading(false); }
  }, [report.id, onChange]);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const [task, staff, teams] = await Promise.all([getReportTask(report.id), getMaintenanceStaff(), getMaintenanceTeams()]);
        if (live) { setTask(task); setStaff(staff.filter(person => person.active)); setTeams(teams); setLoaded(true); setError(''); if (task) onChange(task); }
      } catch (reason) { if (live) { setLoaded(false); setError(reason instanceof Error ? reason.message : 'Unable to load maintenance assignment.'); } }
      finally { if (live) setLoading(false); }
    };
    void refresh(); window.addEventListener('focus', refresh);
    return () => { live = false; window.removeEventListener('focus', refresh); };
  }, [report.id, onChange]);
  const options = <>
    <option value="">Choose staff or team</option>
    <optgroup label="Staff">{staff.map(person => <option key={person.profile_id} value={`staff:${person.profile_id}`}>{person.display_name}</option>)}</optgroup>
    <optgroup label="Teams">{teams.filter(team => staff.some(person => person.team_id === team.id)).map(team => <option key={team.id} value={`team:${team.id}`}>{team.name}</option>)}</optgroup>
  </>;
  function assignment() {
    const [kind, id] = assignee.split(':');
    if (!id || !['staff', 'team'].includes(kind)) throw new Error('Choose an active staff member or team.');
    return { assigned_staff_id: kind === 'staff' ? id : null, assigned_team_id: kind === 'team' ? id : null };
  }
  async function save(operation: () => Promise<BackendTask>, success: string) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { const item = await operation(); setTask(item); onChange(item); setNotice(success); setVerified(false); }
    catch (reason) {
      if (reason instanceof ApiError && [404, 409].includes(reason.status)) await load();
      setError(reason instanceof Error ? reason.message : 'Unable to save maintenance task.');
    } finally { setBusy(false); }
  }
  function assign(event: FormEvent) {
    event.preventDefault();
    if (!instructions.trim()) { setError('Enter repair instructions.'); return; }
    void save(() => assignMaintenance({ ticket_id: report.id, title: report.title, instructions: instructions.trim(),
      target_date: date, priority, ...assignment() }), 'Task assigned. The assignee can now see it in maintenance.');
  }
  function review(decision: 'approve' | 'rework') {
    if (!task) return;
    if (!note.trim() || (decision === 'approve' && (!verified || !publicNote.trim()))) {
      setError('Add an internal review note. Approval also requires a resident update and confirmation of the on-site check.'); return;
    }
    void save(() => reviewMaintenance(task, decision, note.trim(), publicNote.trim()),
      decision === 'approve' ? 'Repair verified and report resolved.' : 'Rework requested. The assigned staff have been notified.');
  }
  return <section className="flex flex-1 flex-col gap-5 rounded-3xl border border-border bg-white p-5" aria-label="Maintenance assignment and verification">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Maintenance task</h2>
      <button type="button" disabled={loading || busy} onClick={() => void load()} className="text-sm font-semibold underline">Refresh</button></div>
    {loading && <p role="status">Loading maintenance task…</p>}
    {error && <p role="alert" className="text-sm text-status-red">{error}</p>}
    {notice && <p role="status" className="text-sm text-status-green">{notice}</p>}
    {!loading && loaded && <WorkflowGuide
      steps={['Review', 'Assign', 'Repair', 'Verify', 'Resolved']}
      active={!task ? 1 : task.status === 'resolved' ? 4 : task.status === 'awaiting_verification' ? 3 : 2}
      next={!task ? 'Next: choose staff or a team, set a target date, and assign this repair.' : task.status === 'awaiting_verification' ? 'Next: review the completion evidence. Verify the repair or request rework below.' : task.status === 'resolved' ? 'Complete: the repair is verified and the resident report is resolved.' : task.status === 'changes_requested' ? 'Waiting for maintenance to address your feedback and resubmit evidence.' : task.status === 'assigned' ? 'Waiting for the assigned maintenance staff to start work.' : 'Repair in progress. Review the evidence once maintenance submits it.'}
    />}

    {!loading && loaded && !task && ['approved', 'in_progress'].includes(report.status) && <form onSubmit={assign} className="flex flex-col gap-4">
      {!staff.length && <p>No active maintenance staff are available. Ask your administrator to set up staff accounts.</p>}
      <label className="flex flex-col gap-2 text-sm">Assign to<select required disabled={busy} value={assignee} onChange={event => setAssignee(event.target.value)} className={control}>{options}</select></label>
      <label className="flex flex-col gap-2 text-sm">Target completion<Input type="date" required value={date} disabled={busy} onChange={event => setDate(event.target.value)} /></label>
      <label className="flex flex-col gap-2 text-sm">Task priority<select value={priority} disabled={busy} onChange={event => setPriority(event.target.value as typeof priority)} className={control}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <label className="flex flex-col gap-2 text-sm">Repair instructions<Textarea required maxLength={2000} disabled={busy} value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
      <Button type="submit" disabled={busy || !staff.length}>{busy ? 'Assigning…' : 'Assign task & notify'}</Button>
    </form>}
    {!loading && loaded && !task && report.status === 'resolved' && <p>No maintenance task is linked to this report.</p>}
    {!loading && loaded && task && <>
      <p className="text-sm font-semibold capitalize">{task.status.replaceAll('_', ' ')}</p>
      <p className="text-sm">{teams.find(team => team.id === task.assigned_team_id)?.name ?? staff.find(person => person.profile_id === task.assigned_staff_id)?.display_name ?? 'Previously assigned staff'} · Due {task.target_date}</p>
      <p className="whitespace-pre-wrap text-sm">{task.instructions}</p>
      {task.work_notes && <div><h3 className="font-semibold">Work notes</h3><p className="whitespace-pre-wrap text-sm">{task.work_notes}</p></div>}
      {['awaiting_verification', 'changes_requested', 'resolved'].includes(task.status) && <>
        <div className="grid gap-4 md:grid-cols-2"><Photo label="Before repair" url={task.before_photo_url ?? undefined} /><Photo label="After repair" url={task.after_photo_url ?? undefined} /></div>
        <div><h3 className="font-semibold">Completion notes</h3><p className="whitespace-pre-wrap text-sm">{task.completion_notes}</p></div>
        {task.review_note && <p className="whitespace-pre-wrap text-sm">Review: {task.review_note}</p>}
      </>}
      {task.status === 'awaiting_verification' && <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-sm">Internal review note<Textarea maxLength={2000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
        <label className="flex flex-col gap-2 text-sm">Update visible to resident<Textarea maxLength={1000} value={publicNote} disabled={busy} onChange={event => setPublicNote(event.target.value)} /></label>
        <label className="flex gap-3 text-sm"><input type="checkbox" checked={verified} disabled={busy} onChange={event => setVerified(event.target.checked)} />I confirm the repair has been checked on site.</label>
        <div className="flex flex-wrap gap-3"><Button type="button" disabled={busy} onClick={() => review('approve')}>Verify repair & resolve report</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => review('rework')}>Request rework</Button></div>
      </div>}
      {['assigned', 'in_progress', 'changes_requested'].includes(task.status) && <details><summary className="cursor-pointer text-sm font-semibold">Reassign task</summary>
        <form onSubmit={event => { event.preventDefault(); void save(() => reassignMaintenance(task, assignment(), note.trim()), 'Task reassigned.'); }} className="mt-4 flex flex-col gap-3">
          <select aria-label="New assignee" required disabled={busy} value={assignee} onChange={event => setAssignee(event.target.value)} className={control}>{options}</select>
          <Textarea aria-label="Reassignment reason" required maxLength={2000} value={note} disabled={busy} onChange={event => setNote(event.target.value)} placeholder="Reason for reassignment" />
          <Button type="submit" disabled={busy}>Reassign & notify</Button>
        </form></details>}
      <TaskHistory id={task.id} updatedAt={task.updated_at} manager />
    </>}
  </section>;
}
