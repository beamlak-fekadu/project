'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle } from 'lucide-react';
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, CardFooter,
  Button, Input, Textarea, Modal, Spinner,
} from '@/components/ui';
import { PMStatusBadge } from '@/components/ui/StatusBadge';
import { getPMSchedules, updateScheduleStatus, createPMCompletion } from '@/services/pm.service';
import { useToast } from '@/components/ui/Toast';
import type { PMSchedule, PMChecklistItem } from '@/types/database';

type ScheduleWithJoins = PMSchedule & {
  pm_plans?: {
    id: string;
    name: string;
    frequency_days: number;
  };
  equipment_assets?: { id: string; asset_code: string; name: string };
  profiles?: { id: string; full_name: string; email: string };
};

export default function PMScheduleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [schedule, setSchedule] = useState<ScheduleWithJoins | null>(null);
  const [overdueDays, setOverdueDays] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [completionForm, setCompletionForm] = useState({
    completion_date: new Date().toISOString().split('T')[0],
    duration_hours: '',
    notes: '',
  });
  const [checklist, setChecklist] = useState<PMChecklistItem[]>([]);

  const load = useCallback(async () => {
    const { data, error } = await getPMSchedules({ status: undefined });
    if (error) {
      toast('error', 'Failed to load schedule');
      setLoading(false);
      return;
    }
    const found = (data as unknown as ScheduleWithJoins[])?.find((s) => s.id === id);
    if (!found) {
      toast('error', 'Schedule not found');
      setLoading(false);
      return;
    }
    setSchedule(found);
    if (found.status === 'overdue') {
      const days = Math.ceil((Date.now() - new Date(found.scheduled_date).getTime()) / (1000 * 60 * 60 * 24));
      setOverdueDays(days);
    } else {
      setOverdueDays(0);
    }
    setLoading(false);
  }, [id, toast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  function openCompletionModal() {
    setCompletionForm({
      completion_date: new Date().toISOString().split('T')[0],
      duration_hours: '',
      notes: '',
    });
    setChecklist([]);
    setCompletionModalOpen(true);
  }

  async function handleComplete() {
    if (!schedule) return;
    setActionLoading(true);

    const { error: completionError } = await createPMCompletion({
      schedule_id: schedule.id,
      completed_by: null,
      completion_date: completionForm.completion_date,
      duration_hours: completionForm.duration_hours ? Number(completionForm.duration_hours) : null,
      notes: completionForm.notes || null,
      checklist_results: checklist,
    });

    if (completionError) {
      toast('error', 'Failed to record completion');
      setActionLoading(false);
      return;
    }

    const { error: statusError } = await updateScheduleStatus(schedule.id, 'completed');
    if (statusError) {
      toast('warning', 'Completion recorded but status update failed');
    } else {
      toast('success', 'PM completed successfully');
    }

    setCompletionModalOpen(false);
    setActionLoading(false);
    await load();
  }

  if (loading || !schedule) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const canComplete = schedule.status === 'scheduled' || schedule.status === 'overdue' || schedule.status === 'in_progress';

  return (
    <div>
      <PageHeader
        title="PM Schedule"
        description={schedule.pm_plans?.name ?? 'Schedule Detail'}
        breadcrumbs={[
          { label: 'Dashboard', href: '/' },
          { label: 'Preventive Maintenance', href: '/pm' },
          { label: 'Schedule Detail' },
        ]}
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push('/pm')}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Schedule Information</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Plan</dt>
                  <dd className="mt-1 text-sm text-[var(--foreground)]">
                    {schedule.pm_plans?.name ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Asset</dt>
                  <dd className="mt-1 text-sm text-[var(--foreground)]">
                    {schedule.equipment_assets
                      ? `${schedule.equipment_assets.asset_code} — ${schedule.equipment_assets.name}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Scheduled Date</dt>
                  <dd className="mt-1 text-sm text-[var(--foreground)]">
                    {new Date(schedule.scheduled_date).toLocaleDateString()}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Status</dt>
                  <dd className="mt-1"><PMStatusBadge status={schedule.status} /></dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Assigned To</dt>
                  <dd className="mt-1 text-sm text-[var(--foreground)]">
                    {schedule.profiles?.full_name ?? 'Unassigned'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-[var(--text-muted)]">Frequency</dt>
                  <dd className="mt-1 text-sm text-[var(--foreground)]">
                    {schedule.pm_plans ? `Every ${schedule.pm_plans.frequency_days} days` : '—'}
                  </dd>
                </div>
                {schedule.notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-[var(--text-muted)]">Notes</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-[var(--foreground)]">
                      {schedule.notes}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
            {canComplete && (
              <CardFooter>
                <Button onClick={openCompletionModal}>
                  <CheckCircle className="h-4 w-4" />
                  Complete PM
                </Button>
              </CardFooter>
            )}
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Quick Info</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Created</span>
                  <span className="text-[var(--foreground)]">{new Date(schedule.created_at).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Last Updated</span>
                  <span className="text-[var(--foreground)]">{new Date(schedule.updated_at).toLocaleDateString()}</span>
                </div>
                {schedule.status === 'overdue' && (
                  <div className="mt-4 rounded-lg bg-red-50 p-3 dark:bg-red-900/20">
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">
                      This PM is overdue by {overdueDays} days
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal
        open={completionModalOpen}
        onClose={() => setCompletionModalOpen(false)}
        title="Complete PM"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setCompletionModalOpen(false)}>Cancel</Button>
            <Button onClick={handleComplete} loading={actionLoading}>
              <CheckCircle className="h-4 w-4" />
              Record Completion
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Completion Date"
              type="date"
              value={completionForm.completion_date}
              onChange={(e) => setCompletionForm({ ...completionForm, completion_date: e.target.value })}
            />
            <Input
              label="Duration (hours)"
              type="number"
              step="0.5"
              value={completionForm.duration_hours}
              onChange={(e) => setCompletionForm({ ...completionForm, duration_hours: e.target.value })}
            />
          </div>
          <Textarea
            label="Notes"
            value={completionForm.notes}
            onChange={(e) => setCompletionForm({ ...completionForm, notes: e.target.value })}
            placeholder="Describe work performed, findings, etc."
          />

          {checklist.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium text-[var(--foreground)]">Checklist</h4>
              <div className="space-y-2 rounded-lg border border-[var(--border-subtle)] p-3">
                {checklist.map((item, idx) => (
                  <label key={idx} className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={item.completed ?? false}
                      onChange={(e) => {
                        const updated = [...checklist];
                        updated[idx] = { ...updated[idx], completed: e.target.checked };
                        setChecklist(updated);
                      }}
                      className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-sm text-[var(--foreground)]">{item.task}</span>
                      {item.required && (
                        <span className="ml-1 text-xs text-red-500">*</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
