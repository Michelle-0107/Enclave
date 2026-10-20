import ReportRoute from '@/components/management/ReportRoute';

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ repairReview?: string | string[] }> };

export default async function ReportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const reviewKey = typeof query.repairReview === 'string' ? query.repairReview : undefined;
  return <ReportRoute key={id} reportId={id} reviewKey={reviewKey} />;
}
