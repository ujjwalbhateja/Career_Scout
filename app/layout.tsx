import type { Metadata } from "next";
import "./scout.css";

export const metadata: Metadata = {
  title: "Career Scout — Find your next role",
  description: "Search live job sources, refine your criteria, and import company career or job links on demand.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
