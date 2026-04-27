'use client';

import { useCallback, useEffect, useState } from 'react';
import { BrainCircuit, HeartPulse, RefreshCcw, Stethoscope, Siren, Users } from 'lucide-react';
import { Badge, Button, Card, CardHeader, CardTitle, DataTable, PageHeader, StatCard } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { getDecisionSupportSnapshot, refreshDecisionSupportSnapshots, type DecisionSupportSnapshot } from '@/services/decision-support.service';
import { AskAiButton } from '@/components/assistant/AskAiButton';

const EMPTY_SNAPSHOT: DecisionSupportSnapshot = {
  triage: [],
  healthScores: [],
  readiness: [],
  workload: [],
};

type TriageRow = DecisionSupportSnapshot['triage'][number] & Record<string, unknown>;
type HealthRow = DecisionSupportSnapshot['healthScores'][number] & Record<string, unknown>;
type ReadinessRow = DecisionSupportSnapshot['readiness'][number] & Record<string, unknown>;
type WorkloadRow = DecisionSupportSnapshot['workload'][number] & Record<string, unknown>;

export default function DecisionSupportPage() {
  const { toast } = useToast();
  const [snapshot, setSnapshot] = useState<DecisionSupportSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const data = await getDecisionSupportSnapshot();
    setSnapshot(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const avgHealth = snapshot.healthScores.length
    ? snapshot.healthScores.reduce((acc, item) => acc + item.score, 0) / snapshot.healthScores.length
    : 0;
  const avgReadiness = snapshot.readiness.length
    ? snapshot.readiness.reduce((acc, item) => acc + item.readiness_score, 0) / snapshot.readiness.length
    : 0;
  const highPriority = snapshot.triage.filter((item) => item.priority_score >= 75).length;
  const overloaded = snapshot.workload.filter((item) => item.open_assignments >= 6).length;

  const triageColumns = [
    { key: 'asset_code', header: 'Asset Code' },
    { key: 'asset_name', header: 'Asset' },
    { key: 'department_name', header: 'Department' },
    {
      key: 'priority_score',
      header: 'Priority Score',
      render: (row: TriageRow) => (
        <Badge variant={row.priority_score > 75 ? 'error' : row.priority_score > 45 ? 'warning' : 'info'}>
          {row.priority_score}
        </Badge>
      ),
    },
    {
      key: 'recommended_action',
      header: 'Action',
    },
  ];

  const healthColumns = [
    { key: 'asset_code', header: 'Asset Code' },
    { key: 'asset_name', header: 'Asset' },
    {
      key: 'score',
      header: 'Health Score',
      render: (row: HealthRow) => (
        <Badge variant={row.score >= 80 ? 'success' : row.score >= 60 ? 'warning' : 'error'}>{row.score}</Badge>
      ),
    },
    {
      key: 'drivers',
      header: 'Explanation',
      render: (row: HealthRow) => row.drivers.map((driver) => `${driver.label}: ${driver.value}`).join(' | '),
    },
  ];

  const readinessColumns = [
    { key: 'department_name', header: 'Department' },
    { key: 'essential_total', header: 'Essential Devices' },
    { key: 'essential_functional', header: 'Functional Today' },
    {
      key: 'readiness_score',
      header: 'Readiness',
      render: (row: ReadinessRow) => (
        <Badge variant={row.readiness_score >= 90 ? 'success' : row.readiness_score >= 75 ? 'warning' : 'error'}>
          {row.readiness_score}%
        </Badge>
      ),
    },
  ];

  const workloadColumns = [
    { key: 'assignee', header: 'Engineer / Technician' },
    { key: 'open_assignments', header: 'Open Assignments' },
    { key: 'overdue_assignments', header: 'High Priority Open' },
    { key: 'estimated_hours', header: 'Estimated Hours' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Decision Support Center"
        description="Unified triage, explainable health scoring, clinical readiness, escalation pressure, and workload balancing."
        actions={
          <div className="flex items-center gap-2">
            <AskAiButton
              moduleLabel="Decision Support"
              label="Ask AI why prioritized"
              seedPrompt="Explain the top triage priorities, health drivers, and readiness risks in this decision-support snapshot."
            />
            <Button
              size="sm"
              variant="outline"
              loading={refreshing}
              onClick={async () => {
                setRefreshing(true);
                const { error } = await refreshDecisionSupportSnapshots();
                setRefreshing(false);
                if (error) {
                  toast('error', 'Snapshot refresh failed. Verify migration 00014 is applied.');
                  return;
                }
                await load();
                toast('success', 'Decision-support snapshots refreshed');
              }}
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh Snapshots
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Average Health Score" value={avgHealth.toFixed(1)} icon={<HeartPulse className="h-6 w-6" />} color="purple" />
        <StatCard label="Avg Clinical Readiness" value={`${avgReadiness.toFixed(1)}%`} icon={<Stethoscope className="h-6 w-6" />} color="green" />
        <StatCard label="High-Priority Triage Items" value={highPriority} icon={<Siren className="h-6 w-6" />} color="red" />
        <StatCard label="Overloaded Staff" value={overloaded} icon={<Users className="h-6 w-6" />} color="orange" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-violet-300" />
              What to Fix Next
            </span>
          </CardTitle>
        </CardHeader>
        <DataTable<TriageRow>
          columns={triageColumns}
          data={snapshot.triage as TriageRow[]}
          loading={loading}
          searchPlaceholder="Search triage items..."
          emptyMessage="No triage candidates generated"
        />
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Explainable Equipment Health Score</CardTitle>
          </CardHeader>
          <DataTable<HealthRow>
            columns={healthColumns}
            data={snapshot.healthScores as HealthRow[]}
            loading={loading}
            searchPlaceholder="Search assets..."
            emptyMessage="No health scores available"
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Clinical Service Readiness</CardTitle>
          </CardHeader>
          <DataTable<ReadinessRow>
            columns={readinessColumns}
            data={snapshot.readiness as ReadinessRow[]}
            loading={loading}
            searchPlaceholder="Search departments..."
            emptyMessage="No readiness data available"
          />
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Capacity vs Backlog</CardTitle>
        </CardHeader>
        <DataTable<WorkloadRow>
          columns={workloadColumns}
          data={snapshot.workload as WorkloadRow[]}
          loading={loading}
          searchPlaceholder="Search engineers..."
          emptyMessage="No workload records available"
        />
      </Card>
    </div>
  );
}
