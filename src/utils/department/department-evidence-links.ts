// Department-role link helpers. All targets are read-only evidence routes
// (asset profile, request detail, work-order detail) or department-scoped
// report routes. Mutation flows that the department can initiate (maintenance
// request, calibration request, training request) are produced with
// source=department-portal so the receiving page can prefill correctly.

export function deptEquipmentDetail(assetId: string): string {
  return `/equipment/${assetId}`;
}

export function deptMaintenanceRequestDetail(requestId: string): string {
  return `/maintenance/requests/${requestId}`;
}

export function deptWorkOrderEvidence(workOrderId: string): string {
  return `/maintenance/work-orders/${workOrderId}`;
}

export function deptRequestDetail(type: string, id: string): string {
  return `/requests/${type}/${id}`;
}

export function deptCreateMaintenanceRequest(assetId?: string | null): string {
  const params = new URLSearchParams({ source: 'department-portal' });
  if (assetId) params.set('assetId', assetId);
  return `/maintenance/requests/new?${params.toString()}`;
}

export function deptCreateCalibrationRequest(assetId?: string | null): string {
  const params = new URLSearchParams({ source: 'department-portal' });
  if (assetId) params.set('assetId', assetId);
  // Calibration creation routes go through the calibration module when present.
  return `/calibration?${params.toString()}&action=new-request`;
}

export function deptCreateTrainingRequest(assetId?: string | null): string {
  const params = new URLSearchParams({ source: 'department-portal' });
  if (assetId) params.set('assetId', assetId);
  return `/training?${params.toString()}&action=new-request`;
}

export function deptReport(reportType: string, departmentId: string): string {
  const params = new URLSearchParams({ department: departmentId });
  return `/reports/${reportType}?${params.toString()}`;
}
