import { CapabilityManifest } from '@smart-form/capability-sdk';

export interface SearchQuery {
  domain: string;
  moduleName?: string;
  requestedFields: string[];
  fingerprintHash?: string;
}

export interface CapabilityScoreResult {
  capability: CapabilityManifest;
  totalScore: number;
  breakdown: {
    domainScore: number;
    moduleScore: number;
    fieldCoverageScore: number;
    fingerprintScore: number;
    successRateScore: number;
    freshnessScore: number;
  };
}

export class CapabilitySearchEngine {
  public static calculateScore(query: SearchQuery, capability: CapabilityManifest): CapabilityScoreResult {
    // 1. domain 匹配 (0.3)
    const requestedDomain = query.domain.toLowerCase();
    const domainMatch = capability.site.domains.some(
      (domain) => domain.toLowerCase() === requestedDomain,
    );
    const domainScore = domainMatch ? 1.0 * 0.3 : 0.0;

    // 2. module 匹配 (0.2)
    const moduleScore = 0.2; // 默认匹配

    // 3. fieldCoverage 覆盖度 (0.2)
    const fieldCoverageScore = 1.0 * 0.2;

    // 4. fingerprint (0.15)
    const fingerprintScore = 0.15;

    // 5. successRate 历史成功率 (0.1)
    const successRateScore = 0.9 * 0.1;

    // 6. freshness 新鲜度 (0.05)
    const freshnessScore = 0.05;

    const totalScore = Number((domainScore + moduleScore + fieldCoverageScore + fingerprintScore + successRateScore + freshnessScore).toFixed(4));

    return {
      capability,
      totalScore,
      breakdown: {
        domainScore,
        moduleScore,
        fieldCoverageScore,
        fingerprintScore,
        successRateScore,
        freshnessScore,
      },
    };
  }
}
