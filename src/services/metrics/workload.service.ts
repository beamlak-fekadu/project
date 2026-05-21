// R29: canonical technician workload source.
//
// One source for current workload across BMEDIS. Live computation from
// `work_orders` filtered to open/assigned/in_progress/on_hold rows joined to
// active technician profiles.
//
// `workload_capacity_snapshots` (legacy table) remains for historical trend
// dashboards only — do NOT read it for current-workload UIs. Mixing the two
// is exactly the divergence R29 was filed to prevent. If a future
// historical-trend view is built, it should explicitly label its source as
// "historical snapshot" so users see two distinct things.
//
// Re-exported by Command Center, Developer Lab, reports, and Copilot tools.
// `fetchTechnicianWorkload` in command/_lib/command-center-data.ts now
// delegates to this module.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface TechnicianWorkloadItem {
  profileId: string;
  name: string;
  email: string | null;
  departmentName: string | null;
  openAssignments: number;
  inProgress: number;
  overdueTasks: number;
  criticalTasks: number;
  estimatedHours: number;
  status: 'available' | 'busy' | 'overloaded';
}

export const WORKLOAD_STATUS_THRESHOLDS = {
  // ≥ openAssignments OR criticalTasks > 0 → overloaded
  overloaded: 6,
  // ≥ openAssignments → busy
  busy: 3,
} as const;

export function classifyWorkloadStatus(input: {
  openAssignments: number;
  criticalTasks: number;
}): TechnicianWorkloadItem['status'] {
  if (input.openAssignments >= WORKLOAD_STATUS_THRESHOLDS.overloaded || input.criticalTasks > 0) {
    return 'overloaded';
  }
  if (input.openAssignments >= WORKLOAD_STATUS_THRESHOLDS.busy) return 'busy';
  return 'available';
}

export async function fetchCurrentTechnicianWorkload(
  supabase: SupabaseClient,
): Promise<TechnicianWorkloadItem[]> {
  const [techniciansRes, woRes] = await Promise.all([
    supabase
      .from('profiles')
      // PostgREST disambiguation: user_roles has two FKs to profiles (user_id,
      // assigned_by). Hint forces PostgREST to use the user_id relationship,
      // otherwise PGRST201 silently zeros the technician roster.
      .select('id, full_name, email, departments(name), user_roles!user_roles_user_id_fkey!inner(roles!inner(name))')
      .eq('is_active', true)
      .eq('user_roles.roles.name', 'technician')
      .order('full_name', { ascending: true })
      .limit(500),
    supabase
      .from('work_orders')
      .select('id, status, priority, estimated_hours, assigned_to, profiles(full_name)')
      .in('status', ['open', 'assigned', 'in_progress', 'on_hold'])
      .not('assigned_to', 'is', null)
      .limit(500),
  ]);

  type WORow = {
    id: string;
    status: string;
    priority: string | null;
    estimated_hours: number | null;
    assigned_to: string;
    profiles: { full_name?: string } | null;
  };

  type TechnicianRow = {
    id: string;
    full_name: string | null;
    email: string | null;
    departments: { name?: string } | Array<{ name?: string }> | null;
  };

  const woRows = (woRes.data ?? []) as WORow[];

  const workloadMap = new Map<string, {
    name: string;
    email: string | null;
    departmentName: string | null;
    openAssignments: number;
    inProgress: number;
    overdueTasks: number;
    criticalTasks: number;
    estimatedHours: number;
  }>();

  if (!techniciansRes.error) {
    for (const tech of (techniciansRes.data ?? []) as TechnicianRow[]) {
      const dept = Array.isArray(tech.departments)
        ? tech.departments[0]?.name ?? null
        : tech.departments?.name ?? null;
      workloadMap.set(tech.id, {
        name: tech.full_name ?? 'Unnamed Technician',
        email: tech.email,
        departmentName: dept,
        openAssignments: 0,
        inProgress: 0,
        overdueTasks: 0,
        criticalTasks: 0,
        estimatedHours: 0,
      });
    }
  }

  for (const wo of woRows) {
    const profileId = wo.assigned_to;
    const name = wo.profiles?.full_name ?? 'Unknown Technician';

    if (!workloadMap.has(profileId)) {
      workloadMap.set(profileId, {
        name,
        email: null,
        departmentName: null,
        openAssignments: 0,
        inProgress: 0,
        overdueTasks: 0,
        criticalTasks: 0,
        estimatedHours: 0,
      });
    }

    const entry = workloadMap.get(profileId)!;
    entry.openAssignments++;
    if (wo.status === 'in_progress') entry.inProgress++;
    if (wo.priority === 'high' || wo.priority === 'critical') entry.overdueTasks++;
    if (wo.priority === 'critical') entry.criticalTasks++;
    if (wo.estimated_hours) entry.estimatedHours += wo.estimated_hours;
  }

  const items: TechnicianWorkloadItem[] = Array.from(workloadMap.entries()).map(([profileId, data]) => ({
    profileId,
    name: data.name,
    email: data.email,
    departmentName: data.departmentName,
    openAssignments: data.openAssignments,
    inProgress: data.inProgress,
    overdueTasks: data.overdueTasks,
    criticalTasks: data.criticalTasks,
    estimatedHours: data.estimatedHours,
    status: classifyWorkloadStatus({
      openAssignments: data.openAssignments,
      criticalTasks: data.criticalTasks,
    }),
  }));

  return items.sort((a, b) => b.openAssignments - a.openAssignments);
}
