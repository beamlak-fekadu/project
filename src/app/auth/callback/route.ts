import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeReturnPath } from '@/lib/auth/return-to';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeReturnPath(searchParams.get('returnTo'))
    ?? safeReturnPath(searchParams.get('next'))
    ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  const loginUrl = new URL('/login', origin);
  loginUrl.searchParams.set('error', 'auth_callback_error');
  if (next !== '/') loginUrl.searchParams.set('returnTo', next);
  return NextResponse.redirect(loginUrl);
}
