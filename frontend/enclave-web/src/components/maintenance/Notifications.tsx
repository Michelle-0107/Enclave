"use client";
import Image from "next/image";
import Link from "next/link";
import { Heading } from "./Common";
const items = [
  {
    title: "New task assigned",
    text: "Streetlight repair at Park Entrance.",
    time: "10 min ago",
    href: "/maintenance/tasks/HP-1024",
  },
  {
    title: "Changes requested",
    text: "Management added a review note to #HP-1025.",
    time: "1 hour ago",
    href: "/maintenance/tasks/HP-1025/rework",
  },
  {
    title: "Repair submitted",
    text: "Your repair evidence will appear here after submission.",
    time: "Example update",
    href: "/maintenance/tasks/HP-1024",
  },
];
export default function Notifications() {
  return (
    <section className="flex flex-col gap-7">
      <Heading
        title="Notifications."
        subtitle="Assignments and management feedback."
        back={null}
      />
      <div className="divide-y">
        {items.map((n) => (
          <Link
            key={n.title}
            href={n.href}
            className="flex items-start gap-4 py-7 first:pt-0 hover:opacity-75"
          >
            <span className="flex size-[42px] shrink-0 items-center justify-center rounded-full bg-secondary">
              <Image
                src="/images/enclave-logo.png"
                alt=""
                width={20}
                height={24}
                className="h-6 w-5 object-contain"
              />
            </span>
            <div className="flex min-w-0 flex-col gap-1.5">
              <h2 className="font-semibold">{n.title}</h2>
              <p className="text-sm text-muted-foreground">{n.text}</p>
              <p className="text-xs text-muted-foreground">{n.time}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
