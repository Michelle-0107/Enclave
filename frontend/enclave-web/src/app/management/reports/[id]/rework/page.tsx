import { notFound } from 'next/navigation';

import RequestRework from '@/components/management/RequestRework';
import { mockReports } from '@/lib/mock-reports';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function RequestReworkPage({
  params,
}: Props) {
  const { id } = await params;

  const report = mockReports.find((item) => item.id === id);

  if (
    !report ||
    report.status !== 'awaiting-verification'
  ) {
    notFound();
  }

  return <RequestRework key={report.id} report={report} />;
}