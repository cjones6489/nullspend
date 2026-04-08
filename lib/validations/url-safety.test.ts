import { describe, it, expect } from "vitest";
import { isSafeExternalUrl } from "./url-safety";

describe("isSafeExternalUrl", () => {
  // ── Happy path ────────────────────────────────────────────────────

  it("accepts standard HTTPS URLs", () => {
    expect(isSafeExternalUrl("https://example.com/path")).toBe(true);
    expect(isSafeExternalUrl("https://api.example.com")).toBe(true);
    expect(isSafeExternalUrl("https://example.com:8443/path?q=1")).toBe(true);
    expect(isSafeExternalUrl("https://sub.domain.example.co.uk")).toBe(true);
  });

  it("accepts HTTPS URLs with query strings and fragments", () => {
    expect(isSafeExternalUrl("https://example.com/path?a=1&b=2#fragment")).toBe(true);
  });

  it("accepts HTTPS URLs with {customer_id} placeholder after parsing", () => {
    // The placeholder is a real character sequence in the URL path —
    // `new URL()` accepts it, so this helper will too. Callers that
    // want to reject literal placeholders should add a separate check.
    expect(isSafeExternalUrl("https://example.com/upgrade?customer=%7Bcustomer_id%7D")).toBe(true);
  });

  // ── Scheme rejection ──────────────────────────────────────────────

  it("rejects non-HTTPS schemes", () => {
    expect(isSafeExternalUrl("http://example.com")).toBe(false);
    expect(isSafeExternalUrl("ftp://example.com")).toBe(false);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,<h1>x</h1>")).toBe(false);
  });

  // ── User-info rejection (the SSRF / spoofing class) ───────────────

  it("rejects URLs with user-info (username@host)", () => {
    expect(isSafeExternalUrl("https://user@example.com")).toBe(false);
  });

  it("rejects URLs with user-info (username:password@host)", () => {
    expect(isSafeExternalUrl("https://user:pass@example.com")).toBe(false);
  });

  it("rejects the evil.com@good.com display-confusable attack", () => {
    // `new URL("https://evil.com@good.com")` parses hostname as "good.com"
    // but displays "evil.com@good.com" to users — classic phishing vector.
    // This is the canonical reason to reject user-info.
    expect(isSafeExternalUrl("https://evil.com@good.com/upgrade")).toBe(false);
  });

  it("rejects URLs with empty password (https://user:@host)", () => {
    expect(isSafeExternalUrl("https://user:@example.com")).toBe(false);
  });

  // ── Loopback rejection ────────────────────────────────────────────

  it("rejects localhost", () => {
    expect(isSafeExternalUrl("https://localhost")).toBe(false);
    expect(isSafeExternalUrl("https://localhost:8080/x")).toBe(false);
  });

  it("rejects 127.0.0.0/8", () => {
    expect(isSafeExternalUrl("https://127.0.0.1")).toBe(false);
    expect(isSafeExternalUrl("https://127.0.0.1:443/x")).toBe(false);
    expect(isSafeExternalUrl("https://127.99.99.99")).toBe(false);
  });

  it("rejects bind-all (0.0.0.0)", () => {
    expect(isSafeExternalUrl("https://0.0.0.0")).toBe(false);
  });

  // ── Private ranges ────────────────────────────────────────────────

  it("rejects RFC 1918 private ranges", () => {
    expect(isSafeExternalUrl("https://10.0.0.1")).toBe(false);
    expect(isSafeExternalUrl("https://10.255.255.255")).toBe(false);
    expect(isSafeExternalUrl("https://192.168.1.1")).toBe(false);
    expect(isSafeExternalUrl("https://172.16.0.1")).toBe(false);
    expect(isSafeExternalUrl("https://172.31.255.255")).toBe(false);
  });

  it("accepts public IPs that look close to private ranges", () => {
    // 172.15 is NOT private (range is 172.16-31)
    expect(isSafeExternalUrl("https://172.15.0.1")).toBe(true);
    // 172.32 is NOT private
    expect(isSafeExternalUrl("https://172.32.0.1")).toBe(true);
    // 11.x is NOT private
    expect(isSafeExternalUrl("https://11.0.0.1")).toBe(true);
  });

  // ── Link-local + metadata ─────────────────────────────────────────

  it("rejects link-local (169.254.0.0/16)", () => {
    expect(isSafeExternalUrl("https://169.254.169.254")).toBe(false); // AWS metadata
    expect(isSafeExternalUrl("https://169.254.0.1")).toBe(false);
  });

  it("rejects .local hostnames", () => {
    expect(isSafeExternalUrl("https://mycomputer.local")).toBe(false);
    expect(isSafeExternalUrl("https://some.nested.local")).toBe(false);
  });

  // ── IPv6 literals ─────────────────────────────────────────────────

  it("rejects IPv6 literal hostnames", () => {
    expect(isSafeExternalUrl("https://[::1]")).toBe(false);
    expect(isSafeExternalUrl("https://[2001:db8::1]")).toBe(false);
  });

  // ── Malformed input ───────────────────────────────────────────────

  it("rejects obviously malformed input", () => {
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
    expect(isSafeExternalUrl("https://")).toBe(false);
    expect(isSafeExternalUrl("://example.com")).toBe(false);
  });
});
