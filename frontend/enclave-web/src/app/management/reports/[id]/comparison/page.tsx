import { notFound } from 'next/navigation';

import RepairComparison from '@/components/management/RepairComparison';
import { mockReports } from '@/lib/mock-reports';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function RepairComparisonPage({
  params,
}: Props) {
  const { id } = await params;

  const report = mockReports.find((item) => item.id === id);

  if (!report) {
    notFound();
  }

  return <RepairComparison report={report} />;
}