import type { Metadata } from "next";
import "./globals.css";
import AppProviders from "@/components/auth/AppProviders";

export const metadata: Metadata = {
  title: "Enclave · Management Portal",
  description: "Manage reports, residents, notifications, and community repairs.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
