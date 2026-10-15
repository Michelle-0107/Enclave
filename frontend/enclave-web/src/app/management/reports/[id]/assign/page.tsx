import { notFound } from 'next/navigation';

import AssignMaintenance from '@/components/management/AssignMaintenance';
import {
  mockReports,
  type ManagementReport,
} from '@/lib/mock-reports';

type Props = {
  params: Promise<{
    id: string;
  }>;

  searchParams: Promise<{
    category?: string | string[];
    priority?: string | string[];
    repairOption?: string | string[];
  }>;
};

function isPriority(
  value: unknown,
): value is ManagementReport['priority'] {
  return (
    value === 'Low' ||
    value === 'Medium' ||
    value === 'High'
  );
}

export default async function AssignMaintenancePage({
  params,
  searchParams,
}: Props) {
  const { id } = await params;
  const query = await searchParams;

  const report = mockReports.find((item) => item.id === id);

  if (!report) {
    notFound();
  }

  const category =
    typeof query.category === 'string' &&
    query.category.trim()
      ? query.category.trim()
      : report.category;

  const priority = isPriority(query.priority)
    ? query.priority
    : report.priority;

  const repairInstructions =
    query.repairOption === 'kerb-ramp'
      ? 'Selected option: Kerb ramp repair. Inspect and repair the damaged kerb ramp. Verify step-free access on site after repair.'
      : query.repairOption === 'surface'
        ? 'Selected option: Surface repair. Inspect and repair the uneven walkway surface. Verify step-free access on site after repair.'
        : undefined;

  return (
    <AssignMaintenance
      key={`${report.id}-${category}-${priority}-${query.repairOption ?? ''}`}
      report={report}
      category={category}
      priority={priority}
      initialInstructions={repairInstructions}
    />
  );
}