import type { Metadata } from "next";
import "./scout.css";

export const metadata: Metadata = {
  title: "Career Scout — Your profile, your next role",
  description: "Build a profile from your resume, clarify your goals, and find relevant jobs in one guided workspace.",
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
