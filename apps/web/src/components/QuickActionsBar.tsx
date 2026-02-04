'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useChat } from '../contexts/ChatContext';

interface QuickAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  action: () => void;
  color?: string;
}

export function QuickActionsBar() {
  const [isExpanded, setIsExpanded] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { openChat } = useChat();

  const getContextualActions = (): QuickAction[] => {
    const baseActions: QuickAction[] = [
      {
        id: 'chat',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        ),
        label: 'Ask AI',
        action: openChat,
        color: 'bg-purple-500 hover:bg-purple-600',
      },
      {
        id: 'search',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        ),
        label: 'Search',
        action: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true })),
        color: 'bg-gray-600 hover:bg-gray-700',
      },
      {
        id: 'command',
        icon: (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
        label: 'Commands',
        action: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', metaKey: true, shiftKey: true })),
        color: 'bg-gray-600 hover:bg-gray-700',
      },
    ];

    // Add context-specific actions
    if (pathname === '/dashboard' || pathname === '/dashboard/') {
      return [
        {
          id: 'generate',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          ),
          label: 'Generate Docs',
          action: () => router.push('/dashboard/repositories'),
          color: 'bg-blue-500 hover:bg-blue-600',
        },
        ...baseActions,
      ];
    }

    if (pathname?.includes('/repositories')) {
      return [
        {
          id: 'sync',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ),
          label: 'Sync Repos',
          action: () => {/* trigger sync */},
          color: 'bg-green-500 hover:bg-green-600',
        },
        ...baseActions,
      ];
    }

    if (pathname?.includes('/jobs')) {
      return [
        {
          id: 'refresh',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          ),
          label: 'Refresh Jobs',
          action: () => window.location.reload(),
          color: 'bg-blue-500 hover:bg-blue-600',
        },
        ...baseActions,
      ];
    }

    if (pathname?.includes('/documents')) {
      return [
        {
          id: 'export',
          icon: (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          ),
          label: 'Export',
          action: () => {/* trigger export */},
          color: 'bg-green-500 hover:bg-green-600',
        },
        ...baseActions,
      ];
    }

    return baseActions;
  };

  const actions = getContextualActions();

  return (
    <div className="fixed left-4 bottom-20 z-40 flex flex-col items-start gap-2">
      {/* Expanded actions */}
      {isExpanded && (
        <div className="flex flex-col gap-2 mb-2 animate-in slide-in-from-bottom-2 fade-in duration-200">
          {actions.map(action => (
            <button
              key={action.id}
              onClick={() => {
                action.action();
                setIsExpanded(false);
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-full text-white shadow-lg transition-all ${action.color || 'bg-gray-600 hover:bg-gray-700'}`}
            >
              {action.icon}
              <span className="text-sm font-medium whitespace-nowrap">{action.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* Toggle button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all ${
          isExpanded
            ? 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-800 rotate-45'
            : 'bg-blue-600 text-white hover:bg-blue-700'
        }`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </div>
  );
}
