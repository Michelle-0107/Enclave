type Props = { rows?: number; className?: string; variant?: 'report' | 'card' | 'line' };

function Bar({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`block animate-pulse rounded-full bg-slate-200/80 ${className}`} />;
}

export function DataSkeleton({ rows = 3, className = '', variant = 'line' }: Props) {
  return <div role="status" aria-label="Loading content" aria-busy="true" className={className}>
    <span className="sr-only">Loading content</span>
    {Array.from({ length: rows }, (_, index) => variant === 'report' ? <div key={index} className="report-list-row pointer-events-none" aria-hidden="true">
      <Bar className="report-thumbnail animate-pulse" />
      <div className="report-row-main py-1"><Bar className="h-4 w-28" /><Bar className="h-5 w-3/4 rounded-md" /><Bar className="h-3 w-1/2 rounded-md" /></div>
      <div className="report-row-trailing"><Bar className="h-9 w-28" /></div>
    </div> : variant === 'card' ? <div key={index} className="rounded-2xl border border-border bg-white p-5" aria-hidden="true"><Bar className="mb-4 h-5 w-2/5 rounded-md" /><Bar className="mb-3 h-3 w-full rounded-md" /><Bar className="h-3 w-3/5 rounded-md" /></div> : <div key={index} className="border-b border-border py-5" aria-hidden="true"><Bar className="mb-3 h-4 w-1/3 rounded-md" /><Bar className="mb-2 h-3 w-full rounded-md" /><Bar className="h-3 w-2/3 rounded-md" /></div>)}
  </div>;
}
