'use client';

import { useState, useEffect } from 'react';

interface Badge {
  id: string;
  name: string;
  icon: string;
  description: string;
  earnedAt: string;
}

interface UserBadgesProps {
  token: string;
  compact?: boolean;
}

export function UserBadges({ token, compact = false }: UserBadgesProps) {
  const [badges, setBadges] = useState<Badge[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    async function fetchBadges() {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/user/badges`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await response.json();
        if (data.success) {
          setBadges(data.data.badges || []);
        }
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }
    fetchBadges();
  }, [token]);

  if (loading) {
    return (
      <div className="flex gap-1">
        {[...Array(3)].map((_, i) => (
          <div
            key={i}
            className="w-6 h-6 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (badges.length === 0) {
    if (compact) return null;
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        No badges earned yet. Keep documenting!
      </div>
    );
  }

  const displayBadges = compact ? badges.slice(0, 5) : showAll ? badges : badges.slice(0, 8);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {displayBadges.map((badge) => (
          <div
            key={badge.id}
            className="group relative"
            title={badge.name}
          >
            <span className="text-xl cursor-help">{badge.icon}</span>
            {/* Tooltip */}
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              <div className="font-medium">{badge.name}</div>
              {!compact && <div className="text-gray-300">{badge.description}</div>}
            </div>
          </div>
        ))}
        {!compact && badges.length > 8 && !showAll && (
          <button
            onClick={() => setShowAll(true)}
            className="text-sm text-blue-600 hover:underline"
          >
            +{badges.length - 8} more
          </button>
        )}
      </div>
    </div>
  );
}

// Predefined badges for the system
export const AVAILABLE_BADGES = [
  { id: 'first-doc', name: 'First Doc', icon: '📝', description: 'Generated your first documentation' },
  { id: 'doc-streak-7', name: '7-Day Streak', icon: '🔥', description: '7 consecutive days of doc updates' },
  { id: 'doc-streak-30', name: '30-Day Streak', icon: '🌟', description: '30 consecutive days of doc updates' },
  { id: 'all-healthy', name: 'Health Pro', icon: '💚', description: 'All docs at 90%+ health' },
  { id: 'zero-drift', name: 'In Sync', icon: '✨', description: 'Zero documentation drift for 30 days' },
  { id: 'api-master', name: 'API Master', icon: '🔌', description: 'Documented 50+ API endpoints' },
  { id: 'contributor', name: 'Contributor', icon: '🤝', description: 'Contributed to 10+ repositories' },
  { id: 'reviewer', name: 'Reviewer', icon: '👀', description: 'Reviewed 25+ doc PRs' },
  { id: 'early-adopter', name: 'Early Adopter', icon: '🚀', description: 'Joined during beta' },
  { id: 'perfectionist', name: 'Perfectionist', icon: '💎', description: 'Achieved 100% doc coverage' },
];
