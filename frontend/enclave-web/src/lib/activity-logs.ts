import { apiRequest, ApiError } from './api';
export type ActivityPortal = 'management' | 'maintenance';
export type ActivityLog = {
  id: string; created_at: string; actor_name: string;
  actor_role: 'management' | 'maintenance' | 'resident' | 'system';
  action: string; target_label: string; target_id: string | null;
  result: 'success' | 'failed'; summary: string;
};
export type ActivityLogPage = { items: ActivityLog[]; has_more: boolean };
export async function getActivityLogs(portal: ActivityPortal, filters: { search: string; role: string; result: string; from: string; to: string; offset: number }) {
  const query = new URLSearchParams({ limit: '20', offset: String(filters.offset) });
  for (const key of ['search', 'role', 'result', 'from', 'to'] as const) if (filters[key]) query.set(key, filters[key]);
  try {
    const data = await apiRequest<ActivityLogPage>(`/api/v1/${portal}/activity-logs?${query}`);
    if (!Array.isArray(data.items) || typeof data.has_more !== 'boolean') throw new Error('Activity records could not be loaded.');
    return data;
  } catch (error) {
    if (error instanceof ApiError && [404, 405, 501].includes(error.status)) throw new Error('Activity logs are not available yet. Please try again later.');
    throw error;
  }
}
