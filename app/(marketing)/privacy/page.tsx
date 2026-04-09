import type { Metadata } from "next";
import Link from "next/link";

// NOT LEGAL ADVICE. This is a generic Privacy Policy template covering
// common practices for a FinOps SaaS. Have a lawyer review before
// relying on it for actual compliance (GDPR, CCPA, etc.). Replace or
// extend as the product evolves.
//
// Last substantive update: 2026-04-09 (initial version for launch).

export const metadata: Metadata = {
  title: "Privacy Policy — NullSpend",
  description:
    "How NullSpend collects, uses, and protects your data. Short, plain-language, and honest.",
};

const LAST_UPDATED = "April 9, 2026";

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Last updated: {LAST_UPDATED}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Privacy Policy
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          The short version: we take your data seriously, we don&apos;t sell it,
          we don&apos;t resell it, and we only collect what we need to make the
          product work. This page explains the details.
        </p>
      </header>

      <div className="space-y-8 text-sm leading-relaxed">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            1. What we collect
          </h2>
          <p className="text-muted-foreground">
            To operate NullSpend we need to collect a small amount of
            information:
          </p>
          <ul className="ml-5 list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Account information</strong> —
              your email address and authentication credentials, managed via
              Supabase Auth.
            </li>
            <li>
              <strong className="text-foreground">Usage metadata</strong> — the
              API calls you route through NullSpend, including model, token
              counts, cost, and timestamps. We do not store prompt content or
              model responses by default.
            </li>
            <li>
              <strong className="text-foreground">Optional body capture</strong>{" "}
              — if you explicitly enable request/response body logging for
              debugging, we store those bodies in encrypted object storage
              scoped to your organization. You can disable this at any time.
            </li>
            <li>
              <strong className="text-foreground">Payment information</strong>{" "}
              — for paid plans, handled entirely by Stripe. We never see or
              store card numbers.
            </li>
            <li>
              <strong className="text-foreground">Operational logs</strong> —
              request IDs, error traces, and diagnostic data used to debug
              issues and improve reliability. Retained for 30 days unless a
              specific investigation extends that window.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            2. What we don&apos;t do
          </h2>
          <ul className="ml-5 list-disc space-y-2 text-muted-foreground">
            <li>
              We don&apos;t sell your data. To anyone. Ever.
            </li>
            <li>
              We don&apos;t train AI models on your usage data.
            </li>
            <li>
              We don&apos;t resell aggregated usage data to third parties for
              marketing, analytics, or any other purpose.
            </li>
            <li>
              We don&apos;t share your data with advertisers or data brokers.
            </li>
            <li>
              We don&apos;t log the contents of prompts or model responses by
              default (only token counts and metadata).
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            3. How we use what we collect
          </h2>
          <p className="text-muted-foreground">
            The data we collect is used to:
          </p>
          <ul className="ml-5 list-disc space-y-2 text-muted-foreground">
            <li>Operate the product (cost tracking, budget enforcement, HITL)</li>
            <li>Process billing and subscription management</li>
            <li>Send product, security, and service-related emails</li>
            <li>Debug issues you report and improve reliability</li>
            <li>Comply with legal obligations when required</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            4. Service providers we rely on
          </h2>
          <p className="text-muted-foreground">
            NullSpend runs on infrastructure from these providers. Each
            receives only the data strictly necessary to perform its function:
          </p>
          <ul className="ml-5 list-disc space-y-2 text-muted-foreground">
            <li>
              <strong className="text-foreground">Supabase</strong> —
              authentication and primary database storage
            </li>
            <li>
              <strong className="text-foreground">Vercel</strong> — dashboard
              hosting and edge rendering
            </li>
            <li>
              <strong className="text-foreground">Cloudflare</strong> — proxy
              worker, DNS, and CDN
            </li>
            <li>
              <strong className="text-foreground">Stripe</strong> — payment
              processing (paid plans only)
            </li>
            <li>
              <strong className="text-foreground">Upstash</strong> — rate
              limiting state
            </li>
            <li>
              <strong className="text-foreground">Sentry</strong> — error
              monitoring (operational logs, not user data)
            </li>
          </ul>
          <p className="text-muted-foreground">
            We review these providers periodically and keep them under
            contractual data processing agreements where applicable.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            5. Open source
          </h2>
          <p className="text-muted-foreground">
            Portions of NullSpend are open source. You can inspect the
            client SDK, cost calculation engine, and adapter packages
            yourself. We believe transparency about how your data is
            processed is a feature, not a liability.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            6. Your rights
          </h2>
          <p className="text-muted-foreground">
            You have the right to:
          </p>
          <ul className="ml-5 list-disc space-y-2 text-muted-foreground">
            <li>Access the data we hold about you</li>
            <li>Correct inaccurate information</li>
            <li>
              Delete your account and all associated data (self-serve via
              Settings, or email us)
            </li>
            <li>Export your cost event history in CSV or JSON</li>
            <li>
              Opt out of non-essential product emails (essential service
              emails like security notices still go through)
            </li>
          </ul>
          <p className="text-muted-foreground">
            To exercise any of these rights, email us at{" "}
            <a
              href="mailto:support@nullspend.dev"
              className="text-primary hover:underline"
            >
              support@nullspend.dev
            </a>
            .
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            7. Data retention
          </h2>
          <p className="text-muted-foreground">
            Cost event data is retained for as long as your account is
            active, or longer if required for billing reconciliation or
            legal compliance. When you delete your account, we remove
            your cost events, API keys, webhook configurations, and
            personal information within 30 days. Stripe-held payment
            records are retained per Stripe&apos;s own policies.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            8. Changes to this policy
          </h2>
          <p className="text-muted-foreground">
            We&apos;ll update this page if our practices change. The
            &ldquo;Last updated&rdquo; date at the top reflects the most
            recent substantive change. For material changes, we&apos;ll
            notify active users by email at least 14 days before the
            change takes effect.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            9. Contact
          </h2>
          <p className="text-muted-foreground">
            Questions, concerns, or a data request? Email{" "}
            <a
              href="mailto:support@nullspend.dev"
              className="text-primary hover:underline"
            >
              support@nullspend.dev
            </a>
            . We read everything.
          </p>
        </section>
      </div>

      <footer className="mt-16 border-t border-border/40 pt-6">
        <Link
          href="/"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← Back to home
        </Link>
      </footer>
    </article>
  );
}
