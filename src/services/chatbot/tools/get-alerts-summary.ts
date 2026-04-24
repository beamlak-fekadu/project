import { buildAlertSynthesis } from '../proactive-signals';

type RiskPack = { recommendationFlags: Record<string, unknown>[] };

export function getAlertsSummary(riskAnalytics: RiskPack) {
  const flags = riskAnalytics.recommendationFlags ?? [];
  return {
    openFlags: flags.slice(0, 10),
    alertSynthesis: buildAlertSynthesis(flags),
  };
}
