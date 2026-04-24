export function getMyTasks(shared: { assignedWorkOrders: Record<string, unknown>[]; overduePm: Record<string, unknown>[] }) {
  return {
    assignedWorkOrders: shared.assignedWorkOrders,
    openWorkOrderCount: shared.assignedWorkOrders.length,
    overduePmHighlights: shared.overduePm.slice(0, 5),
  };
}
