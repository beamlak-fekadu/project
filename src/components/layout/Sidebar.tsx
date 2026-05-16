'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_SECTIONS, APP_NAME_SHORT, ROUTES } from '@/constants';
import { hasCapability, type Capability } from '@/lib/rbac';
import {
  ChevronLeft, ChevronRight, Monitor, FileText, PackageCheck, Wrench, CalendarCheck, CalendarDays, Gauge,
  Package, Boxes, GraduationCap, Trash2, Activity, ShieldAlert, CheckCircle, BarChart3,
  ArrowUpDown, FileBarChart, Users, Settings, ClipboardList, Headphones, BrainCircuit, Shield, MessageSquareText, Bell, LayoutDashboard, RefreshCw,
} from 'lucide-react';
import LogoMark from '@/components/brand/LogoMark';

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard, Bell, Monitor, FileText, PackageCheck, Wrench, CalendarCheck, CalendarDays, Gauge,
  Package, Boxes, GraduationCap, Trash2, Activity, ShieldAlert, CheckCircle, BarChart3,
  ArrowUpDown, FileBarChart, Users, Settings, ClipboardList, Headphones, BrainCircuit, Shield, MessageSquareText, RefreshCw,
};

interface SidebarProps {
  userRoles?: string[];
}

// Viewer-specific label overrides — viewer pages are framed as read-only
// management overviews, not operational modules. The underlying routes are
// unchanged; only the label is swapped in the sidebar for the viewer role.
const VIEWER_LABEL_OVERRIDES: Record<string, string> = {
  [ROUTES.EQUIPMENT]: 'Equipment Overview',
  [ROUTES.MAINTENANCE]: 'Maintenance Overview',
  [ROUTES.REPLACEMENT]: 'Replacement & Risk',
  [ROUTES.COMPLIANCE]: 'Compliance Overview',
  [ROUTES.ALERTS]: 'Management Alerts',
};

// Store-User-specific label overrides — store pages are framed as a
// Store / Logistics Operations Console, not generic biomedical modules.
const STORE_LABEL_OVERRIDES: Record<string, string> = {
  [ROUTES.COMMAND]: 'Store Operations',
  [ROUTES.SPARE_PARTS]: 'Spare Parts Stock Control',
  [ROUTES.LOGISTICS]: 'Logistics Console',
  [ROUTES.PROCUREMENT]: 'Procurement Tracking',
  [ROUTES.MAINTENANCE]: 'Maintenance Blockers',
  [ROUTES.ALERTS]: 'Logistics Alerts',
};

// Department-role label overrides — department pages are framed as a
// Department Equipment & Service Readiness Portal.
const DEPARTMENT_LABEL_OVERRIDES: Record<string, string> = {
  [ROUTES.COMMAND]: 'Department Dashboard',
  [ROUTES.CALENDAR]: 'Department Calendar',
  [ROUTES.EQUIPMENT]: 'Department Equipment',
  [ROUTES.REQUESTS]: 'Department Requests',
  [ROUTES.MAINTENANCE]: 'Work Status',
  [ROUTES.COMPLIANCE]: 'Compliance Status',
  [ROUTES.ALERTS]: 'Department Alerts',
};

export default function Sidebar({ userRoles = ['admin'] }: SidebarProps) {
  const isViewerOnly =
    userRoles.length > 0 &&
    userRoles.includes('viewer') &&
    !userRoles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head');
  const isStoreOnly =
    userRoles.length > 0 &&
    userRoles.includes('store_user') &&
    !userRoles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  const isDepartmentOnly =
    userRoles.length > 0 &&
    (userRoles.includes('department_head') || userRoles.includes('department_user')) &&
    !userRoles.some((r) => r === 'developer' || r === 'admin' || r === 'bme_head' || r === 'technician');
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    if (href === ROUTES.EQUIPMENT) {
      return pathname.startsWith('/inventory') || pathname.startsWith('/equipment');
    }
    return pathname.startsWith(href);
  };

  return (
    <aside
      className={`panel-surface-muted flex h-screen flex-col border-r border-[var(--border-subtle)] transition-all duration-200 ${
        collapsed ? 'w-16' : 'w-72'
      }`}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-4">
        {!collapsed && (
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark size={28} />
            <span className="text-base font-semibold text-[var(--foreground)] tracking-tight">{APP_NAME_SHORT}</span>
          </Link>
        )}
        {collapsed && (
          <Link href="/" className="mx-auto">
            <LogoMark size={26} />
          </Link>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded-lg p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-1)] hover:text-[var(--foreground)]"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-4">
        {NAV_SECTIONS.map((section) => {
          const visibleItems = section.items.filter((item) => {
            const cap = (item as { capability?: string }).capability as Capability | undefined;
            if (cap) return hasCapability(userRoles, cap);
            return item.roles.some((r) => userRoles.includes(r));
          });
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.title} className="mb-5">
              {!collapsed && (
                <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-subtle)]">
                  {section.title}
                </p>
              )}
              {visibleItems.map((item) => {
                const Icon = iconMap[item.icon] || Monitor;
                const active = isActive(item.href);
                const isChatbotItem = item.href === ROUTES.CHATBOT;
                const chatbotClass = isChatbotItem
                  ? active
                    ? 'border border-[var(--chatbot-nav-border)] bg-[image:var(--chatbot-nav-bg-active)] text-[var(--chatbot-nav-text)] shadow-[var(--chatbot-nav-glow)]'
                    : 'border border-[var(--chatbot-nav-border)] bg-[image:var(--chatbot-nav-bg)] text-[var(--chatbot-nav-text)] hover:bg-[image:var(--chatbot-nav-bg-hover)]'
                  : '';
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                      !isChatbotItem && active
                        ? 'bg-[var(--brand-soft)] font-medium text-[var(--brand)] shadow-sm'
                        : !isChatbotItem
                          ? 'font-normal text-[var(--text-muted)] hover:bg-[var(--surface-1)] hover:text-[var(--foreground)]'
                          : chatbotClass
                    } ${isChatbotItem ? 'relative overflow-hidden font-medium' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon
                      className={`h-[18px] w-[18px] flex-shrink-0 ${isChatbotItem ? 'text-[var(--chatbot-nav-icon)]' : ''}`}
                      strokeWidth={active ? 2 : 1.75}
                    />
                    {!collapsed && (
                      <span>
                        {isStoreOnly && STORE_LABEL_OVERRIDES[item.href]
                          ? STORE_LABEL_OVERRIDES[item.href]
                          : isDepartmentOnly && DEPARTMENT_LABEL_OVERRIDES[item.href]
                            ? DEPARTMENT_LABEL_OVERRIDES[item.href]
                            : isViewerOnly && VIEWER_LABEL_OVERRIDES[item.href]
                              ? VIEWER_LABEL_OVERRIDES[item.href]
                              : item.label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
