'use server';

import { getActionContext, actionError, type ActionResult } from './_shared';
import { runGeminiConnectivitySmoke } from '@/services/chatbot/providers/gemini-provider';
import { getCopilotTelemetrySummary, getCopilotUsageSummary, type CopilotUsageSummary } from '@/services/chatbot/usage-service';
import { getCopilotRouteDriftSummary, type CopilotRouteDriftSummary } from '@/services/chatbot/telemetry-drift-service';
import { canInspectCopilotTelemetry, canUseDeveloperCopilotDiagnostics } from '@/services/chatbot/copilot-rbac';

export async function runGeminiSmokeTestAction(): Promise<ActionResult> {
  try {
    const { profile, error } = await getActionContext(['developer']);
    if (error || !profile) return { success: false, error };
    if (!canUseDeveloperCopilotDiagnostics({ roleNames: profile.roleNames })) {
      return { success: false, error: 'Insufficient permissions' };
    }
    const result = await runGeminiConnectivitySmoke();
    return { success: result.ok, error: result.ok ? undefined : result.details, data: result };
  } catch (error) {
    return actionError(error, 'Gemini smoke test failed');
  }
}

export async function getCopilotUsageSummaryAction(): Promise<ActionResult<CopilotUsageSummary>> {
  try {
    const { supabase, profile, error } = await getActionContext(['developer', 'admin', 'bme_head']);
    if (error || !profile) return { success: false, error };
    if (!canInspectCopilotTelemetry({ roleNames: profile.roleNames })) {
      return { success: false, error: 'Insufficient permissions' };
    }
    const summary = await getCopilotUsageSummary(supabase, { profileId: profile.id, roleNames: profile.roleNames });
    return { success: true, data: summary };
  } catch (error) {
    return actionError(error, 'Failed to load copilot usage summary') as ActionResult<CopilotUsageSummary>;
  }
}

export async function getCopilotTelemetrySummaryAction(): Promise<ActionResult<Array<Record<string, unknown>>>> {
  try {
    const { supabase, profile, error } = await getActionContext(['developer']);
    if (error || !profile) return { success: false, error };
    if (!canUseDeveloperCopilotDiagnostics({ roleNames: profile.roleNames })) {
      return { success: false, error: 'Insufficient permissions' };
    }
    return { success: true, data: await getCopilotTelemetrySummary(supabase) };
  } catch (error) {
    return actionError(error, 'Failed to load copilot telemetry summary') as ActionResult<Array<Record<string, unknown>>>;
  }
}

export async function getCopilotRouteDriftSummaryAction(): Promise<ActionResult<CopilotRouteDriftSummary>> {
  try {
    const { supabase, profile, error } = await getActionContext(['developer']);
    if (error || !profile) return { success: false, error };
    if (!canUseDeveloperCopilotDiagnostics({ roleNames: profile.roleNames })) {
      return { success: false, error: 'Insufficient permissions' };
    }
    return { success: true, data: await getCopilotRouteDriftSummary(supabase) };
  } catch (error) {
    return actionError(error, 'Failed to load copilot route drift summary') as ActionResult<CopilotRouteDriftSummary>;
  }
}
