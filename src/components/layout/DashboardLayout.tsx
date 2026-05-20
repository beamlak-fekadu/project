'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import NavigationProgress from './NavigationProgress';
import { AssistantPanel } from '@/components/assistant/AssistantPanel';
import { useAssistantContext } from '@/components/assistant/AssistantProvider';
import OfflineStatusBanner from '@/components/offline/OfflineStatusBanner';
import { pageFade, drawerSlideLeft, transitions } from '@/lib/ui/motion-presets';
import { useDrawerA11y } from '@/hooks/useDrawerA11y';

interface DashboardLayoutProps {
  children: ReactNode;
  userName?: string;
  userRole?: string;
  userJobTitle?: string | null;
  userRoles?: string[];
  onLogout?: () => void;
}

export default function DashboardLayout({ children, userName, userRole, userJobTitle, userRoles, onLogout }: DashboardLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();
  const { closeAssistant } = useAssistantContext();

  // Prevent background scroll while the mobile drawer is open. The desktop
  // shell already manages its own scroll; this only kicks in on small screens.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : previous;
    return () => { document.body.style.overflow = previous; };
  }, [mobileMenuOpen]);

  useEffect(() => {
    const handleMajorOverlayOpen = (event: Event) => {
      const source = (event as CustomEvent<{ source?: string }>).detail?.source;
      if (source === 'assistant') setMobileMenuOpen(false);
    };
    window.addEventListener('bmedis:major-overlay-open', handleMajorOverlayOpen);
    return () => window.removeEventListener('bmedis:major-overlay-open', handleMajorOverlayOpen);
  }, []);

  // Nav links inside the mobile drawer call `onNavigate={closeMobileMenu}` to
  // dismiss it on tap; we don't need a separate route-change effect for that.

  const closeMobileMenu = () => setMobileMenuOpen(false);
  const openMobileMenu = () => {
    closeAssistant();
    window.dispatchEvent(new CustomEvent('bmedis:major-overlay-open', { detail: { source: 'sidebar' } }));
    setMobileMenuOpen(true);
  };
  const sidebarDrawerRef = useDrawerA11y(mobileMenuOpen, closeMobileMenu);

  return (
    <div className="app-shell flex h-dvh min-w-0 overflow-hidden">
      <NavigationProgress />
      <AnimatePresence>
        {mobileMenuOpen && (
          <div className="no-print fixed inset-0 z-40 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transitions.default}
              className="absolute inset-0 bg-black/50"
              onClick={closeMobileMenu}
            />
            <motion.div
              ref={sidebarDrawerRef}
              role="dialog"
              aria-label="Navigation menu"
              aria-modal="true"
              variants={drawerSlideLeft}
              initial="initial"
              animate="animate"
              exit="exit"
              className="absolute inset-y-0 left-0 z-50 max-w-full"
            >
              <Sidebar userRoles={userRoles} drawerMode onNavigate={closeMobileMenu} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="no-print hidden lg:flex">
        <Sidebar userRoles={userRoles} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="no-print">
          <Topbar
            userName={userName}
            userRole={userRole}
            userJobTitle={userJobTitle}
            userRoles={userRoles}
            onMenuToggle={openMobileMenu}
            onLogout={onLogout}
          />
          <OfflineStatusBanner />
        </div>
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-4 lg:p-6 lg:pb-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              variants={pageFade}
              initial="initial"
              animate="animate"
              exit="exit"
              className="min-w-0"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <AssistantPanel />
    </div>
  );
}
