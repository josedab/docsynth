'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DashboardStats {
  totalRepos: number;
  activeRepos: number;
  totalJobs: number;
  completedJobs: number;
  docsGenerated: number;
}

interface RecentJob {
  id: string;
  status: string;
  prNumber: number;
  prTitle: string;
  repository: {
    name: string;
  };
  createdAt: string;
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchDashboardData() {
      const token = localStorage.getItem('docsynth_token');
      if (!token) return;

      try {
        // Fetch recent jobs
        const jobsResponse = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/jobs?perPage=5`,
          {
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        const jobsData = await jobsResponse.json();

        if (jobsData.success) {
          setRecentJobs(jobsData.data);
          setStats({
            totalRepos: 0,
            activeRepos: 0,
            totalJobs: jobsData.meta?.total ?? 0,
            completedJobs: jobsData.data.filter((j: RecentJob) => j.status === 'COMPLETED').length,
            docsGenerated: 0,
          });
        }
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl md:text-2xl font-bold mb-6 md:mb-8">Dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6 mb-6 md:mb-8">
        <StatCard title="Total Repositories" value={stats?.totalRepos ?? 0} />
        <StatCard title="Active Repositories" value={stats?.activeRepos ?? 0} />
        <StatCard title="Generation Jobs" value={stats?.totalJobs ?? 0} />
        <StatCard title="Docs Generated" value={stats?.docsGenerated ?? 0} />
      </div>

      {/* Recent Jobs */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="p-3 md:p-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
          <h2 className="text-base md:text-lg font-semibold">Recent Jobs</h2>
          <Link href="/dashboard/jobs" className="text-blue-600 hover:underline text-sm">
            View all
          </Link>
        </div>

        {recentJobs.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <p>No generation jobs yet.</p>
            <p className="text-sm mt-2">Jobs will appear here when PRs are merged to enabled repositories.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {recentJobs.map((job) => (
              <div key={job.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {job.repository.name} #{job.prNumber}
                  </p>
                  <p className="text-sm text-gray-500 truncate max-w-md">{job.prTitle}</p>
                </div>
                <div className="flex items-center gap-4">
                  <StatusBadge status={job.status} />
                  <span className="text-sm text-gray-500">
                    {new Date(job.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
            Add a Repository
          </h3>
          <p className="text-sm text-blue-700 dark:text-blue-300 mb-4">
            Enable documentation generation for your GitHub repositories.
          </p>
          <Link
            href="/dashboard/repositories"
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Manage Repositories
          </Link>
        </div>

        <div className="p-6 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
          <h3 className="font-semibold text-purple-900 dark:text-purple-100 mb-2">
            Install GitHub App
          </h3>
          <p className="text-sm text-purple-700 dark:text-purple-300 mb-4">
            Install the DocSynth GitHub App to enable webhook triggers.
          </p>
          <a
            href="https://github.com/apps/docsynth"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
          >
            Install App
          </a>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <div className="bg-white dark:bg-gray-800 p-4 md:p-6 rounded-lg border border-gray-200 dark:border-gray-700">
      <p className="text-xs md:text-sm text-gray-500 dark:text-gray-400 truncate">{title}</p>
      <p className="text-xl md:text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    ANALYZING: 'bg-blue-100 text-blue-800',
    INFERRING: 'bg-blue-100 text-blue-800',
    GENERATING: 'bg-blue-100 text-blue-800',
    REVIEWING: 'bg-purple-100 text-purple-800',
    COMPLETED: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full ${colors[status] ?? 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  );
}
