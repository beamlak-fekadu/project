// Department-scope helpers.
//
// Every page and component used by department_head / department_user must
// derive its scope from `profile.department_id`. There is intentionally NO
// fallback to all-hospital data — if the department is missing, the UI must
// render an explicit error state instead of leaking other departments' rows.
//
// This file is the single source for the "missing department" message and
// the helper that detects whether a role list is department-only.

export const MISSING_DEPARTMENT_MESSAGE =
  'No department is linked to this profile. Please ask the BME Head or administrator to assign a department.';

export type DepartmentRoleType = 'department_head' | 'department_user';

export function isDepartmentRoleList(roles: readonly string[]): boolean {
  if (!roles.includes('department_head') && !roles.includes('department_user')) return false;
  return !roles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
}

export function detectDepartmentRoleType(roles: readonly string[]): DepartmentRoleType | null {
  if (!isDepartmentRoleList(roles)) return null;
  // Head takes precedence — most demos give the supervisor the head role.
  if (roles.includes('department_head')) return 'department_head';
  if (roles.includes('department_user')) return 'department_user';
  return null;
}
