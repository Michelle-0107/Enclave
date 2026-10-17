import ReportRoute from '@/components/management/ReportRoute';

type Props = { params: Promise<{ id: string }> };

export default async function RejectPage({ params }: Props) {
  const { id } = await params;
  return <ReportRoute reportId={id} />;
}
