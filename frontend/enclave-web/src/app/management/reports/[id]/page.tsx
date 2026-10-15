import { notFound } from 'next/navigation';

import VerifyRepair from '@/components/management/VerifyRepair';
import { mockReports } from '@/lib/mock-reports';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function VerifyRepairPage({
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

  return <VerifyRepair key={report.id} report={report} />;
}