import {
  OFFLINE_ACTION_DEFINITIONS,
  type OfflineActionCategory,
  type OfflineActionType,
} from '@/types/offline';
import type { RoleName } from '@/types/roles';

export type OfflineRolePermission = {
  canInspectDiagnostics: boolean;
  canManageLocalQueue: boolean;
  futureAllowedActions: OfflineActionType[];
  notes: string;
};

const ROLE_OFFLINE_PERMISSIONS: Record<RoleName, OfflineRolePermission> = {
  developer: {
    canInspectDiagnostics: true,
    canManageLocalQueue: true,
    futureAllowedActions: [],
    notes: 'May inspect diagnostics and manage the local queue. Test queue actions stay disabled unless explicitly built for development.',
  },
  admin: {
    canInspectDiagnostics: true,
    canManageLocalQueue: true,
    futureAllowedActions: ['qr_note.create'],
    notes: 'May review cached data and draft notes. Final approvals remain online-only.',
  },
  bme_head: {
    canInspectDiagnostics: true,
    canManageLocalQueue: true,
    futureAllowedActions: ['qr_note.create'],
    notes: 'May review cached data and draft notes. Major approvals are not allowed offline.',
  },
  technician: {
    canInspectDiagnostics: false,
    canManageLocalQueue: false,
    futureAllowedActions: [
      'maintenance_event.log',
      'qr_note.create',
      'maintenance_request.create',
      'work_order.start_intent',
      'work_order.complete_draft',
    ],
    notes: 'Future offline work focuses on additive maintenance evidence and start intent, not final closure.',
  },
  department_head: {
    canInspectDiagnostics: false,
    canManageLocalQueue: false,
    futureAllowedActions: [
      'maintenance_request.create',
      'calibration_request.create',
      'training_request.create',
      'department_issue.report',
    ],
    notes: 'Future offline work is limited to department-scoped requests and issue reporting.',
  },
  department_user: {
    canInspectDiagnostics: false,
    canManageLocalQueue: false,
    futureAllowedActions: [
      'maintenance_request.create',
      'calibration_request.create',
      'training_request.create',
      'department_issue.report',
    ],
    notes: 'Future offline work is request-focused and department-scoped.',
  },
  store_user: {
    canInspectDiagnostics: false,
    canManageLocalQueue: false,
    futureAllowedActions: [
      'store_reorder.create',
      'stock_receipt.draft',
      'stock_issue.draft',
    ],
    notes: 'Future offline stock work is draft/review-first; final stock balance changes require online validation.',
  },
  viewer: {
    canInspectDiagnostics: false,
    canManageLocalQueue: false,
    futureAllowedActions: [],
    notes: 'Viewer remains read-only. Cached read views may be introduced in a later phase.',
  },
};

export const ONLINE_ONLY_OFFLINE_ACTIONS = Object.values(OFFLINE_ACTION_DEFINITIONS)
  .filter((definition) => definition.category === 'online_only')
  .map((definition) => definition.actionType);

export function getOfflineActionCategory(actionType: OfflineActionType): OfflineActionCategory {
  return OFFLINE_ACTION_DEFINITIONS[actionType].category;
}

export function getOfflinePermissionsForRole(roleName: RoleName): OfflineRolePermission {
  return ROLE_OFFLINE_PERMISSIONS[roleName];
}

export function getOfflinePermissionsForRoles(roleNames: string[] | null | undefined): OfflineRolePermission {
  const roles = (roleNames ?? []) as RoleName[];
  if (roles.includes('developer')) return ROLE_OFFLINE_PERMISSIONS.developer;
  if (roles.includes('admin')) return ROLE_OFFLINE_PERMISSIONS.admin;
  if (roles.includes('bme_head')) return ROLE_OFFLINE_PERMISSIONS.bme_head;

  const role = roles.find((candidate): candidate is RoleName => candidate in ROLE_OFFLINE_PERMISSIONS);
  return role ? ROLE_OFFLINE_PERMISSIONS[role] : ROLE_OFFLINE_PERMISSIONS.viewer;
}

export function canQueueOfflineAction(roleNames: string[] | null | undefined, actionType: OfflineActionType) {
  const definition = OFFLINE_ACTION_DEFINITIONS[actionType];
  if (!definition || definition.category === 'online_only') return false;
  const permissions = getOfflinePermissionsForRoles(roleNames);
  return permissions.futureAllowedActions.includes(actionType);
}

export function canManageOfflineQueue(roleNames: string[] | null | undefined) {
  return getOfflinePermissionsForRoles(roleNames).canManageLocalQueue;
}
