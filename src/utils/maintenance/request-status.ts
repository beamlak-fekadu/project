// Canonical status constants for maintenance_requests.
// Used by server actions, service helpers, and UI to enforce the duplicate prevention rule.

export const OPEN_MAINTENANCE_REQUEST_STATUSES = ['pending', 'approved', 'assigned', 'in_progress'] as const;
export const CLOSED_MAINTENANCE_REQUEST_STATUSES = ['completed', 'rejected', 'canceled'] as const;
export const OPEN_WORK_ORDER_STATUSES = ['open', 'assigned', 'in_progress', 'on_hold'] as const;
export const CLOSED_WORK_ORDER_STATUSES = ['completed', 'canceled'] as const;

export type OpenMaintenanceRequestStatus = (typeof OPEN_MAINTENANCE_REQUEST_STATUSES)[number];
export type ClosedMaintenanceRequestStatus = (typeof CLOSED_MAINTENANCE_REQUEST_STATUSES)[number];
export type OpenWorkOrderStatus = (typeof OPEN_WORK_ORDER_STATUSES)[number];
export type ClosedWorkOrderStatus = (typeof CLOSED_WORK_ORDER_STATUSES)[number];

export function isOpenMaintenanceRequestStatus(status: string): status is OpenMaintenanceRequestStatus {
  return (OPEN_MAINTENANCE_REQUEST_STATUSES as readonly string[]).includes(status);
}

export function isClosedMaintenanceRequestStatus(status: string): status is ClosedMaintenanceRequestStatus {
  return (CLOSED_MAINTENANCE_REQUEST_STATUSES as readonly string[]).includes(status);
}

export function isOpenWorkOrderStatus(status: string): status is OpenWorkOrderStatus {
  return (OPEN_WORK_ORDER_STATUSES as readonly string[]).includes(status);
}

export function isClosedWorkOrderStatus(status: string): status is ClosedWorkOrderStatus {
  return (CLOSED_WORK_ORDER_STATUSES as readonly string[]).includes(status);
}

// Label for display in duplicate warning messages
export function formatRequestStatus(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Pending',
    approved: 'Approved',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    completed: 'Completed',
    rejected: 'Rejected',
    canceled: 'Canceled',
  };
  return labels[status] ?? status;
}
