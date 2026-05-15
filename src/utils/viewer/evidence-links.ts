// Read-only evidence link helpers for the Viewer role.
//
// Viewer must never see Create/Edit/Approve/Assign/Schedule/Receive/Issue/etc.
// actions. Use these helpers to produce links that always open a read-only
// detail or evidence route — never a creation or mutation endpoint.
//
// Each helper documents:
//   - the route it produces
//   - whether the destination is operational (read-only for viewer due to RBAC
//     in the layout) or a dedicated evidence panel

export function viewerEquipmentDetail(assetId: string): string {
  return `/equipment/${assetId}`;
}

export function viewerWorkOrderEvidence(workOrderId: string): string {
  return `/maintenance/work-orders/${workOrderId}`;
}

export function viewerMaintenanceRequestEvidence(requestId: string): string {
  return `/maintenance/requests/${requestId}`;
}

export function viewerPMScheduleEvidence(scheduleId: string): string {
  return `/pm/schedules/${scheduleId}`;
}

export function viewerReplacementEvidence(assetId: string): string {
  return `/command/drilldown/replacement/${assetId}`;
}

export function viewerProcurementEvidence(procurementId: string): string {
  return `/command/drilldown/procurement/${procurementId}`;
}

export function viewerReport(reportType: string): string {
  return `/reports/${reportType}`;
}

export function viewerDepartmentBreakdown(reportType: string, departmentId?: string | null): string {
  const base = `/reports/${reportType}`;
  return departmentId ? `${base}?department=${encodeURIComponent(departmentId)}` : base;
}
