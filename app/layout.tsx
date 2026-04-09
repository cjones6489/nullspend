import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";

import { QueryProvider } from "@/components/providers/query-provider";
import { cn } from "@/lib/utils";

import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "NullSpend",
  description: "Approval layer for risky AI agent actions.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Awaiting headers() opts the entire app tree into dynamic rendering.
  //
  // This is REQUIRED for CSP nonces to work: Next.js auto-propagates the
  // per-request nonce (set by proxy.ts in the x-nonce request header) to
  // framework scripts, page JavaScript bundles, inline styles, and
  // <Script> components — but ONLY for dynamically rendered pages. Static
  // prerendering bakes a build-time placeholder nonce into the HTML while
  // the CSP response header gets a fresh per-request nonce, and the
  // mismatch causes the browser to block every script (React never
  // hydrates). See Next.js docs:
  //   https://nextjs.org/docs/app/guides/content-security-policy
  //   "When nonces are used in CSP, all pages must be dynamically rendered."
  //
  // The trade-off: no static optimization or ISR for any page. Acceptable
  // for this app because the marketing + docs pages are small and Vercel's
  // dynamic edge rendering is fast enough. Security > ~100ms on cold pages.
  //
  // We read the nonce here but don't use it directly. The call itself is
  // what opts into dynamic rendering. Next.js handles the actual nonce
  // propagation to its own generated script tags automatically once the
  // request is dynamic. If this layout ever adds explicit <Script> tags,
  // they should use `nonce={nonce}` via a headers() read in the same scope.
  //
  // Found by /qa pass 2026-04-08. Before this change, the HTML body had
  // ZERO <script nonce="..."> tags despite middleware setting a valid nonce
  // in the CSP header, because Next.js was prerendering every page.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  void nonce; // reserved for future <Script nonce={nonce} /> additions

  return (
    <html lang="en" className={cn("font-sans", geist.variable, geistMono.variable)} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
