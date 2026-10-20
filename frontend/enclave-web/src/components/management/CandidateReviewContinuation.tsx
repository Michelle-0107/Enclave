'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { getRepairCandidates, type RepairCandidate } from '@/lib/api';
import { readReview, remainingCandidates, reviewHref, saveReview, stopReview } from '@/lib/candidateReview';

export default function CandidateReviewContinuation({ reviewKey, reportId, approvalSaved }: {
  reviewKey: string; reportId: string; approvalSaved: boolean;
}) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<RepairCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!approvalSaved) return;
    let active = true;
    async function check() {
      try {
        const queue = readReview(sessionStorage, reviewKey, reportId);
        if (!queue) return;
        const { issues } = await getRepairCandidates();
        if (!active) return;
        const next = remainingCandidates(queue, issues);
        if (next.length) { setPending(next); setOpen(true); }
        else {
          stopReview(sessionStorage, reviewKey);
          setMessage('All candidates in this plan have been reviewed.');
        }
      } catch {
        if (active) setError('Report approved. Unable to check the remaining candidates.');
      }
    }
    void check();
    return () => { active = false; };
  }, [approvalSaved, reviewKey, reportId, attempt]);

  function stop() {
    stopReview(sessionStorage, reviewKey);
    setOpen(false);
    setError('');
    setMessage('Candidate review stopped. Your approval has been saved.');
  }

  async function goNext() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const queue = readReview(sessionStorage, reviewKey, reportId);
      if (!queue) { setOpen(false); setMessage('This candidate review session has ended.'); return; }
      // Another manager may have approved the next issue while the dialog was open.
      const { issues } = await getRepairCandidates();
      const next = remainingCandidates(queue, issues);
      if (!next.length) {
        stopReview(sessionStorage, reviewKey);
        setOpen(false);
        setMessage('All candidates in this plan have been reviewed.');
        return;
      }
      const first = next[0];
      saveReview(sessionStorage, reviewKey, { ...queue, issueIds: next.map(item => item.id),
        currentIssueId: first.id, currentTicketId: first.review_ticket_id });
      router.push(reviewHref(first.review_ticket_id, reviewKey));
    } catch { setError('Your approval is saved. Unable to open the next candidate. Please try again.'); }
    finally { setBusy(false); }
  }

  if (!approvalSaved) return null;
  return <>
    {message && <p role="status" className="rounded-2xl bg-enclave-lavender p-4 text-sm text-primary">{message}</p>}
    {error && !open && <div role="status" className="rounded-2xl border p-4 text-sm">
      <p>{error}</p><button type="button" className="mt-2 min-h-10 font-semibold underline" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry remaining candidates</button>
      <button type="button" className="ml-4 min-h-10 underline" onClick={stop}>Stop review</button>
    </div>}
    <Dialog open={open} onOpenChange={value => { if (!value && !busy) stop(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Review the next candidate?</DialogTitle>
          <DialogDescription>This repair plan has more than one qualified candidate. Your report has been approved. {pending.length} candidate{pending.length === 1 ? '' : 's'} remain. Would you like to go to the next candidate?</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-status-red">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={stop}>No, stop here</Button>
          <Button type="button" disabled={busy} onClick={() => void goNext()}>{busy ? 'Checking…' : 'Yes, next candidate'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
