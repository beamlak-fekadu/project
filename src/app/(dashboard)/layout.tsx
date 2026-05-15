'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth';
import { useProfile } from '@/hooks/useProfile';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { PageLoader } from '@/components/ui/Spinner';
import { ToastProvider } from '@/components/ui/Toast';
import { AssistantProvider } from '@/components/assistant/AssistantProvider';
import { NAV_SECTIONS } from '@/constants';
import type { RoleName } from '@/types/roles';

const EXTRA_ROUTE_RULES: Array<{ prefix: string; roles: RoleName[] }> = [
  { prefix: '/developer-lab', roles: ['developer'] },
  { prefix: '/command/health', roles: ['developer'] },
  { prefix: '/users', roles: ['developer', 'admin', 'bme_head'] },
  { prefix: '/settings', roles: ['developer', 'admin', 'bme_head'] },
  { prefix: '/security', roles: ['developer', 'admin', 'bme_head'] },
  { prefix: '/audit', roles: ['developer', 'admin', 'bme_head'] },
  { prefix: '/equipment/new', roles: ['developer', 'admin', 'bme_head', 'technician'] },
  { prefix: '/equipment/', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
  { prefix: '/inventory/new', roles: ['developer', 'admin', 'bme_head', 'technician'] },
  { prefix: '/inventory/', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
  { prefix: '/maintenance/work-orders/new', roles: ['developer', 'admin', 'bme_head', 'technician'] },
  { prefix: '/maintenance/work-orders/', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head'] },
  { prefix: '/maintenance/requests/new', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user'] },
  { prefix: '/maintenance/requests/', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user'] },
  { prefix: '/pm/plans/new', roles: ['developer', 'admin', 'bme_head', 'technician'] },
  { prefix: '/pm/plans/', roles: ['developer', 'admin', 'bme_head', 'technician', 'viewer'] },
  { prefix: '/pm/schedules/', roles: ['developer', 'admin', 'bme_head', 'technician', 'viewer'] },
  { prefix: '/requests', roles: ['developer', 'admin', 'bme_head', 'technician', 'department_head', 'department_user', 'store_user', 'viewer'] },
  { prefix: '/documents', roles: ['developer', 'admin', 'bme_head', 'technician'] },
  { prefix: '/installation', roles: ['developer', 'admin', 'bme_head', 'technician'] },
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
  const { user, loading: authLoading, signOut } = useAuth();
  const { profile, loading: profileLoading } = useProfile(user?.id);

  const loading = authLoading || profileLoading;

  if (loading) return <PageLoader />;

  if (!user) {
    router.push('/login');
    return <PageLoader />;
  }

  const handleLogout = async () => {
    await signOut();
    router.push('/login');
  };

  const userRoles = profile?.roleNames || ['viewer'];
  const isDeveloper = userRoles.includes('developer');
  const allowedRoles = allowedRolesForPath(pathname);
  const hasRouteAccess = isDeveloper || !allowedRoles || allowedRoles.some((role) => userRoles.includes(role));

  return (
    <ToastProvider>
      <AssistantProvider>
        <DashboardLayout
          userName={profile?.full_name || user.email || 'User'}
          userRole={profile?.primaryRole || 'user'}
          userJobTitle={profile?.job_title}
          userRoles={userRoles}
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
    </ToastProvider>
  );
}
