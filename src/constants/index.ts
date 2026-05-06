export const APP_NAME = 'BMERMS';
export const APP_NAME_SHORT = 'BMERMS';
export const APP_NAME_FULL = 'Biomedical Engineering Resource Management System';
export const APP_DESCRIPTION = 'Biomedical Engineering Resource Management System';
export const APP_OPERATIONAL_TAGLINE = 'Clinical engineering operations, reliability, and decision support in one unified platform.';
export const HOSPITAL_NAME = 'Yekatit-12 Hospital Medical College';
export const CHATBOT_NAME = 'BMERMS AI Chatbot';
export const ASSISTANT_NAME = 'BMERMS AI Assistant';

export const ROUTES = {
  LOGIN: '/login',
  RESET_PASSWORD: '/reset-password',
  DASHBOARD: '/dashboard/analytical',
  DASHBOARD_ANALYTICAL: '/dashboard/analytical',
  DASHBOARD_WORK_ORDERS: '/dashboard/work-orders',
  DECISION_SUPPORT: '/decision-support',
  INVENTORY: '/inventory',
  EQUIPMENT: '/equipment',
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
  ANALYTICS: '/analytics',
  ANALYTICS_RELIABILITY: '/analytics/reliability',
  ANALYTICS_RISK: '/analytics/risk',
  ANALYTICS_PMC: '/analytics/pmc',
  ANALYTICS_PERFORMANCE: '/analytics/performance',
  REPLACEMENT: '/replacement',
  ALERTS: '/alerts',
  HELPDESK: '/helpdesk',
  SETTINGS: '/settings',
  USERS: '/users',
  SECURITY: '/security',
  DOCUMENTS: '/documents',
  INSTALLATION: '/installation',
  CHATBOT: '/chatbot',
} as const;

export const NAV_SECTIONS = [
  {
    title: 'Dashboard',
    items: [
      { label: 'Analytical Dashboard', href: ROUTES.DASHBOARD_ANALYTICAL, icon: 'LayoutDashboard', roles: ['admin', 'technician', 'department_user', 'store_user', 'viewer'] },
      { label: 'Work Order Dashboard', href: ROUTES.DASHBOARD_WORK_ORDERS, icon: 'ClipboardList', roles: ['admin', 'technician', 'department_user', 'viewer'] },
    ],
  },
  {
    title: 'Operations',
    items: [
      { label: 'Facility Equipment', href: ROUTES.EQUIPMENT, icon: 'Monitor', roles: ['admin', 'technician', 'department_user', 'store_user', 'viewer'] },
      { label: 'Requests', href: ROUTES.REQUESTS, icon: 'ClipboardList', roles: ['admin', 'technician', 'department_user'] },
      { label: 'Maintenance', href: ROUTES.MAINTENANCE, icon: 'Wrench', roles: ['admin', 'technician', 'department_user'] },
      { label: 'Preventive Maintenance', href: ROUTES.PM, icon: 'CalendarCheck', roles: ['admin', 'technician'] },
      { label: 'Calibration', href: ROUTES.CALIBRATION, icon: 'Gauge', roles: ['admin', 'technician'] },
      { label: 'Logistics', href: ROUTES.LOGISTICS, icon: 'Package', roles: ['admin', 'technician', 'store_user'] },
      { label: 'Procurement', href: ROUTES.PROCUREMENT, icon: 'PackageCheck', roles: ['admin', 'technician', 'store_user'] },
      { label: 'Spare Parts', href: ROUTES.SPARE_PARTS, icon: 'Package', roles: ['admin', 'technician', 'store_user'] },
      { label: 'Training', href: ROUTES.TRAINING, icon: 'GraduationCap', roles: ['admin', 'technician', 'department_user'] },
      { label: 'Helpdesk', href: ROUTES.HELPDESK, icon: 'Headphones', roles: ['admin', 'technician', 'department_user'] },
      { label: 'Alerts', href: ROUTES.ALERTS, icon: 'Bell', roles: ['admin', 'technician'] },
      { label: 'Disposal', href: ROUTES.DISPOSAL, icon: 'Trash2', roles: ['admin', 'technician'] },
    ],
  },
  {
    title: 'Decision Support',
    items: [
      { label: 'Decision Support Center', href: ROUTES.DECISION_SUPPORT, icon: 'BrainCircuit', roles: ['admin', 'technician', 'viewer'] },
      { label: 'Reliability Analytics', href: ROUTES.ANALYTICS_RELIABILITY, icon: 'Activity', roles: ['admin', 'technician', 'viewer'] },
      { label: 'Risk Scoring', href: ROUTES.ANALYTICS_RISK, icon: 'ShieldAlert', roles: ['admin', 'technician', 'viewer'] },
      { label: 'PM Compliance', href: ROUTES.ANALYTICS_PMC, icon: 'CheckCircle', roles: ['admin', 'technician', 'viewer'] },
      { label: 'Performance Scores', href: ROUTES.ANALYTICS_PERFORMANCE, icon: 'BarChart3', roles: ['admin', 'technician', 'viewer'] },
      { label: 'Replacement Priority', href: ROUTES.REPLACEMENT, icon: 'ArrowUpDown', roles: ['admin', 'technician', 'viewer'] },
      { label: 'AI Assistant', href: ROUTES.CHATBOT, icon: 'MessageSquareText', roles: ['admin', 'technician', 'department_user', 'store_user', 'viewer'] },
    ],
  },
  {
    title: 'Reports',
    items: [
      { label: 'Reports', href: ROUTES.REPORTS, icon: 'FileBarChart', roles: ['admin', 'technician', 'department_user', 'viewer'] },
    ],
  },
  {
    title: 'Administration',
    items: [
      { label: 'Security', href: ROUTES.SECURITY, icon: 'Shield', roles: ['admin'] },
      { label: 'Users & Roles', href: ROUTES.USERS, icon: 'Users', roles: ['admin'] },
      { label: 'Settings', href: ROUTES.SETTINGS, icon: 'Settings', roles: ['admin'] },
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
