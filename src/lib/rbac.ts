// Central role-based access-control (RBAC) capability matrix for BMERMS.
//
// This module is the **single source of truth** for what each role can do.
// Sidebar visibility, page-level guards, server-action checks, and Developer
// Lab role-demo validation should all derive from `CAPABILITY_MATRIX` or one
// of its helpers — never from ad-hoc inline role string checks.
//
// Strategy summary (Prompt 7):
//   - Developer is the full reference standard; it can do everything.
//   - BME Head is the operational reference standard: Developer minus
//     Developer Lab / debug / sandbox tools.
//   - Other roles get progressively narrower capability sets.
//   - Database/RLS still independently enforces these; UI hiding is the
//     friendly layer, not the security layer.

import type { RoleName } from '@/types/roles';

export type Capability =
  // Navigation visibility
  | 'nav.developer_lab'
  | 'nav.command'
  | 'nav.calendar'
  | 'nav.equipment'
  | 'nav.maintenance'
  | 'nav.requests'
  | 'nav.pm'
  | 'nav.calibration'
  | 'nav.work_orders'
  | 'nav.spare_parts'
  | 'nav.logistics'
  | 'nav.procurement'
  | 'nav.training'
  | 'nav.replacement'
  | 'nav.disposal'
  | 'nav.alerts'
  | 'nav.reports'
  | 'nav.settings'
  | 'nav.audit'
  | 'nav.compliance'
  // Equipment + assets
  | 'equipment.create'
  | 'equipment.edit'
  | 'equipment.delete'
  // Maintenance + work orders
  | 'maintenance.request.create'
  | 'maintenance.request.approve'
  | 'work_order.create'
  | 'work_order.assign'
  | 'work_order.start'
  | 'work_order.complete'
  | 'work_order.add_event'
  // Preventive maintenance
  | 'pm.plan.create'
  | 'pm.assign'
  | 'pm.complete'
  // Calibration
  | 'calibration.request.create'
  | 'calibration.request.approve'
  | 'calibration.schedule'
  | 'calibration.record_result'
  // Spare parts / stock / procurement
  | 'spare_parts.manage'
  | 'stock.receive'
  | 'stock.issue'
  | 'procurement.request'
  | 'procurement.status_update'
  // Training
  | 'training.request.create'
  | 'training.schedule'
  | 'training.record_attendance'
  // Disposal
  | 'disposal.request.create'
  | 'disposal.approve'
  | 'disposal.record'
  // Alerts
  | 'alerts.acknowledge'
  // Reports
  | 'reports.view'
  | 'reports.export'
  // Administration / governance
  | 'users.manage'
  | 'roles.manage'
  | 'audit.view'
  // Developer-only
  | 'developer.diagnostics'
  | 'developer.refresh_snapshots'
  | 'developer.sandbox'
  | 'developer.demo_reset';

type Matrix = Record<RoleName, Set<Capability>>;

function caps(...c: Capability[]): Set<Capability> {
  return new Set(c);
}

// Developer = every capability (it's the reference standard).
const DEVELOPER_CAPS: Capability[] = [
  'nav.developer_lab', 'nav.command', 'nav.calendar', 'nav.equipment', 'nav.maintenance', 'nav.requests',
  'nav.pm', 'nav.calibration', 'nav.work_orders', 'nav.spare_parts', 'nav.logistics', 'nav.procurement',
  'nav.training', 'nav.replacement', 'nav.disposal', 'nav.alerts', 'nav.reports', 'nav.settings', 'nav.audit',
  'nav.compliance',
  'equipment.create', 'equipment.edit', 'equipment.delete',
  'maintenance.request.create', 'maintenance.request.approve',
  'work_order.create', 'work_order.assign', 'work_order.start', 'work_order.complete', 'work_order.add_event',
  'pm.plan.create', 'pm.assign', 'pm.complete',
  'calibration.request.create', 'calibration.request.approve', 'calibration.schedule', 'calibration.record_result',
  'spare_parts.manage', 'stock.receive', 'stock.issue', 'procurement.request', 'procurement.status_update',
  'training.request.create', 'training.schedule', 'training.record_attendance',
  'disposal.request.create', 'disposal.approve', 'disposal.record',
  'alerts.acknowledge', 'reports.view', 'reports.export',
  'users.manage', 'roles.manage', 'audit.view',
  'developer.diagnostics', 'developer.refresh_snapshots', 'developer.sandbox', 'developer.demo_reset',
];

