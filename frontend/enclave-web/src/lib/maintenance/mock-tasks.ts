import type { MaintenanceTask } from "./types";
export const mockMaintenanceTasks: MaintenanceTask[] = [
  {
    id: "HP-1024",
    title: "Streetlight malfunction",
    location: "Park Entrance · Streetlight A",
    description:
      "The streetlight near the park entrance does not turn on at night.",
    priority: "High",
    status: "assigned",
    assignedAt: "14 Oct 2026",
    targetDate: "15 Oct 2026",
    team: "Electrical team",
    instructions:
      "Inspect fitting and power supply. Test operation after repair.",
    workNotes: "",
    completionNotes: "",
  },
  {
    id: "HP-1025",
    title: "Broken kerb ramp",
    location: "Lake Walk",
    description: "The kerb ramp surface is uneven and difficult to use.",
    priority: "High",
    status: "changes-requested",
    assignedAt: "13 Oct 2026",
    targetDate: "16 Oct 2026",
    team: "Civil team",
    instructions:
      "Repair the ramp and check that the walking surface is level.",
    reviewNote:
      "Upload a clearer photo of the repaired ramp and confirm the walking surface is level.",
    workNotes: "",
    completionNotes: "",
  },
];
