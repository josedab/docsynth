'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LanguageSelector } from '../../components/LanguageSelector';
import { useI18n } from '../../i18n';
import { ChatProvider } from '../../contexts/ChatContext';
import { FloatingChatButton } from '../../components/FloatingChatButton';
import { OnboardingWizard, useOnboarding } from '../../components/OnboardingWizard';
import { SearchModal, useGlobalSearch } from '../../components/SearchModal';
import { NotificationsProvider } from '../../contexts/NotificationsContext';
import { NotificationsBell } from '../../components/NotificationsBell';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { ThemeToggle } from '../../components/ThemeToggle';
import { KeyboardShortcutsProvider } from '../../contexts/KeyboardShortcutsContext';
import { KeyboardShortcutsHelp } from '../../components/KeyboardShortcutsHelp';
import { CommandPalette } from '../../components/CommandPalette';
import { QuickActionsBar } from '../../components/QuickActionsBar';
import { DemoModeBanner } from '../../components/DemoModeBanner';

interface User {
  id: string;
  githubUsername: string;
  avatarUrl: string | null;
  organizations: Array<{
    id: string;
    name: string;
    subscriptionTier: string;
    role: string;
  }>;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { t } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { showOnboarding, checked, completeOnboarding, skipOnboarding } = useOnboarding();
  const { isSearchOpen, setIsSearchOpen } = useGlobalSearch();

  useEffect(() => {
    async function fetchUser() {
      const token = localStorage.getItem('docsynth_token');

      if (!token) {
        router.push('/auth/login');
        return;
      }

      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/auth/me`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const data = await response.json();

        if (!data.user) {
          localStorage.removeItem('docsynth_token');
          router.push('/auth/login');
          return;
        }

        setUser(data.user);
      } catch (error) {
        console.error('Failed to fetch user:', error);
        router.push('/auth/login');
      } finally {
        setLoading(false);
      }
    }

    fetchUser();
  }, [router]);

  const handleLogout = () => {
    localStorage.removeItem('docsynth_token');
    router.push('/');
  };

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <ThemeProvider>
      <KeyboardShortcutsProvider>
        <ChatProvider>
          <NotificationsProvider>
            <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
              {/* Demo Mode Banner */}
              <DemoModeBanner />

              {/* Header */}
              <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="flex justify-between items-center h-16">
                    <div className="flex items-center gap-4 md:gap-8">
                      {/* Mobile menu button */}
                      <button
                        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                        className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                        aria-label="Toggle menu"
                      >
                        <svg
                          className="w-6 h-6"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          {mobileMenuOpen ? (
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          ) : (
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M4 6h16M4 12h16M4 18h16"
                            />
                          )}
                        </svg>
                      </button>
                      <Link href="/dashboard" className="text-xl font-bold text-blue-600">
                        DocSynth
                      </Link>
                      <nav className="hidden md:flex gap-6">
                        <Link
                          href="/dashboard"
                          className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                        >
                          {t.nav.overview}
                        </Link>
                        <Link
                          href="/dashboard/repositories"
                          className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                        >
                          {t.nav.repositories}
                        </Link>
                        <Link
                          href="/dashboard/documents"
                          className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                        >
                          {t.nav.documents}
                        </Link>
                        <Link
                          href="/dashboard/jobs"
                          className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                        >
                          {t.nav.jobs}
                        </Link>
                        <Link
                          href="/dashboard/analytics"
                          className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                        >
                          {t.nav.analytics || 'Analytics'}
                        </Link>
                        <Link
                          href="/dashboard/visualizations"
                          className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                        >
                          {t.nav.visualizations || 'Visualizations'}
                        </Link>
                        <Link
                          href="/dashboard/settings"
                          className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                        >
                          {t.nav.settings}
                        </Link>
                      </nav>
                    </div>

                    <div className="flex items-center gap-4">
                      {/* Search Button */}
                      <button
                        onClick={() => setIsSearchOpen(true)}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
                      >
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                          />
                        </svg>
                        <span className="hidden sm:inline">Search</span>
                        <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-600 rounded">
                          ⌘K
                        </kbd>
                      </button>

                      {user && (
                        <div className="flex items-center gap-3">
                          {user.avatarUrl && (
                            <img
                              src={user.avatarUrl}
                              alt={user.githubUsername}
                              className="w-8 h-8 rounded-full"
                            />
                          )}
                          <span className="text-sm text-gray-700 dark:text-gray-300 hidden md:inline">
                            {user.githubUsername}
                          </span>
                        </div>
                      )}
                      <NotificationsBell />
                      <ThemeToggle />
                      <LanguageSelector />
                      <button
                        onClick={handleLogout}
                        className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                      >
                        {t.nav.signOut}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Mobile menu */}
                {mobileMenuOpen && (
                  <div className="md:hidden border-t border-gray-200 dark:border-gray-700">
                    <nav className="flex flex-col px-4 py-3 space-y-1">
                      <Link
                        href="/dashboard"
                        onClick={() => setMobileMenuOpen(false)}
                        className="px-3 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {t.nav.overview}
                      </Link>
                      <Link
                        href="/dashboard/repositories"
                        onClick={() => setMobileMenuOpen(false)}
                        className="px-3 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {t.nav.repositories}
                      </Link>
                      <Link
                        href="/dashboard/documents"
                        onClick={() => setMobileMenuOpen(false)}
                        className="px-3 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {t.nav.documents}
                      </Link>
                      <Link
                        href="/dashboard/jobs"
                        onClick={() => setMobileMenuOpen(false)}
                        className="px-3 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {t.nav.jobs}
                      </Link>
                      <Link
                        href="/dashboard/analytics"
                        onClick={() => setMobileMenuOpen(false)}
                        className="px-3 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {t.nav.analytics || 'Analytics'}
                      </Link>
                      <Link
                        href="/dashboard/visualizations"
                        onClick={() => setMobileMenuOpen(false)}
                        className="px-3 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {t.nav.visualizations || 'Visualizations'}
                      </Link>
                      <Link
                        href="/dashboard/settings"
                        onClick={() => setMobileMenuOpen(false)}
                        className="px-3 py-2 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {t.nav.settings}
                      </Link>
                    </nav>
                  </div>
                )}
              </header>

              {/* Main content */}
              <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8">
                {children}
              </main>

              {/* Floating Chat Button */}
              <FloatingChatButton />

              {/* Global Search Modal */}
              <SearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />

              {/* Onboarding Wizard */}
              {checked && showOnboarding && (
                <OnboardingWizard onComplete={completeOnboarding} onSkip={skipOnboarding} />
              )}

              {/* Keyboard Shortcuts Help */}
              <KeyboardShortcutsHelp />

              {/* Command Palette */}
              <CommandPalette />

              {/* Quick Actions Bar */}
              <QuickActionsBar />
            </div>
          </NotificationsProvider>
        </ChatProvider>
      </KeyboardShortcutsProvider>
    </ThemeProvider>
  );
}
