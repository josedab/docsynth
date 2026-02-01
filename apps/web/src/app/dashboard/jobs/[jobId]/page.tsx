'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface JobDetail {
  id: string;
  status: string;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  result: {
    prNumber?: number;
    prUrl?: string;
    documents?: Array<{
      id: string;
      path: string;
      type: string;
    }>;
    metrics?: {
      totalTokensUsed: number;
      documentsGenerated: number;
    };
  } | null;
  changeAnalysis: {
    id: string;
    priority: string;
    impactedAreas: string[];
    summary: string | null;
    prEvent: {
      prNumber: number;
      title: string;
      body: string | null;
      url: string;
      repository: {
        id: string;
        name: string;
        githubFullName: string;
      };
    };
    intentContext?: {
      id: string;
      businessPurpose: string | null;
      technicalApproach: string | null;
      targetAudience: string | null;
      keyConceptsJson: unknown;
    } | null;
  };
  docVersions: Array<{
    id: string;
    version: number;
    document: {
      id: string;
      path: string;
      type: string;
      title: string | null;
    };
  }>;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  ANALYZING: 'bg-blue-100 text-blue-800 border-blue-200',
  INFERRING: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  GENERATING: 'bg-purple-100 text-purple-800 border-purple-200',
  REVIEWING: 'bg-pink-100 text-pink-800 border-pink-200',
  COMPLETED: 'bg-green-100 text-green-800 border-green-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
};

const STATUS_STEPS = [
  { key: 'PENDING', label: 'Pending', description: 'Waiting to start' },
  { key: 'ANALYZING', label: 'Analyzing', description: 'Parsing code changes' },
  { key: 'INFERRING', label: 'Inferring', description: 'Understanding intent' },
  { key: 'GENERATING', label: 'Generating', description: 'Creating documentation' },
  { key: 'REVIEWING', label: 'Reviewing', description: 'Quality checks' },
  { key: 'COMPLETED', label: 'Completed', description: 'Done!' },
];

