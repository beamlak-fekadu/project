import { createClient } from '@/lib/supabase/client';
import type { Profile, UserRole } from '@/types/domain';
import { logAuditEvent } from './audit.service';

// PostgREST ambiguity guard: user_roles has TWO FKs to profiles
// (user_id, assigned_by) and audit_logs/pm_schedules/notifications also have
// multiple FKs to profiles. Without `!user_roles_user_id_fkey` PostgREST
// raises PGRST201 ("Could not embed because more than one relationship was
// found"), the entire select silently fails, and the calling page renders
// zero rows. Keep the explicit FK hint on every user_roles embed against
// profiles in this service AND across the rest of the codebase.
const PROFILE_SELECT = `
  id, user_id, full_name, email, phone, department_id,
  avatar_url, job_title, is_active, created_at, updated_at,
  departments(id, name, code),
  user_roles!user_roles_user_id_fkey(id, role_id, assigned_at, roles(id, name, description, permissions))
`;

const PROFILE_SIMPLE_SELECT = `
  id, user_id, full_name, email, phone, department_id,
  avatar_url, job_title, is_active, created_at, updated_at
`;

export async function getProfiles() {
  const supabase = createClient();
  return supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('is_active', true)
    .order('full_name', { ascending: true });
}

export async function getAllProfiles() {
  const supabase = createClient();
  return supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .order('full_name', { ascending: true });
}

// Canonical fetcher for the "assignable technician" dropdown across maintenance
// work orders, PM schedules, calibration scheduling, and training assignment.
//
// Inclusion rules:
//   - role IN ('technician', 'bme_head') — BME Head may take work directly.
//   - is_active = true.
//   - profile.user_id may be NULL: profile-only staff are still assignable.
//     They simply can't log in until linked to an auth.users row via
//     supabase/seed/99_link_auth_users.sql.
//
// Exclusion rules:
//   - 'developer' is intentionally excluded — developer is a thesis/debug
//     identity, not an operational technician.
//
// RLS caveat: this query embeds user_roles → roles via !inner joins. If RLS
// on `user_roles` or `roles` blocks SELECT for the calling user, the dropdown
// will silently return an empty list. See documents/rbac-rls-audit.sql
// section 1 to verify SELECT policies on those tables.
//
// Empty-state contract: callers should render
// "No assignable technicians found. Check Settings → Staff & Access."
// when the result is empty, so the message is consistent everywhere.
export async function getActiveTechnicians() {
  const supabase = createClient();
  return supabase
    .from('profiles')
    .select(`
      id, user_id, full_name, email, phone, department_id, job_title,
      avatar_url, is_active, created_at, updated_at,
      departments(id, name, code),
      user_roles!user_roles_user_id_fkey!inner(id, role_id, assigned_at, roles!inner(id, name, description, permissions))
    `)
    .eq('is_active', true)
    .in('user_roles.roles.name', ['technician', 'bme_head'])
    .order('full_name', { ascending: true });
}

/** Canonical empty-state copy for assignment dropdowns. */
export const ASSIGNABLE_TECHNICIANS_EMPTY_STATE =
  'No assignable technicians found. Check Settings → Staff & Access.';

export async function getProfileById(id: string) {
  const supabase = createClient();
  return supabase
    .from('profiles')
    .select(PROFILE_SELECT)
    .eq('id', id)
    .single();
}

export async function updateProfile(id: string, data: Partial<Omit<Profile, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'department' | 'roles'>>) {
  const supabase = createClient();
  const oldProfile = await supabase.from('profiles').select(PROFILE_SIMPLE_SELECT).eq('id', id).single();
  const result = await supabase
    .from('profiles')
    .update(data)
    .eq('id', id)
    .select(PROFILE_SIMPLE_SELECT)
    .single();

  if (!result.error) {
    await logAuditEvent({
      action: 'profile.update',
      entityType: 'profiles',
      entityId: id,
      oldValues: (oldProfile.data as Record<string, unknown> | null) ?? null,
      newValues: (result.data as Record<string, unknown> | null) ?? null,
    });
  }

  return result;
}

export async function getRoles() {
  const supabase = createClient();
  return supabase
    .from('roles')
    .select('id, name, description, permissions, created_at, updated_at')
    .order('name', { ascending: true });
}

export async function assignRole(userId: string, roleId: string) {
  const supabase = createClient();
  const result = await supabase
    .from('user_roles')
    .insert({ user_id: userId, role_id: roleId } as Omit<UserRole, 'id' | 'assigned_at' | 'assigned_by'>)
    .select('id, user_id, role_id, assigned_at')
    .single();

  if (!result.error) {
    await logAuditEvent({
      action: 'user_role.assign',
      entityType: 'user_roles',
      entityId: (result.data as Record<string, unknown> | null)?.id as string | null,
      newValues: (result.data as Record<string, unknown> | null) ?? null,
    });
  }

  return result;
}

export async function removeRole(userId: string, roleId: string) {
  const supabase = createClient();
  const oldRole = await supabase
    .from('user_roles')
    .select('id, user_id, role_id, assigned_at')
    .eq('user_id', userId)
    .eq('role_id', roleId)
    .maybeSingle();
  const result = await supabase
    .from('user_roles')
    .delete()
    .eq('user_id', userId)
    .eq('role_id', roleId);

  if (!result.error) {
    await logAuditEvent({
      action: 'user_role.remove',
      entityType: 'user_roles',
      entityId: (oldRole.data as Record<string, unknown> | null)?.id as string | null,
      oldValues: (oldRole.data as Record<string, unknown> | null) ?? { user_id: userId, role_id: roleId },
    });
  }

  return result;
}
