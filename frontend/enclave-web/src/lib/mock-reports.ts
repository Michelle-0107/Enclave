export type ManagementReportStatus =
  | 'pending'
  | 'approved'
  | 'in-progress'
  | 'awaiting-verification'
  | 'resolved'
  | 'needs-information';

export type ManagementReport = {
  id: string;
  title: string;
  location: string;
  status: ManagementReportStatus;
  priority: 'Low' | 'Medium' | 'High';
  description: string;
  category: string;
  submittedAt: string;
};

export const reportStatusLabels: Record<
  ManagementReportStatus,
  string
> = {
  pending: 'Pending review',
  approved: 'Approved',
  'in-progress': 'In progress',
  'awaiting-verification': 'Awaiting verification',
  resolved: 'Resolved',
  'needs-information': 'Needs information',
};

export const mockReports: ManagementReport[] = [
  {
    id: 'HP-1024',
    title: 'Streetlight malfunction',
    location: 'Park Entrance',
    status: 'pending',
    priority: 'High',
    description:
      'The streetlight near the park entrance does not turn on at night.',
    category: 'Streetlight',
    submittedAt: '14 Oct 2026',
  },
  {
    id: 'HP-1025',
    title: 'Broken kerb ramp',
    location: 'Lake Walk',
    status: 'approved',
    priority: 'High',
    description:
      'The kerb ramp is cracked and uneven.',
    category: 'Accessibility',
    submittedAt: '13 Oct 2026',
  },
  {
    id: 'HP-1012',
    title: 'Bench repair submitted',
    location: 'Community Garden',
    status: 'awaiting-verification',
    priority: 'Medium',
    description:
      'Maintenance has submitted the bench repair for management verification.',
    category: 'Facility',
    submittedAt: '10 Oct 2026',
  },
];