export type OfflineWorkOrderActionType = 'update_status' | 'log_event';

export interface OfflineWorkOrderAction {
  id: string;
  type: OfflineWorkOrderActionType;
  workOrderId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  syncedAt?: string;
  retryCount?: number;
  lastError?: string;
}

const STORAGE_KEY = 'memis.offline.workorder.queue.v1';
let fallbackCounter = 0;

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getOfflineQueue(): OfflineWorkOrderAction[] {
  if (!canUseStorage()) return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as OfflineWorkOrderAction[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOfflineQueue(items: OfflineWorkOrderAction[]) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function createLegacyOfflineActionId() {
  if (globalThis.crypto?.randomUUID) return `off-${globalThis.crypto.randomUUID()}`;
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(12);
    globalThis.crypto.getRandomValues(bytes);
    return `off-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  fallbackCounter += 1;
  return `off-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

export function enqueueOfflineAction(action: Omit<OfflineWorkOrderAction, 'id' | 'createdAt'>) {
  const queue = getOfflineQueue();
  const next: OfflineWorkOrderAction = {
    id: createLegacyOfflineActionId(),
    createdAt: new Date().toISOString(),
    ...action,
  };
  queue.push(next);
  saveOfflineQueue(queue);
  return next;
}

export function removeOfflineAction(id: string) {
  const queue = getOfflineQueue().filter((item) => item.id !== id);
  saveOfflineQueue(queue);
}

export function markOfflineActionFailed(id: string, errorMessage: string) {
  const queue = getOfflineQueue().map((item) => {
    if (item.id !== id) return item;
    return {
      ...item,
      retryCount: (item.retryCount ?? 0) + 1,
      lastError: errorMessage,
    };
  });
  saveOfflineQueue(queue);
}
