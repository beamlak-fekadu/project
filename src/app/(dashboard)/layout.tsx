'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageLoader } from '@/components/ui/Spinner';
import { ToastProvider } from '@/components/ui/Toast';
import { AssistantProvider } from '@/components/assistant/AssistantProvider';
import { SyncEngineProvider } from '@/components/offline/SyncEngineProvider';
import { NAV_SECTIONS } from '@/constants';
import { buildLoginHref, buildCurrentReturnPath, storeReturnPath } from '@/lib/auth/return-to';
import type { RoleName } from '@/types/roles';

const EXTRA_ROUTE_RULES: Array<{ prefix: string; roles: RoleName[] }> = [
  { prefix: '/developer-lab', roles: ['developer'] },
  { prefix: '/command/health', roles: ['developer'] },
  { prefix: '/users', roles: ['developer', 'admin', 'bme_head'] },
  { prefix: '/settings', roles: ['developer', 'admin', 'bme_head'] },
  { prefix: '/security', roles: ['developer', 'admin', 'bme_head'] },
  { prefix: '/audit', roles: ['developer', 'admin', 'bme_head'] },
  { prefix: '/equipment/new', roles: ['developer', 'admin', 'bme_head', 'technician'] },
  // Store user can open asset detail as read-only evidence from blocker /
  // usage-linkage pages.
  { prefix: '/equipment/', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
  { prefix: '/inventory/new', roles: ['developer', 'admin', 'bme_head', 'technician'] },
  { prefix: '/inventory/', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
  { prefix: '/maintenance/work-orders/new', roles: ['developer', 'admin', 'bme_head', 'technician'] },
  // Viewer can open work-order and maintenance-request detail records as
  // read-only evidence from the Viewer Maintenance Overview and Notification Center.
  // Store user can open work-order detail as evidence from blocker rows.
  { prefix: '/maintenance/work-orders/', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'viewer', 'store_user'] },
  { prefix: '/maintenance/requests/new', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user'] },
  { prefix: '/maintenance/requests/', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'viewer'] },
  { prefix: '/pm/plans/new', roles: ['developer', 'admin', 'bme_head', 'technician'] },
  { prefix: '/pm/plans/', roles: ['developer', 'admin', 'bme_head', 'technician', 'viewer'] },
  { prefix: '/pm/schedules/', roles: ['developer', 'admin', 'bme_head', 'technician', 'viewer'] },
  // Viewer drilldowns into evidence (procurement, replacement) — read-only.
  { prefix: '/command/drilldown/', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
  // Compliance Overview is hidden from BME Head; BME Head uses the dedicated
  // PM and Calibration pages as the operational evidence source.
  { prefix: '/compliance', roles: ['developer', 'admin', 'viewer', 'department_head', 'department_user'] },
  { prefix: '/requests', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
  { prefix: '/documents', roles: ['developer', 'admin', 'bme_head', 'technician'] },
  { prefix: '/installation', roles: ['developer', 'admin', 'bme_head', 'technician'] },
  // Notification Center — all logged-in roles can read their own inbox.
  { prefix: '/notifications', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
];

const NAV_ROUTE_RULES = NAV_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({
    prefix: item.href,
    roles: item.roles as unknown as RoleName[],
  }))
);

function routeMatches(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`);
}

function allowedRolesForPath(pathname: string): RoleName[] | null {
  if ((pathname.startsWith('/equipment/') || pathname.startsWith('/inventory/')) && pathname.endsWith('/edit')) {
    return ['developer', 'admin', 'bme_head', 'technician'];
  }

  const rules = [...EXTRA_ROUTE_RULES, ...NAV_ROUTE_RULES]
    .filter((rule) => rule.prefix !== '/')
    .sort((a, b) => b.prefix.length - a.prefix.length);
  return rules.find((rule) => routeMatches(pathname, rule.prefix))?.roles ?? null;
}

export default function DashboardRootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user, loading: authLoading, signOut } = useAuth();
  const { profile, loading: profileLoading, profileError } = useProfile(user?.id);
  const online = useOnlineStatus();

  const loading = authLoading || profileLoading;

  if (loading) return <PageLoader />;

  if (!user) {
    if (!online.isOnline) {
      return (
        <div className="grid min-h-screen place-items-center bg-[var(--background)] px-4 text-[var(--foreground)]">
          <div className="max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-6 text-center">
            <p className="text-lg font-semibold">Online login required.</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
              This device has no previously verified BMEDIS session. Connect to the internet and sign in once before using offline mode.
            </p>
          </div>
        </div>
      );
    }
    const search = searchParams.toString();
    const returnTo = buildCurrentReturnPath(pathname, search ? `?${search}` : '');
    storeReturnPath(returnTo);
    router.push(buildLoginHref(returnTo));
    return <PageLoader />;
  }

  if (!profile && !online.isOnline) {
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--background)] px-4 text-[var(--foreground)]">
        <div className="max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-6 text-center">
          <p className="text-lg font-semibold">Online login required.</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">
            This device has a browser session but no previously verified BMEDIS profile snapshot. Connect to the internet and sign in once before using offline mode.
          </p>
        </div>
      </div>
    );
  }

  // Profile is null while online — this means the auth user has no linked
  // profile or no role assigned. Show a clear error; never silently fall back
  // to viewer so a misconfigured account doesn't masquerade as a valid user.
  if (!profile && online.isOnline) {
    const message = profileError ??
      'Your account is authenticated but your profile could not be loaded. ' +
      'Please sign out and contact your system administrator.';
    return (
      <div className="grid min-h-screen place-items-center bg-[var(--background)] px-4 text-[var(--foreground)]">
        <div className="max-w-lg rounded-lg border border-amber-500/30 bg-amber-500/5 p-6 text-center">
          <p className="text-base font-semibold text-amber-400">Profile Setup Required</p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--text-muted)]">{message}</p>
          <p className="mt-4 text-xs text-[var(--text-muted)]">
            Signed in as: <span className="font-mono">{user.email}</span>
          </p>
          <button
            onClick={async () => {
              try {
                const supabase = (await import('@/lib/supabase/client')).createClient();
                await supabase.auth.signOut();
              } catch { /* best effort */ }
              router.push('/login');
            }}
            className="mt-5 rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    try {
      const cache = await import('@/lib/offline/cache');
      if (profile?.id && profile?.primaryRole) {
        await cache.clearOfflineReadCache({
          profileId: profile.id,
          roleName: profile.primaryRole,
          departmentId: profile.department_id ?? null,
        });
      }
      const session = await import('@/lib/offline/session-snapshot');
      session.clearOfflineSessionSnapshot(user.id);
    } catch {
      // best-effort cache clear; offline cache may not be initialized
    }
    await signOut();
    router.push('/login');
  };

  // profile is guaranteed non-null here — the guards above return early when
  // it is null. Using non-null assertion so TypeScript knows this too.
  const userRoles = profile!.roleNames;
  const isDeveloper = userRoles.includes('developer');
  const allowedRoles = allowedRolesForPath(pathname);
  const hasRouteAccess = isDeveloper || !allowedRoles || allowedRoles.some((role) => userRoles.includes(role));

  return (
    <ToastProvider>
      <SyncEngineProvider>
        <AssistantProvider>
          <DashboardLayout
            userName={profile!.full_name || user.email || 'User'}
            userRole={profile!.primaryRole}
            userJobTitle={profile!.job_title}
            userRoles={userRoles}
            offlineVerifiedAt={profile!.offlineVerifiedAt ?? null}
            onLogout={handleLogout}
          >
            {hasRouteAccess ? (
              children
            ) : (
              <div className="mx-auto max-w-xl rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-1)] p-6">
                <p className="text-lg font-semibold text-[var(--foreground)]">Access restricted</p>
                <p className="mt-2 text-sm text-[var(--text-muted)]">
                  Your current role does not have permission to open this module directly.
                </p>
              </div>
            )}
          </DashboardLayout>
        </AssistantProvider>
      </SyncEngineProvider>
    </ToastProvider>
  );
}
