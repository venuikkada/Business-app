import "./globals.css";

export const metadata = { title: { default: "Platform admin", template: "%s · CBA Admin" }, robots: { index: false, follow: false }, icons: { icon: "/icon.svg" } };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
