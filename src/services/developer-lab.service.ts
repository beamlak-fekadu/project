import type { createClient } from '@/lib/supabase/server';
import {
  EXPECTED_DEMO_USERS,
  validateDemoRoleMappings,
  type DemoRoleValidationInput,
  type DemoRoleValidationResult,
} from '@/utils/developer-lab/demo-role-validation';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface RpcDemoRoleRow {
  email: string;
  auth_user_id: string | null;
  profile_id: string | null;
  profile_user_id: string | null;
  full_name: string | null;
  job_title: string | null;
  department_name: string | null;
  assigned_roles: string[] | null;
  primary_reason: string | null;
  reasons: string[] | null;
}

function normalizeRpcDemoRow(row: RpcDemoRoleRow): DemoRoleValidationInput {
  return {
    email: row.email,
    authUserId: row.auth_user_id,
    profileId: row.profile_id,
    profileUserId: row.profile_user_id,
    fullName: row.full_name,
    jobTitle: row.job_title,
    departmentName: row.department_name,
    assignedRoles: row.assigned_roles ?? [],
  };
}

export async function getDemoRoleIntegrityDiagnostics(supabase: SupabaseServerClient): Promise<{
  rows: DemoRoleValidationResult[];
  source: 'validate_demo_role_integrity_rpc' | 'profiles_fallback';
  warning: string | null;
}> {
  const rpc = await (supabase.rpc as never as (fn: string) => Promise<{ data: RpcDemoRoleRow[] | null; error: { message: string } | null }>)(
    'validate_demo_role_integrity',
  );

  if (!rpc.error && rpc.data) {
    return {
      rows: validateDemoRoleMappings(rpc.data.map(normalizeRpcDemoRow)),
      source: 'validate_demo_role_integrity_rpc',
      warning: null,
    };
  }

  const emails = EXPECTED_DEMO_USERS.map((user) => user.email);
  const { data } = await supabase
    .from('profiles')
    // PostgREST FK hint: user_roles has two FKs to profiles (user_id,
    // assigned_by). Without it, demo-role validation silently returns 0 rows.
    .select('id, email, full_name, job_title, user_id, departments(name), user_roles!user_roles_user_id_fkey(id, roles(name))')
    .in('email', emails);

  const fallbackRows = ((data ?? []) as Array<Record<string, unknown>>).map((row): DemoRoleValidationInput => {
    const roles = ((row.user_roles as Array<{ roles?: { name?: string } | Array<{ name?: string }> | null }> | null) ?? [])
      .flatMap((ur) => {
        if (!ur.roles) return [];
        if (Array.isArray(ur.roles)) return ur.roles.map((role) => role.name).filter(Boolean);
        return [ur.roles.name].filter(Boolean);
      }) as string[];
    const department = Array.isArray(row.departments)
      ? row.departments[0]
      : row.departments as { name?: string | null } | null;

    return {
      email: String(row.email),
      authUserId: null,
      profileId: String(row.id),
      profileUserId: (row.user_id as string | null) ?? null,
      fullName: (row.full_name as string | null) ?? null,
      jobTitle: (row.job_title as string | null) ?? null,
      departmentName: department?.name ?? null,
      assignedRoles: roles,
    };
  });

  return {
    rows: validateDemoRoleMappings(fallbackRows),
    source: 'profiles_fallback',
    warning: `Auth user diagnostics unavailable: ${rpc.error?.message ?? 'validate_demo_role_integrity RPC returned no data'}. Apply migration 00058 before evaluating auth.users linkage.`,
  };
}

