'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CheckCircle, ClipboardList, FileWarning, Plus, Recycle, Trash2, XCircle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import Tabs from '@/components/ui/Tabs';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import StatCard from '@/components/ui/StatCard';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { PageLoader } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import {
  getDisposalRequests,
} from '@/services/disposal.service';
import { getReplacementPriorities } from '@/services/analytics.service';
import { createDisposalRequestAction, updateDisposalRequestStatusAction } from '@/actions/disposal.actions';
import { getEquipmentList } from '@/services/equipment.service';
import { createClient } from '@/lib/supabase/client';
import type { DisposalMethod, DisposalRequestStatus } from '@/types/domain';
import { replacementEvidence } from '@/app/(dashboard)/command/_lib/command-center-routes';
import { useRole } from '@/hooks/useRole';

type DisposalRow = Record<string, unknown>;
type DisposedRow = Record<string, unknown>;
type CandidateRow = Record<string, unknown>;
type DisposalTab = 'requests' | 'candidates' | 'disposed';
type DisposalFilter = 'all' | 'pending' | 'approved' | 'completed' | 'replacement' | 'non-repairable' | 'high-burden' | 'missing-evidence';

const disposalMethodOptions: { value: DisposalMethod; label: string }[] = [
  { value: 'auction', label: 'Auction' },
  { value: 'donation', label: 'Donation' },
  { value: 'recycling', label: 'Recycling' },
  { value: 'destruction', label: 'Destruction' },
  { value: 'return_to_vendor', label: 'Return to Vendor' },
  { value: 'other', label: 'Other' },
];

const statusVariant: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple'> = {
  pending: 'warning',
  approved: 'info',
  rejected: 'error',
  completed: 'success',
  canceled: 'default',
};

