// Kept as a type-only compatibility module for the existing page components.
// Real report records are loaded from the management API; no sample records live here.
import type { ApiReportStatus, ManagementReport } from '@/lib/api';

export type { ManagementReport };
export type ManagementReportStatus = ApiReportStatus;

export const reportStatusLabels: Record<ManagementReportStatus, string> = {
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected',
  in_progress: 'In progress',
  resolved: 'Resolved',
};
