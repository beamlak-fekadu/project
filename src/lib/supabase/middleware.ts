import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCurrentReturnPath, safeReturnPath } from '@/lib/auth/return-to';

// `/qr` is public so unauthenticated scans render the friendly login-required
// landing page (src/app/qr/a/[token]) instead of bouncing through /login.
// The route itself only reveals asset details after authentication +
// role/department checks; the unauthenticated branch shows no asset data.
const PUBLIC_PATHS = [
  '/login',
  '/reset-password',
  '/auth/callback',
  '/qr',
  '/offline',
  '/sw.js',
  '/manifest.webmanifest',
  '/offline-health.txt',
  '/api/telegram',
];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublicPath = PUBLIC_PATHS.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone();
    const returnTo = buildCurrentReturnPath(request.nextUrl.pathname, request.nextUrl.search);
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('returnTo', returnTo);
    return NextResponse.redirect(url);
  }

  if (user && (request.nextUrl.pathname === '/login' || request.nextUrl.pathname === '/reset-password')) {
    const url = request.nextUrl.clone();
    // If the user is already authenticated and hits /login with a safe
    // returnTo param (used by the QR scan flow), honour it instead of
    // always bouncing to /. Only single-leading-slash internal paths pass.
    const candidate = safeReturnPath(request.nextUrl.searchParams.get('returnTo'));
    if (candidate) {
      const destination = new URL(candidate, request.nextUrl.origin);
      url.pathname = destination.pathname;
      url.search = destination.search;
      url.hash = destination.hash;
    } else {
      url.pathname = '/';
      url.search = '';
    }
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
