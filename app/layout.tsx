import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { QueryProvider } from "@/components/providers/query-provider";
import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "NullSpend",
  description: "Approval layer for risky AI agent actions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable, geistMono.variable)} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
