import { notFound } from 'next/navigation';

import RequestInformation from '@/components/management/RequestInformation';
import { mockReports } from '@/lib/mock-reports';

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function RequestInformationPage({
  params,
}: Props) {
  const { id } = await params;

  const report = mockReports.find((item) => item.id === id);

  if (!report) {
    notFound();
  }

  return (
    <RequestInformation
      key={report.id}
      report={report}
    />
  );
}