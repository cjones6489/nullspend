/**
 * Shared URL safety validator.
 *
 * Used by any user-configurable URL that will be followed automatically
 * by the platform (webhook endpoints, upgrade URLs in denial responses,
 * any future auto-followed URL).
 *
 * Rejects:
 * - Non-HTTPS schemes
 * - IPv6 literal hostnames
 * - User-info in URLs (e.g. `https://evil.com@good.com/path` — the host
 *   is `good.com` but agents that render the visible string may route
 *   to `evil.com`, and the user-info itself is a known exfiltration
 *   channel)
 * - Loopback addresses (`localhost`, `127.0.0.0/8`, `0.0.0.0`)
 * - Private RFC 1918 ranges (`10/8`, `192.168/16`, `172.16-31/12`)
 * - Link-local / metadata addresses (`169.254.0.0/16`, `*.local`)
 *
 * Does NOT check DNS — a hostname that resolves to a private IP at
 * request time will still pass this check. The platform's outbound
 * HTTP client is responsible for the second layer of defense (DNS
 * pinning / IP allowlisting in Cloudflare Workers, etc.).
 */
export function isSafeExternalUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  // Reject user-info in URLs. `new URL("https://evil.com@good.com")`
  // parses hostname as `good.com` but `evil.com` appears before the `@`
  // and is a well-known display-confusable attack vector. No legitimate
  // configuration should include user-info.
  if (parsed.username !== "" || parsed.password !== "") return false;

  const hostname = parsed.hostname;

  // Block IPv6 literals — real URLs in this context use DNS hostnames.
  if (hostname.startsWith("[")) return false;

  // Loopback + bind-all
  if (hostname === "localhost") return false;
  if (hostname.startsWith("127.")) return false;
  if (hostname === "0.0.0.0") return false;

  // Private RFC 1918 ranges
  if (hostname.startsWith("10.")) return false;
  if (hostname.startsWith("192.168.")) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return false;

  // Link-local and metadata
  if (hostname.startsWith("169.254.")) return false;
  if (hostname.endsWith(".local")) return false;

  return true;
}
