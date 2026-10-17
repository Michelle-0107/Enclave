"use client";
import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMaintenance } from "./MaintenanceProvider";
import { Heading, control } from "./Common";
import { statusLabels } from "@/lib/maintenance/types";
export default function MyTasks() {
  const { tasks, loading, error } = useMaintenance();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const filtered = tasks.filter(
    (t) =>
      (!status || t.status === status) &&
      (!priority || t.priority === priority) &&
      `${t.id} ${t.title} ${t.location}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  return (
    <section className="flex flex-col gap-7">
      <Heading
        title="Your tasks."
        subtitle="Assigned repairs, all in one place."
        back={null}
      />
      <div className="grid grid-cols-3 gap-3 lg:gap-5">
        {[
          ["Assigned", tasks.filter((t) => t.status === "assigned").length],
          [
            "In progress",
            tasks.filter((t) =>
              ["in-progress", "changes-requested"].includes(t.status),
            ).length,
          ],
          [
            "To review",
            tasks.filter((t) => t.status === "awaiting-verification").length,
          ],
        ].map(([label, count]) => (
          <Card
            key={label}
            className="gap-3 rounded-3xl p-4 shadow-none ring-0 lg:p-5"
          >
            <p className="text-[28px] font-semibold">
              {String(count).padStart(2, "0")}
            </p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </Card>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="task-search">Search tasks</Label>
        <Input
          id="task-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search task ID, issue or location"
          className={control}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:max-w-[372px]">
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="status-filter"
            className="text-xs text-muted-foreground"
          >
            Status
          </Label>
          <select
            id="status-filter"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-11 rounded-xl border bg-white px-3 text-sm"
          >
            <option value="">All statuses</option>
            {Object.entries(statusLabels).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label
            htmlFor="priority-filter"
            className="text-xs text-muted-foreground"
          >
            Priority
          </Label>
          <select
            id="priority-filter"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="h-11 rounded-xl border bg-white px-3 text-sm"
          >
            <option value="">All priorities</option>
            {["High", "Medium", "Low"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>
      {loading && <p role="status">Loading tasks…</p>}
      {error && (
        <p role="alert" className="text-status-red">
          {error}
        </p>
      )}
      <div className="divide-y">
        {filtered.map((task) => (
          <Link
            key={task.id}
            href={`/maintenance/tasks/${task.id}`}
            className="flex flex-col gap-2 py-7 first:pt-0 hover:opacity-75"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <h2 className="text-lg font-semibold">{task.title}</h2>
              <span
                className={`text-xs ${task.status === "changes-requested" ? "text-status-red" : task.status === "resolved" ? "text-status-green" : "text-status-orange"}`}
              >
                {task.priority} · {statusLabels[task.status]}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              #{task.id} · {task.location}
            </p>
          </Link>
        ))}
      </div>
      {!loading && !error && !filtered.length && (
        <p className="text-sm text-muted-foreground">
          No tasks match your search.
        </p>
      )}
    </section>
  );
}
