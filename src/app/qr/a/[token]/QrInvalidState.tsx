import Link from 'next/link';
import { AlertOctagon, ShieldOff, SearchX } from 'lucide-react';
import LogoMark from '@/components/brand/LogoMark';
import NetworkStatusPill from '@/components/offline/NetworkStatusPill';
import { Button } from '@/components/ui';
import { APP_NAME_SHORT } from '@/constants';

type Variant = 'invalid' | 'not_found' | 'revoked';

type Props = {
  variant: Variant;
  authenticated: boolean;
};

const COPY: Record<Variant, { title: string; body: string; icon: typeof AlertOctagon }> = {
  invalid: {
    title: 'Invalid QR code',
    body:
      'This QR label does not look like a valid BMERMS equipment tag. The code may be damaged or copied from another system.',
    icon: AlertOctagon,
  },
  not_found: {
    title: 'QR label not recognised',
    body:
      'This QR code is not associated with any active equipment record. It may belong to a retired asset, or the label may need to be regenerated.',
    icon: SearchX,
  },
  revoked: {
    title: 'QR label revoked',
    body:
      'This QR label has been revoked. Please contact Biomedical Engineering for a new label before continuing service work on this asset.',
    icon: ShieldOff,
  },
};

export default function QrInvalidState({ variant, authenticated }: Props) {
  const { title, body, icon: Icon } = COPY[variant];
  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-8 text-[var(--foreground)]">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <LogoMark size={56} />
        <p className="mt-4 text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-[var(--text-muted)]">
          {APP_NAME_SHORT}
        </p>
        <div className="mt-4">
          <NetworkStatusPill />
        </div>

        <div className="mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/10 text-rose-300">
          <Icon className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">{body}</p>

        <div className="mt-8 flex w-full flex-col gap-2">
          {authenticated ? (
            <Link href="/equipment">
              <Button variant="outline" className="w-full">Open Equipment</Button>
            </Link>
          ) : (
            <Link href="/login">
              <Button variant="outline" className="w-full">Log in to BMERMS</Button>
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
