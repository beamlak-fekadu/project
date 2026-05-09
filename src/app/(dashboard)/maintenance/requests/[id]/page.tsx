'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CheckCircle, XCircle, UserPlus, Wrench, ArrowLeft,
} from 'lucide-react';
import {
  PageHeader, Card, CardHeader, CardTitle, CardContent, CardFooter,
  Button, Modal, Select, Spinner,
} from '@/components/ui';
import { UrgencyBadge, RequestStatusBadge } from '@/components/ui/StatusBadge';
import { getRequestById } from '@/services/maintenance.service';
import { updateRequestStatusAction } from '@/actions/maintenance.actions';
import { getActiveTechnicians } from '@/services/users.service';
import { useToast } from '@/components/ui/Toast';
import type { MaintenanceRequest, MaintenanceRequestStatus, Profile } from '@/types/database';

type RequestWithJoins = MaintenanceRequest & {
  equipment_assets?: { id: string; asset_code: string; name: string };
  departments?: { id: string; name: string; code: string };
};

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  const [request, setRequest] = useState<RequestWithJoins | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [technicians, setTechnicians] = useState<Profile[]>([]);
  const [selectedTechnician, setSelectedTechnician] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await getRequestById(id);
    if (error || !data) {
      toast('error', 'Failed to load request');
      return;
    }
    setRequest(data as unknown as RequestWithJoins);
    setLoading(false);
  }, [id, toast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function handleStatusUpdate(status: MaintenanceRequestStatus) {
    setActionLoading(true);
    const result = await updateRequestStatusAction(id, status);
    if (!result.success) {
      toast('error', result.error ?? `Failed to ${status} request`);
    } else {
      toast('success', `Request ${status}`);
      await load();
    }
    setActionLoading(false);
  }

  async function openAssignModal() {
    if (technicians.length === 0) {
      const { data } = await getActiveTechnicians();
      if (data) setTechnicians(data as unknown as Profile[]);
    }
    setAssignModalOpen(true);
  }

  async function handleAssign() {
    if (!selectedTechnician) return;
    setActionLoading(true);
    const result = await updateRequestStatusAction(id, 'assigned');
    if (!result.success) {
      toast('error', result.error ?? 'Failed to assign request');
    } else {
      toast('success', 'Request assigned');
      setAssignModalOpen(false);
      await load();
    }
    setActionLoading(false);
  }

  if (loading || !request) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  const isPending = request.status === 'pending';
  const isApproved = request.status === 'approved';
  const isAssigned = request.status === 'assigned';
  const canCreateWO = isApproved || isAssigned || request.status === 'in_progress';

  return (
    <div>
      <PageHeader
        title={request.request_number}
        description="Maintenance Request"
        breadcrumbs={[
          { label: 'Command Center', href: '/command' },
          { label: 'Maintenance', href: '/maintenance' },
          { label: request.request_number },
        ]}
        actions={
          <Button variant="outline" size="sm" onClick={() => router.push('/maintenance')}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Request Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Asset</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {request.equipment_assets
                      ? `${request.equipment_assets.asset_code} — ${request.equipment_assets.name}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Department</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {request.departments?.name ?? '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Urgency</dt>
                  <dd className="mt-1"><UrgencyBadge urgency={request.urgency} /></dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Status</dt>
                  <dd className="mt-1"><RequestStatusBadge status={request.status} /></dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Created</dt>
                  <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                    {new Date(request.created_at).toLocaleString()}
                  </dd>
                </div>
                {request.resolved_at && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Resolved</dt>
                    <dd className="mt-1 text-sm text-gray-900 dark:text-white">
                      {new Date(request.resolved_at).toLocaleString()}
                    </dd>
                  </div>
                )}
                <div className="sm:col-span-2">
                  <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Fault Description</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900 dark:text-white">
                    {request.fault_description}
                  </dd>
                </div>
                {request.notes && (
                  <div className="sm:col-span-2">
                    <dt className="text-sm font-medium text-gray-500 dark:text-gray-400">Notes</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900 dark:text-white">
                      {request.notes}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
            <CardFooter>
              <div className="flex flex-wrap gap-2">
                {isPending && (
                  <>
                    <Button size="sm" onClick={() => handleStatusUpdate('approved')} loading={actionLoading}>
                      <CheckCircle className="h-4 w-4" />
                      Approve
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleStatusUpdate('rejected')} loading={actionLoading}>
                      <XCircle className="h-4 w-4" />
                      Reject
                    </Button>
                  </>
                )}
                {(isPending || isApproved) && (
                  <Button size="sm" variant="outline" onClick={openAssignModal} loading={actionLoading}>
                    <UserPlus className="h-4 w-4" />
                    Assign
                  </Button>
                )}
                {(isAssigned || request.status === 'in_progress') && (
                  <Button size="sm" onClick={() => handleStatusUpdate('completed')} loading={actionLoading}>
                    <CheckCircle className="h-4 w-4" />
                    Complete
                  </Button>
                )}
                {canCreateWO && (
                  <Link href={`/maintenance/work-orders/new?request_id=${request.id}&asset_id=${request.asset_id}`}>
                    <Button size="sm" variant="secondary">
                      <Wrench className="h-4 w-4" />
                      Create Work Order
                    </Button>
                  </Link>
                )}
              </div>
            </CardFooter>
          </Card>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-blue-500" />
                  <span className="text-gray-500 dark:text-gray-400">Created</span>
                  <span className="ml-auto text-gray-700 dark:text-gray-300">
                    {new Date(request.created_at).toLocaleDateString()}
                  </span>
                </div>
                {request.updated_at !== request.created_at && (
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-yellow-500" />
                    <span className="text-gray-500 dark:text-gray-400">Updated</span>
                    <span className="ml-auto text-gray-700 dark:text-gray-300">
                      {new Date(request.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
                {request.resolved_at && (
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="text-gray-500 dark:text-gray-400">Resolved</span>
                    <span className="ml-auto text-gray-700 dark:text-gray-300">
                      {new Date(request.resolved_at).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Modal
        open={assignModalOpen}
        onClose={() => setAssignModalOpen(false)}
        title="Assign Technician"
        footer={
          <>
            <Button variant="outline" onClick={() => setAssignModalOpen(false)}>Cancel</Button>
            <Button onClick={handleAssign} loading={actionLoading} disabled={!selectedTechnician}>Assign</Button>
          </>
        }
      >
        <Select
          label="Technician"
          placeholder="Select a technician"
          value={selectedTechnician}
          onChange={(e) => setSelectedTechnician(e.target.value)}
          options={technicians.map((t) => ({ value: t.id, label: `${t.full_name}${t.email ? ` · ${t.email}` : ''}` }))}
        />
      </Modal>
    </div>
  );
}
