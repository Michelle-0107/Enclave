import { clearAuthSession, getValidAccessToken } from '@/lib/auth-session';

export type ApiReportStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'in_progress'
  | 'resolved';

export type BackendReport = {
  ticket_id: string;
  user_id: string;
  description: string;
  status: ApiReportStatus;
  created_at: string | null;
  latitude: number;
  longitude: number;
  image_url: string | null;
  category: string | null;
  priority: 'high' | 'medium' | 'low' | null;
  is_approved: boolean;
};

export type ManagementReport = {
  id: string;
  title: string;
  location: string;
  status: ApiReportStatus;
  priority: 'Low' | 'Medium' | 'High' | 'Unassigned';
  description: string;
  category: string;
  submittedAt: string;
  createdAt: string | null;
  imageUrl: string | null;
  latitude: number;
  longitude: number;
  isApproved: boolean;
};

export type ManagementReportList = {
  items: BackendReport[];
  limit: number;
  offset: number;
  has_more: boolean;
};

export type StatusEvent = {
  id: number;
  from_status: ApiReportStatus;
  to_status: ApiReportStatus;
  note: string;
  repair_verified: boolean;
  created_at: string;
  actor_role: 'management';
};

export type ReportHistory = {
  ticket_id: string;
  items: StatusEvent[];
  limit: number;
  offset: number;
  has_more: boolean;
};

export type StatusUpdate = {
  expected_status: ApiReportStatus;
  status: ApiReportStatus;
  note: string;
  repair_verified?: boolean;
};

export type CurrentUser = {
  user_id: string;
  email: string | null;
};

export type CreateResidentInput = {
  resident_reference: string;
  full_name: string;
  unit_number: string;
  registered_email: string;
};

export type CreateResidentResult = {
  resident_id: string;
};

export type InvitationResult = {
  invitation_id: string;
  resident_id: string;
  invitation_token: string;
  expires_at: string;
};

export type CreateNotificationInput = {
  title: string;
  message: string;
  expires_at?: string | null;
};

export type NotificationResult = {
  id: number;
  title: string;
  message: string;
  related_report_id: number | null;
  is_read: boolean;
  created_at: string;
  published_at: string | null;
  expires_at: string | null;
};

export type FacilityIssue = {
  id: string;
  facility_id: string;
  facility_name: string;
  facility_type: string;
  latitude: number;
  longitude: number;
  fault_kind: 'damage' | 'obstruction';
  status: 'open' | 'resolved';
  reporter_count: number;
  affects_routes: boolean;
  created_at: string;
  resolved_at: string | null;
};

export type RepairCandidates = {
  snapshot_at: string;
  issues: FacilityIssue[];
  confirmation_threshold: number;
  main_path_source: 'management_defined';
  currency: 'MYR';
  persistence: 'not_saved';
};

export type WhatIfPath = {
  id: string;
  name: string;
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
};

export type WhatIfPlan = {
  id: string;
  name: string;
  repairs: Array<{
    facility_id: string;
    estimated_cost_myr: string | null;
  }>;
};

export type RouteDetails = {
  distance_meters?: number | null;
  duration_seconds?: number | null;
  geometry?: { type: 'LineString'; coordinates: [number, number][] } | null;
  data_source?: string | null;
};

export type WalkingReference = RouteDetails & {
  state: 'available';
  route_mode: 'avoid_damage';
  reference_only: true;
  accessibility_verified: false;
  warning: string;
};

export type RouteOutcome = RouteDetails & {
  state: 'available' | 'no_route' | 'not_assessable';
  reason?: string | null;
  fallback?: WalkingReference | null;
};

