export const APP_NAME = 'BMERMS';
export const APP_NAME_SHORT = 'BMERMS';
export const APP_NAME_FULL = 'Biomedical Engineering Resource Management System';
export const APP_DESCRIPTION = 'Biomedical Engineering Resource Management System';
export const APP_OPERATIONAL_TAGLINE = 'Clinical engineering operations, reliability, and decision support in one unified platform.';
export const HOSPITAL_NAME = 'Yekatit-12 Hospital Medical College';
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
  ALERTS: '/alerts',
  HELPDESK: '/helpdesk',
  DEVELOPER_LAB: '/developer-lab',
  SETTINGS: '/settings',
  USERS: '/users',
  SECURITY: '/security',
  AUDIT: '/audit',
  DOCUMENTS: '/documents',
  INSTALLATION: '/installation',
  CHATBOT: '/chatbot',
} as const;

export const NAV_SECTIONS = [
  {
    title: 'Command',
    items: [
      { label: 'Command Center', href: ROUTES.COMMAND, icon: 'LayoutDashboard', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
      { label: 'Hospital Calendar', href: ROUTES.CALENDAR, icon: 'CalendarDays', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
      { label: 'Developer Lab', href: ROUTES.DEVELOPER_LAB, icon: 'Activity', roles: ['developer', 'admin'] },
    ],
  },
  {
    title: 'Equipment',
    items: [
      { label: 'Equipment', href: ROUTES.EQUIPMENT, icon: 'Monitor', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
    ],
  },
  {
    title: 'Work',
    items: [
      { label: 'Maintenance', href: ROUTES.MAINTENANCE, icon: 'Wrench', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user'] },
      { label: 'Requests', href: ROUTES.REQUESTS, icon: 'ClipboardList', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
      { label: 'Preventive Maintenance', href: ROUTES.PM, icon: 'CalendarCheck', roles: ['developer', 'admin', 'bme_head', 'technician', 'viewer'] },
      { label: 'Calibration', href: ROUTES.CALIBRATION, icon: 'Gauge', roles: ['developer', 'admin', 'bme_head', 'technician'] },
      { label: 'Work Orders', href: ROUTES.WORK_ORDERS, icon: 'ClipboardList', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head'] },
    ],
  },
  {
    title: 'Inventory',
    items: [
      { label: 'Spare Parts', href: ROUTES.SPARE_PARTS, icon: 'Package', roles: ['developer', 'admin', 'bme_head', 'technician', 'store_user'] },
      { label: 'Logistics', href: ROUTES.LOGISTICS, icon: 'Boxes', roles: ['developer', 'admin', 'bme_head', 'technician', 'store_user'] },
      { label: 'Procurement', href: ROUTES.PROCUREMENT, icon: 'PackageCheck', roles: ['developer', 'admin', 'bme_head', 'technician', 'store_user'] },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'Training', href: ROUTES.TRAINING, icon: 'GraduationCap', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user'] },
    ],
  },
  {
    title: 'Lifecycle',
    items: [
      { label: 'Replacement Priority', href: ROUTES.REPLACEMENT, icon: 'ArrowUpDown', roles: ['developer', 'admin', 'bme_head', 'technician', 'viewer'] },
      { label: 'Disposal', href: ROUTES.DISPOSAL, icon: 'Trash2', roles: ['developer', 'admin', 'bme_head', 'technician'] },
    ],
  },
  {
    title: 'Support',
    items: [
      { label: 'Alerts', href: ROUTES.ALERTS, icon: 'Bell', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head'] },
      { label: CHATBOT_NAME, href: ROUTES.CHATBOT, icon: 'MessageSquareText', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'Reports', href: ROUTES.REPORTS, icon: 'FileBarChart', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Settings', href: ROUTES.SETTINGS, icon: 'Settings', roles: ['developer', 'admin', 'bme_head'] },
      { label: 'Audit Log', href: ROUTES.AUDIT, icon: 'FileText', roles: ['developer', 'admin', 'bme_head'] },
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
