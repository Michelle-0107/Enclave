export type TaskStatus =
  | "assigned"
  | "in-progress"
  | "changes-requested"
  | "awaiting-verification"
  | "resolved";
export type MaintenanceTask = {
  id: string;
  ticketId?: string;
  title: string;
  location: string;
  description: string;
  priority: "Low" | "Medium" | "High";
  status: TaskStatus;
  assignedAt: string;
  targetDate: string;
  team: string;
  instructions: string;
  workNotes: string;
  completionNotes: string;
  reviewNote?: string;
  beforePhotoUrl?: string;
  afterPhotoUrl?: string;
  updatedAt?: string;
};
export type EvidenceInput = {
  notes: string;
  photo: File;
  checkedOnSite: boolean;
};
/** Implement with your real authenticated API. Enforce role and assignment server-side. */
export interface MaintenanceGateway {
  listTasks(): Promise<MaintenanceTask[]>;
  getTask(id: string): Promise<MaintenanceTask>;
  startWork(id: string): Promise<MaintenanceTask>;
  saveUpdate(id: string, notes: string): Promise<MaintenanceTask>;
  submitEvidence(id: string, input: EvidenceInput): Promise<MaintenanceTask>;
  reportBlocker(
    id: string,
    type: string,
    details: string,
  ): Promise<MaintenanceTask>;
}
export const statusLabels: Record<TaskStatus, string> = {
  assigned: "Assigned",
  "in-progress": "In progress",
  "changes-requested": "Changes requested",
  "awaiting-verification": "Awaiting verification",
  resolved: "Resolved",
};
