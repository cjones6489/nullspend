/**
 * DNS resolution + TLS certificate sanity — P0-C / P0-F launch-night class.
 *
 * P0-C was DATABASE_URL pointing at an IPv6-only Supabase direct endpoint;
 * Vercel's Node runtime is IPv4-only → ENOTFOUND. The class lesson: verify
 * DNS resolves via IPv4 from a CI runner that matches production network.
 *
 * P0-F was docs hardcoding `nullspend.com` (parking page) and
 * `proxy.nullspend.com` (NXDOMAIN). The class lesson: verify every URL the
 * docs + marketing site advertise actually resolves in DNS and serves
 * over valid TLS.
 *
 * This test hits the production hostnames via DNS + TLS handshake (not a
 * full HTTP round-trip — that's covered elsewhere) and asserts:
 *   1. DNS resolves on IPv4 (A record present)
 *   2. TLS handshake succeeds with a valid cert
 *   3. Cert is not expiring within 30 days (advance warning)
 *
 * These hosts are hardcoded because they're the canonical production URLs
 * from `memory/project_production_urls.md`. If they change, this test
 * file changes — that's a feature, not a bug. DNS drift is exactly the
 * bug class this catches.
 */

import { describe, it, expect } from "vitest";
import { lookup } from "node:dns/promises";
import { connect } from "node:tls";
import type { PeerCertificate } from "node:tls";

// Canonical production hosts per memory/project_production_urls.md.
// DO NOT add preview URLs here — those are tested via getBaseUrl() in
// other files. This file verifies the hostnames that appear in docs,
// SDK defaults, marketing, and customer copy-paste quickstarts.
const PRODUCTION_HOSTS = [
  { host: "www.nullspend.dev", purpose: "dashboard (primary)" },
  { host: "nullspend.dev", purpose: "apex (redirects to www)" },
  { host: "proxy.nullspend.dev", purpose: "proxy worker custom domain" },
];

const MIN_DAYS_BEFORE_EXPIRY = 30;

function getCertExpiryDays(cert: PeerCertificate): number {
  const validTo = new Date(cert.valid_to);
  const now = Date.now();
  return Math.floor((validTo.getTime() - now) / (1000 * 60 * 60 * 24));
}

async function getTlsCert(host: string, port = 443): Promise<PeerCertificate> {
  return new Promise((resolve, reject) => {
    const socket = connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: true,
        // Don't send any data; we just want the certificate.
      },
      () => {
        const cert = socket.getPeerCertificate(true);
        socket.end();
        if (!cert || Object.keys(cert).length === 0) {
          reject(new Error(`No certificate returned for ${host}`));
        } else {
          resolve(cert);
        }
      },
    );
    socket.setTimeout(10_000, () => {
      socket.destroy(new Error(`TLS handshake timeout for ${host}`));
    });
    socket.on("error", reject);
  });
}

describe("DNS + TLS for production hosts (P0-C / P0-F regression)", () => {
  describe.each(PRODUCTION_HOSTS)("$host ($purpose)", ({ host }) => {
    it("resolves via DNS (IPv4)", async () => {
      // family: 4 forces A-record lookup. If IPv6-only (like the
      // Supabase direct URL that broke P0-C), this throws.
      const { address } = await lookup(host, { family: 4 });
      expect(address).toBeTruthy();
      expect(address).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    });

    it("serves a valid TLS certificate", async () => {
      const cert = await getTlsCert(host);
      expect(cert.subject).toBeDefined();
      // The cert must cover this hostname (either as CN or in SAN).
      // Note: `cert.subject.CN` is typed `string | string[]` because X.509
      // allows multi-valued CN attributes (rare but legal). Normalize.
      const coveredNames = new Set<string>();
      const cn = cert.subject?.CN;
      if (typeof cn === "string") {
        coveredNames.add(cn);
      } else if (Array.isArray(cn)) {
        for (const v of cn) coveredNames.add(v);
      }
      if (cert.subjectaltname) {
        for (const name of cert.subjectaltname.split(", ")) {
          if (name.startsWith("DNS:")) coveredNames.add(name.slice(4));
        }
      }
      const coversHost = [...coveredNames].some(
        (n) =>
          n === host ||
          (n.startsWith("*.") && host.endsWith(n.slice(1))),
      );
      expect(
        coversHost,
        `Cert for ${host} covers: ${[...coveredNames].join(", ")}`,
      ).toBe(true);
    });

    it("TLS certificate is not expiring within 30 days", async () => {
      const cert = await getTlsCert(host);
      const daysUntilExpiry = getCertExpiryDays(cert);
      expect(
        daysUntilExpiry,
        `Cert for ${host} expires in ${daysUntilExpiry} days (${cert.valid_to})`,
      ).toBeGreaterThanOrEqual(MIN_DAYS_BEFORE_EXPIRY);
    });
  });
});
