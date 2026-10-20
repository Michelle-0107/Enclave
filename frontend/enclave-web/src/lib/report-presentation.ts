import type { ApiReportStatus } from './api';
import type { TaskStatus } from './maintenance/types';

export const tones = {
  amber: { color: '#8A5912', backgroundColor: '#FFF1DA' },
  green: { color: '#276443', backgroundColor: '#E3F1E9' },
  red: { color: '#A13832', backgroundColor: '#F9E7E5' },
  blue: { color: '#315F91', backgroundColor: '#E7EFF9' },
  teal: { color: '#216E71', backgroundColor: '#DFF3F2' },
  purple: { color: '#6D5685', backgroundColor: '#EEE8F4' },
  grey: { color: '#59616E', backgroundColor: '#ECEEF1' },
} as const;
export const reportTones: Record<ApiReportStatus, keyof typeof tones> = {
  pending: 'amber', approved: 'blue', rejected: 'red', in_progress: 'purple', resolved: 'teal',
};
export const reportStatuses: ApiReportStatus[] = ['pending', 'approved', 'in_progress', 'resolved', 'rejected'];
export const taskTones: Record<TaskStatus, keyof typeof tones> = {
  assigned: 'blue', 'in-progress': 'purple', 'awaiting-verification': 'amber', 'changes-requested': 'red', resolved: 'teal',
};
export function priorityTone(priority: string) {
  return priority === 'High' ? tones.red : priority === 'Medium' ? tones.amber : priority === 'Low' ? tones.blue : tones.grey;
}
