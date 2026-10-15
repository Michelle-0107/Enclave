import Link from 'next/link';

import { Card, CardContent } from '@/components/ui/card';

const overview = [
  {
    value: '08',
    label: 'Pending review',
    href: '/management/reports?status=pending',
    color: 'text-status-orange',
  },
  {
    value: '12',
    label: 'Active repairs',
    href: '/management/reports?status=in-progress',
    color: 'text-muted-foreground',
  },
  {
    value: '03',
    label: 'To verify',
    href: '/management/reports?status=awaiting-verification',
    color: 'text-muted-foreground',
  },
];

const attentionItems = [
  {
    id: 'HP-1024',
    title: 'Streetlight malfunction',
    location: 'Park Entrance',
    status: 'Pending review',
  },
  {
    id: 'HP-1012',
    title: 'Repair ready for verification',
    location: 'Community Garden',
    status: 'Awaiting verification',
  },
];

export default function ManagementDashboard() {
  return (
    <div className="flex flex-col gap-7">
      <h1 className="text-[30px] leading-[1.45] font-semibold lg:text-[36px]">
        Your community.
      </h1>

      <p className="text-sm text-muted-foreground">
        KL East · Today, 14 October
      </p>

      <div className="grid gap-5 sm:grid-cols-3">
        {overview.map((item) => (
          <Link
            key={item.label}
            href={item.href}
            className="rounded-3xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Card className="h-full rounded-3xl border-0 bg-card py-0 shadow-none transition-colors hover:bg-secondary/50">
              <CardContent className="flex flex-col gap-[14px] p-5">
                <p className="text-[28px] leading-[1.45] font-semibold">
                  {item.value}
                </p>

                <p className={`text-sm ${item.color}`}>
                  {item.label}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <section aria-labelledby="attention-heading">
        <h2
          id="attention-heading"
          className="mb-2 text-xl font-semibold"
        >
          Needs your attention
        </h2>

        <div>
          {attentionItems.map((item) => (
            <Link
              key={item.id}
              href={`/management/reports/${item.id}`}
              className="flex flex-col gap-2 border-b py-7 transition-colors hover:bg-secondary/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
                <h3 className="text-lg font-semibold">
                  {item.title}
                </h3>

                <p className="text-xs text-status-orange sm:w-[218px] sm:shrink-0">
                  {item.status}
                </p>
              </div>

              <p className="text-xs text-muted-foreground">
                #{item.id} · {item.location}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <Link
        href="/management/reports"
        className="flex min-h-[52px] items-center justify-center rounded-2xl bg-secondary px-5 py-4 text-center text-sm font-semibold transition-colors hover:bg-secondary/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        View all reports
      </Link>

      <p className="text-xs text-muted-foreground">
        Demo dashboard · Sample counts, reports and date.
      </p>
    </div>
  );
}