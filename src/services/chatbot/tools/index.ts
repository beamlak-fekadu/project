/**
 * Server-side BMERMS copilot retrieval tools (Supabase-backed, no vectors for structured data).
 */
export { getCurrentUserContext } from './get-current-user-context';
export { getMyTasks } from './get-my-tasks';
export { getEquipmentSummary } from './get-equipment-summary';
export { getWorkOrderSummary } from './get-work-order-summary';
export { getDepartmentReadiness } from './get-department-readiness';
export { getAlertsSummary } from './get-alerts-summary';
export { getInventoryLogisticsStatus } from './get-inventory-logistics-status';
export { getProcurementStatus } from './get-procurement-status';
export { getSafeTroubleshootingContext } from './get-safe-troubleshooting-context';
export {
  loadTaskBlocks,
  loadRiskAndAnalytics,
  loadLogistics,
  loadDecisionSupportSnapshot,
  isAdmin,
  usesBroadWorkOrderPool,
} from './task-data-loaders';