function formatLabel(val: string) {
  return val.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeDisposalTab(value: string | null): DisposalTab | '' {
  if (value === 'requests' || value === 'candidates' || value === 'disposed') return value;
  return '';
}

export default function DisposalPage() {
  const { toast } = useToast();
  const { canManageMaintenance, primaryRole } = useRole();
  const searchParams = useSearchParams();
  const [disposalRequests, setDisposalRequests] = useState<DisposalRow[]>([]);
  const [disposedAssets, setDisposedAssets] = useState<DisposedRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [assets, setAssets] = useState<{ value: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<DisposalTab | ''>(() => normalizeDisposalTab(searchParams.get('tab')));
  const [activeFilter, setActiveFilter] = useState<DisposalFilter>('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [approveTarget, setApproveTarget] = useState<DisposalRow | null>(null);
  const [rejectTarget, setRejectTarget] = useState<DisposalRow | null>(null);

  // Form
  const [formAssetId, setFormAssetId] = useState('');
  const [formReason, setFormReason] = useState('');
  const [formMethod, setFormMethod] = useState<DisposalMethod>('recycling');
  const [formNotes, setFormNotes] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const [reqRes, disposedRes, assetRes, replacementRes] = await Promise.all([
        getDisposalRequests(),
        supabase
          .from('disposed_assets')
          .select(`
            id, asset_id, disposal_request_id, disposal_date, disposal_method,
            disposal_value, disposed_by, notes, created_at,
            equipment_assets(id, asset_code, name),
            disposed_by_profile:profiles!disposed_assets_disposed_by_fkey(id, full_name, email)
          `)
          .order('disposal_date', { ascending: false }),
        getEquipmentList(),
        getReplacementPriorities(),
      ]);

      setDisposalRequests((reqRes.data || []) as DisposalRow[]);
      setDisposedAssets((disposedRes.data || []) as DisposedRow[]);
      const requestsByAsset = new Set((reqRes.data || []).map((row: Record<string, unknown>) => row.asset_id));
      const replacementRows = ((replacementRes.data || []) as CandidateRow[])
        .filter((row) => Number(row.replacement_priority_index ?? 0) >= 0.7 || Number(row.maintenance_burden_score ?? 0) >= 0.7 || Number(row.risk_score ?? 0) >= 0.7)
        .map((row) => ({ ...row, existing_request: requestsByAsset.has(row.asset_id) }));
      const nonRepairableAssets = ((assetRes.data || []) as CandidateRow[])
        .filter((row) => ['non_functional', 'decommissioned'].includes(String(row.condition)))
        .map((row) => ({
          id: `asset-${row.id as string}`,
          asset_id: row.id,
          replacement_priority_index: null,
          risk_score: null,
          maintenance_burden_score: null,
          reason: row.condition === 'non_functional' ? 'Non-functional equipment should be reviewed for disposal evidence.' : 'Decommissioned asset requires disposal evidence if still retained.',
          equipment_assets: row,
          existing_request: requestsByAsset.has(row.id),
        }));
      setCandidates([...replacementRows, ...nonRepairableAssets]);
      setAssets(
        (assetRes.data || []).map((a: Record<string, unknown>) => ({
          value: a.id as string,
          label: `${a.asset_code} — ${a.name}`,
        }))
      );
    } catch {
      toast('error', 'Failed to load disposal data');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (searchParams.get('source') === 'requests-hub' && searchParams.get('action') === 'new-request') {
      setCreateOpen(true);
    }
    if (searchParams.get('action') === 'new-request') setCreateOpen(true);
    if (searchParams.get('assetId')) setFormAssetId(searchParams.get('assetId') ?? '');
    if (searchParams.get('reason')) setFormReason(searchParams.get('reason') ?? '');
  }, [searchParams]);

  const handleCreate = async () => {
    if (!formAssetId || !formReason) {
      toast('warning', 'Asset and reason are required');
      return;
    }
    setSubmitting(true);
    try {
      const result = await createDisposalRequestAction({
        asset_id: formAssetId,
        requested_by: null,
        reason: formReason,
        disposal_method_proposed: formMethod,
        status: 'pending' as DisposalRequestStatus,
        notes: formNotes || null,
      });
      if (!result.success) throw new Error(result.error ?? 'Failed to create disposal request');
      toast('success', 'Disposal request created');
      setCreateOpen(false);
      resetForm();
      loadData();
    } catch {
      toast('error', 'Failed to create disposal request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async () => {
    if (!approveTarget) return;
    setSubmitting(true);
    try {
      const result = await updateDisposalRequestStatusAction(
        approveTarget.id as string,
        'approved'
      );
      if (!result.success) throw new Error(result.error ?? 'Failed to approve request');
      toast('success', 'Disposal request approved');
      setApproveTarget(null);
      loadData();
    } catch {
      toast('error', 'Failed to approve request');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    setSubmitting(true);
    try {
      const result = await updateDisposalRequestStatusAction(
        rejectTarget.id as string,
        'rejected'
      );
      if (!result.success) throw new Error(result.error ?? 'Failed to reject request');
      toast('success', 'Disposal request rejected');
      setRejectTarget(null);
      loadData();
    } catch {
      toast('error', 'Failed to reject request');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setFormAssetId(''); setFormReason(''); setFormMethod('recycling'); setFormNotes('');
  };

  const requestColumns = [
    { key: 'request_number', header: 'Request #', sortable: true },
    {
      key: 'asset',
      header: 'Asset',
      render: (row: DisposalRow) => {
        const asset = row.equipment_assets as { asset_code: string; name: string } | null;
        return asset ? `${asset.asset_code} — ${asset.name}` : '—';
      },
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (row: DisposalRow) => {
        const reason = row.reason as string;
        return reason?.length > 50 ? `${reason.slice(0, 50)}...` : reason || '—';
      },
    },
    {
      key: 'disposal_method_proposed',
      header: 'Proposed Method',
      render: (row: DisposalRow) =>
        row.disposal_method_proposed ? formatLabel(row.disposal_method_proposed as string) : '—',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: DisposalRow) => (
        <Badge variant={statusVariant[row.status as string] || 'default'}>
          {formatLabel(row.status as string)}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: DisposalRow) => new Date(row.created_at as string).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: DisposalRow) => {
        if (row.status === 'approved') {
          return (
            <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={`/disposal?requestId=${row.id as string}&action=record-disposal`}>
              Record Disposal
            </Link>
          );
        }
        if (row.status !== 'pending' || !canManageMaintenance) {
          return (
            <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={`/disposal?requestId=${row.id as string}`}>
              {row.status === 'completed' ? 'View Disposal Evidence' : row.status === 'rejected' ? 'View Reason' : 'Review Request'}
            </Link>
          );
        }
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); setApproveTarget(row); }}
              title="Approve"
            >
              <CheckCircle className="h-4 w-4 text-green-500" />
              Approve Request
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => { e.stopPropagation(); setRejectTarget(row); }}
              title="Reject"
            >
              <XCircle className="h-4 w-4 text-red-500" />
              Reject
            </Button>
          </div>
        );
      },
    },
  ];

  const disposedColumns = [
    {
      key: 'asset',
      header: 'Asset',
      render: (row: DisposedRow) => {
        const asset = row.equipment_assets as { asset_code: string; name: string } | null;
        return asset ? `${asset.asset_code} — ${asset.name}` : '—';
      },
    },
    {
      key: 'disposal_date',
      header: 'Disposal Date',
      sortable: true,
      render: (row: DisposedRow) => new Date(row.disposal_date as string).toLocaleDateString(),
    },
    {
      key: 'disposal_method',
      header: 'Method',
      render: (row: DisposedRow) => formatLabel(row.disposal_method as string),
    },
    {
      key: 'disposal_value',
      header: 'Value',
      render: (row: DisposedRow) =>
        row.disposal_value != null ? `$${(row.disposal_value as number).toFixed(2)}` : '—',
    },
    {
      key: 'disposed_by',
      header: 'Disposed By',
      render: (row: DisposedRow) => {
        const profile = row.disposed_by_profile as { full_name?: string | null; email?: string | null } | null;
        return (
          <div>
            <p>{profile?.full_name ?? profile?.email ?? 'Unknown user'}</p>
            {!profile && row.disposed_by ? <p className="text-xs text-[var(--text-muted)]">{String(row.disposed_by).slice(0, 8)}...</p> : null}
          </div>
        );
      },
    },
    {
      key: 'action',
      header: 'Action',
      render: (row: DisposedRow) => (
        <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={`/disposal?disposedId=${row.id as string}`}>
          View Evidence
        </Link>
      ),
    },
  ];

  if (loading) return <PageLoader />;

  const pending = disposalRequests.filter((row) => row.status === 'pending');
  const approved = disposalRequests.filter((row) => row.status === 'approved');
  const completed = disposalRequests.filter((row) => row.status === 'completed');
  const missingEvidence = approved.filter((row) => !disposedAssets.some((asset) => asset.disposal_request_id === row.id));
  const nonRepairable = candidates.filter((row) => {
    const asset = row.equipment_assets as { condition?: string } | null;
    return ['non_functional', 'decommissioned'].includes(String(asset?.condition ?? ''));
  });
  const highMaintenance = candidates.filter((row) => Number(row.maintenance_burden_score ?? 0) >= 0.7);
  const defaultTab: DisposalTab = normalizeDisposalTab(searchParams.get('tab'))
    || (pending.length > 0 ? 'requests' : disposalRequests.length === 0 && candidates.length > 0 ? 'candidates' : 'disposed');
  const selectedTab = activeTab || defaultTab;
  function selectDisposalView(tab: DisposalTab, filter: DisposalFilter = 'all') {
    setActiveTab(tab);
    setActiveFilter(filter);
  }
  const filteredRequests = disposalRequests.filter((row) => {
    if (activeFilter === 'pending') return row.status === 'pending';
    if (activeFilter === 'approved') return row.status === 'approved';
    if (activeFilter === 'missing-evidence') return missingEvidence.some((item) => item.id === row.id);
    return true;
  });
  const filteredCandidates = candidates.filter((row) => {
    if (activeFilter === 'replacement') return true;
    if (activeFilter === 'non-repairable') return nonRepairable.some((item) => item.id === row.id);
    if (activeFilter === 'high-burden') return highMaintenance.some((item) => item.id === row.id);
    if (activeFilter === 'missing-evidence') return !row.existing_request;
    return true;
  });
  const filteredDisposed = activeFilter === 'completed' ? disposedAssets : disposedAssets;

  const candidateColumns = [
    {
      key: 'asset',
      header: 'Asset',
      render: (row: CandidateRow) => {
        const asset = row.equipment_assets as { id?: string; asset_code?: string; name?: string; departments?: { name?: string } | null; condition?: string } | null;
        return (
          <div>
            <p className="font-medium">{asset?.asset_code ?? String(row.asset_id ?? 'Unknown asset')}</p>
            <p className="text-xs text-[var(--text-muted)]">{asset?.name ?? 'Unknown asset'} · {asset?.departments?.name ?? 'No department'}</p>
          </div>
        );
      },
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (row: CandidateRow) => String(row.reason ?? (Number(row.replacement_priority_index ?? 0) >= 0.7 ? 'High replacement priority with lifecycle evidence.' : 'Lifecycle evidence requires review.')),
    },
    {
      key: 'rpi',
      header: 'RPI',
      render: (row: CandidateRow) => row.replacement_priority_index == null ? '—' : <Badge variant="error">{Math.round(Number(row.replacement_priority_index) * 100)}/100</Badge>,
    },
    {
      key: 'condition',
      header: 'Condition',
      render: (row: CandidateRow) => {
        const asset = row.equipment_assets as { condition?: string } | null;
        return asset?.condition ? asset.condition.replace(/_/g, ' ') : '—';
      },
    },
    {
      key: 'maintenance_burden_score',
      header: 'Maintenance Burden',
      render: (row: CandidateRow) => Number(row.maintenance_burden_score ?? 0) >= 0.7 ? 'High' : row.maintenance_burden_score == null ? '—' : 'Moderate/low',
    },
    {
      key: 'risk_score',
      header: 'Risk',
      render: (row: CandidateRow) => Number(row.risk_score ?? 0) >= 0.7 ? 'High' : row.risk_score == null ? '—' : 'Moderate/low',
    },
    {
      key: 'action',
      header: 'Action',
      render: (row: CandidateRow) => {
        const assetId = String(row.asset_id ?? '');
        return (
          <div className="flex flex-wrap gap-1.5">
            {row.existing_request ? (
              <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={`/disposal?assetId=${assetId}`}>Review Request</Link>
            ) : canManageMaintenance ? (
              <button type="button" className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" onClick={() => { setFormAssetId(assetId); setFormReason(String(row.reason ?? 'Lifecycle evidence supports disposal review.')); setCreateOpen(true); }}>
                Create Disposal Request
              </button>
            ) : null}
            <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={replacementEvidence(assetId)}>Open Replacement Evidence</Link>
            {assetId && (
              <Link className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs font-medium hover:bg-[var(--surface-2)]" href={`/equipment/${assetId}`}>Open Asset Profile</Link>
            )}
          </div>
        );
      },
    },
  ];

  const tabs = [
    {
      id: 'requests',
      label: 'Requests',
      count: disposalRequests.length,
      content: (
        <DataTable
          columns={requestColumns}
          data={filteredRequests}
          searchPlaceholder="Search disposal requests..."
          emptyMessage="No disposal requests found"
          actions={canManageMaintenance ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              New Request
            </Button>
          ) : undefined}
        />
      ),
    },
    {
      id: 'candidates',
      label: 'Candidates',
      count: candidates.length,
      content: (
        <DataTable
          columns={candidateColumns}
          data={filteredCandidates}
          searchPlaceholder="Search disposal candidates..."
          emptyMessage="No disposal candidates found"
        />
      ),
    },
    {
      id: 'disposed',
      label: 'Disposed',
      count: disposedAssets.length,
      content: (
        <DataTable
          columns={disposedColumns}
          data={filteredDisposed}
          searchPlaceholder="Search disposed assets..."
          emptyMessage="No disposed assets found"
        />
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Disposal"
        description="End-of-life workflow for formal disposal requests, lifecycle candidates, approvals, and disposal evidence."
        actions={canManageMaintenance ? (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            New Disposal Request
          </Button>
        ) : <Badge variant="info">{primaryRole === 'viewer' ? 'Read-only' : 'View access'}</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Disposal Requests" value={disposalRequests.length} icon={<ClipboardList className="h-6 w-6" />} color="blue" active={selectedTab === 'requests' && activeFilter === 'all'} onClick={() => selectDisposalView('requests')} />
        <StatCard label="Pending Review" value={pending.length} icon={<AlertTriangle className="h-6 w-6" />} color="yellow" active={activeFilter === 'pending'} onClick={() => selectDisposalView('requests', 'pending')} />
        <StatCard label="Approved Disposal" value={approved.length} icon={<CheckCircle className="h-6 w-6" />} color="purple" active={activeFilter === 'approved'} onClick={() => selectDisposalView('requests', 'approved')} />
        <StatCard label="Completed Disposal" value={disposedAssets.length || completed.length} icon={<Trash2 className="h-6 w-6" />} color="green" active={selectedTab === 'disposed'} onClick={() => selectDisposalView('disposed', 'completed')} />
        <StatCard label="Replacement Candidates" value={candidates.length} icon={<Recycle className="h-6 w-6" />} color="orange" active={selectedTab === 'candidates' && activeFilter === 'replacement'} onClick={() => selectDisposalView('candidates', 'replacement')} />
        <StatCard label="Non-repairable Assets" value={nonRepairable.length} icon={<FileWarning className="h-6 w-6" />} color="red" active={activeFilter === 'non-repairable'} onClick={() => selectDisposalView('candidates', 'non-repairable')} />
        <StatCard label="High Maintenance Burden" value={highMaintenance.length} icon={<AlertTriangle className="h-6 w-6" />} color="red" active={activeFilter === 'high-burden'} onClick={() => selectDisposalView('candidates', 'high-burden')} />
        <StatCard label="Missing Evidence" value={missingEvidence.length} icon={<FileWarning className="h-6 w-6" />} color="gray" active={activeFilter === 'missing-evidence'} onClick={() => selectDisposalView(missingEvidence.length > 0 ? 'requests' : 'candidates', 'missing-evidence')} />
      </div>

      {disposalRequests.length === 0 && candidates.length > 0 && (
        <section className="panel-surface rounded-lg p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">No Formal Disposal Requests Yet</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Replacement candidates are planning evidence, not disposal requests. Review the candidate evidence, then create a formal request when the BME Head is ready to start approval.</p>
            </div>
            <Badge variant="warning">Review {candidates.length} candidates</Badge>
          </div>
        </section>
      )}

      <Tabs tabs={tabs} activeTab={selectedTab} defaultTab={defaultTab} onChange={(tabId) => { setActiveTab(tabId as DisposalTab); setActiveFilter('all'); }} />

      {/* New Request Modal */}
      <Modal
        open={createOpen}
        onClose={() => { setCreateOpen(false); resetForm(); }}
        title="New Disposal Request"
        footer={
          <>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleCreate} loading={submitting}>Submit Request</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label="Asset *" options={assets} placeholder="Select asset" value={formAssetId} onChange={(e) => setFormAssetId(e.target.value)} />
          <Textarea label="Reason for Disposal *" value={formReason} onChange={(e) => setFormReason(e.target.value)} placeholder="Why should this equipment be disposed?" />
          <Select label="Proposed Method" options={disposalMethodOptions} value={formMethod} onChange={(e) => setFormMethod(e.target.value as DisposalMethod)} />
          <Textarea label="Notes" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="Additional notes..." />
        </div>
      </Modal>

      {/* Approve Dialog */}
      <ConfirmDialog
        open={!!approveTarget}
        onClose={() => setApproveTarget(null)}
        onConfirm={handleApprove}
        title="Approve Disposal Request"
        description={`Are you sure you want to approve disposal request ${approveTarget?.request_number}?`}
        confirmLabel="Approve"
        loading={submitting}
        destructive={false}
      />

      {/* Reject Dialog */}
      <ConfirmDialog
        open={!!rejectTarget}
        onClose={() => setRejectTarget(null)}
        onConfirm={handleReject}
        title="Reject Disposal Request"
        description={`Are you sure you want to reject disposal request ${rejectTarget?.request_number}?`}
        confirmLabel="Reject"
        loading={submitting}
      />
    </div>
  );
}
