type PortalRole = "management" | "maintenance";

function Block({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-secondary ${className}`} />;
}

function Rows({ count = 4, withThumb = false }: { count?: number; withThumb?: boolean }) {
  return (
    <div className="divide-y divide-border rounded-2xl border bg-card px-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex min-w-0 items-center gap-4 py-4">
          {withThumb && <Block className="h-14 w-14 shrink-0 rounded-xl sm:h-16 sm:w-16" />}
          <div className="min-w-0 flex-1 space-y-2">
            <Block className="h-4 w-2/5" />
            <Block className="h-3 w-4/5" />
            <Block className="h-3 w-1/2" />
          </div>
          <Block className="hidden h-8 w-24 shrink-0 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

function PageContent({ role, pathname }: { role: PortalRole; pathname: string }) {
  const management = role === "management";
  const dashboard = pathname === "/management" || pathname === "/maintenance";
  const whatIf = pathname.startsWith("/management/what-if");
  const account = pathname.endsWith("/account");
  const notifications = pathname.endsWith("/notifications");
  const residents = pathname.startsWith("/management/residents");
  const activity = pathname.startsWith("/management/activity-logs");
  const reportDetail = management && pathname.startsWith("/management/reports/");
  const reports = management && pathname.startsWith("/management/reports");
  const taskDetail = role === "maintenance" && pathname.startsWith("/maintenance/tasks/");

  if (dashboard) {
    return (
      <div className="space-y-7">
        <div className="space-y-3"><Block className="h-8 w-52 max-w-[70%]" /><Block className="h-4 w-72 max-w-full" /></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <Block key={i} className="h-24 rounded-3xl" />)}</div>
        <section className="space-y-3"><Block className="h-5 w-32" /><div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Block key={i} className="h-28 rounded-2xl" />)}</div></section>
        <section className="space-y-3"><div className="flex justify-between"><Block className="h-5 w-36" /><Block className="h-4 w-14" /></div><Rows count={4} withThumb /></section>
      </div>
    );
  }

  if (whatIf) {
    return (
      <div className="space-y-6">
        <div className="space-y-3"><Block className="h-8 w-48" /><Block className="h-4 w-full max-w-3xl" /><Block className="h-4 w-2/3 max-w-2xl" /></div>
        <Block className="h-16 rounded-full" />
        <div className="space-y-4 rounded-3xl border bg-card p-4 sm:p-6"><div className="flex justify-between gap-4"><Block className="h-6 w-56 max-w-[65%]" /><Block className="h-10 w-28 rounded-full" /></div><Block className="h-11 w-full rounded-full" /><div className="flex gap-2"><Block className="h-10 w-32 rounded-full" /><Block className="h-10 w-32 rounded-full" /></div><Block className="h-64 w-full rounded-2xl sm:h-96" /></div>
      </div>
    );
  }

  if (account) {
    return (
      <div className="max-w-5xl space-y-6">
        <div className="space-y-3"><Block className="h-8 w-44" /><Block className="h-4 w-80 max-w-full" /></div>
        <Block className="h-28 rounded-3xl" />
        <div className="rounded-2xl border bg-card p-5 sm:p-7"><div className="flex items-center gap-4"><Block className="h-16 w-16 rounded-full" /><div className="flex-1 space-y-2"><Block className="h-5 w-40" /><Block className="h-4 w-56 max-w-full" /></div></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><Block className="h-11 rounded-full" /><Block className="h-11 rounded-full" /></div><div className="mt-7 space-y-5"><Block className="h-4 w-24" /><Block className="h-5 w-64 max-w-full" /><Block className="h-px w-full" /><Block className="h-4 w-32" /><Block className="h-5 w-4/5" /></div></div>
      </div>
    );
  }

  if (notifications) {
    return <div className="space-y-6"><div className="space-y-3"><Block className="h-8 w-48" /><Block className="h-4 w-72 max-w-full" /></div>{management && <div className="grid gap-3 sm:grid-cols-3"><Block className="h-24 rounded-2xl" /><Block className="h-24 rounded-2xl" /><Block className="h-24 rounded-2xl" /></div>}<Rows count={6} /></div>;
  }

  if (residents || activity) {
    return <div className="space-y-6"><div className="flex flex-wrap items-end justify-between gap-4"><div className="space-y-3"><Block className="h-8 w-52" /><Block className="h-4 w-72 max-w-full" /></div>{residents && <Block className="h-10 w-32 rounded-full" />}</div><div className="rounded-2xl border bg-card p-4"><Block className="h-11 w-full rounded-full" /><div className="mt-4 flex gap-3"><Block className="h-10 flex-1 rounded-full" /><Block className="h-10 flex-1 rounded-full" /></div></div><Rows count={6} /></div>;
  }

  if (reports && !reportDetail) {
    return <div className="space-y-6"><div className="flex items-end justify-between gap-4"><div className="space-y-3"><Block className="h-8 w-44" /><Block className="h-4 w-72 max-w-full" /></div><Block className="h-10 w-20" /></div><div className="rounded-2xl border bg-card p-4"><Block className="h-11 w-full rounded-full" /><div className="mt-4 grid gap-3 sm:grid-cols-3"><Block className="h-10 rounded-full" /><Block className="h-10 rounded-full" /><Block className="h-10 rounded-full" /></div></div><Rows count={5} withThumb /></div>;
  }

  if (reportDetail || taskDetail) {
    return <div className="space-y-6"><Block className="h-4 w-24" /><div className="space-y-3"><Block className="h-8 w-3/4 max-w-2xl" /><Block className="h-4 w-56" /></div><div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,.9fr)]"><Block className="h-64 rounded-2xl sm:h-96" /><div className="space-y-4 rounded-2xl border bg-card p-5"><Block className="h-6 w-40" /><Block className="h-4 w-full" /><Block className="h-4 w-4/5" /><Block className="h-11 w-full rounded-xl" /><Block className="h-11 w-full rounded-xl" /></div></div></div>;
  }

  return <div className="space-y-6"><div className="space-y-3"><Block className="h-8 w-52" /><Block className="h-4 w-72 max-w-full" /></div><div className="rounded-2xl border bg-card p-4"><Block className="h-11 w-full rounded-full" /><div className="mt-4 grid gap-3 sm:grid-cols-2"><Block className="h-10 rounded-full" /><Block className="h-10 rounded-full" /></div></div><Rows count={5} withThumb /></div>;
}

export default function PortalSessionSkeleton({ role, pathname }: { role: PortalRole; pathname: string }) {
  const management = role === "management";
  const navigationCount = management ? 6 : 3;
  const sidebarCount = management ? 7 : 3;

  return (
    <div className="portal-shell min-h-dvh bg-background text-foreground" data-role={role} aria-busy="true">
      <p role="status" className="sr-only">Loading workspace</p>
      <aside aria-hidden="true" className="fixed inset-y-0 left-0 hidden w-[248px] flex-col gap-8 bg-card p-5 lg:flex">
        <div className="flex items-center gap-3"><Block className="h-8 w-8 rounded-full" /><Block className="h-5 w-32" /></div>
        <Block className="h-12 w-full rounded-2xl" />
        <div className="space-y-3">{Array.from({ length: sidebarCount }, (_, i) => <Block key={i} className="h-[52px] w-full rounded-2xl" />)}</div>
      </aside>
      <div className="min-h-dvh lg:pl-[248px]">
        <header aria-hidden="true" className="sticky top-0 z-30 flex min-h-[90px] items-center justify-between gap-3 bg-background/95 px-6 py-5 backdrop-blur lg:px-10 lg:py-6">
          <div className="space-y-2"><Block className="h-7 w-56 max-w-[60vw]" /><Block className="h-3 w-28 lg:hidden" /></div>
          <Block className="h-11 w-11 shrink-0 rounded-full" />
        </header>
        <main className="portal-workspace min-w-0 px-6 pt-6 pb-[calc(112px+env(safe-area-inset-bottom))] lg:px-10 lg:pb-10">
          <PageContent role={role} pathname={pathname} />
        </main>
      </div>
      <nav aria-hidden="true" className="fixed inset-x-0 bottom-0 z-50 border-t bg-card px-3 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] lg:hidden">
        <div className={`mx-auto grid max-w-2xl gap-2 ${management ? "grid-cols-6" : "grid-cols-3"}`}>
          {Array.from({ length: navigationCount }, (_, i) => <Block key={i} className="mx-auto h-12 w-12 rounded-2xl" />)}
        </div>
      </nav>
    </div>
  );
}
