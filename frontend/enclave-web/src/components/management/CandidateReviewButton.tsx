'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { getRepairCandidates, type WhatIfResult } from '@/lib/api';
import { currentCandidates, planCandidateIds, reviewHref, saveReview } from '@/lib/candidateReview';

export default function CandidateReviewButton({ plan }: { plan: WhatIfResult['plans'][number] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function openFirst() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { issues } = await getRepairCandidates();
      // Use the compared plan's exact issue IDs, never facilities from another tied plan.
      const pending = currentCandidates(planCandidateIds(plan), issues);
      if (!pending.length) {
        setError('This plan has no candidates awaiting approval. Refresh candidates and compare again.');
        return;
      }
      const first = pending[0];
      const key = crypto.randomUUID();
      saveReview(sessionStorage, key, { planName: plan.name, issueIds: pending.map(item => item.id),
        currentIssueId: first.id, currentTicketId: first.review_ticket_id, createdAt: Date.now() });
      router.push(reviewHref(first.review_ticket_id, key));
    } catch {
      setError('Unable to open candidate reports. Check your connection and allow session storage, then try again.');
    } finally { setBusy(false); }
  }
  return <div>
    <button type="button" disabled={busy} onClick={() => void openFirst()}
      className="min-h-11 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-60">
      {busy ? 'Checking candidates…' : `Review candidates · ${plan.name}`}
    </button>
    {error && <p role="alert" className="mt-2 text-sm text-status-red">{error}</p>}
  </div>;
}