export type WhatIfResult = {
  simulation_id: string;
  generated_at: string;
  snapshot_at: string;
  simulation_only: true;
  currency: 'MYR';
  budget_myr: string | null;
  baseline_road_obstacle_count: number;
  baseline: Array<{
    path_id: string;
    path_name: string;
    route_mode: 'avoid_damage' | 'accessible';
    current: RouteOutcome;
    reference_without_damage: RouteOutcome;
  }>;
  plans: Array<{
    id: string;
    name: string;
    total_estimated_cost_myr: string | null;
    budget_status: 'within_budget' | 'over_budget' | 'unknown_cost' | 'not_set';
    repaired_issue_count: number;
    remaining_road_obstacle_count: number;
    affected_major_path_count: number;
    improved_major_path_count: number;
    summaries: Array<{
      route_mode: 'avoid_damage' | 'accessible';
      designated_path_count: number;
      restored_path_count: number;
      shortened_path_count: number;
      improved_path_count: number;
      distance_saved_on_comparable_paths_meters: number;
      baseline_available_path_count: number;
      after_available_path_count: number;
    }>;
    paths: Array<{
      path_id: string;
      path_name: string;
      route_mode: 'avoid_damage' | 'accessible';
      after: RouteOutcome;
      effect: string;
      distance_saved_meters: number | null;
      duration_saved_seconds: number | null;
    }>;
  }>;
  warnings: string[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function apiBaseUrl() {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (!value) {
    throw new Error(
      'Set NEXT_PUBLIC_API_BASE_URL in the web environment before using the management portal.',
    );
  }
  return value;
}

async function readError(response: Response) {
  let payload: { detail?: unknown; message?: string } = {};

  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    // Keep a safe status-based message when a service returns no JSON.
  }

  const detail = payload.detail;
  if (typeof detail === 'string') return detail;
  if (typeof payload.message === 'string') return payload.message;
  if (Array.isArray(detail)) {
    const first = detail[0] as { loc?: unknown[]; msg?: unknown } | undefined;
    const field = first?.loc?.slice(1).join('.') ?? '';
    const message = typeof first?.msg === 'string' ? first.msg : 'Invalid request';
    return field ? `${field}: ${message}` : message;
  }

  return `Backend request failed (${response.status}).`;
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}) {
  const token = await getValidAccessToken();
  if (!token) {
    clearAuthSession();
    throw new ApiError('Your session expired. Please sign in again.', 401);
  }

  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  });
  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(
      'Could not reach the backend. Check the API URL, backend health, and its CORS allowlist for https://enclavehomes.app.',
      0,
    );
  }

  if (!response.ok) {
    const message = await readError(response);
    if (response.status === 401) clearAuthSession();
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export function toManagementReport(report: BackendReport): ManagementReport {
  const titleText = report.description.trim().split(/\r?\n/, 1)[0];
  const priority = report.priority
    ? (report.priority.charAt(0).toUpperCase() + report.priority.slice(1)) as
        | 'Low'
        | 'Medium'
        | 'High'
    : 'Unassigned';

  return {
    id: report.ticket_id,
    title: titleText.length > 88 ? `${titleText.slice(0, 85)}…` : titleText,
    location: `${report.latitude.toFixed(5)}, ${report.longitude.toFixed(5)}`,
    status: report.status,
    priority,
    description: report.description,
    category: report.category ?? 'Unclassified',
    submittedAt: report.created_at
      ? new Date(report.created_at).toLocaleString()
      : 'Date unavailable',
    createdAt: report.created_at,
    imageUrl: report.image_url,
    latitude: report.latitude,
    longitude: report.longitude,
    isApproved: report.is_approved,
  };
}

export async function getManagementReports(status?: ApiReportStatus) {
  const reports: BackendReport[] = [];
  const limit = 100;
  let offset = 0;
  let hasMore = true;

  while (hasMore && offset < 5000) {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (status) query.set('status', status);
    const page = await apiRequest<ManagementReportList>(
      `/api/v1/management/reports?${query.toString()}`,
    );
    reports.push(...page.items);
    hasMore = page.has_more;
    offset += page.limit;
  }

  if (hasMore) {
    throw new ApiError('The report list is too large to load in one view.', 413);
  }

  return reports.map(toManagementReport);
}

export async function getManagementReport(ticketId: string) {
  const reports = await getManagementReports();
  return reports.find((report) => report.id === ticketId) ?? null;
}

export async function updateReportStatus(ticketId: string, update: StatusUpdate) {
  const encodedId = encodeURIComponent(ticketId);
  const response = await apiRequest<{ report: BackendReport; event: StatusEvent }>(
    `/api/v1/management/reports/${encodedId}/status`,
    { method: 'PATCH', body: update },
  );
  return {
    report: toManagementReport(response.report),
    event: response.event,
  };
}

export function getReportHistory(ticketId: string) {
  return apiRequest<ReportHistory>(
    `/api/v1/reports/${encodeURIComponent(ticketId)}/history?limit=100&offset=0`,
  );
}

export function getCurrentUser() {
  return apiRequest<CurrentUser>('/auth/me');
}

export function getManagementAccess() {
  return apiRequest<ManagementReportList>('/api/v1/management/reports?limit=1&offset=0');
}

export function createResident(input: CreateResidentInput) {
  return apiRequest<CreateResidentResult>('/api/v1/management/residents', {
    method: 'POST',
    body: input,
  });
}

export function issueResidentInvitation(residentId: string) {
  return apiRequest<InvitationResult>(
    `/api/v1/management/residents/${encodeURIComponent(residentId)}/invitations`,
    { method: 'POST' },
  );
}

export function createNotification(input: CreateNotificationInput) {
  return apiRequest<NotificationResult>('/api/v1/management/notifications', {
    method: 'POST',
    body: input,
  });
}

export function getRepairCandidates() {
  return apiRequest<RepairCandidates>('/api/v1/management/what-if/candidates');
}

export function compareRepairPlans(input: {
  paths: WhatIfPath[];
  plans: WhatIfPlan[];
  route_modes: Array<'avoid_damage' | 'accessible'>;
  budget_myr: string | null;
  include_geometry: boolean;
}) {
  return apiRequest<WhatIfResult>('/api/v1/management/what-if/compare', {
    method: 'POST',
    body: input,
  });
}
