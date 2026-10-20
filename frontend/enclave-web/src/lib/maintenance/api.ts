import { ApiError, apiRequest } from '@/lib/api';
import type { MaintenanceGateway, MaintenanceTask, TaskStatus } from './types';

export type BackendTask = {
  id: string; ticket_id: string; title: string; description: string;
  latitude: number; longitude: number; priority: 'low' | 'medium' | 'high';
  status: 'assigned' | 'in_progress' | 'awaiting_verification' | 'changes_requested' | 'resolved';
  version: number; assigned_staff_id: string | null; assigned_team_id: string | null;
  instructions: string; target_date: string; created_at: string; updated_at: string;
  work_notes: string; completion_notes: string; review_note: string;
  before_photo_url: string | null; after_photo_url: string | null; checked_on_site: boolean;
  report_status: string;
};
export type Staff = { profile_id: string; display_name: string; email: string; team_id: string | null; active: boolean };
export type Team = { id: string; name: string };
export type StaffNotice = { id: number; task_id: string; title: string; message: string; is_read: boolean; created_at: string };
export type TaskEvent = { id: number; action: string; note: string; actor_role: string; created_at: string };
type Page<T> = { items: T[]; limit: number; offset: number; has_more: boolean };
const root = '/api/v1/maintenance';
const management = '/api/v1/management/maintenance';
const statuses: Record<BackendTask['status'], TaskStatus> = {
  assigned: 'assigned', in_progress: 'in-progress', awaiting_verification: 'awaiting-verification',
  changes_requested: 'changes-requested', resolved: 'resolved',
};

export function validateTask(task: BackendTask): BackendTask {
  if (!task || !Object.hasOwn(statuses, task.status) || !Number.isSafeInteger(task.version) || task.version < 1 ||
      typeof task.id !== 'string' || typeof task.ticket_id !== 'string' || typeof task.title !== 'string' ||
      !Number.isFinite(task.latitude) || !Number.isFinite(task.longitude) ||
      !['low', 'medium', 'high'].includes(task.priority)) {
    throw new ApiError('The server returned an invalid maintenance task. Refresh and try again.', 503);
  }
  return task;
}

export function toMaintenanceTask(value: BackendTask): MaintenanceTask {
  const task = validateTask(value);
  return {
    id: task.id, ticketId: task.ticket_id, title: task.title, description: task.description,
    location: `${task.latitude.toFixed(5)}, ${task.longitude.toFixed(5)}`,
    latitude: task.latitude, longitude: task.longitude,
    priority: ({ low: 'Low', medium: 'Medium', high: 'High' } as const)[task.priority],
    status: statuses[task.status], assignedAt: new Date(task.created_at).toLocaleString(),
    targetDate: task.target_date, team: task.assigned_team_id ? 'Assigned to your team' : 'Assigned to you',
    instructions: task.instructions, workNotes: task.work_notes, completionNotes: task.completion_notes,
    reviewNote: task.review_note, beforePhotoUrl: task.before_photo_url ?? undefined,
    afterPhotoUrl: task.after_photo_url ?? undefined, updatedAt: new Date(task.updated_at).toLocaleString(),
  };
}

export async function allPages<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    const page = await apiRequest<Page<T>>(`${path}?limit=100&offset=${offset}`);
    if (!page || !Array.isArray(page.items) || page.items.length > 100 || page.limit !== 100 ||
        page.offset !== offset || typeof page.has_more !== 'boolean' || (page.has_more && !page.items.length)) {
      throw new ApiError('Unable to read the maintenance list. Refresh and try again.', 503);
    }
    items.push(...page.items);
    if (!page.has_more) return items;
  }
  throw new ApiError('Too many maintenance records to load in one view.', 413);
}

// Use the version the user saw; never silently retry a conflicting write.
export function createMaintenanceGateway(): MaintenanceGateway {
  const versions = new Map<string, number>();
  let revision = 0;
  let listSequence = 0;
  function accept(value: BackendTask) {
    const task = toMaintenanceTask(value);
    versions.set(task.id, value.version);
    return task;
  }
  function version(id: string) {
    const value = versions.get(id);
    if (!value) throw new ApiError('Reload the task before making changes.', 409);
    return value;
  }
  async function change(id: string, action: string, method: 'POST' | 'PATCH', body: object) {
    revision++;
    return accept(await apiRequest<BackendTask>(`${root}/tasks/${encodeURIComponent(id)}/${action}`, {
      method, body: { expected_version: version(id), ...body },
    }));
  }
  return {
    async listTasks() {
      const startingRevision = revision;
      const sequence = ++listSequence;
      const rows = await allPages<BackendTask>(`${root}/tasks`);
      if (startingRevision !== revision || sequence !== listSequence) {
        throw new ApiError('Tasks changed while loading. Refresh the task list.', 409);
      }
      const tasks = rows.map(toMaintenanceTask);
      versions.clear(); rows.forEach(task => versions.set(task.id, task.version));
      return tasks;
    },
    async getTask(id) { revision++; return accept(await apiRequest<BackendTask>(`${root}/tasks/${encodeURIComponent(id)}`)); },
    startWork: id => change(id, 'start', 'POST', {}),
    saveUpdate: (id, notes) => change(id, 'progress', 'PATCH', { notes }),
    reportBlocker: (id, type, details) => change(id, 'blockers', 'POST', { blocker_type: type, notes: details }),
    async submitEvidence(id, input) {
      revision++;
      const form = new FormData();
      form.set('expected_version', String(version(id)));
      form.set('notes', input.notes); form.set('checked_on_site', String(input.checkedOnSite));
      form.set('file', input.photo);
      return accept(await apiRequest<BackendTask>(`${root}/tasks/${encodeURIComponent(id)}/evidence`, { method: 'POST', body: form }));
    },
  };
}

export const getStaffNotifications = () => allPages<StaffNotice>(`${root}/notifications`);
export const markStaffNotificationRead = (id: number) => apiRequest<void>(`${root}/notifications/${id}/read`, { method: 'POST' });
export const getTaskHistory = (id: string, manager = false) => allPages<TaskEvent>(`${manager ? management : root}/tasks/${encodeURIComponent(id)}/history`);
export const getMaintenanceStaff = () => allPages<Staff>(`${management}/staff`);
export const getMaintenanceTeams = () => allPages<Team>(`${management}/teams`);
export async function getReportTask(ticketId: string) {
  const rows = await allPages<BackendTask>(`${management}/tasks`);
  return rows.find(task => task.ticket_id === ticketId) ?? null;
}
export type AssignmentInput = {
  ticket_id: string; title: string; instructions: string; priority: 'low' | 'medium' | 'high'; target_date: string;
  assigned_staff_id: string | null; assigned_team_id: string | null;
};
export const assignMaintenance = (body: AssignmentInput) => apiRequest<BackendTask>(`${management}/tasks`, { method: 'POST', body });
export const reassignMaintenance = (task: BackendTask, assignee: Pick<AssignmentInput, 'assigned_staff_id' | 'assigned_team_id'>, note: string) =>
  apiRequest<BackendTask>(`${management}/tasks/${encodeURIComponent(task.id)}/assignment`, { method: 'PATCH', body: {
    ...assignee, expected_version: task.version, note,
  } });
export const reviewMaintenance = (task: BackendTask, decision: 'approve' | 'rework', note: string, publicNote?: string) =>
  apiRequest<BackendTask>(`${management}/tasks/${encodeURIComponent(task.id)}/review`, { method: 'POST', body: {
    expected_version: task.version, decision, note, repair_verified: decision === 'approve',
    ...(decision === 'approve' ? { public_note: publicNote } : {}),
  } });
