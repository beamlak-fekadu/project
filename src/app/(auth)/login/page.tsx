'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { signIn } from '@/services/auth.service';
import { createClient } from '@/lib/supabase/client';
import { consumeStoredReturnPath, safeReturnPath } from '@/lib/auth/return-to';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import LogoMark from '@/components/brand/LogoMark';
import LoginPulseLayer from '@/components/auth/LoginPulseLayer';
import { APP_NAME_FULL, APP_NAME_SHORT, HOSPITAL_NAME } from '@/constants';
import { transitions } from '@/lib/ui/motion-presets';

const SIGN_IN_TAGLINE = 'Secure access to biomedical equipment analytics and operations.';

/**
 * Categorizes Supabase auth errors into user-readable messages.
 * Avoids leaking internal error strings in production.
 */
function friendlyAuthError(rawMessage: string): string {
  const m = rawMessage.toLowerCase();
  if (m.includes('invalid login credentials') || m.includes('invalid credentials')) {
    return 'Incorrect email or password. Please check your credentials and try again.';
  }
  if (m.includes('email not confirmed')) {
    return 'This account\'s email has not been confirmed. Contact your system administrator to activate this account.';
  }
  if (m.includes('too many requests') || m.includes('rate limit')) {
    return 'Too many login attempts. Please wait a minute and try again.';
  }
  if (m.includes('user not found') || m.includes('no user found')) {
    return 'No account found with this email address.';
  }
  if (m.includes('network') || m.includes('fetch')) {
    return 'Network error. Please check your connection and try again.';
  }
  return rawMessage;
}

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get('returnTo'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [staySignedIn, setStaySignedIn] = useState(true);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    // Sign out any existing session first so a shared-device scenario never
    // carries a previous user's cookies into the new login.
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {
      // Ignore — best effort; the signInWithPassword call below is authoritative.
    }

    const { error: authError } = await signIn(email, password);
    if (authError) {
      setError(friendlyAuthError(authError.message));
      setLoading(false);
      return;
    }
    const destination = returnTo ?? consumeStoredReturnPath() ?? '/';
    router.replace(destination);
    router.refresh();
  }

  return (
    <div className="flex flex-col">
      <LoginPulseLayer />
      <header className="mb-10 flex flex-col items-center text-center sm:mb-12">
        <div className="mb-6 flex items-center justify-center">
          <LogoMark size={72} />
        </div>

        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-[var(--foreground)]">{APP_NAME_SHORT}</p>
        <p className="mt-2 max-w-[18rem] text-[0.65rem] leading-relaxed text-[var(--text-muted)] sm:text-xs">{HOSPITAL_NAME}</p>
        <p className="mt-1.5 max-w-[20rem] text-[0.62rem] leading-snug text-[var(--text-muted)]/90 sm:text-[0.68rem]">{APP_NAME_FULL}</p>

        <h1 className="mt-9 text-base font-medium tracking-tight text-[var(--foreground)] sm:mt-10 sm:text-lg">Sign in to your account</h1>
        <p className="mt-2 max-w-sm text-xs leading-relaxed text-[var(--text-muted)] sm:text-[0.8125rem]">{SIGN_IN_TAGLINE}</p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-7 sm:space-y-8">
        <Input
          appearance="minimal"
          label="Email"
          labelClassName="!text-sky-700/95 dark:!text-sky-400/90"
          type="text"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@menelikii.gov.et"
          required
          autoComplete="email"
          autoFocus
        />
        <Input
          appearance="minimal"
          label="Password"
          labelClassName="!text-[var(--foreground)]"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          required
          autoComplete="current-password"
        />

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-0.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-muted)] select-none">
            <input
              type="checkbox"
              checked={staySignedIn}
              onChange={(e) => setStaySignedIn(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-[var(--border-subtle)] bg-transparent text-sky-600 focus:ring-2 focus:ring-sky-500/60 focus:ring-offset-0 dark:text-sky-500"
            />
            Stay signed in on this device
          </label>
          <Link
            href="/reset-password"
            className="text-xs text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
          >
            Forgot password?
          </Link>
        </div>

        <AnimatePresence>
          {error && (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={transitions.fast}
              className="rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2.5 text-sm text-red-200 dark:text-red-100"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
        <div className="pt-2">
          <Button
            type="submit"
            loading={loading}
            size="lg"
            className="w-full !rounded-full !bg-[#0ea5e9] !text-white text-sm font-semibold uppercase tracking-[0.12em] shadow-[0_12px_36px_-10px_rgb(14_165_233/0.5)] transition-[background-color,box-shadow] hover:!bg-[#0284c7] hover:shadow-[0_14px_40px_-10px_rgb(2_132_199/0.52)] focus-visible:!ring-sky-400 disabled:!bg-[var(--surface-3)] disabled:!text-[var(--foreground)] disabled:!shadow-none"
          >
            Log in
          </Button>
        </div>
      </form>
    </div>
  );
}
