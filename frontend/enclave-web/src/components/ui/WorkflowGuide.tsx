import type { ReactNode } from 'react';

export default function WorkflowGuide({ steps, active, next, children }: {
  steps: string[]; active: number; next: string; children?: ReactNode;
}) {
  return <aside aria-label="Workflow progress" className="rounded-2xl border border-border bg-card p-4">
    <ol className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {steps.map((label, index) => <li key={label} aria-current={index === active ? 'step' : undefined} className={index === active ? 'font-semibold text-primary' : ''}>{index < active ? '✓ ' : `${index + 1}. `}{label}</li>)}
    </ol>
    <p className="mt-3 text-sm font-semibold">{next}</p>
    {children}
  </aside>;
}
