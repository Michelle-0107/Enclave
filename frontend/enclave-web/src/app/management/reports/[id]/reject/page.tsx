import { notFound } from 'next/navigation';

import RejectReport from '@/components/management/RejectReport';
import { mockReports } from '@/lib/mock-reports';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function RejectReportPage({
  params,
}: Props) {
  const { id } = await params;

  const report = mockReports.find((item) => item.id === id);

  if (!report) {
    notFound();
  }

  return (
    <RejectReport
      key={report.id}
      report={report}
    />
  );
}