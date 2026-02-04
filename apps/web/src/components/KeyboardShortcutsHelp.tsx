'use client';

import { useKeyboardShortcuts } from '../contexts/KeyboardShortcutsContext';

export function KeyboardShortcutsHelp() {
  const { showHelp, setShowHelp } = useKeyboardShortcuts();

  if (!showHelp) return null;

  const shortcutGroups = [
    {
      title: 'Navigation',
      shortcuts: [
        { keys: ['g', 'd'], description: 'Go to Dashboard' },
        { keys: ['g', 'r'], description: 'Go to Repositories' },
        { keys: ['g', 'j'], description: 'Go to Jobs' },
        { keys: ['g', 's'], description: 'Go to Settings' },
        { keys: ['g', 'v'], description: 'Go to Visualizations' },
        { keys: ['g', 'a'], description: 'Go to Analytics' },
      ],
    },
    {
      title: 'Actions',
      shortcuts: [
        { keys: ['⌘', 'K'], description: 'Open search' },
        { keys: ['?'], description: 'Show this help' },
        { keys: ['Esc'], description: 'Close modal/panel' },
      ],
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={() => setShowHelp(false)}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            Keyboard Shortcuts
          </h2>
          <button
            onClick={() => setShowHelp(false)}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">
                {group.title}
              </h3>
              <div className="space-y-2">
                {group.shortcuts.map((shortcut, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-2"
                  >
                    <span className="text-gray-700 dark:text-gray-300">
                      {shortcut.description}
                    </span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, j) => (
                        <span key={j}>
                          <kbd className="px-2 py-1 text-xs font-semibold bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded border border-gray-200 dark:border-gray-600">
                            {key}
                          </kbd>
                          {j < shortcut.keys.length - 1 && (
                            <span className="mx-1 text-gray-400">then</span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Press <kbd className="px-1.5 py-0.5 text-xs bg-gray-200 dark:bg-gray-600 rounded">?</kbd> anywhere to show this help
          </p>
        </div>
      </div>
    </div>
  );
}
