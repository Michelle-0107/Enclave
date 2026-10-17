"use client";

import Link from "next/link";
import { useState } from "react";
import { Shell, Heading, Pill } from "./_components";

const tasks = [
  {
    id: "1024",
    title: "Streetlight malfunction",
    location: "Park Entrance · Streetlight A",
    status: "Assigned",
    tone: "amber",
    priority: "High",
  },
  {
    id: "1025",
    title: "Broken kerb ramp",
    location: "Lane Walk · North entrance",
    status: "Changes requested",
    tone: "red",
    priority: "High",
  },
  {
    id: "1026",
    title: "Damaged walkway tile",
    location: "Block B · Main walkway",
    status: "In progress",
    tone: "",
    priority: "Normal",
  },
  {
    id: "1027",
    title: "Leaking water pipe",
    location: "Residential area · Block C",
    status: "To review",
    tone: "",
    priority: "Normal",
  },
];

export default function MaintenanceTasks() {
  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("all");
  const [selectedPriority, setSelectedPriority] = useState("all");

  const filteredTasks = tasks.filter((task) => {
    const searchText = search.toLowerCase();

    const matchesSearch =
      task.id.toLowerCase().includes(searchText) ||
      task.title.toLowerCase().includes(searchText) ||
      task.location.toLowerCase().includes(searchText);

    const matchesStatus =
      selectedStatus === "all" || task.status === selectedStatus;

    const matchesPriority =
      selectedPriority === "all" ||
      task.priority === selectedPriority;

    return matchesSearch && matchesStatus && matchesPriority;
  });

  return (
    <Shell active="tasks">
      <Heading
        title="Your tasks."
        subtitle="Assigned repairs, all in one place."
      />

      <div className="m-stats">
        <div className="m-stat">
          <strong>04</strong>
          <span>Assigned</span>
        </div>

        <div className="m-stat">
          <strong>02</strong>
          <span>In progress</span>
        </div>

        <div className="m-stat">
          <strong>01</strong>
          <span>To review</span>
        </div>
      </div>

      <label className="m-field-label" htmlFor="task-search">
        Search tasks
      </label>

      <input
        id="task-search"
        className="m-input m-search"
        placeholder="Search task ID, title or location..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <div className="m-filters">
        <div>
          <label className="m-field-label" htmlFor="status">
            Status
          </label>

          <select
            id="status"
            className="m-select"
            value={selectedStatus}
            onChange={(event) => setSelectedStatus(event.target.value)}
          >
            <option value="all">All statuses</option>
            <option value="Assigned">Assigned</option>
            <option value="In progress">In progress</option>
            <option value="Changes requested">Changes requested</option>
            <option value="To review">To review</option>
          </select>
        </div>

        <div>
          <label className="m-field-label" htmlFor="priority">
            Priority
          </label>

          <select
            id="priority"
            className="m-select"
            value={selectedPriority}
            onChange={(event) => setSelectedPriority(event.target.value)}
          >
            <option value="all">All priorities</option>
            <option value="High">High</option>
            <option value="Normal">Normal</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        {filteredTasks.length > 0 ? (
          filteredTasks.map((task) => (
            <Link
              className="m-task"
              href={`/maintenance/tasks/${task.id}`}
              key={task.id}
            >
              <div>
                <h3>{task.title}</h3>
                <p>
                  #{task.id} · {task.location}
                </p>
              </div>

              <div className="m-row">
                <Pill tone={task.tone}>{task.status}</Pill>
                <span className="m-muted">{task.priority}</span>
              </div>
            </Link>
          ))
        ) : (
          <div className="m-task">
            <p>No tasks match your search or selected filters.</p>
          </div>
        )}
      </div>
    </Shell>
  );
}