import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { statusLabels, type TaskStatus } from "@/lib/maintenance/types";
export const primaryLink =
  "flex min-h-[52px] items-center justify-center rounded-2xl bg-primary px-6 py-3 text-center text-sm font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2";
export const secondaryLink =
  "flex min-h-[52px] items-center justify-center rounded-2xl bg-secondary px-6 py-3 text-center text-sm font-semibold hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2";
export const control =
  "h-[54px] w-full rounded-2xl border bg-white px-4 text-sm shadow-none";
export const action =
  "min-h-[52px] rounded-2xl px-6 text-sm font-semibold whitespace-normal";
export function Heading({
  title,
  subtitle,
  back = "/maintenance",
  backLabel = "My tasks",
}: {
  title: string;
  subtitle?: string;
  back?: string | null;
  backLabel?: string;
}) {
  return (
    <>
      {back && (
        <Link href={back} className="text-sm font-semibold hover:underline">
          ‹ {backLabel}
        </Link>
      )}
      <h1 className="text-[30px] leading-[1.45] font-semibold lg:text-[36px]">
        {title}
      </h1>
      {subtitle && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {subtitle}
        </p>
      )}
    </>
  );
}
export function Status({
  status,
  children,
}: {
  status: TaskStatus;
  children?: ReactNode;
}) {
  return (
    <span
      className={`inline-flex w-fit items-center gap-2 rounded-lg px-3 py-2 text-xs ${status === "changes-requested" ? "bg-status-red-bg text-status-red" : status === "resolved" ? "bg-status-green-bg text-status-green" : "bg-status-orange-bg text-status-orange"}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {children || statusLabels[status]}
    </span>
  );
}
export function Photo({ label, url }: { label: string; url?: string }) {
  return (
    <div className="flex min-h-[142px] flex-col justify-center gap-2 overflow-hidden rounded-3xl bg-enclave-lavender p-5 lg:min-h-[180px]">
      {url ? (
        <>
          <p className="text-sm font-semibold">{label}</p>
          <Image
            unoptimized
            src={url}
            alt={label}
            width={544}
            height={200}
            className="h-[200px] w-full rounded-xl object-contain"
          />
        </>
      ) : (
        <>
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-xs text-muted-foreground">No photo attached.</p>
        </>
      )}
    </div>
  );
}
