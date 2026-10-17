"use client";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { mockMaintenanceTasks } from "@/lib/maintenance/mock-tasks";
import type {
  MaintenanceGateway,
  MaintenanceTask,
} from "@/lib/maintenance/types";
type Context = {
  tasks: MaintenanceTask[];
  loading: boolean;
  error: string;
  gateway: MaintenanceGateway;
  demo: boolean;
  onSignOut?: () => Promise<void>;
};
const Store = createContext<Context | null>(null);
/** No credentials or API URLs are hardcoded. Supply gateway from a client auth wrapper. */
export function MaintenanceProvider({
  children,
  gateway: remote,
  onSignOut,
}: {
  children: ReactNode;
  gateway?: MaintenanceGateway;
  onSignOut?: () => Promise<void>;
}) {
  const [tasks, setTasks] = useState<MaintenanceTask[]>(
    remote ? [] : mockMaintenanceTasks,
  );
  const [loading, setLoading] = useState(!!remote);
  const [error, setError] = useState("");
  const files = useRef<string[]>([]);
  useEffect(
    () => () => files.current.forEach((url) => URL.revokeObjectURL(url)),
    [],
  );
  useEffect(() => {
    if (!remote) return;
    let live = true;
    remote
      .listTasks()
      .then((t) => {
        if (live) setTasks(t);
      })
      .catch(() => {
        if (live) setError("Unable to load tasks. Please try again.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [remote]);
  function apply(task: MaintenanceTask) {
    setTasks((items) => items.map((t) => (t.id === task.id ? task : t)));
    return task;
  }
  function demoUpdate(id: string, patch: Partial<MaintenanceTask>) {
    const task = tasks.find((t) => t.id === id);
    if (!task) throw new Error("Task not found");
    return apply({ ...task, ...patch, updatedAt: new Date().toLocaleString() });
  }
  const gateway: MaintenanceGateway = {
    listTasks: async () => (remote ? remote.listTasks() : tasks),
    startWork: async (id) =>
      remote
        ? apply(await remote.startWork(id))
        : demoUpdate(id, { status: "in-progress" }),
    saveUpdate: async (id, notes) =>
      remote
        ? apply(await remote.saveUpdate(id, notes))
        : demoUpdate(id, { workNotes: notes }),
    submitEvidence: async (id, input) => {
      if (remote) return apply(await remote.submitEvidence(id, input));
      const url = URL.createObjectURL(input.photo);
      files.current.push(url);
      return demoUpdate(id, {
        status: "awaiting-verification",
        completionNotes: input.notes,
        afterPhotoUrl: url,
      });
    },
    reportBlocker: async (id, type, details) =>
      remote
        ? apply(await remote.reportBlocker(id, type, details))
        : demoUpdate(id, { workNotes: `Blocker: ${type} — ${details}` }),
  };
  return (
    <Store.Provider
      value={{ tasks, loading, error, gateway, demo: !remote, onSignOut }}
    >
      {children}
    </Store.Provider>
  );
}
export function useMaintenance() {
  const value = useContext(Store);
  if (!value) throw new Error("MaintenanceProvider is required");
  return value;
}
