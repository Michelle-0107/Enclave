import { notFound } from 'next/navigation';

import ResolvedReport from '@/components/management/ResolvedReport';
import { mockReports } from '@/lib/mock-reports';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ResolvedReportPage({
  params,
}: Props) {
  const { id } = await params;

  const report = mockReports.find((item) => item.id === id);

  if (
    !report ||
    (
      report.status !== 'awaiting-verification' &&
      report.status !== 'resolved'
    )
  ) {
    notFound();
  }

  return (
    <ResolvedReport
      report={report}
      preview={report.status !== 'resolved'}
    />
  );
}