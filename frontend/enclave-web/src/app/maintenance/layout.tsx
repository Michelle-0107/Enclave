import type { ReactNode } from "react";
import MaintenanceLayout from "@/components/layout/MaintenanceLayout";
import { MaintenanceProvider } from "@/components/maintenance/MaintenanceProvider";
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <MaintenanceProvider>
      <MaintenanceLayout>{children}</MaintenanceLayout>
    </MaintenanceProvider>
  );
}
