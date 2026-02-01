'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface LeaderboardEntry {
  id: string;
  repositoryId: string;
  repositoryName: string;
  rank: number;
  score: number;
  scoreChange: number;
  docsImproved: number;
  docsCreated: number;
  streak: number;
  badges: Array<{ id: string; name: string; icon: string }>;
}

interface TeamLeaderboardProps {
  token: string;
  limit?: number;
}

export function TeamLeaderboard({ token, limit = 10 }: TeamLeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      setLoading(true);
      const response = await apiFetch<{
        success: boolean;
        data: { entries: LeaderboardEntry[] };
      }>(`/api/health-dashboard/leaderboard?period=${period}`, { token });

      setEntries(response.data.entries.slice(0, limit));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, [period, token, limit]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const getRankBadge = (rank: number) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const getScoreChangeIndicator = (change: number) => {
    if (change > 0) return <span className="text-green-600">↑{change}</span>;
    if (change < 0) return <span className="text-red-600">↓{Math.abs(change)}</span>;
    return <span className="text-gray-400">-</span>;
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3" />
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="p-4 border-b flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          🏆 Team Leaderboard
        </h3>
        <div className="flex gap-2">
          {(['weekly', 'monthly'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
              }`}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="p-8 text-center text-gray-500">
          No leaderboard data yet. Run a health scan to get started!
        </div>
      ) : (
        <div className="divide-y">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`p-4 flex items-center gap-4 hover:bg-gray-50 transition-colors ${
                entry.rank <= 3 ? 'bg-gradient-to-r from-amber-50 to-transparent' : ''
              }`}
            >
              {/* Rank */}
              <div className="w-10 text-center font-bold text-lg">
                {getRankBadge(entry.rank)}
              </div>

              {/* Repository info */}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{entry.repositoryName}</div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>+{entry.docsImproved} improved</span>
                  <span>+{entry.docsCreated} new</span>
                  {entry.streak > 0 && (
                    <span className="text-orange-600">🔥 {entry.streak} day streak</span>
                  )}
                </div>
              </div>

              {/* Badges */}
              {entry.badges.length > 0 && (
                <div className="flex gap-1">
                  {entry.badges.slice(0, 3).map((badge) => (
                    <span key={badge.id} title={badge.name} className="text-lg">
                      {badge.icon}
                    </span>
                  ))}
                </div>
              )}

              {/* Score */}
              <div className="text-right">
                <div className="flex items-center gap-2">
                  <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getScoreColor(entry.score)}`}
                      style={{ width: `${entry.score}%` }}
                    />
                  </div>
                  <span className="font-bold w-8">{entry.score}</span>
                </div>
                <div className="text-xs">{getScoreChangeIndicator(entry.scoreChange)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
