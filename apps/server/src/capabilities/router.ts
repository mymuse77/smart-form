import { CapabilityScoreResult } from './search';

export type CapabilityReuseDecision = 'AUTO_REUSE' | 'USER_CONFIRM' | 'RE_EXPLORE';

export class CapabilityRouter {
  public static decideReuseStrategy(scoreResult?: CapabilityScoreResult): { decision: CapabilityReuseDecision; score: number } {
    if (!scoreResult) {
      return { decision: 'RE_EXPLORE', score: 0 };
    }

    const score = scoreResult.totalScore;
    if (score >= 0.85) {
      return { decision: 'AUTO_REUSE', score };
    } else if (score >= 0.65) {
      return { decision: 'USER_CONFIRM', score };
    } else {
      return { decision: 'RE_EXPLORE', score };
    }
  }
}
