import { notFound } from 'next/navigation';

import ReportDetails from '@/components/management/ReportDetails';
import { mockReports } from '@/lib/mock-reports';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function ReportDetailsPage({ params }: Props) {
  const { id } = await params;

  const report = mockReports.find((item) => item.id === id);

  if (!report) {
    notFound();
  }

  return <ReportDetails key={report.id} report={report} />;
}