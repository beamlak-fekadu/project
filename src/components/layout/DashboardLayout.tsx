'use client';

import { useState, type ReactNode } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import { AssistantPanel } from '@/components/assistant/AssistantPanel';
import OfflineStatusBanner from '@/components/offline/OfflineStatusBanner';

interface DashboardLayoutProps {
  children: ReactNode;
  userName?: string;
  userRole?: string;
  userJobTitle?: string | null;
  userRoles?: string[];
  alertCount?: number;
  onLogout?: () => void;
}

export default function DashboardLayout({ children, userName, userRole, userJobTitle, userRoles, alertCount, onLogout }: DashboardLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="app-shell flex h-screen overflow-hidden">
      <div className={`no-print fixed inset-0 z-40 lg:hidden ${mobileMenuOpen ? '' : 'pointer-events-none'}`}>
        <div className={`absolute inset-0 bg-black/50 transition-opacity ${mobileMenuOpen ? 'opacity-100' : 'opacity-0'}`} onClick={() => setMobileMenuOpen(false)} />
        <div className={`absolute inset-y-0 left-0 z-50 transition-transform ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <Sidebar userRoles={userRoles} />
        </div>
      </div>

      <div className="no-print hidden lg:flex">
        <Sidebar userRoles={userRoles} />
      </div>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="no-print">
          <Topbar
            userName={userName}
            userRole={userRole}
            userJobTitle={userJobTitle}
            userRoles={userRoles}
            alertCount={alertCount}
            onMenuToggle={() => setMobileMenuOpen(true)}
            onLogout={onLogout}
          />
          <OfflineStatusBanner />
        </div>
        <main className="flex-1 overflow-y-auto p-4 pb-6 lg:p-6 lg:pb-8">{children}</main>
      </div>
      <AssistantPanel />
    </div>
  );
}
