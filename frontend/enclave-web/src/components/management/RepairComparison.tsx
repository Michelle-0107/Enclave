import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import type { ManagementReport } from '@/lib/mock-reports';

type Props = {
  report: ManagementReport;
};

const scenarios = [
  {
    title: 'Before repair',
    impact: '1 of 3 destinations reachable',
    note: 'Kerb ramp and surface sections unavailable.',
  },
  {
    title: 'After kerb ramp repair',
    impact: '2 of 3 destinations reachable (+1)',
    note: 'Pavilion route reopened in this estimate.',
  },
  {
    title: 'After surface repair',
    impact: '2 of 3 destinations reachable (+1)',
    note: 'Playground route reopened in this estimate.',
  },
];

const repairOptions = [
  {
    id: 'kerb-ramp',
    title: 'Kerb ramp repair',
    cost: 'RM 2,500',
  },
  {
    id: 'surface',
    title: 'Surface repair',
    cost: 'RM 1,500',
  },
];

export default function RepairComparison({ report }: Props) {
  return (
    <div className="flex flex-col gap-7">
      <Link
        href={`/management/reports/${report.id}`}
        className="inline-flex min-h-11 w-fit items-center gap-1 text-sm font-semibold text-primary"
      >
        <ChevronLeft size={18} aria-hidden="true" />
        Report details
      </Link>

      <h1 className="text-[30px] font-semibold leading-[1.45] text-primary lg:text-[36px]">
        Repair comparison.
      </h1>

      <p className="text-sm text-muted-foreground">
        #{report.id} · {report.title} · {report.location}
      </p>

      <div className="flex flex-col gap-3.5 rounded-3xl bg-enclave-lavender p-5">
        <h2 className="text-[17px] font-semibold text-primary">
          Planning estimate
        </h2>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Illustrative costs and route impact. Confirm
          quotations before assigning work.
        </p>
      </div>

      <p className="text-sm text-primary">
        Step-free profile · Baseline: 1 of 3 destinations
        reachable
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-primary">
          Route impact comparison
        </h2>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Step-free routes from Main Entrance. Solid:
          reachable. Dashed: unavailable.
        </p>

        <div className="grid gap-6 xl:grid-cols-3">
          {scenarios.map((scenario, index) => (
            <div
              key={scenario.title}
              className="flex min-w-0 flex-col gap-3 rounded-[18px] border border-border bg-white p-4"
            >
              <h3 className="text-sm font-semibold text-primary">
                {scenario.title}
              </h3>

              <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-2xl bg-muted p-5 text-center">
                <p className="text-sm font-semibold text-primary">
                  Route map
                </p>

                <p className="text-xs leading-relaxed text-muted-foreground">
                  {scenario.title}
                  <br />
                  Main Entrance → community destinations
                </p>

                <p className="text-xs text-muted-foreground">
                  Map integration pending
                </p>
              </div>

              <p
                className={`text-xs font-semibold ${
                  index === 0
                    ? 'text-status-orange'
                    : 'text-status-green'
                }`}
              >
                {scenario.impact}
              </p>

              <p className="text-xs leading-relaxed text-muted-foreground">
                {scenario.note}
              </p>
            </div>
          ))}
        </div>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Illustrative network estimates. Verify routes and
          repair completion on site.
        </p>
      </section>

      <section
        aria-label="Repair options"
        className="grid gap-5 md:grid-cols-2"
      >
        {repairOptions.map((option, index) => {
          const query = new URLSearchParams({
            category: report.category,
            priority: report.priority,
            repairOption: option.id,
          });

          return (
            <div
              key={option.id}
              className={
                index === 1
                  ? 'border-t border-border pt-5 md:border-t-0 md:border-l md:pt-0 md:pl-5'
                  : ''
              }
            >
              <div className="flex flex-col gap-3.5 rounded-3xl bg-white p-5">
                <h2 className="text-xl font-semibold text-primary">
                  {option.title}
                </h2>

                <p className="text-[28px] font-semibold text-primary">
                  {option.cost}
                </p>

                <p className="text-sm text-muted-foreground">
                  2 of 3 destinations reachable (+1)
                </p>

                <Link
                  href={`/management/reports/${report.id}/assign?${query.toString()}`}
                  className="flex min-h-[52px] items-center justify-center rounded-2xl bg-enclave-lavender px-5 text-sm font-semibold text-primary hover:opacity-80"
                >
                  Select option
                </Link>
              </div>
            </div>
          );
        })}
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Costs and impact are sample planning estimates.
        Comparing options does not update the live route map.
      </p>
    </div>
  );
}