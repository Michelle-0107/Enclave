import ReportsList from '@/components/management/ReportsList';

type Props = {
  searchParams: Promise<{
    status?: string | string[];
  }>;
};

export default async function ReportsPage({
  searchParams,
}: Props) {
  const params = await searchParams;

  const status =
    typeof params.status === 'string'
      ? params.status
      : 'all';

  return (
    <ReportsList
      key={status}
      initialStatus={status}
    />
  );
}
