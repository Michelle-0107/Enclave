import ReportRoute from '@/components/management/ReportRoute';

type Props = { params: Promise<{ id: string }> };

export default async function RequestInformationPage({ params }: Props) {
  const { id } = await params;
  return <ReportRoute reportId={id} unavailableFeature="request-information" />;
}
