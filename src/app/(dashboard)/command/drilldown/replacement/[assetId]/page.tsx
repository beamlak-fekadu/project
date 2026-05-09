import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireRole } from '@/lib/auth/helpers';
import { createClient } from '@/lib/supabase/server';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui';
import { ScoreExplanation } from '../../../_components/ScoreExplanation';
import { buildReplacementReason } from '@/utils/decision-support/command-center-reasons';
import { replacementReportPrefill } from '../../../_lib/command-center-routes';

export default async function ReplacementEvidencePage({ params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params;
  const profile = await requireRole(['developer', 'admin', 'bme_head', 'department_head', 'viewer']);
  const canMutate = Boolean(profile.roleNames?.some((role: string) => ['developer', 'admin', 'bme_head'].includes(role)));
  const supabase = await createClient();

  const { data } = await supabase
    .from('v_replacement_decision')
    .select('asset_id, asset_code, asset_name, department_name, age_score, failure_score, availability_score, maintenance_burden_score, spare_part_score, risk_score, cost_score, replacement_priority_index, replacement_rank, justification')
    .eq('asset_id', assetId)
    .maybeSingle();

  if (!data) {
    return <div className="space-y-4"><Link href="/command" className="inline-flex items-center gap-1 text-sm text-violet-300"><ArrowLeft className="h-4 w-4" /> Command Center</Link><p className="text-sm text-[var(--text-muted)]">Replacement evidence not found.</p></div>;
  }

  const rpi = Number(data.replacement_priority_index ?? 0);
  const reason = buildReplacementReason({
    rank: Number(data.replacement_rank ?? 0),
    priorityIndex: rpi,
    ageScore: data.age_score as number | null,
    failureScore: data.failure_score as number | null,
    availabilityScore: data.availability_score as number | null,
    maintenanceBurdenScore: data.maintenance_burden_score as number | null,
    sparePartScore: data.spare_part_score as number | null,
    riskScore: data.risk_score as number | null,
    costScore: data.cost_score as number | null,
    justification: data.justification as string | null,
  });

  return (
    <div className="space-y-6">
      <Link href="/command/drilldown/replacement" className="inline-flex items-center gap-1 text-sm text-violet-300"><ArrowLeft className="h-4 w-4" /> Replacement queue</Link>
      <PageHeader title={`Replacement evidence — ${data.asset_name ?? 'Asset'}`} description={`${data.asset_code ?? 'N/A'} · ${data.department_name ?? 'Unknown'}`} />
      <Card>
        <CardHeader><CardTitle>Lifecycle Evidence</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="warning">Rank {Number(data.replacement_rank ?? 0)}</Badge>
            <ScoreExplanation details={{
              title: `Replacement Priority Index — ${data.asset_name ?? 'Asset'}`,
              scoreLabel: `RPI ${Math.round(rpi * 100)}/100`,
              formula: 'weighted sum of normalized criteria × 100',
              criteria: ['Availability', 'Age', 'Failure rate', 'Maintenance burden', 'Risk/RPN', 'Spare parts', 'Cost'],
              weights: [
                { label: 'Availability', value: '20%' },
                { label: 'Age', value: '15%' },
                { label: 'Failure rate', value: '15%' },
                { label: 'Maintenance burden', value: '15%' },
                { label: 'Risk/RPN', value: '15%' },
                { label: 'Spare parts', value: '10%' },
                { label: 'Cost', value: '10%' },
              ],
              normalizedValues: [
                { label: 'Availability score', value: data.availability_score as number | null },
                { label: 'Age score', value: data.age_score as number | null },
                { label: 'Failure score', value: data.failure_score as number | null },
                { label: 'Maintenance burden', value: data.maintenance_burden_score as number | null },
                { label: 'Risk score', value: data.risk_score as number | null },
                { label: 'Spare part score', value: data.spare_part_score as number | null },
                { label: 'Cost score', value: data.cost_score as number | null },
              ],
              rawValues: [{ label: 'Rank', value: Number(data.replacement_rank ?? 0) }],
              calculation: `RPI = ${Math.round(rpi * 100)}/100`,
              generatedReason: reason,
              source: 'v_replacement_decision / replacement_priority_scores',
              assignmentMethod: 'Computed',
              actionSuggestion: 'Use as evidence for BME Head lifecycle decision.',
            }}>RPI {Math.round(rpi * 100)}/100</ScoreExplanation>
          </div>
          <p className="text-sm text-[var(--foreground)]">{reason}</p>
          {canMutate && (
            <Link href={replacementReportPrefill(assetId, { reason, rank: Number(data.replacement_rank ?? 0), rpi: Math.round(rpi * 100) })} className="inline-flex rounded-md bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white">
              Add to Report
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
