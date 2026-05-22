'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, CheckCircle, ClipboardList, Gauge, Plus, ShieldAlert, Wrench } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import AssetFilterChip from '@/components/ui/AssetFilterChip';
import AssistantPageContextBridge from '@/components/assistant/AssistantPageContextBridge';
import { useAssetFilter } from '@/hooks/useAssetFilter';
import InfoPopover from '@/components/ui/InfoPopover';
import DataTable from '@/components/ui/DataTable';
import Tabs from '@/components/ui/Tabs';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import ClearFiltersButton from '@/components/ui/ClearFiltersButton';
import StatCard from '@/components/ui/StatCard';
import { motion } from 'framer-motion';
import { cardItem, cardStagger } from '@/lib/ui/motion-presets';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import Table from '@/components/ui/Table';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { OfflineActionResult } from '@/components/offline/OfflineActionResult';
import OfflineSubmitBanner from '@/components/offline/OfflineSubmitBanner';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useRole } from '@/hooks/useRole';
import {
  getCalibrationRecords,
  getCalibrationRequests,
  getUpcomingCalibrations,
} from '@/services/calibration.service';
import {
  countOverdueCalibration,
  countFailedOrAdjustedCalibration,
  countOpenCalibrationRequests,
} from '@/utils/decision-support/canonical-counts';
import { createCalibrationRecordAction, createCalibrationRequestAction } from '@/actions/calibration.actions';
import { runOfflineCapableAction } from '@/lib/offline/queue';
import { getEquipmentList } from '@/services/equipment.service';
import * as settingsService from '@/services/settings.service';
import type { OfflineActionRunResult } from '@/types/offline';
import type { CalibrationResult, CalibrationRequestStatus, Urgency } from '@/types/domain';

const resultVariant: Record<CalibrationResult, 'success' | 'error' | 'warning'> = {
  pass: 'success',
  fail: 'error',
  adjusted: 'warning',
};

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple'> = {
  pending: 'warning',
  approved: 'info',
  in_progress: 'purple',
  completed: 'success',
  rejected: 'error',
  canceled: 'default',
};