// BME Head = Developer minus developer-only tools and minus Developer Lab nav.
const BME_HEAD_CAPS: Capability[] = DEVELOPER_CAPS.filter((c) =>
  !c.startsWith('developer.') && c !== 'nav.developer_lab'
);

export const CAPABILITY_MATRIX: Matrix = {
  developer: caps(...DEVELOPER_CAPS),

  // Legacy 'admin' kept for backward compatibility with seed/02. Treat it as
  // BME Head plus user/role management — same surface, no developer-only.
  admin: caps(...BME_HEAD_CAPS),

  bme_head: caps(...BME_HEAD_CAPS),

  technician: caps(
    'nav.command', 'nav.calendar', 'nav.equipment', 'nav.maintenance', 'nav.requests',
    'nav.pm', 'nav.calibration', 'nav.work_orders', 'nav.spare_parts', 'nav.training', 'nav.alerts', 'nav.reports',
    'maintenance.request.create',
    'work_order.start', 'work_order.complete', 'work_order.add_event',
    'pm.complete',
    'calibration.request.create', 'calibration.record_result',
    'procurement.request',
    'training.request.create',
    'alerts.acknowledge', 'reports.view',
  ),

  // Store User = Store / Logistics Operations Console. Read-only outside of
  // store/logistics workflows. Can create reorder/procurement requests for
  // stock needs, receive delivered items, and issue approved items. Cannot
  // approve procurement, assign technicians, or run maintenance execution.
  // Note: nav.maintenance is granted so /maintenance can render as
  // "Maintenance Blockers" — a strictly read-only blocker view for store.
  store_user: caps(
    'nav.command', 'nav.calendar', 'nav.spare_parts', 'nav.logistics',
    'nav.procurement', 'nav.maintenance', 'nav.alerts', 'nav.reports',
    'spare_parts.manage', 'stock.receive', 'stock.issue',
    'procurement.request',
    'reports.view',
  ),

  // Department Head / User = Department Equipment & Service Readiness Portal.
  // Both roles use the same set of navigation routes (the page renders a
  // different tailored view per role). Pages are department-scoped at the
  // server level — no all-hospital fallback.
  department_head: caps(
    'nav.command', 'nav.calendar', 'nav.equipment', 'nav.maintenance', 'nav.requests',
    'nav.compliance', 'nav.alerts', 'nav.reports',
    'maintenance.request.create',
    'calibration.request.create',
    'training.request.create',
    'disposal.request.create',
    'reports.view',
  ),

  department_user: caps(
    'nav.command', 'nav.calendar', 'nav.equipment', 'nav.maintenance', 'nav.requests',
    'nav.compliance', 'nav.alerts', 'nav.reports',
    'maintenance.request.create',
    'calibration.request.create',
    'training.request.create',
    'disposal.request.create',
    'reports.view',
  ),

  // Viewer = Executive Oversight Portal. Read-only management view with
  // intentionally limited navigation. See utils/viewer/* for the dashboards
  // computed from real data, and src/app/(dashboard)/compliance for the
  // viewer-first compliance overview.
  viewer: caps(
    'nav.command', 'nav.calendar', 'nav.equipment', 'nav.maintenance',
    'nav.compliance', 'nav.replacement', 'nav.alerts', 'nav.reports',
    'reports.view',
  ),
};

// ─── Public helpers ────────────────────────────────────────────────────────

export function hasCapability(roleNames: readonly string[], capability: Capability): boolean {
  if (roleNames.includes('developer')) return true;
  return roleNames.some((role) => {
    const set = CAPABILITY_MATRIX[role as RoleName];
    return set?.has(capability) ?? false;
  });
}

export function hasAnyCapability(roleNames: readonly string[], capabilities: Capability[]): boolean {
  return capabilities.some((c) => hasCapability(roleNames, c));
}

// Returns the canonical capability list for a given role name. Useful for the
// Developer Lab role-demo validation card.
export function capabilitiesFor(role: RoleName): Capability[] {
  return Array.from(CAPABILITY_MATRIX[role] ?? new Set());
}
