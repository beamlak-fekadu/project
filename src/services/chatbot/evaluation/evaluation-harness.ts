import { classifyChatRequest } from '@/services/chatbot/classifier-service';
import { EVALUATION_PROMPTS } from './capability-evaluation-dataset';

export interface EvaluationSummary {
  total: number;
  matchedCapability: number;
  matchRate: number;
  lowConfidenceCount: number;
  fallbackCount: number;
  byCapability: Record<string, { total: number; matched: number; lowConfidence: number }>;
}

export function runCapabilityEvaluation(): EvaluationSummary {
  const byCapability: EvaluationSummary['byCapability'] = {};
  let matchedCapability = 0;
  let lowConfidenceCount = 0;
  let fallbackCount = 0;

  for (const sample of EVALUATION_PROMPTS) {
    const classified = classifyChatRequest(sample.prompt);
    const isMatch = classified.capability === sample.capability;
    if (isMatch) matchedCapability += 1;
    if (classified.confidenceLabel === 'low') lowConfidenceCount += 1;
    if (classified.capability === 'general_fallback') fallbackCount += 1;

    const bucket = byCapability[sample.capability] ?? { total: 0, matched: 0, lowConfidence: 0 };
    bucket.total += 1;
    if (isMatch) bucket.matched += 1;
    if (classified.confidenceLabel === 'low') bucket.lowConfidence += 1;
    byCapability[sample.capability] = bucket;
  }

  return {
    total: EVALUATION_PROMPTS.length,
    matchedCapability,
    matchRate: EVALUATION_PROMPTS.length ? matchedCapability / EVALUATION_PROMPTS.length : 0,
    lowConfidenceCount,
    fallbackCount,
    byCapability,
  };
}