async function latestTimestamp(
  query: PromiseLike<{ data: Record<string, unknown> | null; error: { message: string } | null }>,
  columns: string[],
) {
  const { data, error } = await query;
  if (error || !data) return null;
  for (const column of columns) {
    const value = data[column];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

export async function getScoreSnapshotTimestamps(supabase: SupabaseServerClient): Promise<Record<string, string | null>> {
  const [
    risk,
    replacement,
    health,
    readiness,
    pm,
    reliability,
  ] = await Promise.all([
    latestTimestamp(
      supabase
        .from('equipment_risk_scores')
        .select('computed_at, assessed_at')
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle() as never,
      ['computed_at', 'assessed_at'],
    ),
    latestTimestamp(
      supabase
        .from('replacement_priority_scores')
        .select('computed_at')
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle() as never,
      ['computed_at'],
    ),
    latestTimestamp(
      supabase
        .from('equipment_health_snapshots')
        .select('created_at, snapshot_date')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle() as never,
      ['created_at', 'snapshot_date'],
    ),
    latestTimestamp(
      supabase
        .from('clinical_readiness_snapshots')
        .select('created_at, snapshot_date')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle() as never,
      ['created_at', 'snapshot_date'],
    ),
    latestTimestamp(
      supabase
        .from('pm_compliance_metrics')
        .select('computed_at')
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle() as never,
      ['computed_at'],
    ),
    latestTimestamp(
      supabase
        .from('equipment_reliability_metrics')
        .select('computed_at')
        .order('computed_at', { ascending: false })
        .limit(1)
        .maybeSingle() as never,
      ['computed_at'],
    ),
  ]);

  return {
    rpn_fmea: risk,
    replacement_priority: replacement,
    equipment_health: health,
    department_clinical_readiness: readiness,
    pm_compliance: pm,
    availability: reliability,
    mtbf: reliability,
    mttr: reliability,
  };
}

export async function getNotificationRoleDependencyDiagnostics(supabase: SupabaseServerClient): Promise<{
  roleRecipientCounts: Array<{ role: string; count: number; telegramConnected: number }>;
  telegramConnectionsWithMissingProfile: number | null;
  warnings: string[];
}> {
  const expectedRoles = Array.from(new Set(EXPECTED_DEMO_USERS.map((user) => user.expectedRole)));

  // R14: count Telegram connections per role by joining telegram_connections
  // → profiles → user_roles → roles. A role with N profiles but 0 telegram
  // connections is functional in-app but won't get any Telegram delivery —
  // exactly the kind of silent gap R14 was filed to surface.
  const roleRecipientCounts = await Promise.all(expectedRoles.map(async (role) => {
    const [profilesRes, telegramRes] = await Promise.all([
      supabase
        .from('profiles')
        // PostgREST FK hint: user_roles has two FKs to profiles (user_id,
        // assigned_by). Without it PGRST201 silently zeros every count.
        .select('id, user_roles!user_roles_user_id_fkey!inner(roles!inner(name))', { count: 'exact', head: true })
        .eq('is_active', true)
        .eq('user_roles.roles.name', role),
      supabase
        .from('telegram_connections')
        .select('id, profiles!inner(id, is_active, user_roles!user_roles_user_id_fkey!inner(roles!inner(name)))', { count: 'exact', head: true })
        .eq('profiles.is_active', true)
        .eq('profiles.user_roles.roles.name', role),
    ]);
    return {
      role,
      count: profilesRes.error ? 0 : profilesRes.count ?? 0,
      telegramConnected: telegramRes.error ? 0 : telegramRes.count ?? 0,
    };
  }));

  let telegramConnectionsWithMissingProfile: number | null = null;
  const orphanRes = await supabase
    .from('telegram_connections')
    .select('id, profile_id, profiles(id)')
    .limit(1000);
  if (!orphanRes.error) {
    telegramConnectionsWithMissingProfile = ((orphanRes.data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => {
        const profile = row.profiles;
        if (Array.isArray(profile)) return profile.length === 0;
        return !profile;
      }).length;
  }

  const warnings: string[] = [];
  for (const row of roleRecipientCounts) {
    if (row.count === 0) warnings.push(`Notification recipient resolver found zero active profiles for role ${row.role}.`);
    if (row.count > 0 && row.telegramConnected === 0) {
      // R14: explicit silent-gap warning. A role that has active profiles
      // but zero Telegram connections will get in-app notifications but
      // never any Telegram delivery — operationally fine, but the gap
      // should be visible to whoever is reviewing pre-validation readiness.
      warnings.push(`Role ${row.role} has ${row.count} active profile(s) but zero Telegram connection(s). Telegram-eligible notifications for this role will skip with no_chat_id.`);
    }
  }
  if (telegramConnectionsWithMissingProfile && telegramConnectionsWithMissingProfile > 0) {
    warnings.push(`${telegramConnectionsWithMissingProfile} Telegram connection(s) point to a missing profile.`);
  }
  if (telegramConnectionsWithMissingProfile === null) {
    warnings.push('Telegram connection diagnostics unavailable; table may be missing in this environment.');
  }

  return { roleRecipientCounts, telegramConnectionsWithMissingProfile, warnings };
}
