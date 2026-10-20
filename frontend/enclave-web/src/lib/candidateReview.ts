import type { RepairCandidate, WhatIfResult } from './api';

const PREFIX = 'enclave-repair-review:';
const MAX_AGE = 2 * 60 * 60 * 1000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type ReviewQueue = {
  planName: string;
  issueIds: string[];
  currentIssueId: string;
  currentTicketId: string;
  createdAt: number;
};

export function reviewHref(ticket: string, key: string) {
  return `/management/reports/${encodeURIComponent(ticket)}?${new URLSearchParams({ repairReview: key })}`;
}

export function planCandidateIds(plan: WhatIfResult['plans'][number]) {
  return [...new Set(plan.facility_impacts?.flatMap(item => item.repaired_issue_ids ?? []) ?? [])];
}

export function currentCandidates(issueIds: string[], candidates: RepairCandidate[]) {
  const byId = new Map(candidates.filter(item => item.status === 'open' && item.reporter_count >= 2
    && item.review_ticket_id).map(item => [item.id, item]));
  return issueIds.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
}

export function remainingCandidates(queue: ReviewQueue, candidates: RepairCandidate[]) {
  return currentCandidates(queue.issueIds.filter(id => id !== queue.currentIssueId), candidates);
}

export function saveReview(storage: Storage, key: string, queue: ReviewQueue) {
  if (!uuid.test(key)) throw new Error('Invalid review session.');
  storage.setItem(PREFIX + key, JSON.stringify(queue));
}

export function stopReview(storage: Storage, key: string) {
  if (uuid.test(key)) storage.removeItem(PREFIX + key);
}

export function readReview(storage: Storage, key: string, ticket: string, now = Date.now()): ReviewQueue | null {
  if (!uuid.test(key)) return null;
  const raw = storage.getItem(PREFIX + key);
  if (!raw || raw.length > 10000) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || typeof data.planName !== 'string' || data.planName.length > 120
      || !Array.isArray(data.issueIds) || !data.issueIds.length || data.issueIds.length > 40
      || !data.issueIds.every((id: unknown) => typeof id === 'string' && uuid.test(id))
      || new Set(data.issueIds).size !== data.issueIds.length
      || !data.issueIds.includes(data.currentIssueId) || data.currentTicketId !== ticket
      || typeof data.createdAt !== 'number' || data.createdAt > now || now - data.createdAt > MAX_AGE) return null;
    return data as ReviewQueue;
  } catch { return null; }
}
