'use client';

import { createContext, useContext, useCallback, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';

interface Shortcut {
  key: string;
  modifiers?: ('ctrl' | 'meta' | 'shift' | 'alt')[];
  description: string;
  action: () => void;
}

interface KeyboardShortcutsContextValue {
  shortcuts: Shortcut[];
  registerShortcut: (shortcut: Shortcut) => void;
  unregisterShortcut: (key: string) => void;
  showHelp: boolean;
  setShowHelp: (show: boolean) => void;
}

const KeyboardShortcutsContext = createContext<KeyboardShortcutsContextValue | null>(null);

export function KeyboardShortcutsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [showHelp, setShowHelp] = useState(false);

  // Default navigation shortcuts
  const defaultShortcuts: Shortcut[] = [
    {
      key: '?',
      description: 'Show keyboard shortcuts',
      action: () => setShowHelp(true),
    },
    {
      key: 'g',
      description: 'Go to Dashboard',
      action: () => {
        // Wait for second key
        const handler = (e: KeyboardEvent) => {
          if (e.key === 'd') router.push('/dashboard');
          else if (e.key === 'r') router.push('/dashboard/repositories');
          else if (e.key === 'j') router.push('/dashboard/jobs');
          else if (e.key === 's') router.push('/dashboard/settings');
          else if (e.key === 'v') router.push('/dashboard/visualizations');
          else if (e.key === 'a') router.push('/dashboard/analytics');
          document.removeEventListener('keydown', handler);
        };
        document.addEventListener('keydown', handler, { once: true });
        setTimeout(() => document.removeEventListener('keydown', handler), 1000);
      },
    },
    {
      key: 'Escape',
      description: 'Close modal/panel',
      action: () => setShowHelp(false),
    },
  ];

  const registerShortcut = useCallback((shortcut: Shortcut) => {
    setShortcuts((prev) => [...prev.filter((s) => s.key !== shortcut.key), shortcut]);
  }, []);

  const unregisterShortcut = useCallback((key: string) => {
    setShortcuts((prev) => prev.filter((s) => s.key !== key));
  }, []);

  // Global keyboard listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      const allShortcuts = [...defaultShortcuts, ...shortcuts];

      for (const shortcut of allShortcuts) {
        const modifiersMatch =
          !shortcut.modifiers ||
          shortcut.modifiers.every((mod) => {
            if (mod === 'ctrl') return e.ctrlKey;
            if (mod === 'meta') return e.metaKey;
            if (mod === 'shift') return e.shiftKey;
            if (mod === 'alt') return e.altKey;
            return false;
          });

        if (e.key === shortcut.key && modifiersMatch) {
          e.preventDefault();
          shortcut.action();
          return;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, router]);

  return (
    <KeyboardShortcutsContext.Provider
      value={{
        shortcuts: [...defaultShortcuts, ...shortcuts],
        registerShortcut,
        unregisterShortcut,
        showHelp,
        setShowHelp,
      }}
    >
      {children}
    </KeyboardShortcutsContext.Provider>
  );
}

export function useKeyboardShortcuts() {
  const context = useContext(KeyboardShortcutsContext);
  if (!context) {
    throw new Error('useKeyboardShortcuts must be used within a KeyboardShortcutsProvider');
  }
  return context;
}
