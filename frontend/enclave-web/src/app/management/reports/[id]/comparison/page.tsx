import { redirect } from 'next/navigation';

export default async function ReportComparisonPage() {
  redirect('/management/what-if');
}
