export const APP_NAME = 'BMERMS';
export const APP_NAME_SHORT = 'BMERMS';
export const APP_NAME_FULL = 'Biomedical Engineering Resource Management System';
export const APP_DESCRIPTION = 'Biomedical Engineering Resource Management System';
export const APP_OPERATIONAL_TAGLINE = 'Clinical engineering operations, reliability, and decision support in one unified platform.';
export const HOSPITAL_NAME = 'Menelik II Hospital';
export const CHATBOT_NAME = 'BMERMS AI Chatbot';
export const ASSISTANT_NAME = 'BMERMS AI Assistant';

export { ROLE_CONFIG } from './roles';

export const ROUTES = {
  LOGIN: '/login',
  RESET_PASSWORD: '/reset-password',
  COMMAND: '/command',
  CALENDAR: '/calendar',
  // DEPRECATED — kept as redirect targets in middleware. DASHBOARD now points to /command
  // so any code that uses ROUTES.DASHBOARD as the post-login default keeps working.
  DASHBOARD: '/command',
  DASHBOARD_ANALYTICAL: '/dashboard/analytical',
  DASHBOARD_WORK_ORDERS: '/dashboard/work-orders',
  DECISION_SUPPORT: '/decision-support',
  ANALYTICS: '/analytics',
  ANALYTICS_RELIABILITY: '/analytics/reliability',
  ANALYTICS_RISK: '/analytics/risk',
  ANALYTICS_PMC: '/analytics/pmc',
  ANALYTICS_PERFORMANCE: '/analytics/performance',
  // Active routes
  INVENTORY: '/inventory',
  EQUIPMENT: '/equipment',
  EQUIPMENT_NEW: '/equipment/new',
  INVENTORY_NEW: '/inventory/new',
  MAINTENANCE: '/maintenance',
  WORK_ORDERS: '/work-orders',
  REQUESTS: '/requests',
  MAINTENANCE_REQUESTS: '/maintenance/requests',
  MAINTENANCE_WORK_ORDERS: '/maintenance/work-orders',
  PM: '/pm',
  PM_PLANS: '/pm/plans',
  PM_SCHEDULES: '/pm/schedules',
  CALIBRATION: '/calibration',
  SPARE_PARTS: '/spare-parts',
  LOGISTICS: '/logistics',
  PROCUREMENT: '/procurement',
  TRAINING: '/training',
  DISPOSAL: '/disposal',
  REPORTS: '/reports',
  REPLACEMENT: '/replacement',
  COMPLIANCE: '/compliance',
  ALERTS: '/alerts',
  HELPDESK: '/helpdesk',
  DEVELOPER_LAB: '/developer-lab',
  OFFLINE_SYNC: '/offline-sync',
  SETTINGS: '/settings',
  USERS: '/users',
  SECURITY: '/security',
  AUDIT: '/audit',
  DOCUMENTS: '/documents',
  INSTALLATION: '/installation',
  CHATBOT: '/chatbot',
} as const;