function formatLabel(val: string) {
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

type CalRecord = Record<string, unknown>;
type CalRequest = Record<string, unknown>;
type CalibrationTab = 'requests' | 'upcoming' | 'overdue' | 'records';
type CalibrationFilter =
  | 'all'
  | 'due-soon'
  | 'overdue'
  | 'critical-overdue'
  | 'failed-adjusted'
  | 'external'
  | 'completed-month'
  | 'pending-requests'
  | 'approved-requests';
type CalibrationAsset = {
  id?: string;
  asset_code?: string;
  name?: string;
  departments?: { name?: string; code?: string } | null;
  equipment_categories?: { name?: string; criticality_level?: string | null } | null;
};

function calibrationAsset(row: CalRecord | CalRequest): CalibrationAsset | null {
  return (row.equipment_assets as CalibrationAsset | null) ?? null;
}

function daysFromToday(dateValue: unknown) {
  if (!dateValue) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateValue as string);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

function isCriticalCalibration(row: CalRecord) {
  const asset = calibrationAsset(row);
  const criticality = String(asset?.equipment_categories?.criticality_level ?? '').toLowerCase();
  const department = `${asset?.departments?.name ?? ''} ${asset?.departments?.code ?? ''}`.toLowerCase();
  const assetText = `${asset?.asset_code ?? ''} ${asset?.name ?? ''} ${asset?.equipment_categories?.name ?? ''}`.toLowerCase();
  return criticality === 'critical'
    || /(icu|intensive care|operating|theater|emergency)/.test(department)
    || /(ventilator|anesthesia|defibrillator|infusion|monitor)/.test(assetText);
}

function isImpactDepartment(asset: CalibrationAsset | null) {
  const department = `${asset?.departments?.name ?? ''} ${asset?.departments?.code ?? ''}`.toLowerCase();
  return /(icu|intensive care|or\b|operating|theater|emergency|laboratory|lab\b|imaging|radiology)/.test(department);
}

function calibrationPriorityScore(row: CalRecord, request?: CalRequest | null) {
  const asset = calibrationAsset(row);
  const overdueDays = Math.abs(Math.min(daysFromToday(row.next_due_date), 0));
  const result = String(row.result ?? '');
  const criticality = String(asset?.equipment_categories?.criticality_level ?? '').toLowerCase();
  const workflowStatus = String(request?.status ?? '');
  return Math.min(100,
    Math.min(overdueDays, 120) * 0.35
    + (criticality === 'critical' ? 28 : criticality === 'high' ? 20 : criticality === 'medium' ? 10 : 4)
    + (result === 'fail' ? 22 : result === 'adjusted' ? 14 : 0)
    + (isImpactDepartment(asset) ? 12 : 0)
    + (!workflowStatus ? 10 : ['pending', 'approved'].includes(workflowStatus) ? 6 : 2)
  );
}

function calibrationFactors(row: CalRecord, request?: CalRequest | null) {
  const asset = calibrationAsset(row);
  const days = daysFromToday(row.next_due_date);
  const result = String(row.result ?? 'unknown');
  const criticality = String(asset?.equipment_categories?.criticality_level ?? 'routine');
  const workflow = request ? formatLabel(String(request.status ?? 'request open')) : 'No workflow';
  return [
    days < 0 ? `${Math.abs(days)}d overdue` : `${days}d until due`,
    formatLabel(criticality),
    `Last ${formatLabel(result)}`,
    isImpactDepartment(asset) ? 'High-impact department' : 'Routine department',
    workflow,
  ];
}

function normalizeCalibrationTab(value: string | null): CalibrationTab | '' {
  if (value === 'requests' || value === 'upcoming' || value === 'overdue' || value === 'records') return value;
  return '';
}

export default function CalibrationPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { profile } = useProfile(user?.id);
  const { canManageMaintenance, can, primaryRole, roles } = useRole();
  const canRequestCalibration = can('calibration.request.create');
  const searchParams = useSearchParams();
  const assetFilter = useAssetFilter();
  const [records, setRecords] = useState<CalRecord[]>([]);
  const [requests, setRequests] = useState<CalRequest[]>([]);
  const [upcoming, setUpcoming] = useState<CalRecord[]>([]);
  const [assets, setAssets] = useState<{ value: string; label: string }[]>([]);
  const [calTypes, setCalTypes] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<CalibrationTab | ''>(() => normalizeCalibrationTab(searchParams.get('tab')));
  const [activeFilter, setActiveFilter] = useState<CalibrationFilter>(() => {
    const requested = searchParams.get('filter');
    if (requested === 'critical-overdue') return 'critical-overdue';
    if (requested === 'failed-adjusted') return 'failed-adjusted';
    if (requested === 'external') return 'external';
    if (requested === 'due-soon') return 'due-soon';
    return 'all';
  });

  const [recordModalOpen, setRecordModalOpen] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [requestOfflineResult, setRequestOfflineResult] = useState<OfflineActionRunResult | null>(null);

  // Record form
  const [recAssetId, setRecAssetId] = useState('');
  const [recTypeId, setRecTypeId] = useState('');
  const [recDate, setRecDate] = useState('');
  const [recNextDue, setRecNextDue] = useState('');
  const [recResult, setRecResult] = useState<CalibrationResult>('pass');
  const [recCalibratedBy, setRecCalibratedBy] = useState('');
  const [recNotes, setRecNotes] = useState('');

  // Request form
  const [reqAssetId, setReqAssetId] = useState('');
  const [reqTypeId, setReqTypeId] = useState('');
  const [reqUrgency, setReqUrgency] = useState<Urgency>('medium');
  const [reqNotes, setReqNotes] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [recRes, reqRes, upRes, assetRes, typeRes] = await Promise.all([
        getCalibrationRecords(),
        getCalibrationRequests(),
        getUpcomingCalibrations(90),
        getEquipmentList(),
        settingsService.getAll('calibration_types'),
      ]);

      setRecords((recRes.data || []) as CalRecord[]);
      setRequests((reqRes.data || []) as CalRequest[]);
      setUpcoming((upRes.data || []) as CalRecord[]);
      setAssets(
        (assetRes.data || []).map((a: Record<string, unknown>) => ({
          value: a.id as string,
          label: `${a.asset_code} — ${a.name}`,
        }))
      );
      setCalTypes(
        (typeRes.data || []).map((t: Record<string, unknown>) => ({
          value: t.id as string,
          label: t.name as string,
        }))
      );
    } catch {
      toast('error', 'Failed to load calibration data');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (searchParams.get('source') === 'requests-hub' && searchParams.get('action') === 'new-request') {
      setRequestModalOpen(true);
    }
    const assetId = searchParams.get('assetId');
    if (assetId) {
      setReqAssetId(assetId);
      setRecAssetId(assetId);
    }
    const calibrationTypeId = searchParams.get('calibrationTypeId');
    if (calibrationTypeId) {
      setReqTypeId(calibrationTypeId);
      setRecTypeId(calibrationTypeId);
    }
    if (searchParams.get('action') === 'record-result') setRecordModalOpen(true);
    if (searchParams.get('action') === 'new-request') setRequestModalOpen(true);
  }, [searchParams]);

  const openRequestForAsset = useCallback((assetId?: string | null) => {
    if (!assetId) return null;
    return requests.find((request) =>
      request.asset_id === assetId
      && ['pending', 'approved', 'in_progress'].includes(String(request.status ?? ''))
    ) ?? null;
  }, [requests]);

  function selectCalibrationView(tab: CalibrationTab, filter: CalibrationFilter = 'all') {
    setActiveTab(tab);
    setActiveFilter(filter);
  }

  const handleCreateRecord = async () => {
    if (!recAssetId || !recDate) {
      toast('warning', 'Asset and date are required');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createCalibrationRecordAction({
        asset_id: recAssetId,
        calibration_type_id: recTypeId || null,
        calibrated_by: recCalibratedBy || null,
        calibration_date: recDate,
        next_due_date: recNextDue || null,
        result: recResult,
        certificate_path: null,
        notes: recNotes || null,
      });
      if (!result.success) throw new Error(result.error ?? 'Failed to create calibration record');
      const notificationData = result.data as {
        notification_warning?: string;
        notification_result?: { detail?: string | null };
      } | undefined;
      if (notificationData?.notification_warning) {
        toast('warning', notificationData.notification_result?.detail
          ? `Calibration record created. Notification delivery needs review: ${notificationData.notification_result.detail}`
          : 'Calibration record created, but notification delivery needs review.');
      } else {
        toast('success', 'Calibration record created');
      }
      setRecordModalOpen(false);
      resetRecordForm();
      loadData();
    } catch {
      toast('error', 'Failed to create calibration record');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateRequest = async () => {
    if (!reqAssetId) {
      toast('warning', 'Asset is required');
      return;
    }
    setSubmitting(true);
    const payload = {
      asset_id: reqAssetId,
      requested_by: null,
      calibration_type_id: reqTypeId || null,
      urgency: reqUrgency,
      status: 'pending' as CalibrationRequestStatus,
      notes: reqNotes || null,
      submitted_by_profile_id: profile?.id ?? null,
      department_id: profile?.department_id ?? null,
    };
    const result = await runOfflineCapableAction({
      actionType: 'calibration_request.create',
      entityType: 'calibration_requests',
      assetId: reqAssetId,
      payload,
      createdByProfileId: profile?.id ?? null,
      roleName: primaryRole,
      roleNames: roles,
      sourceRoute: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/calibration',
      executeOnline: () => createCalibrationRequestAction(payload),
      metadata: { form: 'calibration_request_modal' },
    });
    setSubmitting(false);
    setRequestOfflineResult(result);

    if (result.status === 'queued') {
      toast('success', 'Saved offline — will sync when connection returns.');
      return;
    }
    if (result.status === 'failed' || result.status === 'conflict') {
      toast('error', result.error ?? 'Failed to create calibration request');
      return;
    }
    toast('success', 'Calibration request submitted');
    setRequestModalOpen(false);
    resetRequestForm();
    loadData();
  };

  const resetRecordForm = () => {
    setRecAssetId(''); setRecTypeId(''); setRecDate('');
    setRecNextDue(''); setRecResult('pass'); setRecCalibratedBy(''); setRecNotes('');
  };

  const resetRequestForm = () => {
    setReqAssetId(''); setReqTypeId(''); setReqUrgency('medium'); setReqNotes('');
  };

  const recordColumns = [
    {
      key: 'asset',
      header: 'Asset',
      sortable: true,
      render: (row: CalRecord) => {
        const asset = row.equipment_assets as { asset_code: string; name: string } | null;
        return asset ? `${asset.asset_code} — ${asset.name}` : '—';
      },
    },
    {
      key: 'type',
      header: 'Type',
      render: (row: CalRecord) => {
        const type = row.calibration_types as { name: string } | null;
        return type?.name || '—';
      },
    },
    {
      key: 'calibration_date',
      header: 'Date',
      sortable: true,
      render: (row: CalRecord) => new Date(row.calibration_date as string).toLocaleDateString(),
    },
    {
      key: 'result',
      header: 'Result',
      render: (row: CalRecord) => (
        <Badge variant={resultVariant[row.result as CalibrationResult]}>
          {formatLabel(row.result as string)}
        </Badge>
      ),
    },
    {
      key: 'next_due_date',
      header: 'Next Due',
      sortable: true,
      render: (row: CalRecord) =>
        row.next_due_date ? new Date(row.next_due_date as string).toLocaleDateString() : '—',
    },
    { key: 'calibrated_by', header: 'Calibrated By' },
    {
      key: 'action',
      header: 'Action',
      render: (row: CalRecord) => {
        const asset = calibrationAsset(row);
        return (
          <div className="flex flex-wrap gap-1.5">
            <Link className="rounded-lg bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--brand-strong)]" href={`/calibration/records/${row.id as string}`}>
              View Evidence
            </Link>
            {['fail', 'adjusted'].includes(row.result as string) && asset?.id && (
              <Link className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-400 hover:bg-amber-500/20" href={`/maintenance/requests/new?assetId=${asset.id}&source=calibration-failed&reportedCondition=needs_repair&description=${encodeURIComponent(`Calibration ${String(row.result)} result requires corrective review.`)}`}>
                Create Maintenance Request
              </Link>
            )}
          </div>
        );
      },
    },
  ];

  const requestColumns = [
    {
      key: 'request_number',
      header: 'Request #',
      sortable: true,
    },
    {
      key: 'asset',
      header: 'Asset',
      render: (row: CalRequest) => {
        const asset = row.equipment_assets as { asset_code: string; name: string } | null;
        return asset ? `${asset.asset_code} — ${asset.name}` : '—';
      },
    },
    {
      key: 'type',
      header: 'Type',
      render: (row: CalRequest) => {
        const type = row.calibration_types as { name: string } | null;
        return type?.name || '—';
      },
    },
    {
      key: 'urgency',
      header: 'Urgency',
      render: (row: CalRequest) => (
        <Badge variant={statusVariant[row.urgency as string] || 'default'}>
          {formatLabel(row.urgency as string)}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: CalRequest) => (
        <Badge variant={statusVariant[row.status as string] || 'default'}>
          {formatLabel(row.status as string)}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Requested',
      sortable: true,
      render: (row: CalRequest) => new Date(row.created_at as string).toLocaleDateString(),
    },
    {
      key: 'action',
      header: 'Next Action',
      render: (row: CalRequest) => {
        const label = row.status === 'pending'
          ? 'Review Calibration Request'
          : row.status === 'approved'
            ? 'Schedule Calibration'
            : row.status === 'completed'
              ? 'View Calibration Evidence'
              : row.status === 'rejected'
                ? 'View Rejection Reason'
                : 'Open Assigned Calibration Task';
        const isPrimary = ['pending', 'approved', 'in_progress'].includes(String(row.status ?? ''));
        return (
          <Link
            className={isPrimary
              ? 'rounded-lg bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--brand-strong)]'
              : 'rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]'}
            href={`/calibration/requests/${row.id as string}${row.status === 'approved' ? '?action=schedule' : ''}`}
          >
            {label}
          </Link>
        );
      },
    },
  ];

  const upcomingColumns = [
    {
      key: 'asset',
      header: 'Asset',
      sortable: true,
      render: (row: CalRecord) => {
        const asset = calibrationAsset(row);
        return (
          <div>
            <p className="font-medium">{asset?.asset_code ?? '—'}</p>
            <p className="text-xs text-[var(--text-muted)]">{asset?.name ?? 'Unknown asset'}</p>
          </div>
        );
      },
    },
    {
      key: 'department',
      header: 'Department',
      render: (row: CalRecord) => calibrationAsset(row)?.departments?.name ?? '—',
    },
    {
      key: 'type',
      header: 'Type',
      render: (row: CalRecord) => {
        const type = row.calibration_types as { name: string } | null;
        return type?.name || '—';
      },
    },
    {
      key: 'next_due_date',
      header: 'Due Date',
      sortable: true,
      render: (row: CalRecord) => {
        const due = row.next_due_date as string;
        const days = daysFromToday(due);
        const isOverdue = days < 0;
        return (
          <span className={isOverdue ? 'font-semibold text-red-600' : ''}>
            {new Date(due).toLocaleDateString()}
            {isOverdue && ` (${Math.abs(days)}d overdue)`}
          </span>
        );
      },
    },
    {
      key: 'days_overdue',
      header: 'Days',
      render: (row: CalRecord) => {
        const days = daysFromToday(row.next_due_date);
        return days < 0 ? <Badge variant={Math.abs(days) > 90 ? 'error' : 'warning'}>{Math.abs(days)} overdue</Badge> : `${days} until due`;
      },
    },
    {
      key: 'last_result',
      header: 'Last Result',
      render: (row: CalRecord) => (
        <Badge variant={resultVariant[row.result as CalibrationResult]}>
          {formatLabel(row.result as string)}
        </Badge>
      ),
    },
    {
      key: 'risk',
      header: 'Risk',
      render: (row: CalRecord) => (
        <Badge variant={isCriticalCalibration(row) ? 'error' : 'info'}>
          {Math.round(calibrationPriorityScore(row, openRequestForAsset(String(row.asset_id ?? calibrationAsset(row)?.id ?? ''))))}/100
        </Badge>
      ),
    },
    {
      key: 'action',
      header: 'Next Action',
      render: (row: CalRecord) => {
        const asset = calibrationAsset(row);
        const due = row.next_due_date ? new Date(row.next_due_date as string) : null;
        const overdue = due ? due < new Date() : false;
        const request = openRequestForAsset(String(row.asset_id ?? asset?.id ?? ''));
        if (request?.id) {
          return (
            <div className="flex flex-wrap gap-1.5">
              <Link className="rounded-lg bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--brand-strong)]" href={`/calibration/requests/${request.id as string}${String(request.status) === 'approved' ? '?action=schedule' : ''}`}>
                {String(request.status) === 'approved' ? 'Schedule Calibration' : 'Review Calibration Request'}
              </Link>
              {asset?.id && (
                <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={`/equipment/${asset.id}`}>
                  Open Asset Profile
                </Link>
              )}
            </div>
          );
        }
        const label = overdue && isCriticalCalibration(row) ? 'Create Calibration Request' : overdue ? 'Record Calibration Result' : 'Prepare Calibration';
        return (
          <div className="flex flex-wrap gap-1.5">
            {canRequestCalibration && label === 'Create Calibration Request' && (
              <button
                type="button"
                onClick={() => {
                  if (asset?.id) setReqAssetId(asset.id);
                  setRequestModalOpen(true);
                }}
                className="rounded-lg bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--brand-strong)]"
              >
                {label}
              </button>
            )}
            {canManageMaintenance && label !== 'Create Calibration Request' && (
              <button
                type="button"
                onClick={() => {
                  if (asset?.id) setRecAssetId(asset.id);
                  setRecordModalOpen(true);
                }}
                className="rounded-lg bg-[var(--brand)] px-2 py-1 text-xs font-medium text-white hover:bg-[var(--brand-strong)]"
              >
                {label}
              </button>
            )}
            {asset?.id && (
              <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={`/equipment/${asset.id}`}>
                Open Asset Profile
              </Link>
            )}
          </div>
        );
      },
    },
  ];

  if (loading) return <PageLoader />;

  const filterAsset = assetFilter.assetId;
  const matchesAsset = (row: CalRecord | CalRequest): boolean => {
    if (!filterAsset) return true;
    const id = (row as { asset_id?: string | null }).asset_id ?? calibrationAsset(row)?.id ?? null;
    return id === filterAsset;
  };
  const recordsScoped: CalRecord[] = filterAsset ? records.filter(matchesAsset) : records;
  const requestsScoped: CalRequest[] = filterAsset ? requests.filter(matchesAsset) : requests;
  const upcomingScoped: CalRecord[] = filterAsset ? upcoming.filter(matchesAsset) : upcoming;
  const now = new Date();
  const overdueRows = upcomingScoped.filter((row) => row.next_due_date && new Date(row.next_due_date as string) < now);
  const criticalOverdueRows = overdueRows.filter(isCriticalCalibration);
  const dueSoonRows = upcomingScoped.filter((row) => {
    if (!row.next_due_date) return false;
    const due = new Date(row.next_due_date as string);
    const days = Math.ceil((due.getTime() - now.getTime()) / 86_400_000);
    return days >= 0 && days <= 30;
  });
  const upcomingOnlyRows = dueSoonRows.filter((row) => daysFromToday(row.next_due_date) >= 0);
  const awaitingActionRequests = requestsScoped.filter((row) => ['pending', 'approved'].includes(String(row.status ?? '')));
  const needsSchedulingRows = [...overdueRows, ...upcomingOnlyRows]
    .filter((row) => !openRequestForAsset(String(row.asset_id ?? calibrationAsset(row)?.id ?? '')))
    .sort((a, b) => daysFromToday(a.next_due_date) - daysFromToday(b.next_due_date));
  const urgentSafetyRows = overdueRows
    .filter((row) => isCriticalCalibration(row) || ['fail', 'adjusted'].includes(String(row.result ?? '')))
    .sort((a, b) => calibrationPriorityScore(b, openRequestForAsset(String(b.asset_id ?? calibrationAsset(b)?.id ?? ''))) - calibrationPriorityScore(a, openRequestForAsset(String(a.asset_id ?? calibrationAsset(a)?.id ?? ''))));
  const longestOverdueRows = [...overdueRows].sort((a, b) => daysFromToday(a.next_due_date) - daysFromToday(b.next_due_date)).slice(0, 5);
  const sortedUpcoming = [...upcomingOnlyRows].sort((a, b) => calibrationPriorityScore(b, openRequestForAsset(String(b.asset_id ?? calibrationAsset(b)?.id ?? ''))) - calibrationPriorityScore(a, openRequestForAsset(String(a.asset_id ?? calibrationAsset(a)?.id ?? ''))));
  const sortedOverdue = [...overdueRows].sort((a, b) => calibrationPriorityScore(b, openRequestForAsset(String(b.asset_id ?? calibrationAsset(b)?.id ?? ''))) - calibrationPriorityScore(a, openRequestForAsset(String(a.asset_id ?? calibrationAsset(a)?.id ?? ''))));
  const failedAdjusted = recordsScoped.filter((row) => ['fail', 'adjusted'].includes(row.result as string));
  const completedThisMonth = recordsScoped.filter((row) => {
    if (!row.calibration_date) return false;
    const date = new Date(row.calibration_date as string);
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });
  const externalCalibration = recordsScoped.filter((row) => {
    const by = String(row.calibrated_by ?? '').toLowerCase();
    const notes = String(row.notes ?? '').toLowerCase();
    return by.includes('vendor') || by.includes('external') || notes.includes('vendor') || notes.includes('external');
  });
  const externalRequests = requestsScoped.filter((row) => String(row.notes ?? '').toLowerCase().match(/vendor|external|third[- ]party/));
  const defaultTab: CalibrationTab = normalizeCalibrationTab(searchParams.get('tab'))
    || (awaitingActionRequests.length > 0 ? 'requests' : overdueRows.length > 0 ? 'overdue' : dueSoonRows.length > 0 ? 'upcoming' : 'records');
  const selectedTab = activeTab || defaultTab;
  const selectedFilter = activeFilter;

  const filteredRecords = recordsScoped.filter((row) => {
    if (selectedFilter === 'failed-adjusted') return ['fail', 'adjusted'].includes(String(row.result ?? ''));
    if (selectedFilter === 'external') return externalCalibration.some((item) => item.id === row.id);
    if (selectedFilter === 'completed-month') return completedThisMonth.some((item) => item.id === row.id);
    return true;
  });
  const filteredRequests = requestsScoped.filter((row) => {
    if (selectedFilter === 'pending-requests') return row.status === 'pending';
    if (selectedFilter === 'approved-requests') return row.status === 'approved';
    if (selectedFilter === 'external') return externalRequests.some((item) => item.id === row.id);
    return true;
  });
  const filteredUpcoming = sortedUpcoming.filter((row) => {
    if (selectedFilter === 'due-soon') return dueSoonRows.some((item) => item.id === row.id);
    if (selectedFilter === 'critical-overdue') return false;
    return true;
  });
  const filteredOverdue = sortedOverdue.filter((row) => {
    if (selectedFilter === 'critical-overdue') return isCriticalCalibration(row);
    if (selectedFilter === 'failed-adjusted') return ['fail', 'adjusted'].includes(String(row.result ?? ''));
    return true;
  });

  const tabs = [
    {
      id: 'requests',
      label: 'Requests',
      count: requestsScoped.length,
      content: (
        <DataTable
          columns={requestColumns}
          data={filteredRequests}
          searchPlaceholder="Search calibration requests..."
          emptyMessage="No calibration requests found"
          actions={canRequestCalibration ? (
            <Button onClick={() => setRequestModalOpen(true)}>
              <ClipboardList className="h-4 w-4" />
              New Request
            </Button>
          ) : undefined}
        />
      ),
    },
    {
      id: 'upcoming',
      label: 'Upcoming',
      count: upcomingOnlyRows.length,
      content: (
        <Table
          columns={upcomingColumns}
          data={filteredUpcoming}
          emptyMessage="No upcoming calibrations in the next 90 days"
        />
      ),
    },
    {
      id: 'overdue',
      label: 'Overdue',
      count: overdueRows.length,
      content: (
        <Table
          columns={upcomingColumns}
          data={filteredOverdue}
          emptyMessage="No overdue calibration rows found"
        />
      ),
    },
    {
      id: 'records',
      label: 'Records',
      count: recordsScoped.length,
      content: (
        <DataTable
          columns={recordColumns}
          data={filteredRecords}
          searchPlaceholder="Search calibration records..."
          emptyMessage="No calibration records found"
          actions={canManageMaintenance ? (
            <Button onClick={() => setRecordModalOpen(true)}>
              <Plus className="h-4 w-4" />
              New Record
            </Button>
          ) : undefined}
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <AssistantPageContextBridge
        moduleLabel="Calibration"
        pageLabel="Calibration control center"
        activeTab={selectedTab}
        currentFilters={{ filter: selectedFilter }}
        pageSummary="Calibration page with open requests, upcoming and overdue calibration, failed or adjusted results, external calibration, and completed-this-month evidence."
        visibleCounts={{
          records: recordsScoped.length,
          openRequests: countOpenCalibrationRequests(requestsScoped as Array<{ status?: string | null }>),
          dueSoon: dueSoonRows.length,
          overdue: countOverdueCalibration(upcomingScoped as Array<{ next_due_date?: string | null }>),
          criticalOverdue: criticalOverdueRows.length,
          failedAdjusted: countFailedOrAdjustedCalibration(recordsScoped as Array<{ result?: string | null }>),
        }}
        availableEvidenceLinks={[{ label: 'Calibration', href: '/calibration', type: 'module' }, { label: 'Calendar', href: '/calendar?type=calibration', type: 'calendar' }]}
        quickPrompts={['Which calibration items are urgent?', 'What compliance issues need attention?', 'Prepare a calibration summary.']}
      />
      <PageHeader
        title="Calibration"
        descriptionInfo="Accuracy and safety compliance control center for due, overdue, failed, adjusted, and requested calibrations."
        actions={canManageMaintenance ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setRequestModalOpen(true)} variant="outline"><ClipboardList className="h-4 w-4" /> New Request</Button>
            <Button onClick={() => setRecordModalOpen(true)}><Plus className="h-4 w-4" /> New Record</Button>
          </div>
        ) : canRequestCalibration ? (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setRequestModalOpen(true)} variant="outline"><ClipboardList className="h-4 w-4" /> Request Calibration</Button>
          </div>
        ) : <Badge variant="info">{primaryRole === 'viewer' ? 'Read-only' : 'View access'}</Badge>}
      />

      {assetFilter.assetId ? (
        <AssetFilterChip
          asset={assetFilter.asset}
          clearHref={assetFilter.clearHref}
          source={assetFilter.source}
        />
      ) : null}

      <motion.div
        variants={cardStagger}
        initial="initial"
        animate="animate"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <motion.div variants={cardItem}><StatCard label="Calibration Records" value={recordsScoped.length} icon={<Gauge className="h-6 w-6" />} color="blue" active={selectedTab === 'records' && selectedFilter === 'all'} onClick={() => selectCalibrationView('records')} /></motion.div>
        <motion.div variants={cardItem}><StatCard label="Open Requests" value={countOpenCalibrationRequests(requestsScoped as Array<{ status?: string | null }>)} icon={<ClipboardList className="h-6 w-6" />} color="purple" active={selectedTab === 'requests' && selectedFilter === 'all'} onClick={() => selectCalibrationView('requests')} /></motion.div>
        <motion.div variants={cardItem}><StatCard label="Due Soon" value={dueSoonRows.length} icon={<CalendarClock className="h-6 w-6" />} color="yellow" active={selectedTab === 'upcoming' && selectedFilter === 'due-soon'} onClick={() => selectCalibrationView('upcoming', 'due-soon')} /></motion.div>
        <motion.div variants={cardItem}><StatCard label="Overdue" value={countOverdueCalibration(upcomingScoped as Array<{ next_due_date?: string | null }>)} icon={<AlertTriangle className="h-6 w-6" />} color="red" active={selectedTab === 'overdue' && selectedFilter === 'overdue'} onClick={() => selectCalibrationView('overdue', 'overdue')} /></motion.div>
        <motion.div variants={cardItem}><StatCard label="Failed / Adjusted" value={countFailedOrAdjustedCalibration(recordsScoped as Array<{ result?: string | null }>)} icon={<ShieldAlert className="h-6 w-6" />} color="orange" active={selectedFilter === 'failed-adjusted'} onClick={() => selectCalibrationView('records', 'failed-adjusted')} /></motion.div>
        <motion.div variants={cardItem}><StatCard label="Critical Overdue" value={criticalOverdueRows.length} icon={<AlertTriangle className="h-6 w-6" />} color="red" active={selectedFilter === 'critical-overdue'} onClick={() => selectCalibrationView('overdue', 'critical-overdue')} /></motion.div>
        <motion.div variants={cardItem}><StatCard label="External Calibration" value={externalCalibration.length + externalRequests.length} icon={<Wrench className="h-6 w-6" />} color="gray" active={selectedFilter === 'external'} onClick={() => selectCalibrationView(externalRequests.length > 0 ? 'requests' : 'records', 'external')} /></motion.div>
        <motion.div variants={cardItem}><StatCard label="Completed This Month" value={completedThisMonth.length} icon={<CheckCircle className="h-6 w-6" />} color="green" active={selectedFilter === 'completed-month'} onClick={() => selectCalibrationView('records', 'completed-month')} /></motion.div>
      </motion.div>

      {(activeTab !== '' || selectedFilter !== 'all') && (
        <div className="flex justify-end">
          <ClearFiltersButton onClick={() => { setActiveTab(''); setActiveFilter('all'); }} />
        </div>
      )}

      {(overdueRows.length > 0 || failedAdjusted.length > 0 || awaitingActionRequests.length > 0) && (
        <section className="panel-surface rounded-lg p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[var(--foreground)]">Calibration Triage</h2>
              <InfoPopover align="left">
                <p className="mb-2 font-semibold text-[var(--foreground)]">How priority is scored</p>
                <p className="mb-2 text-[var(--text-muted)]">Calibration priority = overdue severity + equipment criticality + last result risk + department impact + open workflow state.</p>
                <p className="font-semibold text-[var(--foreground)]">Triage groups</p>
                <p className="text-[var(--text-muted)]">Urgent Safety Risk: overdue high-criticality or failed/adjusted last results. Needs Scheduling: due/overdue equipment without an open workflow. Awaiting Action: pending or approved requests. Longest Overdue: secondary lens for routine overdue work without overstating severity.</p>
              </InfoPopover>
            </div>
            <Badge variant="warning">Scoring method visible per item</Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-4">
            {[
              { title: 'Urgent Safety Risk', rows: urgentSafetyRows.slice(0, 4), empty: 'No urgent calibration safety risks.' },
              { title: 'Needs Scheduling', rows: needsSchedulingRows.slice(0, 4), empty: 'No due items without a workflow.' },
              { title: 'Awaiting Action', requests: awaitingActionRequests.slice(0, 4), empty: 'No calibration requests awaiting action.' },
              { title: 'Longest Overdue', rows: longestOverdueRows, empty: 'No overdue calibration rows.' },
            ].map((group) => (
              <div key={group.title} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3">
                <h3 className="text-sm font-semibold text-[var(--foreground)]">{group.title}</h3>
                <div className="mt-3 space-y-2">
                  {'requests' in group ? (
                    (group.requests ?? []).length === 0 ? (
                      <p className="text-sm text-[var(--text-muted)]">{group.empty}</p>
                    ) : (group.requests ?? []).map((request) => {
                      const asset = calibrationAsset(request);
                      return (
                        <Link key={String(request.id)} href={`/calibration/requests/${request.id as string}${request.status === 'approved' ? '?action=schedule' : ''}`} className="block rounded-md bg-[var(--surface-2)]/70 p-2 hover:bg-[var(--surface-2)]">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-[var(--foreground)]">{asset?.asset_code ?? 'Request'} · {asset?.name ?? String(request.request_number ?? 'Calibration request')}</p>
                              <p className="text-xs text-[var(--text-muted)]">{asset?.departments?.name ?? 'No department'} · {formatLabel(String(request.status ?? 'pending'))}</p>
                            </div>
                            <span className="text-xs font-medium text-[var(--brand)]">{request.status === 'pending' ? 'Review Calibration Request' : 'Schedule Calibration'}</span>
                          </div>
                        </Link>
                      );
                    })
                  ) : (group.rows ?? []).length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">{group.empty}</p>
                  ) : (group.rows ?? []).map((row) => {
                    const asset = calibrationAsset(row);
                    const request = openRequestForAsset(String(row.asset_id ?? asset?.id ?? ''));
                    const factors = calibrationFactors(row, request);
                    const calType = (row.calibration_types as { name?: string } | null)?.name ?? 'Calibration';
                    const dueText = row.next_due_date ? new Date(String(row.next_due_date)).toLocaleDateString() : '—';
                    const actionLabel = request?.id ? 'Open Request' : 'Schedule Calibration';
                    const actionHref = request?.id
                      ? `/calibration/requests/${request.id as string}`
                      : `/calibration/requests/new?assetId=${asset?.id ?? ''}&calibrationTypeId=${String(row.calibration_type_id ?? '')}&source=triage`;
                    return (
                      <div key={String(row.id)} className="rounded-md bg-[var(--surface-2)]/70 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[var(--foreground)]">{asset?.asset_code ?? 'Asset'} · {asset?.name ?? 'Unknown'}</p>
                            <p className="text-xs text-[var(--text-muted)]">{asset?.departments?.name ?? 'No department'} · {formatLabel(String(calType))} · Due {dueText}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            {factors.length > 0 && (
                              <InfoPopover align="right">
                                <p className="mb-1 font-semibold text-[var(--foreground)]">Priority drivers</p>
                                <ul className="space-y-0.5 text-xs text-[var(--text-muted)]">
                                  {factors.map((factor) => (
                                    <li key={factor}>• {factor}</li>
                                  ))}
                                </ul>
                              </InfoPopover>
                            )}
                            {asset?.id && (
                              <Link className="text-xs font-medium text-[var(--brand)] hover:underline" href={actionHref}>{actionLabel}</Link>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <Tabs tabs={tabs} activeTab={selectedTab} defaultTab={defaultTab} onChange={(tabId) => { setActiveTab(tabId as CalibrationTab); setActiveFilter('all'); }} />

      {/* New Record Modal */}
      <Modal
        open={recordModalOpen}
        onClose={() => { setRecordModalOpen(false); resetRecordForm(); }}
        title="New Calibration Record"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => { setRecordModalOpen(false); resetRecordForm(); }}>Cancel</Button>
            <Button onClick={handleCreateRecord} loading={submitting}>Create</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Asset *" options={assets} placeholder="Select asset" value={recAssetId} onChange={(e) => setRecAssetId(e.target.value)} />
          <Select label="Calibration Type" options={calTypes} placeholder="Select type" value={recTypeId} onChange={(e) => setRecTypeId(e.target.value)} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Calibration Date *" type="date" value={recDate} onChange={(e) => setRecDate(e.target.value)} />
            <Input label="Next Due Date" type="date" value={recNextDue} onChange={(e) => setRecNextDue(e.target.value)} />
          </div>
          <Select
            label="Result *"
            options={[
              { value: 'pass', label: 'Pass' },
              { value: 'fail', label: 'Fail' },
              { value: 'adjusted', label: 'Adjusted' },
            ]}
            value={recResult}
            onChange={(e) => setRecResult(e.target.value as CalibrationResult)}
          />
          <Input label="Calibrated By" value={recCalibratedBy} onChange={(e) => setRecCalibratedBy(e.target.value)} placeholder="Technician or vendor name" />
          <Textarea label="Notes" value={recNotes} onChange={(e) => setRecNotes(e.target.value)} placeholder="Additional notes..." />
        </div>
      </Modal>

      {/* New Request Modal */}
      <Modal
        open={requestModalOpen}
        onClose={() => { setRequestModalOpen(false); resetRequestForm(); }}
        title="New Calibration Request"
        footer={
          <>
            <Button variant="outline" onClick={() => { setRequestModalOpen(false); resetRequestForm(); }}>Cancel</Button>
            <Button onClick={handleCreateRequest} loading={submitting}>Submit Request</Button>
          </>
        }
      >
        <div className="space-y-4">
          <OfflineSubmitBanner actionLabel="Calibration request" />
          <OfflineActionResult result={requestOfflineResult} />
          <Select label="Asset *" options={assets} placeholder="Select asset" value={reqAssetId} onChange={(e) => setReqAssetId(e.target.value)} />
          <Select label="Calibration Type" options={calTypes} placeholder="Select type" value={reqTypeId} onChange={(e) => setReqTypeId(e.target.value)} />
          <Select
            label="Urgency"
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'critical', label: 'Critical' },
            ]}
            value={reqUrgency}
            onChange={(e) => setReqUrgency(e.target.value as Urgency)}
          />
          <Textarea label="Notes" value={reqNotes} onChange={(e) => setReqNotes(e.target.value)} placeholder="Reason for request..." />
        </div>
      </Modal>
    </div>
  );
}
