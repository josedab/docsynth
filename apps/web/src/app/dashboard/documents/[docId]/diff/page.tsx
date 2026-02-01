'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface DiffData {
  from: {
    version: number;
    content: string;
    createdAt: string;
  };
  to: {
    version: number;
    content: string;
    createdAt: string;
  };
}

interface DocVersion {
  id: string;
  version: number;
  createdAt: string;
}

interface Document {
  id: string;
  path: string;
  title: string | null;
  version: number;
  versions: DocVersion[];
}

export default function DocumentDiffPage() {
  const params = useParams();
  const router = useRouter();
  useSearchParams(); // Required for Next.js dynamic page
  const docId = params.docId as string;

  const [document, setDocument] = useState<Document | null>(null);
  const [diffData, setDiffData] = useState<DiffData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromVersion, setFromVersion] = useState<number>(1);
  const [toVersion, setToVersion] = useState<number>(2);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');

  useEffect(() => {
    fetchDocument();
  }, [docId]);

  useEffect(() => {
    if (document && fromVersion && toVersion && fromVersion !== toVersion) {
      fetchDiff();
    }
  }, [document, fromVersion, toVersion]);

  async function fetchDocument() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) {
      router.push('/auth/login');
      return;
    }

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/documents/${docId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await response.json();

      if (data.success) {
        setDocument(data.data);
        // Set default versions
        const versions = data.data.versions;
        if (versions.length >= 2) {
          setFromVersion(versions[versions.length - 1].version);
          setToVersion(versions[0].version);
        }
      }
    } catch (error) {
      console.error('Failed to fetch document:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchDiff() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/documents/${docId}/diff?from=${fromVersion}&to=${toVersion}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await response.json();

      if (data.success) {
        setDiffData(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch diff:', error);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Document not found.</p>
        <Link href="/dashboard/documents" className="text-blue-600 hover:underline mt-4 inline-block">
          Back to Documents
        </Link>
      </div>
    );
  }

  if (document.versions.length < 2) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500 mb-4">Only one version available - nothing to compare.</p>
        <Link
          href={`/dashboard/documents/${docId}`}
          className="text-blue-600 hover:underline"
        >
          Back to Document
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <Link
            href={`/dashboard/documents/${docId}`}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            ← {document.title ?? document.path}
          </Link>
        </div>
        <h1 className="text-2xl font-bold">Version Comparison</h1>
      </div>

      {/* Version selectors */}
      <div className="flex flex-wrap items-center gap-4 mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">From:</label>
          <select
            value={fromVersion}
            onChange={(e) => setFromVersion(parseInt(e.target.value, 10))}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
          >
            {document.versions.map((v) => (
              <option key={v.id} value={v.version} disabled={v.version === toVersion}>
                v{v.version} - {new Date(v.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>

        <span className="text-gray-400">→</span>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400">To:</label>
          <select
            value={toVersion}
            onChange={(e) => setToVersion(parseInt(e.target.value, 10))}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-sm"
          >
            {document.versions.map((v) => (
              <option key={v.id} value={v.version} disabled={v.version === fromVersion}>
                v{v.version} - {new Date(v.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
          <button
            onClick={() => setViewMode('split')}
            className={`px-4 py-1 text-sm ${
              viewMode === 'split'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
            }`}
          >
            Split
          </button>
          <button
            onClick={() => setViewMode('unified')}
            className={`px-4 py-1 text-sm ${
              viewMode === 'unified'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
            }`}
          >
            Unified
          </button>
        </div>
      </div>

      {/* Diff view */}
      {diffData && (
        viewMode === 'split' ? (
          <SplitDiffView from={diffData.from} to={diffData.to} />
        ) : (
          <UnifiedDiffView from={diffData.from} to={diffData.to} />
        )
      )}
    </div>
  );
}

function SplitDiffView({
  from,
  to,
}: {
  from: { version: number; content: string };
  to: { version: number; content: string };
}) {
  const fromLines = from.content.split('\n');
  const toLines = to.content.split('\n');
  const diffLines = computeLineDiff(fromLines, toLines);

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* From */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-2 bg-red-50 dark:bg-red-900/20 border-b border-gray-200 dark:border-gray-700">
          <span className="font-medium text-red-800 dark:text-red-200">v{from.version} (old)</span>
        </div>
        <pre className="p-4 overflow-x-auto text-sm">
          {diffLines.map((line, idx) => (
            <div
              key={`from-${idx}`}
              className={`${
                line.type === 'removed'
                  ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                  : line.type === 'added'
                    ? 'opacity-0 h-6'
                    : ''
              }`}
            >
              {line.type !== 'added' && (
                <span className="select-none text-gray-400 mr-4">{String(line.fromLine ?? '').padStart(4)}</span>
              )}
              {line.type !== 'added' && line.from}
            </div>
          ))}
        </pre>
      </div>

      {/* To */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-2 bg-green-50 dark:bg-green-900/20 border-b border-gray-200 dark:border-gray-700">
          <span className="font-medium text-green-800 dark:text-green-200">v{to.version} (new)</span>
        </div>
        <pre className="p-4 overflow-x-auto text-sm">
          {diffLines.map((line, idx) => (
            <div
              key={`to-${idx}`}
              className={`${
                line.type === 'added'
                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                  : line.type === 'removed'
                    ? 'opacity-0 h-6'
                    : ''
              }`}
            >
              {line.type !== 'removed' && (
                <span className="select-none text-gray-400 mr-4">{String(line.toLine ?? '').padStart(4)}</span>
              )}
              {line.type !== 'removed' && line.to}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

function UnifiedDiffView({
  from,
  to,
}: {
  from: { version: number; content: string };
  to: { version: number; content: string };
}) {
  const fromLines = from.content.split('\n');
  const toLines = to.content.split('\n');
  const diffLines = computeLineDiff(fromLines, toLines);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <span className="font-medium">
          v{from.version} → v{to.version}
        </span>
      </div>
      <pre className="p-4 overflow-x-auto text-sm">
        {diffLines.map((line, idx) => (
          <div
            key={idx}
            className={`${
              line.type === 'added'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200'
                : line.type === 'removed'
                  ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
                  : ''
            }`}
          >
            <span className="select-none text-gray-400 w-6 inline-block">
              {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
            </span>
            {line.type === 'added' ? line.to : line.from}
          </div>
        ))}
      </pre>
    </div>
  );
}

interface DiffLine {
  type: 'same' | 'added' | 'removed';
  from?: string;
  to?: string;
  fromLine?: number;
  toLine?: number;
}

function computeLineDiff(fromLines: string[], toLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  const maxLen = Math.max(fromLines.length, toLines.length);

  let fromIdx = 0;
  let toIdx = 0;

  // Simple line-by-line diff (not optimal, but works for display)
  while (fromIdx < fromLines.length || toIdx < toLines.length) {
    const fromLine = fromLines[fromIdx];
    const toLine = toLines[toIdx];

    if (fromLine === toLine) {
      result.push({
        type: 'same',
        from: fromLine,
        to: toLine,
        fromLine: fromIdx + 1,
        toLine: toIdx + 1,
      });
      fromIdx++;
      toIdx++;
    } else if (fromLine !== undefined && !toLines.slice(toIdx).includes(fromLine)) {
      result.push({
        type: 'removed',
        from: fromLine,
        fromLine: fromIdx + 1,
      });
      fromIdx++;
    } else if (toLine !== undefined && !fromLines.slice(fromIdx).includes(toLine)) {
      result.push({
        type: 'added',
        to: toLine,
        toLine: toIdx + 1,
      });
      toIdx++;
    } else {
      // Line exists later - mark current as removed/added
      if (fromLine !== undefined) {
        result.push({
          type: 'removed',
          from: fromLine,
          fromLine: fromIdx + 1,
        });
        fromIdx++;
      }
      if (toLine !== undefined) {
        result.push({
          type: 'added',
          to: toLine,
          toLine: toIdx + 1,
        });
        toIdx++;
      }
    }

    // Safety check
    if (result.length > maxLen * 3) break;
  }

  return result;
}
