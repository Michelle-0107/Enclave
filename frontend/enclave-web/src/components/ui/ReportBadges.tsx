import type { ReactNode } from 'react';
import type { ApiReportStatus } from '@/lib/api';
import { reportStatusLabels } from '@/lib/mock-reports';
import { statusLabels, type TaskStatus } from '@/lib/maintenance/types';
import { tones, reportTones, taskTones, priorityTone } from '@/lib/report-presentation';

function Badge({ children, style, prominent = false }: { children: ReactNode; style: { color: string; backgroundColor: string }; prominent?: boolean }) {
  return <span style={style} className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold${prominent ? ' priority-badge-prominent' : ''}`}>
    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />{children}
  </span>;
}
export function ReportStatusBadge({ status, variant = 'badge' }: { status: ApiReportStatus; variant?: 'badge' | 'text' }) {
  const tone = tones[reportTones[status]];
  if (variant === 'text') {
    return <span style={{ color: tone.color }} className="report-status-text">
      <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />{reportStatusLabels[status]}
    </span>;
  }
  return <Badge style={tone}>{reportStatusLabels[status]}</Badge>;
}
export function TaskStatusBadge({ status, children }: { status: TaskStatus; children?: ReactNode }) {
  return <Badge style={tones[taskTones[status]]}>{children ?? statusLabels[status]}</Badge>;
}
export function PriorityBadge({ priority, prominent = false }: { priority: string; prominent?: boolean }) {
  return <Badge prominent={prominent} style={priorityTone(priority)}>{priority === 'Unassigned' ? 'Priority unassigned' : `${priority} priority`}</Badge>;
}

export function ReportStatusLegend() {
  return <div aria-label="Report status colours" className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
    <span className="font-semibold text-muted-foreground">Status colours</span>
    {(Object.keys(reportTones) as ApiReportStatus[]).map(status => <span key={status} className="inline-flex items-center gap-2" style={{ color: tones[reportTones[status]].color }}>
      <span aria-hidden="true" className="size-2 rounded-full bg-current" />{reportStatusLabels[status]}
    </span>)}
  </div>;
}