// Sidebar nav structure. Each item now declares a `capability` (consumed by
// src/lib/rbac.ts CAPABILITY_MATRIX); the legacy `roles` array is retained for
// non-rbac consumers and as a backstop when no capability is declared.
export const NAV_SECTIONS = [
  {
    title: 'Command',
    items: [
      { label: 'Command Center', href: ROUTES.COMMAND, icon: 'LayoutDashboard', capability: 'nav.command', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
      { label: 'Hospital Calendar', href: ROUTES.CALENDAR, icon: 'CalendarDays', capability: 'nav.calendar', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
      // Developer Lab is intentionally developer-only via the
      // `nav.developer_lab` capability; CAPABILITY_MATRIX grants it only to
      // the `developer` role. The route guard in (dashboard)/layout.tsx is the
      // server-side enforcement.
      { label: 'Developer Lab', href: ROUTES.DEVELOPER_LAB, icon: 'Activity', capability: 'nav.developer_lab', roles: ['developer'] },
    ],
  },
  {
    title: 'Equipment',
    items: [
      // Store User does not get a top-level Equipment entry; they still reach
      // asset detail through evidence links inside the Store pages.
      { label: 'Equipment', href: ROUTES.EQUIPMENT, icon: 'Monitor', capability: 'nav.equipment', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'viewer'] },
    ],
  },
  {
    title: 'Work',
    items: [
      // Maintenance is included for store_user — renders as Maintenance
      // Blockers (read-only) when the role is store_user. See
      // src/app/(dashboard)/maintenance/_components/StoreMaintenanceBlockers.tsx.
      { label: 'Maintenance', href: ROUTES.MAINTENANCE, icon: 'Wrench', capability: 'nav.maintenance', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'viewer', 'store_user'] },
      { label: 'Requests', href: ROUTES.REQUESTS, icon: 'ClipboardList', capability: 'nav.requests', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user'] },
      { label: 'Preventive Maintenance', href: ROUTES.PM, icon: 'CalendarCheck', capability: 'nav.pm', roles: ['developer', 'admin', 'bme_head', 'technician'] },
      { label: 'Calibration', href: ROUTES.CALIBRATION, icon: 'Gauge', capability: 'nav.calibration', roles: ['developer', 'admin', 'bme_head', 'technician'] },
      // Department Head historically had work-orders nav access but should
      // now use the department-scoped Work Status under /maintenance. Keep
      // operational Work Orders for BME/technician only.
      { label: 'Work Orders', href: ROUTES.WORK_ORDERS, icon: 'ClipboardList', capability: 'nav.work_orders', roles: ['developer', 'admin', 'bme_head', 'technician'] },
      // Viewer + department roles see the Compliance Overview. For viewer
      // it is the executive read-only view; for department roles the page
      // renders the department-scoped DepartmentComplianceStatus.
      { label: 'Compliance Overview', href: ROUTES.COMPLIANCE, icon: 'CheckCircle2', capability: 'nav.compliance', roles: ['viewer', 'department_head', 'department_user'] },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Spare Parts', href: ROUTES.SPARE_PARTS, icon: 'Package', capability: 'nav.spare_parts', roles: ['developer', 'admin', 'bme_head', 'technician', 'store_user'] },
      { label: 'Logistics', href: ROUTES.LOGISTICS, icon: 'Boxes', capability: 'nav.logistics', roles: ['developer', 'admin', 'bme_head', 'technician', 'store_user'] },
      { label: 'Procurement', href: ROUTES.PROCUREMENT, icon: 'PackageCheck', capability: 'nav.procurement', roles: ['developer', 'admin', 'bme_head', 'technician', 'store_user'] },
    ],
  },
  {
    title: 'People',
    items: [
      // Department roles request training through Requests Hub; the operational
      // Training page is BME/admin-only.
      { label: 'Training', href: ROUTES.TRAINING, icon: 'GraduationCap', capability: 'nav.training', roles: ['developer', 'admin', 'bme_head', 'technician'] },
    ],
  },
  {
    title: 'Lifecycle',
    items: [
      { label: 'Replacement Priority', href: ROUTES.REPLACEMENT, icon: 'ArrowUpDown', capability: 'nav.replacement', roles: ['developer', 'admin', 'bme_head', 'technician', 'viewer'] },
      { label: 'Disposal', href: ROUTES.DISPOSAL, icon: 'Trash2', capability: 'nav.disposal', roles: ['developer', 'admin', 'bme_head', 'technician'] },
    ],
  },
  {
    title: 'Support',
    items: [
      { label: 'Alerts', href: ROUTES.ALERTS, icon: 'Bell', capability: 'nav.alerts', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'viewer', 'store_user'] },
      // BMERMS AI Chatbot has no dedicated capability; keep roles-based.
      { label: CHATBOT_NAME, href: ROUTES.CHATBOT, icon: 'MessageSquareText', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'Reports', href: ROUTES.REPORTS, icon: 'FileBarChart', capability: 'nav.reports', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Settings', href: ROUTES.SETTINGS, icon: 'Settings', capability: 'nav.settings', roles: ['developer', 'admin', 'bme_head'] },
      { label: 'Audit Log', href: ROUTES.AUDIT, icon: 'FileText', capability: 'nav.audit', roles: ['developer', 'admin', 'bme_head'] },
      { label: 'Sync Review Center', href: ROUTES.OFFLINE_SYNC, icon: 'RefreshCw', capability: 'nav.offline_sync', roles: ['developer', 'admin', 'bme_head'] },
    ],
  },
] as const;

export const CONDITION_COLORS: Record<string, string> = {
  functional: '#10B981',
  needs_repair: '#F59E0B',
  non_functional: '#EF4444',
  under_maintenance: '#6366F1',
  decommissioned: '#6B7280',
};

export const URGENCY_COLORS: Record<string, string> = {
  low: '#10B981',
  medium: '#F59E0B',
  high: '#F97316',
  critical: '#EF4444',
};
