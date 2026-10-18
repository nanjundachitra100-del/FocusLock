export const MAX_BLOCKED_SITES = 50;

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isIpv4Address(hostname: string): boolean {
  const octets = hostname.split(".");
  return octets.length === 4 && octets.every((octet) => {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const value = Number(octet);
    return value >= 0 && value <= 255;
  });
}

/** Accept a bare DNS hostname or HTTP(S) URL and return its canonical hostname. */
export function normalizeBlockedWebsiteDomain(input: string): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  if (!value || value.length > 2048 || /[\\\s]/.test(value)) return null;

  let hostname: string;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    hostname = url.hostname;
  } else {
    if (/[\/@?#]/.test(value)) return null;
    try {
      hostname = new URL(`https://${value}`).hostname;
    } catch {
      return null;
    }
  }

  hostname = hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isIpv4Address(hostname) ||
    !DOMAIN_PATTERN.test(hostname) ||
    hostname.split(".").some((label) => label.length > 63)
  ) {
    return null;
  }

  return hostname;
}
