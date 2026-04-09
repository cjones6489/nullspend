import type { Metadata } from "next";
import Link from "next/link";

// NOT LEGAL ADVICE. This is a generic Terms of Service template covering
// common practices for a SaaS product. Have a lawyer review before
// relying on it for actual compliance. Replace or extend as the
// product evolves.
//
// Last substantive update: 2026-04-09 (initial version for launch).

export const metadata: Metadata = {
  title: "Terms of Service — NullSpend",
  description:
    "The terms under which you use NullSpend. Short, plain-language, and fair.",
};

const LAST_UPDATED = "April 9, 2026";

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Last updated: {LAST_UPDATED}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Terms of Service
        </h1>
        <p className="mt-4 text-sm text-muted-foreground">
          These terms govern your use of NullSpend. By creating an
          account or using the service, you agree to them. They&apos;re
          written to be readable, not to hide gotchas.
        </p>
      </header>

      <div className="space-y-8 text-sm leading-relaxed">
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            1. The service
          </h2>
          <p className="text-muted-foreground">
            NullSpend is a FinOps layer for AI agents: cost tracking,
            budget enforcement, and human-in-the-loop approval for API
            calls to providers like OpenAI and Anthropic. It consists of
            a dashboard, a proxy worker, SDKs, and supporting APIs.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            2. Your account
          </h2>
          <p className="text-muted-foreground">
            You&apos;re responsible for:
          </p>
          <ul className="ml-5 list-disc space-y-2 text-muted-foreground">
            <li>
              Keeping your login credentials and API keys confidential
            </li>
            <li>
              All activity that occurs through your account or API keys
            </li>
            <li>
              Notifying us promptly if you suspect unauthorized access
            </li>
            <li>
              Providing accurate information during sign-up
            </li>
          </ul>
          <p className="text-muted-foreground">
            You must be at least 13 years old (or the minimum age
            required by your jurisdiction) to use NullSpend.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            3. Acceptable use
          </h2>
          <p className="text-muted-foreground">
            Don&apos;t use NullSpend to:
          </p>
          <ul className="ml-5 list-disc space-y-2 text-muted-foreground">
            <li>
              Violate any applicable law or the terms of service of the
              upstream AI providers you&apos;re routing through
            </li>
            <li>
              Attempt to abuse, reverse-engineer, or disrupt the service
            </li>
            <li>
              Send spam, malware, phishing attempts, or other harmful
              content
            </li>
            <li>
              Infringe on anyone&apos;s intellectual property rights
            </li>
            <li>
              Circumvent rate limits or budget controls in ways that
              harm other users
            </li>
            <li>
              Generate or distribute content that is illegal, harmful,
              or violates the AI providers&apos; usage policies
            </li>
          </ul>
          <p className="text-muted-foreground">
            We reserve the right to suspend or terminate accounts that
            violate these rules, with or without notice depending on
            severity.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            4. Billing and subscriptions
          </h2>
          <p className="text-muted-foreground">
            NullSpend offers a free tier and paid plans. Paid plans:
          </p>
          <ul className="ml-5 list-disc space-y-2 text-muted-foreground">
            <li>
              Are billed in advance on a monthly or annual basis via
              Stripe
            </li>
            <li>
              Auto-renew at the end of each billing period until
              cancelled
            </li>
            <li>
              Can be cancelled at any time from the Billing page —
              you&apos;ll retain access until the end of the current
              period
            </li>
            <li>
              Are generally non-refundable once charged, except where
              required by law
            </li>
            <li>
              May include pass-through charges for any applicable taxes
            </li>
          </ul>
          <p className="text-muted-foreground">
            We&apos;ll notify you at least 14 days in advance of any
            price changes to existing plans.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            5. Your data, your ownership
          </h2>
          <p className="text-muted-foreground">
            You retain ownership of all data you send through NullSpend
            — your cost events, budgets, API keys, tags, organizations,
            and any request/response bodies you opt to capture. We act
            as a processor on your behalf. See our{" "}
            <Link
              href="/privacy"
              className="text-primary hover:underline"
            >
              Privacy Policy
            </Link>{" "}
            for the details of how we handle it.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            6. Open source components
          </h2>
          <p className="text-muted-foreground">
            Portions of NullSpend are open source and released under
            permissive licenses (MIT, Apache 2.0). Those components are
            governed by their own license terms in addition to (and
            where they conflict, instead of) these terms. The
            proprietary dashboard, proxy service, and hosted
            infrastructure are not open source and remain subject to
            these Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            7. Availability and support
          </h2>
          <p className="text-muted-foreground">
            We aim for high availability and will work in good faith to
            restore service quickly during incidents, but we don&apos;t
            guarantee uninterrupted access. We&apos;re an early-stage
            product — things may occasionally break, and we&apos;ll be
            transparent when they do.
          </p>
          <p className="text-muted-foreground">
            Support is provided on a best-effort basis via{" "}
            <a
              href="mailto:support@nullspend.dev"
              className="text-primary hover:underline"
            >
              support@nullspend.dev
            </a>
            . Paid plans may include formal SLAs; those are defined in
            your plan documentation.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            8. Disclaimers
          </h2>
          <p className="text-muted-foreground">
            NullSpend is provided &ldquo;as is&rdquo; and &ldquo;as
            available&rdquo; without warranty of any kind, express or
            implied, including but not limited to warranties of
            merchantability, fitness for a particular purpose, and
            non-infringement. We don&apos;t warrant that the service
            will be error-free, uninterrupted, or that defects will be
            corrected.
          </p>
          <p className="text-muted-foreground">
            NullSpend doesn&apos;t guarantee the accuracy of cost
            estimates or budget enforcement — while we try to be
            correct, you should verify critical financial data against
            your upstream provider&apos;s invoices.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            9. Limitation of liability
          </h2>
          <p className="text-muted-foreground">
            To the maximum extent permitted by law, NullSpend and its
            operators shall not be liable for any indirect, incidental,
            special, consequential, or punitive damages arising from
            your use of the service. Our total aggregate liability for
            any claims shall not exceed the greater of (a) fees paid to
            us in the 12 months preceding the claim, or (b) USD 100.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            10. Termination
          </h2>
          <p className="text-muted-foreground">
            You can cancel your account at any time from Settings. We
            can suspend or terminate accounts that violate these Terms,
            fail to pay for subscribed plans, or pose a security risk to
            other users. On termination, your data is deleted per our
            Privacy Policy&apos;s retention schedule.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            11. Changes to these Terms
          </h2>
          <p className="text-muted-foreground">
            We may update these Terms occasionally. For material
            changes, we&apos;ll notify active users by email at least 14
            days before the change takes effect. Continued use of
            NullSpend after a change takes effect means you accept the
            updated Terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            12. Governing law
          </h2>
          <p className="text-muted-foreground">
            These Terms are governed by the laws of the United States
            and, where applicable, the state in which NullSpend&apos;s
            operating entity is registered. Disputes will be resolved in
            the courts of that jurisdiction unless otherwise required by
            applicable consumer protection law.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">
            13. Contact
          </h2>
          <p className="text-muted-foreground">
            Questions about these Terms? Email{" "}
            <a
              href="mailto:support@nullspend.dev"
              className="text-primary hover:underline"
            >
              support@nullspend.dev
            </a>
            .
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
