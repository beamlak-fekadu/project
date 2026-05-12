'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_SECTIONS, APP_NAME_SHORT, ROUTES } from '@/constants';
import {
  ChevronLeft, ChevronRight, Monitor, FileText, PackageCheck, Wrench, CalendarCheck, CalendarDays, Gauge,
  Package, Boxes, GraduationCap, Trash2, Activity, ShieldAlert, CheckCircle, BarChart3,
  ArrowUpDown, FileBarChart, Users, Settings, ClipboardList, Headphones, BrainCircuit, Shield, MessageSquareText, Bell, LayoutDashboard,
} from 'lucide-react';
import LogoMark from '@/components/brand/LogoMark';

const iconMap: Record<string, React.ElementType> = {
  LayoutDashboard, Bell, Monitor, FileText, PackageCheck, Wrench, CalendarCheck, CalendarDays, Gauge,
  Package, Boxes, GraduationCap, Trash2, Activity, ShieldAlert, CheckCircle, BarChart3,
  ArrowUpDown, FileBarChart, Users, Settings, ClipboardList, Headphones, BrainCircuit, Shield, MessageSquareText,
};

interface SidebarProps {
  userRoles?: string[];
}

export default function Sidebar({ userRoles = ['admin'] }: SidebarProps) {
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
          const visibleItems = section.items.filter((item) =>
            item.roles.some((r) => userRoles.includes(r))
          );
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
                    {!collapsed && <span>{item.label}</span>}
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
