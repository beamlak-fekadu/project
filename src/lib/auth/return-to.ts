const RETURN_TO_STORAGE_KEY = 'bmedis.auth.returnTo';

export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  try {
    const parsed = new URL(value, 'http://bmedis.local');
    if (parsed.origin !== 'http://bmedis.local') return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function buildCurrentReturnPath(pathname: string, search = ''): string {
  const candidate = `${pathname}${search}`;
  return safeReturnPath(candidate) ?? '/';
}

export function buildLoginHref(returnTo: string | null | undefined): string {
  const safe = safeReturnPath(returnTo);
  if (!safe) return '/login';
  return `/login?returnTo=${encodeURIComponent(safe)}`;
}

export function storeReturnPath(value: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  const safe = safeReturnPath(value);
  if (!safe) return;
  try {
    window.sessionStorage.setItem(RETURN_TO_STORAGE_KEY, safe);
  } catch {
    // Browser storage can be disabled; returnTo query remains authoritative.
  }
}

export function consumeStoredReturnPath(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = safeReturnPath(window.sessionStorage.getItem(RETURN_TO_STORAGE_KEY));
    window.sessionStorage.removeItem(RETURN_TO_STORAGE_KEY);
    return value;
  } catch {
    return null;
  }
}
