type Action = string | null | undefined;

function withAction(path: string, action?: Action): string {
  if (!action) return path;
  const qs = new URLSearchParams({ action });
  return `${path}?${qs.toString()}`;
}

function withParams(path: string, params: Record<string, string | number | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') qs.set(key, String(value));
  }
  const query = qs.toString();
  return query ? `${path}?${query}` : path;
}

export function workOrderDetail(workOrderId: string, action?: Action): string {
  return withAction(`/maintenance/work-orders/${workOrderId}`, action);
}

export function maintenanceRequestDetail(requestId: string): string {
  return `/maintenance/requests/${requestId}`;
}

export function createMaintenanceRequestFromAsset(
  assetId: string,
  context: {
    departmentId?: string | null;
    urgency?: string | null;
    description?: string | null;
    type?: string | null;
  } = {},
): string {
  return withParams('/maintenance/requests/new', {
    assetId,
    departmentId: context.departmentId,
    urgency: context.urgency ?? 'high',
    type: context.type ?? 'corrective',
    description: context.description,
    source: 'command-center',
  });
}

export function pmDetail(pmId: string, action?: Action): string {
  return withAction(`/pm/schedules/${pmId}`, action);
}

export function calibrationDetail(calibrationId: string, action?: Action): string {
  return withParams('/calibration', {
    calibrationId,
    action,
    source: 'command-center',
  });
}

export function stockProcurementPrefill(
  partId: string,
  context: {
    partName?: string | null;
    currentStock?: number | null;
    reorderLevel?: number | null;
    suggestedQuantity?: number | null;
    reason?: string | null;
    workOrderId?: string | null;
    assetId?: string | null;
  } = {},
): string {
  return withParams('/procurement/requests/new', {
    partId,
    sparePartId: partId,
    itemName: context.partName,
    currentStock: context.currentStock,
    reorderLevel: context.reorderLevel,
    suggestedQuantity: context.suggestedQuantity,
    reason: context.reason,
    workOrderId: context.workOrderId,
    assetId: context.assetId,
    source: 'command-center',
  });
}

export function stockIssuePrefill(
  partId: string,
  context: { workOrderId: string; assetId?: string | null },
): string {
  return withParams('/spare-parts', {
    partId,
    workOrderId: context.workOrderId,
    assetId: context.assetId,
    action: 'issue',
    source: 'command-center',
  });
}

export function procurementDetail(requestId: string, action?: Action): string {
  return withAction(`/command/drilldown/procurement/${requestId}`, action);
}

export function installationDetail(installationId: string, action?: Action): string {
  return withParams('/installation', {
    installationId,
    action,
    source: 'command-center',
  });
}

export function replacementEvidence(assetId: string): string {
  return `/command/drilldown/replacement/${assetId}`;
}

export function replacementReportPrefill(
  assetId: string,
  context: { reason?: string | null; rank?: number | null; rpi?: number | null } = {},
): string {
  return withParams('/reports/replacement', {
    assetId,
    source: 'command-center',
    reason: context.reason,
    rank: context.rank,
    rpi: context.rpi,
  });
}

export function equipmentDetail(assetId: string): string {
  return `/equipment/${assetId}`;
}
