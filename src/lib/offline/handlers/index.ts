import type { OfflineActionType } from '@/types/offline';
import type { OfflineActionHandler } from '../sync-engine';
import { maintenanceOfflineHandlers } from './maintenance';
import { departmentRequestOfflineHandlers } from './department-requests';
import { storeOfflineHandlers } from './store';

export const offlineActionHandlers: Partial<Record<OfflineActionType, OfflineActionHandler>> = {
  ...maintenanceOfflineHandlers,
  ...departmentRequestOfflineHandlers,
  ...storeOfflineHandlers,
} as Partial<Record<OfflineActionType, OfflineActionHandler>>;
