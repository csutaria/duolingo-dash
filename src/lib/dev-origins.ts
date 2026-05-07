const DEFAULT_ALLOWED_DEV_ORIGINS = ["127.0.0.1", "[::1]"] as const;

function normalizeDevOrigin(value: string): string | null {
  let host = value.trim();
  if (!host) return null;

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(host)) {
    try {
      return new URL(host).hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  host = host.replace(/\/.*$/, "");
  if (host.startsWith("[") && host.includes("]")) {
    return host.slice(0, host.indexOf("]") + 1).toLowerCase();
  }

  return host.split(":", 1)[0]?.toLowerCase() || null;
}

export function allowedDevOriginsFromEnv(raw = process.env.NEXT_ALLOWED_DEV_ORIGINS): string[] {
  const seen = new Set<string>();
  const origins: string[] = [];

  for (const origin of DEFAULT_ALLOWED_DEV_ORIGINS) {
    seen.add(origin);
    origins.push(origin);
  }

  for (const part of raw?.split(/[\s,]+/) ?? []) {
    const origin = normalizeDevOrigin(part);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    origins.push(origin);
  }

  return origins;
}
