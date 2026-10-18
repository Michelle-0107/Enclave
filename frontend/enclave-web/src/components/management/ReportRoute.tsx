'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import ReportDetails from '@/components/management/ReportDetails';
import { getManagementReport, type ManagementReport } from '@/lib/api';

type Props = {
  reportId: string;
  unavailableFeature?: 'request-information' | 'rework';
};

export default function ReportRoute({ reportId, unavailableFeature }: Props) {
  const [report, setReport] = useState<ManagementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await getManagementReport(reportId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load this report.');
    } finally {
      setLoading(false);
    }
  }, [reportId]);

  useEffect(() => {
    let active = true;
    getManagementReport(reportId)
      .then((item) => { if (active) setReport(item); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load this report.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reportId]);

  if (loading) return <p role="status" className="py-8 text-sm text-muted-foreground">Loading report from the backend…</p>;
  if (error) {
    return (
      <div role="alert" className="flex flex-col gap-4 rounded-2xl bg-status-red-bg p-5 text-sm text-status-red">
        <p>{error}</p>
        <button type="button" onClick={() => void load()} className="w-fit font-semibold underline">Try again</button>
      </div>
    );
  }
  if (!report) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-sm text-muted-foreground">Report #{reportId} was not found in the live management report list.</p>
        <Link href="/management/reports" className="w-fit text-sm font-semibold text-primary underline">Back to reports</Link>
      </div>
    );
  }

  if (unavailableFeature === 'request-information') {
    const feature = unavailableFeature === 'request-information'
      ? 'Requesting additional information from a resident'
      : 'Sending a maintenance rework request';

    return (
      <div className="flex flex-col gap-5">
        <Link href={`/management/reports/${report.id}`} className="text-sm font-semibold text-primary underline">Back to report</Link>
        <h1 className="text-3xl font-semibold text-primary">This action is not available yet.</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{feature} has no matching endpoint or status transition in the current backend contract. This page will not show a fake success state.</p>
      </div>
    );
  }

  return <ReportDetails report={report} />;
}
