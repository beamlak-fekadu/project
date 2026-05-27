import { createClient } from '@/lib/supabase/server';
import { getCopilotTelemetrySummary, getCopilotUsageSummary } from '@/services/chatbot/usage-service';
import { getCopilotRouteDriftSummary } from '@/services/chatbot/telemetry-drift-service';
import CopilotDiagnosticsClient from './CopilotDiagnosticsClient';

export default async function CopilotDiagnosticsSection({ profileId, roleNames }: { profileId: string; roleNames: string[] }) {
  const supabase = await createClient();
  const [summary, telemetry, routeDrift] = await Promise.all([
    getCopilotUsageSummary(supabase, { profileId, roleNames }),
    getCopilotTelemetrySummary(supabase),
    getCopilotRouteDriftSummary(supabase),
  ]);

  return <CopilotDiagnosticsClient initialSummary={summary} initialTelemetry={telemetry} initialRouteDrift={routeDrift} />;
}
