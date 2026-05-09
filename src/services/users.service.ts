import { createClient } from '@/lib/supabase/client';
import type { Profile, UserRole } from '@/types/database';
import { logAuditEvent } from './audit.service';

const PROFILE_SELECT = `
  id, user_id, full_name, email, phone, department_id,
  avatar_url, job_title, is_active, created_at, updated_at,
  departments(id, name, code),
  user_roles(id, role_id, assigned_at, roles(id, name, description, permissions))
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

export async function getActiveTechnicians() {
  const supabase = createClient();
  return supabase
    .from('profiles')
    .select(`
      id, user_id, full_name, email, phone, department_id,
      avatar_url, job_title, is_active, created_at, updated_at,
      departments(id, name, code),
      user_roles!inner(id, role_id, assigned_at, roles!inner(id, name, description, permissions))
    `)
    .eq('is_active', true)
    .eq('user_roles.roles.name', 'technician')
    .order('full_name', { ascending: true });
}

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
