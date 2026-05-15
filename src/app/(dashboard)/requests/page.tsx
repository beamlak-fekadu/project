import { Badge, PageHeader } from '@/components/ui';
import { requireRole } from '@/lib/auth/helpers';
import RequestsHubClient from './_components/RequestsHubClient';
import { fetchRequestsHubData } from './_lib/requests-hub-data';
import DepartmentRequestsPage from './_components/DepartmentRequestsPage';
import { detectDepartmentRoleType } from '@/utils/department/department-scope';
import { createClient } from '@/lib/supabase/server';
import { fetchDepartmentName } from '@/utils/department/department-metrics';

export default async function RequestsHubPage() {
  const profile = await requireRole(['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer']);
  const data = await fetchRequestsHubData(profile);

  const roleType = detectDepartmentRoleType(profile.roleNames ?? []);
  if (roleType) {
    const departmentId = (profile as unknown as Record<string, unknown>).department_id as string | null | undefined ?? null;
    const profileId = (profile as unknown as Record<string, unknown>).id as string | null ?? null;
    const supabase = await createClient();
    const departmentName = await fetchDepartmentName(supabase, departmentId).catch(() => null);
    // Defensive department-scoping on top of the role-aware fetcher.
    const deptRows = data.unifiedRequests.filter((r) => !departmentId || r.departmentId === departmentId);
    return (
      <DepartmentRequestsPage
        rows={deptRows}
        departmentId={departmentId}
        departmentName={departmentName}
        profileId={profileId}
        roleType={roleType}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requests Hub"
        descriptionInfo="Central intake and tracking for maintenance, calibration, procurement, training, disposal, installation, and specification requests."
        actions={<Badge variant="info">Role-based visibility enabled</Badge>}
      />
      <RequestsHubClient data={data} />
    </div>
  );
}
