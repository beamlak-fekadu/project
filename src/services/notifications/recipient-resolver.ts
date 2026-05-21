// Recipient resolution for the notification engine.
//
// Pulls active profiles by role through profiles + user_roles + roles. We do
// not assume seeded profiles have user_id set; the only requirements for a
// recipient are is_active = true and a matching role.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecipientProfile } from '@/types/notifications';

type DbClient = SupabaseClient;

export const NOTIFICATION_RECIPIENT_IDENTITY_CONTRACT = {
  recipientProfileId: 'profiles.id',
  roleAssignment: 'user_roles.user_id = profiles.id',
  telegramConnection: 'telegram_connections.profile_id = profiles.id',
} as const;

interface ProfileRolesRow {
  id: string;
  full_name: string | null;
  email: string | null;
  department_id: string | null;
  is_active: boolean | null;
  user_roles: Array<{ roles: { name: string } | null } | null> | null;
}

function toRecipient(row: ProfileRolesRow): RecipientProfile | null {
  if (!row || row.is_active === false) return null;
  const roleNames = (row.user_roles ?? [])
    .map((ur) => ur?.roles?.name ?? null)
    .filter((n): n is string => !!n);
  if (roleNames.length === 0) return null;
  const rolePriority = [
    'developer',
    'admin',
    'bme_head',
    'technician',
    'department_head',
    'store_user',
    'department_user',
    'viewer',
  ];
  const primaryRole = rolePriority.find((r) => roleNames.includes(r)) || roleNames[0];
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    department_id: row.department_id,
    primaryRole,
    roleNames,
  };
}

async function fetchProfilesByRoleName(
  client: DbClient,
  roleName: string,
  filter?: { departmentId?: string | null },
): Promise<RecipientProfile[]> {
  let query = client
    .from('profiles')
    .select(
      // PostgREST FK hint: user_roles has two FKs to profiles (user_id,
      // assigned_by). Without the hint, PGRST201 silently zeros every
      // recipient lookup and notifications never reach any role.
      'id, full_name, email, department_id, is_active, user_roles!user_roles_user_id_fkey!inner(roles!inner(name))',
    )
    .eq('is_active', true)
    .eq('user_roles.roles.name', roleName);
  if (filter?.departmentId) {
    query = query.eq('department_id', filter.departmentId);
  }
  const { data, error } = (await query) as {
    data: ProfileRolesRow[] | null;
    error: unknown;
  };
  if (error || !data) return [];
  return data
    .map((row) => toRecipient(row))
    .filter((p): p is RecipientProfile => !!p);
}

export async function getActiveProfilesByRole(
  client: DbClient,
  roleName: string,
): Promise<RecipientProfile[]> {
  return fetchProfilesByRoleName(client, roleName);
}

export async function getDevelopers(client: DbClient): Promise<RecipientProfile[]> {
  return fetchProfilesByRoleName(client, 'developer');
}

export async function getBmeHeads(client: DbClient): Promise<RecipientProfile[]> {
  return fetchProfilesByRoleName(client, 'bme_head');
}

export async function getAdmins(client: DbClient): Promise<RecipientProfile[]> {
  return fetchProfilesByRoleName(client, 'admin');
}

export async function getStoreUsers(client: DbClient): Promise<RecipientProfile[]> {
  return fetchProfilesByRoleName(client, 'store_user');
}

export async function getViewers(client: DbClient): Promise<RecipientProfile[]> {
  return fetchProfilesByRoleName(client, 'viewer');
}

export async function getDepartmentHeads(
  client: DbClient,
  departmentId: string,
): Promise<RecipientProfile[]> {
  if (!departmentId) return [];
  return fetchProfilesByRoleName(client, 'department_head', { departmentId });
}

export async function getDepartmentUsers(
  client: DbClient,
  departmentId: string,
): Promise<RecipientProfile[]> {
  if (!departmentId) return [];
  return fetchProfilesByRoleName(client, 'department_user', { departmentId });
}

export async function getTechniciansAll(
  client: DbClient,
): Promise<RecipientProfile[]> {
  return fetchProfilesByRoleName(client, 'technician');
}

export async function getProfileById(
  client: DbClient,
  profileId: string,
): Promise<RecipientProfile | null> {
  if (!profileId) return null;
  const { data, error } = (await client
    .from('profiles')
    .select(
      // PostgREST FK hint: user_roles has two FKs to profiles (user_id,
      // assigned_by). Without the hint, PGRST201 silently zeros every
      // recipient lookup and notifications never reach any role.
      'id, full_name, email, department_id, is_active, user_roles!user_roles_user_id_fkey!inner(roles!inner(name))',
    )
    .eq('id', profileId)
    .maybeSingle()) as { data: ProfileRolesRow | null; error: unknown };
  if (error || !data) return null;
  return toRecipient(data);
}

export async function getAssetDepartmentId(
  client: DbClient,
  assetId: string,
): Promise<string | null> {
  if (!assetId) return null;
  const { data } = (await client
    .from('equipment_assets')
    .select('department_id')
    .eq('id', assetId)
    .maybeSingle()) as { data: { department_id: string | null } | null };
  return data?.department_id ?? null;
}

export async function getLeadershipRecipients(
  client: DbClient,
): Promise<RecipientProfile[]> {
  const [heads, admins] = await Promise.all([
    getBmeHeads(client),
    getAdmins(client),
  ]);
  return dedupeRecipients([...heads, ...admins]);
}

export function dedupeRecipients(rows: RecipientProfile[]): RecipientProfile[] {
  const seen = new Set<string>();
  const out: RecipientProfile[] = [];
  for (const r of rows) {
    if (!r?.id) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
