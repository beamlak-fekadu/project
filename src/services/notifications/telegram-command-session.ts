// Ephemeral in-memory bot command session — cleared by /reset only.
// Does NOT touch persistent notification, connection, or profile data.

export interface TelegramCommandSession {
  lastCommand: string;
  lastCommandAt: string;
  helpShownAt?: string;
}

const sessions = new Map<string, TelegramCommandSession>();

export function getTelegramCommandSession(chatId: string): TelegramCommandSession | null {
  return sessions.get(chatId) ?? null;
}

export function touchTelegramCommandSession(
  chatId: string,
  command: string,
  options?: { helpShown?: boolean },
): TelegramCommandSession {
  const now = new Date().toISOString();
  const existing = sessions.get(chatId);
  const next: TelegramCommandSession = {
    lastCommand: command,
    lastCommandAt: now,
    helpShownAt: options?.helpShown ? now : existing?.helpShownAt,
  };
  sessions.set(chatId, next);
  return next;
}

export function clearTelegramCommandSession(chatId: string): boolean {
  return Reflect.apply(Map.prototype.delete, sessions, [chatId]) as boolean;
}

/** Test-only: reset all in-memory sessions. */
export function _clearAllTelegramCommandSessionsForTests(): void {
  sessions.clear();
}
