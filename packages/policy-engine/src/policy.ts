export interface DomainPolicyConfig {
  allowedDomains: string[];
  maxRequestsPerMinute?: number;
  allowExternalRedirects?: boolean;
}

export class PolicyEngine {
  constructor(private config: DomainPolicyConfig) {}

  public isUrlAllowed(url: string): { allowed: boolean; reason?: string } {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname;

      const isAllowed = this.config.allowedDomains.some((d) =>
        domain === d || domain.endsWith('.' + d)
      );

      if (!isAllowed) {
        return {
          allowed: false,
          reason: `[POLICY_VIOLATION] Access to domain '${domain}' is outside the authorized domain policy list.`,
        };
      }

      return { allowed: true };
    } catch {
      return { allowed: false, reason: 'Invalid URL format' };
    }
  }
}
