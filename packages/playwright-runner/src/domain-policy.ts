function normalizeHostname(value: string): string {
  const candidate = value.includes('://') ? value : `https://${value}`;
  return new URL(candidate).hostname.toLowerCase();
}

export function isUrlAllowed(url: string, allowedDomains: readonly string[]): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  return allowedDomains.some((domain) => {
    try {
      return normalizeHostname(domain) === hostname;
    } catch {
      return false;
    }
  });
}

