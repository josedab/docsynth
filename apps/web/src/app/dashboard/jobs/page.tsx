'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import Link from 'next/link';

interface Job {
  id: string;
  status: string;
  progress: number;
  prNumber: number;
  prTitle: string;
  repository: {
    name: string;
    githubFullName: string;
  };
  result: {
    prNumber?: number;
    prUrl?: string;
    documents?: Array<{ path: string; type: string }>;
    metrics?: { totalTokensUsed: number; documentsGenerated: number };
  } | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

const POLLING_INTERVAL = 5000; // 5 seconds

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchJobs = useCallback(async () => {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        perPage: '20',
      });

      if (filter !== 'all') {
        params.set('status', filter.toUpperCase());
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/jobs?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await response.json();

      if (data.success) {
        setJobs(data.data);
        setHasMore(data.meta?.hasMore ?? false);
        setLastUpdated(new Date());
      }
    } catch (error) {
      console.error('Failed to fetch jobs:', error);
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  // Initial fetch
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Polling for real-time updates
  useEffect(() => {
    if (autoRefresh) {
      pollingRef.current = setInterval(() => {
        fetchJobs();
      }, POLLING_INTERVAL);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [autoRefresh, fetchJobs]);

  // Check if there are any in-progress jobs
  const hasActiveJobs = jobs.some((job) =>
    ['PENDING', 'ANALYZING', 'INFERRING', 'GENERATING', 'REVIEWING'].includes(job.status)
  );

  async function retryJob(jobId: string) {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/jobs/${jobId}/retry`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      // Refresh list
      fetchJobs();
    } catch (error) {
      console.error('Failed to retry job:', error);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">Generation Jobs</h1>
          {lastUpdated && (
            <p className="text-sm text-gray-500 mt-1">
              Last updated: {lastUpdated.toLocaleTimeString()}
              {hasActiveJobs && autoRefresh && (
                <span className="ml-2 inline-flex items-center">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-1" />
                  Auto-refreshing
                </span>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchJobs}
            className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filter buttons */}
      <div className="flex gap-2 mb-6">
        {['all', 'pending', 'generating', 'completed', 'failed'].map((status) => (
          <button
            key={status}
            onClick={() => {
              setFilter(status);
              setPage(1);
            }}
            className={`px-3 py-1 text-sm rounded-lg capitalize ${
              filter === status
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {status}
          </button>
        ))}
      </div>

      {/* Active jobs indicator */}
      {hasActiveJobs && (
        <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
            <span className="font-medium text-blue-800 dark:text-blue-200">
              {jobs.filter((j) =>
                ['PENDING', 'ANALYZING', 'INFERRING', 'GENERATING', 'REVIEWING'].includes(j.status)
              ).length}{' '}
              job(s) in progress
            </span>
          </div>
        </div>
      )}

      {jobs.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
          <p className="text-gray-500 mb-4">No jobs found.</p>
          <p className="text-sm text-gray-400">
            Jobs will appear here when PRs are merged to enabled repositories.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onRetry={retryJob} />
          ))}

          {/* Pagination */}
          <div className="flex justify-center gap-4 pt-4">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-4 py-2">Page {page}</span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!hasMore}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function JobCard({ job, onRetry }: { job: Job; onRetry: (id: string) => void }) {
  const isActive = ['PENDING', 'ANALYZING', 'INFERRING', 'GENERATING', 'REVIEWING'].includes(
    job.status
  );

  return (
    <Link href={`/dashboard/jobs/${job.id}`}>
      <div
        className={`bg-white dark:bg-gray-800 rounded-lg border ${
          isActive
            ? 'border-blue-300 dark:border-blue-700 ring-1 ring-blue-200 dark:ring-blue-800'
            : 'border-gray-200 dark:border-gray-700'
        } p-6 transition-all hover:shadow-md cursor-pointer`}
      >
        <div className="flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <StatusBadge status={job.status} />
              <h3 className="font-semibold">
                {job.repository.name} #{job.prNumber}
              </h3>
              {isActive && (
                <span className="inline-flex items-center">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                </span>
              )}
            </div>
            <p className="text-gray-600 dark:text-gray-400 mb-2">{job.prTitle}</p>
            <p className="text-sm text-gray-500">
            {job.repository.githubFullName} • {new Date(job.createdAt).toLocaleString()}
          </p>
        </div>

        <div className="flex items-center gap-4">
          {job.status === 'FAILED' && (
            <button
              onClick={() => onRetry(job.id)}
              className="px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Retry
            </button>
          )}
          {job.result?.prUrl && (
            <a
              href={job.result.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              View PR
            </a>
          )}
        </div>
      </div>

      {/* Progress bar for in-progress jobs */}
      {isActive && (
        <div className="mt-4">
          <div className="flex justify-between text-sm text-gray-500 mb-1">
            <span>{getStatusLabel(job.status)}</span>
            <span>{job.progress}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-500 ease-out"
              style={{ width: `${job.progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error message */}
      {job.error && (
        <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{job.error}</p>
        </div>
      )}

      {/* Result details */}
      {job.result?.documents && job.result.documents.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm font-medium mb-2">Generated Documents:</p>
          <div className="flex flex-wrap gap-2">
            {job.result.documents.map((doc, i) => (
              <span key={i} className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded">
                {doc.path}
              </span>
            ))}
          </div>
          {job.result.metrics && (
            <p className="text-xs text-gray-500 mt-2">
              {job.result.metrics.totalTokensUsed.toLocaleString()} tokens used
            </p>
          )}
        </div>
      )}
      </div>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-800',
    ANALYZING: 'bg-blue-100 text-blue-800',
    INFERRING: 'bg-indigo-100 text-indigo-800',
    GENERATING: 'bg-purple-100 text-purple-800',
    REVIEWING: 'bg-pink-100 text-pink-800',
    COMPLETED: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
  };

  return (
    <span
      className={`px-2 py-1 text-xs font-medium rounded-full ${
        colors[status] ?? 'bg-gray-100 text-gray-800'
      }`}
    >
      {status}
    </span>
  );
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: 'Waiting to start...',
    ANALYZING: 'Analyzing code changes...',
    INFERRING: 'Understanding intent...',
    GENERATING: 'Generating documentation...',
    REVIEWING: 'Creating pull request...',
  };
  return labels[status] ?? status;
}
