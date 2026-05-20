import Link from 'next/link';
import { ShieldCheck, KeyRound } from 'lucide-react';
import LogoMark from '@/components/brand/LogoMark';
import NetworkStatusPill from '@/components/offline/NetworkStatusPill';
import { Button } from '@/components/ui';
import { APP_NAME_SHORT, HOSPITAL_NAME } from '@/constants';

type Props = {
  returnTo: string;
};

export default function QrLoginRequired({ returnTo }: Props) {
  // returnTo is sanitised by the caller before being passed here; we still
  // never embed asset details or scan metadata on the unauthenticated screen.
  const loginHref = `/login?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <main className="min-h-dvh bg-[var(--background)] px-4 py-8 text-[var(--foreground)]">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <LogoMark size={64} />
        <p className="mt-4 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">
          {APP_NAME_SHORT}
        </p>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{HOSPITAL_NAME}</p>
        <div className="mt-4">
          <NetworkStatusPill />
        </div>

        <h1 className="mt-8 text-2xl font-semibold tracking-tight">
          Equipment QR scanned
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">
          Please log in to view this equipment&apos;s service information. Access depends on
          your role.
        </p>

        <div className="mt-8 w-full">
          <Link href={loginHref}>
            <Button size="lg" className="w-full">
              <KeyRound className="h-4 w-4" />
              Log in to Continue
            </Button>
          </Link>
        </div>

        <div className="mt-6 flex items-start gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-3 text-xs text-[var(--text-muted)]">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            The QR identifies the asset only — it never grants access. Asset details are revealed
            after authentication and role check.
          </span>
        </div>

        <p className="mt-6 text-[10px] text-[var(--text-muted)]">
          Online QR landing page. Offline QR logging will be implemented in a later offline / PWA pass.
        </p>
      </div>
    </main>
  );
}
