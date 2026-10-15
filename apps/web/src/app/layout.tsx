import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CRAZY BUSINESS APP — One App. Complete Business Control.", template: "%s · CRAZY BUSINESS APP" },
  description: "GST-ready billing, inventory, quotations, payments, expenses and service management for Indian businesses.",
  applicationName: "CRAZY BUSINESS APP",
  icons: { icon: "/icon.svg" },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#ea580c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
