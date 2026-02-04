'use client';

import { useState, useEffect } from 'react';
import { useChat } from '../contexts/ChatContext';
import { ChatWidget } from './ChatWidget';

interface Repository {
  id: string;
  name: string;
  fullName: string;
}

export function FloatingChatButton() {
  const { isOpen, toggleChat, closeChat, selectedRepositoryId, selectedRepositoryName, setSelectedRepository } = useChat();
  const [token, setToken] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [showRepoSelector, setShowRepoSelector] = useState(false);

  useEffect(() => {
    const storedToken = localStorage.getItem('docsynth_token');
    setToken(storedToken);
  }, []);

  // Fetch repositories for selector
  useEffect(() => {
    async function fetchRepos() {
      if (!token) return;
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/repositories`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await response.json();
        if (data.success) {
          setRepositories(data.data || []);
          // Auto-select first repo if none selected
          if (!selectedRepositoryId && data.data?.length > 0) {
            setSelectedRepository(data.data[0].id, data.data[0].name);
          }
        }
      } catch {
        // Silently fail
      }
    }
    fetchRepos();
  }, [token, selectedRepositoryId, setSelectedRepository]);

  if (!token) return null;

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={toggleChat}
        className={`fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ${
          isOpen
            ? 'bg-gray-600 hover:bg-gray-700 rotate-0'
            : 'bg-blue-600 hover:bg-blue-700 hover:scale-110'
        }`}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
      >
        {isOpen ? (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}
      </button>

      {/* Chat Panel */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[500px] max-h-[70vh] flex flex-col shadow-2xl rounded-lg overflow-hidden">
          {/* Repository Selector Header */}
          <div className="bg-blue-700 px-4 py-2 flex items-center justify-between">
            <button
              onClick={() => setShowRepoSelector(!showRepoSelector)}
              className="flex items-center gap-2 text-white text-sm hover:bg-blue-600 px-2 py-1 rounded"
            >
              <span className="truncate max-w-[200px]">
                {selectedRepositoryName || 'Select repository'}
              </span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>

          {/* Repository Dropdown */}
          {showRepoSelector && (
            <div className="absolute top-12 left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-b-lg shadow-lg z-10 max-h-48 overflow-y-auto">
              {repositories.length === 0 ? (
                <div className="p-3 text-sm text-gray-500 text-center">
                  No repositories available
                </div>
              ) : (
                repositories.map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => {
                      setSelectedRepository(repo.id, repo.name);
                      setShowRepoSelector(false);
                    }}
                    className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      selectedRepositoryId === repo.id
                        ? 'bg-blue-50 dark:bg-blue-900 text-blue-600 dark:text-blue-400'
                        : 'text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {repo.fullName || repo.name}
                  </button>
                ))
              )}
            </div>
          )}

          {/* Chat Widget */}
          {selectedRepositoryId && token ? (
            <ChatWidget
              repositoryId={selectedRepositoryId}
              repositoryName={selectedRepositoryName || 'Repository'}
              token={token}
              onClose={closeChat}
            />
          ) : (
            <div className="flex-1 bg-white dark:bg-gray-800 flex items-center justify-center">
              <div className="text-center text-gray-500 dark:text-gray-400 p-4">
                <span className="text-4xl block mb-2">📚</span>
                <p>Select a repository to start chatting</p>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