const POLLING_INTERVAL = 3000;

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.jobId as string;

  const [job, setJob] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);

  const fetchJob = useCallback(async () => {
    const token = localStorage.getItem('docsynth_token');
    if (!token) {
      router.push('/auth/login');
      return;
    }

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/jobs/${jobId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await response.json();

      if (data.success) {
        setJob(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch job:', error);
    } finally {
      setLoading(false);
    }
  }, [jobId, router]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Poll for updates if job is in progress
  useEffect(() => {
    if (!job) return;

    const isActive = ['PENDING', 'ANALYZING', 'INFERRING', 'GENERATING', 'REVIEWING'].includes(
      job.status
    );

    if (!isActive) return;

    const interval = setInterval(fetchJob, POLLING_INTERVAL);
    return () => clearInterval(interval);
  }, [job, fetchJob]);

  async function handleRetry() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    setRetrying(true);
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/jobs/${jobId}/retry`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      await fetchJob();
    } catch (error) {
      console.error('Failed to retry job:', error);
    } finally {
      setRetrying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Job not found.</p>
        <Link href="/dashboard/jobs" className="text-blue-600 hover:underline mt-4 inline-block">
          Back to Jobs
        </Link>
      </div>
    );
  }

  const isActive = ['PENDING', 'ANALYZING', 'INFERRING', 'GENERATING', 'REVIEWING'].includes(
    job.status
  );
  const currentStepIndex = STATUS_STEPS.findIndex((s) => s.key === job.status);

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href="/dashboard/jobs"
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              ← Jobs
            </Link>
          </div>
          <h1 className="text-2xl font-bold">
            {job.changeAnalysis.prEvent.repository.name} #{job.changeAnalysis.prEvent.prNumber}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {job.changeAnalysis.prEvent.title}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {job.status === 'FAILED' && (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {retrying ? 'Retrying...' : 'Retry Job'}
            </button>
          )}
          <a
            href={job.changeAnalysis.prEvent.url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
          >
            View PR on GitHub
          </a>
        </div>
      </div>

      {/* Status and Progress */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span
              className={`px-3 py-1 text-sm font-medium rounded-full border ${
                STATUS_COLORS[job.status] ?? 'bg-gray-100 text-gray-800'
              }`}
            >
              {job.status}
            </span>
            {isActive && (
              <span className="flex items-center text-sm text-gray-500">
                <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse mr-2" />
                Processing...
              </span>
            )}
          </div>
          <span className="text-sm text-gray-500">
            {job.progress}% complete
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-6">
          <div
            className={`h-full transition-all duration-500 ease-out ${
              job.status === 'FAILED' ? 'bg-red-500' : 'bg-blue-600'
            }`}
            style={{ width: `${job.progress}%` }}
          />
        </div>

        {/* Step indicators */}
        <div className="flex justify-between">
          {STATUS_STEPS.slice(0, -1).map((step, index) => {
            const isCompleted = index < currentStepIndex || job.status === 'COMPLETED';
            const isCurrent = step.key === job.status;
            const isFailed = job.status === 'FAILED' && index === currentStepIndex;

            return (
              <div key={step.key} className="flex flex-col items-center flex-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center mb-2 ${
                    isFailed
                      ? 'bg-red-500 text-white'
                      : isCompleted
                        ? 'bg-green-500 text-white'
                        : isCurrent
                          ? 'bg-blue-500 text-white'
                          : 'bg-gray-200 text-gray-500'
                  }`}
                >
                  {isFailed ? (
                    <span>✕</span>
                  ) : isCompleted ? (
                    <span>✓</span>
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>
                <span
                  className={`text-xs font-medium ${
                    isCurrent || isCompleted ? 'text-gray-900 dark:text-white' : 'text-gray-500'
                  }`}
                >
                  {step.label}
                </span>
                <span className="text-xs text-gray-500">{step.description}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Error message */}
      {job.error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6">
          <h3 className="font-medium text-red-800 dark:text-red-200 mb-2">Error</h3>
          <p className="text-sm text-red-600 dark:text-red-400">{job.error}</p>
        </div>
      )}

      {/* Two column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Change Analysis */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold mb-4">Change Analysis</h2>

          <div className="space-y-4">
            <div>
              <label className="text-sm text-gray-500">Priority</label>
              <p className="font-medium">{job.changeAnalysis.priority}</p>
            </div>

            {job.changeAnalysis.summary && (
              <div>
                <label className="text-sm text-gray-500">Summary</label>
                <p className="text-gray-700 dark:text-gray-300">{job.changeAnalysis.summary}</p>
              </div>
            )}

            {job.changeAnalysis.impactedAreas.length > 0 && (
              <div>
                <label className="text-sm text-gray-500">Impacted Areas</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {job.changeAnalysis.impactedAreas.map((area, i) => (
                    <span
                      key={i}
                      className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 rounded"
                    >
                      {area}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Intent Context */}
        {job.changeAnalysis.intentContext && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <h2 className="text-lg font-semibold mb-4">Inferred Intent</h2>

            <div className="space-y-4">
              {job.changeAnalysis.intentContext.businessPurpose && (
                <div>
                  <label className="text-sm text-gray-500">Business Purpose</label>
                  <p className="text-gray-700 dark:text-gray-300">
                    {job.changeAnalysis.intentContext.businessPurpose}
                  </p>
                </div>
              )}

              {job.changeAnalysis.intentContext.technicalApproach && (
                <div>
                  <label className="text-sm text-gray-500">Technical Approach</label>
                  <p className="text-gray-700 dark:text-gray-300">
                    {job.changeAnalysis.intentContext.technicalApproach}
                  </p>
                </div>
              )}

              {job.changeAnalysis.intentContext.targetAudience && (
                <div>
                  <label className="text-sm text-gray-500">Target Audience</label>
                  <p className="text-gray-700 dark:text-gray-300">
                    {job.changeAnalysis.intentContext.targetAudience}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Generated Documents */}
      {job.docVersions.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mt-6">
          <h2 className="text-lg font-semibold mb-4">Generated Documents</h2>

          <div className="space-y-3">
            {job.docVersions.map((dv) => (
              <Link
                key={dv.id}
                href={`/dashboard/documents/${dv.document.id}`}
                className="block p-4 bg-gray-50 dark:bg-gray-900 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{dv.document.title ?? dv.document.path}</p>
                    <p className="text-sm text-gray-500">{dv.document.type}</p>
                  </div>
                  <span className="text-sm text-gray-500">v{dv.version}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Result PR */}
      {job.result?.prUrl && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 mt-6">
          <h2 className="text-lg font-semibold text-green-800 dark:text-green-200 mb-2">
            Documentation PR Created
          </h2>
          <p className="text-sm text-green-700 dark:text-green-300 mb-4">
            A pull request with the generated documentation has been created.
          </p>
          <a
            href={job.result.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
          >
            View Documentation PR #{job.result.prNumber}
          </a>

          {job.result.metrics && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-4">
              {job.result.metrics.documentsGenerated} documents generated •{' '}
              {job.result.metrics.totalTokensUsed.toLocaleString()} tokens used
            </p>
          )}
        </div>
      )}

      {/* Timestamps */}
      <div className="mt-6 grid grid-cols-3 gap-4 text-sm">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-gray-500">Created</p>
          <p className="font-medium">{new Date(job.createdAt).toLocaleString()}</p>
        </div>
        {job.startedAt && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-gray-500">Started</p>
            <p className="font-medium">{new Date(job.startedAt).toLocaleString()}</p>
          </div>
        )}
        {job.completedAt && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-gray-500">Completed</p>
            <p className="font-medium">{new Date(job.completedAt).toLocaleString()}</p>
          </div>
        )}
      </div>
    </div>
  );
}
