import type { ReactNode } from 'react';
import type { ApiReportStatus } from '@/lib/api';
import { reportStatusLabels } from '@/lib/mock-reports';
import { statusLabels, type TaskStatus } from '@/lib/maintenance/types';
import { tones, reportTones, taskTones, priorityTone } from '@/lib/report-presentation';

function Badge({ children, style }: { children: ReactNode; style: { color: string; backgroundColor: string } }) {
  return <span style={style} className="inline-flex w-fit items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold">
    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />{children}
  </span>;
}
export function ReportStatusBadge({ status }: { status: ApiReportStatus }) {
  return <Badge style={tones[reportTones[status]]}>{reportStatusLabels[status]}</Badge>;
}
export function TaskStatusBadge({ status, children }: { status: TaskStatus; children?: ReactNode }) {
  return <Badge style={tones[taskTones[status]]}>{children ?? statusLabels[status]}</Badge>;
}
export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge style={priorityTone(priority)}>{priority === 'Unassigned' ? 'Priority unassigned' : `${priority} priority`}</Badge>;
}
