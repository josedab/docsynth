'use client';

import { useOfflineStatus } from '../hooks/useOfflineStatus';

export function OfflineIndicator() {
  const { isOnline, pendingChanges, syncInProgress, sync, isInitialized } = useOfflineStatus();

  if (!isInitialized) {
    return null;
  }

  // Show nothing if online with no pending changes
  if (isOnline && pendingChanges === 0 && !syncInProgress) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {!isOnline && (
        <div className="flex items-center gap-2 bg-amber-100 text-amber-800 px-4 py-2 rounded-lg shadow-lg border border-amber-200">
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
            />
          </svg>
          <span className="text-sm font-medium">You&apos;re offline</span>
          {pendingChanges > 0 && (
            <span className="text-xs bg-amber-200 px-2 py-0.5 rounded-full">
              {pendingChanges} pending
            </span>
          )}
        </div>
      )}

      {isOnline && pendingChanges > 0 && (
        <div className="flex items-center gap-2 bg-blue-100 text-blue-800 px-4 py-2 rounded-lg shadow-lg border border-blue-200">
          {syncInProgress ? (
            <>
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="text-sm font-medium">Syncing changes...</span>
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span className="text-sm font-medium">{pendingChanges} pending changes</span>
              <button
                onClick={() => sync()}
                className="text-xs bg-blue-200 hover:bg-blue-300 px-2 py-0.5 rounded transition-colors"
              >
                Sync now
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
