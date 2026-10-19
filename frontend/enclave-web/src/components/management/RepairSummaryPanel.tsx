'use client';

import { useEffect, useState } from 'react';
import { getRepairSummary, type RepairSummary } from '@/lib/api';
import { formatRouteSeconds } from '@/lib/repairRouteView';

export default function RepairSummaryPanel({ simulationId, mode }: {
  simulationId: string; mode: 'avoid_damage' | 'accessible';
}) {
  const [answer, setAnswer] = useState<{ key: string; value: RepairSummary } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${simulationId}:${mode}:${attempt}`;
  useEffect(() => {
    let active = true;
    getRepairSummary(simulationId, mode).then(value => {
      if (active) setAnswer({ key, value });
    }).catch(() => {
      if (active) setFailure({ key, message: 'AI summary is unavailable. Route comparisons, entered repair prices and budget remain available above. If the comparison expired, run Compare again.' });
    });
    return () => { active = false; };
  }, [simulationId, mode, key]);
  const summary = answer?.key === key ? answer.value : null;
  const error = failure?.key === key ? failure.message : null;
  const facts = summary?.facts;
  return <section className="rounded-3xl border border-border bg-card p-5" aria-label="AI summary of all routes">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-lg font-semibold text-primary">AI summary · {mode === 'accessible' ? 'Accessible' : 'Avoid damage'}</h3>
      {summary && <span className="rounded-full bg-enclave-lavender px-3 py-1 text-xs font-semibold text-primary">
        {summary.source === 'ai' ? 'AI explanation · calculated ranking' : 'Calculated summary · AI unavailable'}
      </span>}
    </div>
    {!summary && !error && <p role="status" className="mt-3 text-sm text-muted-foreground">Generating the summary… Route comparison is ready to use.</p>}
    {error && <div role="status" className="mt-3 text-sm text-muted-foreground">
      <p>{error}</p><button type="button" className="mt-2 min-h-10 font-semibold text-primary underline" onClick={() => setAttempt(value => value + 1)}>Retry summary</button>
    </div>}
    {facts && <>
      <p className="mt-3 text-sm font-semibold text-primary">
        {facts.recommended_plan_ids.length
          ? `Recommended: ${facts.plans.filter(plan => facts.recommended_plan_ids.includes(plan.id)).map(plan => plan.name).join(' / ')}`
          : 'No time-based recommendation can be made from the comparable results.'}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">{facts.comparable_path_count} common comparable routes · {facts.excluded_path_count} excluded · Budget: {facts.budget_myr === null ? 'Not entered' : `MYR ${facts.budget_myr}`}</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {facts.plans.map(plan => <div key={plan.id} className="rounded-2xl border border-border p-4 text-sm">
          <h4 className="font-semibold text-primary">{plan.name}</h4>
          <p className="mt-2">Before: {formatRouteSeconds(facts.comparable_path_count ? plan.before_seconds : null)} · After: {formatRouteSeconds(facts.comparable_path_count ? plan.after_seconds : null)}</p>
          <p className="mt-1 font-semibold">{plan.saved_seconds >= 0 ? 'Time saved' : 'Extra time'}: {formatRouteSeconds(facts.comparable_path_count ? Math.abs(plan.saved_seconds) : null)}</p>
          <p className="mt-1">Repair cost: {plan.cost_myr === null ? 'Unknown / incomplete' : `MYR ${plan.cost_myr}`}</p>
          <p className="mt-1">Budget: {plan.budget_status.replaceAll('_', ' ')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{plan.restored_paths} newly available · {plan.unavailable_after_paths} unavailable / unassessed after repairs</p>
        </div>)}
      </div>
      <p className="mt-4 text-sm leading-relaxed text-primary">{summary.text}</p>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{facts.explanation}</p>
    </>}
  </section>;
}
