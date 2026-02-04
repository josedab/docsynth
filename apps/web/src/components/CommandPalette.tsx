'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useChat } from '../contexts/ChatContext';

interface Command {
  id: string;
  title: string;
  description?: string;
  category: 'navigation' | 'actions' | 'settings' | 'help';
  icon: string;
  shortcut?: string;
  action: () => void;
}

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentCommands, setRecentCommands] = useState<string[]>([]);
  const router = useRouter();
  const { openChat } = useChat();

  // Load recent commands from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('docsynth_recent_commands');
    if (stored) {
      setRecentCommands(JSON.parse(stored));
    }
  }, []);

  const commands: Command[] = useMemo(() => [
    // Navigation
    { id: 'nav-dashboard', title: 'Go to Dashboard', category: 'navigation', icon: '🏠', shortcut: 'G D', action: () => router.push('/dashboard') },
    { id: 'nav-repos', title: 'Go to Repositories', category: 'navigation', icon: '📦', shortcut: 'G R', action: () => router.push('/dashboard/repositories') },
    { id: 'nav-jobs', title: 'Go to Jobs', category: 'navigation', icon: '⚡', shortcut: 'G J', action: () => router.push('/dashboard/jobs') },
    { id: 'nav-docs', title: 'Go to Documents', category: 'navigation', icon: '📄', action: () => router.push('/dashboard/documents') },
    { id: 'nav-analytics', title: 'Go to Analytics', category: 'navigation', icon: '📊', shortcut: 'G A', action: () => router.push('/dashboard/analytics') },
    { id: 'nav-visualizations', title: 'Go to Visualizations', category: 'navigation', icon: '🔗', shortcut: 'G V', action: () => router.push('/dashboard/visualizations') },
    { id: 'nav-settings', title: 'Go to Settings', category: 'navigation', icon: '⚙️', shortcut: 'G S', action: () => router.push('/dashboard/settings') },
    { id: 'nav-api-keys', title: 'Manage API Keys', category: 'navigation', icon: '🔑', action: () => router.push('/dashboard/settings/api-keys') },
    { id: 'nav-billing', title: 'View Billing', category: 'navigation', icon: '💳', action: () => router.push('/dashboard/settings/billing') },

    // Actions
    { id: 'action-search', title: 'Search Everything', description: 'Search docs, repos, jobs', category: 'actions', icon: '🔍', shortcut: '⌘K', action: () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
    }},
    { id: 'action-chat', title: 'Open AI Chat', description: 'Ask questions about your docs', category: 'actions', icon: '💬', action: () => openChat() },
    { id: 'action-generate', title: 'Generate Documentation', description: 'Trigger doc generation for a repo', category: 'actions', icon: '✨', action: () => {
      router.push('/dashboard/repositories');
      // Could open a modal here
    }},
    { id: 'action-sync', title: 'Sync Repositories', description: 'Fetch latest from GitHub', category: 'actions', icon: '🔄', action: () => {
      router.push('/dashboard/repositories');
    }},
    { id: 'action-new-key', title: 'Create API Key', description: 'Generate new API key', category: 'actions', icon: '➕', action: () => router.push('/dashboard/settings/api-keys') },

    // Settings
    { id: 'settings-theme-light', title: 'Switch to Light Mode', category: 'settings', icon: '☀️', action: () => {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('docsynth_theme', 'light');
    }},
    { id: 'settings-theme-dark', title: 'Switch to Dark Mode', category: 'settings', icon: '🌙', action: () => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('docsynth_theme', 'dark');
    }},
    { id: 'settings-notifications', title: 'Notification Settings', category: 'settings', icon: '🔔', action: () => router.push('/dashboard/settings') },

    // Help
    { id: 'help-shortcuts', title: 'Keyboard Shortcuts', description: 'View all shortcuts', category: 'help', icon: '⌨️', shortcut: '?', action: () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
    }},
    { id: 'help-docs', title: 'View Documentation', category: 'help', icon: '📚', action: () => window.open('https://docs.docsynth.dev', '_blank') },
    { id: 'help-support', title: 'Contact Support', category: 'help', icon: '🆘', action: () => window.open('mailto:support@docsynth.dev', '_blank') },
    { id: 'help-changelog', title: 'View Changelog', category: 'help', icon: '📝', action: () => window.open('https://docsynth.dev/changelog', '_blank') },
  ], [router, openChat]);

  const filteredCommands = useMemo(() => {
    if (!search.trim()) {
      // Show recent commands first, then all
      const recent = commands.filter(c => recentCommands.includes(c.id));
      const others = commands.filter(c => !recentCommands.includes(c.id));
      return [...recent, ...others];
    }

    const query = search.toLowerCase();
    return commands.filter(c =>
      c.title.toLowerCase().includes(query) ||
      c.description?.toLowerCase().includes(query) ||
      c.category.toLowerCase().includes(query)
    );
  }, [search, commands, recentCommands]);

  const groupedCommands = useMemo(() => {
    const groups: Record<string, Command[]> = {
      recent: [],
      navigation: [],
      actions: [],
      settings: [],
      help: [],
    };

    filteredCommands.forEach(cmd => {
      if (!search && recentCommands.includes(cmd.id)) {
        groups.recent.push(cmd);
      } else {
        groups[cmd.category].push(cmd);
      }
    });

    return groups;
  }, [filteredCommands, search, recentCommands]);

  const executeCommand = useCallback((command: Command) => {
    // Save to recent
    const newRecent = [command.id, ...recentCommands.filter(id => id !== command.id)].slice(0, 5);
    setRecentCommands(newRecent);
    localStorage.setItem('docsynth_recent_commands', JSON.stringify(newRecent));

    setIsOpen(false);
    setSearch('');
    command.action();
  }, [recentCommands]);

  // Keyboard shortcut to open (Cmd+Shift+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsOpen(true);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setSearch('');
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // Navigation within palette
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, filteredCommands.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filteredCommands[selectedIndex]) {
        e.preventDefault();
        executeCommand(filteredCommands[selectedIndex]);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, filteredCommands, executeCommand]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  if (!isOpen) return null;

  const categoryLabels: Record<string, string> = {
    recent: 'Recent',
    navigation: 'Navigation',
    actions: 'Actions',
    settings: 'Settings',
    help: 'Help',
  };

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/50" onClick={() => setIsOpen(false)} />

      <div className="relative w-full max-w-xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Search Input */}
        <div className="flex items-center px-4 border-b border-gray-200 dark:border-gray-700">
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 px-3 py-4 bg-transparent text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
            autoFocus
          />
          <kbd className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
            esc
          </kbd>
        </div>

        {/* Commands List */}
        <div className="max-h-[60vh] overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="py-12 text-center text-gray-500 dark:text-gray-400">
              <p>No commands found for &quot;{search}&quot;</p>
            </div>
          ) : (
            <div className="py-2">
              {Object.entries(groupedCommands).map(([category, cmds]) => {
                if (cmds.length === 0) return null;

                return (
                  <div key={category}>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {categoryLabels[category]}
                    </div>
                    {cmds.map(cmd => {
                      const currentIndex = flatIndex++;
                      const isSelected = currentIndex === selectedIndex;

                      return (
                        <button
                          key={cmd.id}
                          onClick={() => executeCommand(cmd)}
                          onMouseEnter={() => setSelectedIndex(currentIndex)}
                          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                            isSelected
                              ? 'bg-blue-50 dark:bg-blue-900/30'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }`}
                        >
                          <span className="text-xl">{cmd.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-gray-900 dark:text-white">
                              {cmd.title}
                            </div>
                            {cmd.description && (
                              <div className="text-sm text-gray-500 dark:text-gray-400 truncate">
                                {cmd.description}
                              </div>
                            )}
                          </div>
                          {cmd.shortcut && (
                            <kbd className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded font-mono">
                              {cmd.shortcut}
                            </kbd>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">↑↓</kbd>
              to navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">↵</kbd>
              to select
            </span>
          </div>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">⌘⇧P</kbd>
            to open
          </span>
        </div>
      </div>
    </div>
  );
}

export function useCommandPalette() {
  const open = () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true, shiftKey: true }));
  };

  return { open };
}
