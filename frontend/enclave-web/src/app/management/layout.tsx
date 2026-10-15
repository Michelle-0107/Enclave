import type { ReactNode } from 'react';

import PortalLayout from '@/components/layout/PortalLayout';

export default function ManagementLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <PortalLayout>
      {children}
    </PortalLayout>
  );
}