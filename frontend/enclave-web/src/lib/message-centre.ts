import { createNotification, getManagementReports, type ApiReportStatus, type CreateNotificationInput, type NotificationResult } from './api';
import { allPages, getStaffNotifications, markStaffNotificationRead, type BackendTask } from './maintenance/api';

export type ReceivedMessage = {
  id: string; title: string; message: string; createdAt: string;
  source: 'Resident report' | 'Maintenance'; href?: string;
  notificationId?: number; unread: boolean;
  status?: ApiReportStatus; priority?: string; category?: string; location?: string;
};
export type ReceivedMessages = { items: ReceivedMessage[]; warnings: string[] };

/** Existing contracts only. Reports are actionable entries, not notification
 * events, and therefore have no fabricated unread/read state. */
export async function getReceivedMessages(): Promise<ReceivedMessages> {
  const [reports, notices, tasks] = await Promise.allSettled([
    getManagementReports(), getStaffNotifications(),
    allPages<BackendTask>('/api/v1/management/maintenance/tasks'),
  ]);
  if (reports.status === 'rejected' && notices.status === 'rejected') {
    throw new Error('Unable to load messages. Please try again.');
  }
  const items: ReceivedMessage[] = [];
  const warnings: string[] = [];
  if (reports.status === 'fulfilled') {
    for (const report of reports.value) items.push({
      id: `report:${report.id}`, title: report.title, message: report.description,
      createdAt: report.createdAt ?? '', source: 'Resident report',
      href: `/management/reports/${encodeURIComponent(report.id)}`, unread: false,
      status: report.status, priority: report.priority, category: report.category, location: report.location,
    });
  } else warnings.push('Resident reports could not be loaded.');
  if (notices.status === 'fulfilled') {
    const tickets = new Map(tasks.status === 'fulfilled' ? tasks.value.map(task => [task.id, task.ticket_id]) : []);
    for (const notice of notices.value) {
      const ticket = tickets.get(notice.task_id);
      items.push({ id: `notice:${notice.id}`, title: notice.title, message: notice.message,
        createdAt: notice.created_at, source: 'Maintenance', notificationId: notice.id,
        unread: !notice.is_read,
        ...(ticket ? { href: `/management/reports/${encodeURIComponent(ticket)}` } : {}),
      });
    }
    if (tasks.status === 'rejected') warnings.push('Task links are temporarily unavailable. You can still read the updates.');
  } else warnings.push('Maintenance updates could not be loaded.');
  return { items: items.sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)), warnings };
}
export async function readMessage(item: ReceivedMessage) {
  if (item.unread && item.notificationId !== undefined) await markStaffNotificationRead(item.notificationId);
}

// No server sent-history endpoint exists in the supplied ZIP. This cache only
// contains announcements successfully published from THIS browser tab/session.
// Replace getSentAnnouncements with the server contract once it is available.
const cacheKey = (userId: string) => `enclave-sent-announcements-v1:${userId}`;
export async function getSentAnnouncements(userId: string): Promise<NotificationResult[]> {
  if (typeof window === 'undefined') return [];
  try {
    const records: unknown = JSON.parse(sessionStorage.getItem(cacheKey(userId)) ?? '[]');
    return Array.isArray(records) ? records.filter((value): value is NotificationResult =>
      !!value && typeof value === 'object' && Number.isSafeInteger(value.id) &&
      typeof value.title === 'string' && typeof value.message === 'string' && typeof value.created_at === 'string',
    ).slice(0, 50) : [];
  } catch { return []; }
}
export async function publishAnnouncement(userId: string, input: CreateNotificationInput) {
  const result = await createNotification(input);
  const records = await getSentAnnouncements(userId);
  const items = [result, ...records.filter(item => item.id !== result.id)].slice(0, 50);
  try { sessionStorage.setItem(cacheKey(userId), JSON.stringify(items)); } catch { /* Sending still succeeded if browser storage is unavailable. */ }
  return { result, items };
}
