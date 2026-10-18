'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  ApiError,
  getReportHistory,
  updateReportStatus,
  type ManagementReport,
  type StatusEvent,
  type ApiReportStatus,
} from '@/lib/api';
import { reportStatusLabels } from '@/lib/mock-reports';
import ReportLocationMap from '@/components/management/ReportLocationMap';

type Props = { report: ManagementReport };

export default function ReportDetails({ report: initialReport }: Props) {
  const [report, setReport] = useState(initialReport);
  const [history, setHistory] = useState<StatusEvent[]>([]);
  const [note, setNote] = useState('');
  const [repairVerified, setRepairVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState('');
  const [photoExpanded, setPhotoExpanded] = useState(false);

  useEffect(() => {
    if (!photoExpanded) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setPhotoExpanded(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [photoExpanded]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await getReportHistory(report.id);
      setHistory(response.items);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load report history.');
    } finally {
      setHistoryLoading(false);
    }
  }, [report.id]);

  useEffect(() => {
    let active = true;
    getReportHistory(report.id)
      .then((response) => { if (active) setHistory(response.items); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load report history.'); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, [report.id]);

  async function transition(status: ApiReportStatus) {
    const trimmedNote = note.trim();
    if (!trimmedNote) {
      setError('Add a resident-visible note before changing the report status.');
      return;
    }
    if (status === 'resolved' && !repairVerified) {
      setError('Confirm the repair was checked on site before marking it resolved.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const result = await updateReportStatus(report.id, {
        expected_status: report.status,
        status,
        note: trimmedNote,
        ...(status === 'resolved' ? { repair_verified: true } : {}),
      });
      setReport(result.report);
      setNote('');
      setRepairVerified(false);
      setHistory((items) => [...items, result.event]);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        setError('Another manager changed this report. Refresh the page and try again.');
      } else {
        setError(reason instanceof Error ? reason.message : 'The status update failed.');
      }
    } finally {
      setSaving(false);
    }
  }

  const statusColor = report.status === 'resolved'
    ? 'bg-status-green-bg text-status-green'
    : report.status === 'rejected'
      ? 'bg-status-red-bg text-status-red'
      : 'bg-status-orange-bg text-status-orange';

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[30px] font-semibold leading-[1.35] text-primary lg:text-[36px]">{report.title}</h1>
      <p className="text-sm leading-relaxed text-muted-foreground">#{report.id} · Submitted {report.submittedAt}</p>
      <div className={`inline-flex w-fit items-center gap-2 rounded-lg px-3 py-2 text-xs ${statusColor}`}>
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {reportStatusLabels[report.status]}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <section aria-label="Report evidence" className="flex min-w-0 flex-col gap-4">
          {report.imageUrl ? (
            <div className="relative h-[240px] overflow-hidden rounded-3xl bg-enclave-lavender p-3">
              <Image src={report.imageUrl} alt={`Resident evidence for ${report.title}`} fill unoptimized sizes="(max-width: 1024px) 100vw, 50vw" className="object-contain p-3" />
              <button type="button" onClick={() => setPhotoExpanded(true)} className="absolute right-4 bottom-4 z-10 min-h-10 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground shadow" aria-label="Expand report photo">Expand photo</button>
            </div>
          ) : (
            <div className="flex min-h-[180px] items-center justify-center rounded-3xl bg-enclave-lavender p-5 text-sm text-muted-foreground">
              No photo was attached to this report.
            </div>
          )}
        </section>

        <section aria-label="Backend report data" className="flex flex-col gap-4 self-start rounded-3xl bg-enclave-lavender p-5 lg:min-h-[240px]">
          <h2 className="text-lg font-semibold text-primary">Report details</h2>
          <dl className="grid gap-4 text-sm">
            <div><dt className="font-semibold text-primary">Category</dt><dd className="mt-1 text-muted-foreground">{report.category}</dd></div>
            <div><dt className="font-semibold text-primary">Priority</dt><dd className="mt-1 text-muted-foreground">{report.priority}</dd></div>
            <div>
              <dt className="font-semibold text-primary">Resident description</dt>
              <dd className="mt-1 whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {report.description || 'No description provided.'}
              </dd>
            </div>
          </dl>
          <p className="text-xs leading-relaxed text-muted-foreground">
            These fields are read from the report API. The current backend has no endpoint for editing category or priority, and no task-assignment endpoint.
          </p>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <section aria-label="Issue location" className="flex min-w-0 flex-col gap-3">
          <h2 className="text-sm font-semibold text-primary">Issue location</h2>
          <ReportLocationMap latitude={report.latitude} longitude={report.longitude} />
        </section>

        {['pending', 'approved', 'in_progress'].includes(report.status) && (
        <section aria-labelledby="status-action-heading" className="flex min-w-0 flex-col gap-4 rounded-3xl border border-border bg-white p-5">
          <h2 id="status-action-heading" className="text-lg font-semibold text-primary">
            {report.status === 'pending' ? 'Review report' : report.status === 'approved' ? 'Start repair work' : 'Verify repair'}
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            The note is visible to the resident. Keep private staff details out of it.
          </p>
          <Textarea
            value={note}
            onChange={(event) => { setNote(event.target.value); setError(''); }}
            maxLength={1000}
            placeholder="Write a short status note for the resident"
            className="min-h-[100px] rounded-2xl bg-white p-4 text-sm leading-relaxed shadow-none"
          />
          {report.status === 'in_progress' && (
            <label className="flex items-start gap-3 text-sm leading-relaxed text-primary">
              <input type="checkbox" checked={repairVerified} onChange={(event) => setRepairVerified(event.target.checked)} className="mt-1 size-4 accent-primary" />
              I confirm the repair has been checked on site.
            </label>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            {report.status === 'pending' && (
              <>
                <Button type="button" disabled={saving} onClick={() => void transition('approved')} className="min-h-[50px] rounded-2xl bg-primary px-5 text-primary-foreground">{saving ? 'Saving…' : 'Approve report'}</Button>
                <Button type="button" disabled={saving} onClick={() => void transition('rejected')} className="min-h-[50px] rounded-2xl bg-status-red-bg px-5 text-status-red hover:bg-status-red-bg">Reject report</Button>
              </>
            )}
            {report.status === 'approved' && (
              <Button type="button" disabled={saving} onClick={() => void transition('in_progress')} className="min-h-[50px] rounded-2xl bg-primary px-5 text-primary-foreground">{saving ? 'Saving…' : 'Mark work in progress'}</Button>
            )}
            {report.status === 'in_progress' && (
              <Button type="button" disabled={saving} onClick={() => void transition('resolved')} className="min-h-[50px] rounded-2xl bg-primary px-5 text-primary-foreground">{saving ? 'Saving…' : 'Mark resolved'}</Button>
            )}
          </div>
          {error && <p role="alert" className="text-sm text-status-red">{error}</p>}
          {report.status === 'pending' && (
            <p className="text-xs leading-relaxed text-muted-foreground">Approval changes the report status. The backend does not currently create or assign a maintenance task.</p>
          )}
        </section>
        )}

        {report.status === 'rejected' && <p className="self-start rounded-2xl bg-status-red-bg p-4 text-sm text-status-red">This report is rejected. The backend does not allow further status changes.</p>}
        {report.status === 'resolved' && <p className="self-start rounded-2xl bg-status-green-bg p-4 text-sm text-status-green">This report is resolved and has been marked as checked by management.</p>}
      </div>

      <section aria-labelledby="history-heading" className="flex flex-col gap-3">
        <h2 id="history-heading" className="text-lg font-semibold text-primary">Status history</h2>
        {historyLoading ? (
          <p className="text-sm text-muted-foreground">Loading status history…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No status history is recorded for this report yet.</p>
        ) : history.map((event) => (
          <article key={event.id} className="rounded-2xl border border-border p-4">
            <p className="text-sm font-semibold text-primary">{reportStatusLabels[event.from_status]} → {reportStatusLabels[event.to_status]}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{event.note}</p>
            <time className="mt-2 block text-xs text-muted-foreground" dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time>
          </article>
        ))}
        {!historyLoading && error && <button type="button" onClick={() => void loadHistory()} className="w-fit text-xs font-semibold text-primary underline">Refresh history</button>}
      </section>

      {photoExpanded && report.imageUrl && (
        <div role="dialog" aria-modal="true" aria-label="Expanded report photo" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 p-5" onClick={() => setPhotoExpanded(false)}>
          <button type="button" onClick={() => setPhotoExpanded(false)} className="absolute top-5 right-5 z-10 min-h-11 rounded-full bg-white/15 px-4 text-sm font-semibold text-white" aria-label="Close expanded photo">Close</button>
          <div className="relative h-[90vh] w-full max-w-6xl" onClick={(event) => event.stopPropagation()}>
            <Image src={report.imageUrl} alt={`Expanded resident evidence for ${report.title}`} fill unoptimized sizes="100vw" className="object-contain" />
          </div>
        </div>
      )}

      <Link href="/management/what-if" className="flex min-h-[52px] items-center justify-center rounded-2xl bg-enclave-lavender px-6 text-center text-sm font-semibold text-primary transition-opacity hover:opacity-80 sm:w-[320px]">
        Compare repair plans
      </Link>
    </div>
  );
}
