import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Redirect deprecated routes to their new canonical destinations.
const DEPRECATED_REDIRECTS: Array<{ from: string; to: string; exact?: boolean; search?: string }> = [
  // Notifications replaces /alerts as the user-facing inbox. Internal alert
  // flags still feed the notification engine, but the page is consolidated.
  { from: '/alerts', to: '/notifications' },
  { from: '/decision-support', to: '/command' },
  { from: '/decision-support-health', to: '/developer-lab', exact: true },
  { from: '/command/health', to: '/developer-lab', exact: true },
  { from: '/helpdesk', to: '/requests', exact: true },
  { from: '/users', to: '/settings', exact: true, search: '?tab=staff-access' },
  { from: '/security', to: '/settings', exact: true, search: '?tab=security-access' },
  { from: '/dashboard/analytical', to: '/command', exact: true },
  { from: '/dashboard/work-orders', to: '/work-orders', exact: true },
  { from: '/dashboard', to: '/command', exact: true },
  { from: '/analytics/reliability', to: '/command', exact: true },
  { from: '/analytics/risk', to: '/command', exact: true },
  { from: '/analytics/pmc', to: '/pm', exact: true },
  { from: '/analytics/performance', to: '/command', exact: true },
  { from: '/analytics', to: '/command', exact: true },
];

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function withProtocol(value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function getCanonicalQrBaseUrl(): URL | null {
  const candidates = [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXT_PUBLIC_SITE_URL];
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      return new URL(trimTrailingSlash(withProtocol(candidate.trim())));
    } catch {
      continue;
    }
  }
  return null;
}

function isLocalRequest(request: NextRequest): boolean {
  const host = request.nextUrl.hostname.toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function canonicalQrRedirect(request: NextRequest): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith('/qr/a/')) return null;
  if (isLocalRequest(request)) return null;

  const canonical = getCanonicalQrBaseUrl();
  if (!canonical) return null;
  if (request.nextUrl.origin.toLowerCase() === canonical.origin.toLowerCase()) return null;

  const url = request.nextUrl.clone();
  url.protocol = canonical.protocol;
  url.host = canonical.host;
  url.pathname = request.nextUrl.pathname;
  url.search = request.nextUrl.search;
  return NextResponse.redirect(url, { status: 308 });
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.NODE_ENV !== 'production' && pathname.startsWith('/copilot-smoke')) {
    return NextResponse.next();
  }

  const qrRedirect = canonicalQrRedirect(request);
  if (qrRedirect) return qrRedirect;

  for (const rule of DEPRECATED_REDIRECTS) {
    const matches = rule.exact ? pathname === rule.from : pathname.startsWith(rule.from);
    if (matches) {
      const url = request.nextUrl.clone();
      url.pathname = rule.to;
      if (rule.search) url.search = rule.search;
      return NextResponse.redirect(url, { status: 301 });
    }
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
