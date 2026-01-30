import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Majordomo Dashboard",
  description: "Your personal AI assistant - everywhere",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[var(--background)]">
        {children}
      </body>
    </html>
  );
}
