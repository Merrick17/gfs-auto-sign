import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GFS Contract Agent",
  description: "Autonomous sales contract processing for Green Fashion Solutions",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
