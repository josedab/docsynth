'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Document {
  id: string;
  path: string;
  type: string;
  title: string | null;
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  repository: {
    id: string;
    name: string;
    githubFullName: string;
  };
}

const DOC_TYPE_LABELS: Record<string, string> = {
  README: 'README',
  API_REFERENCE: 'API Reference',
  CHANGELOG: 'Changelog',
  GUIDE: 'Guide',
  TUTORIAL: 'Tutorial',
  ARCHITECTURE: 'Architecture',
  ADR: 'ADR',
  INLINE_COMMENT: 'Inline Comment',
};

const DOC_TYPE_COLORS: Record<string, string> = {
  README: 'bg-blue-100 text-blue-800',
  API_REFERENCE: 'bg-purple-100 text-purple-800',
  CHANGELOG: 'bg-green-100 text-green-800',
  GUIDE: 'bg-yellow-100 text-yellow-800',
  TUTORIAL: 'bg-orange-100 text-orange-800',
  ARCHITECTURE: 'bg-pink-100 text-pink-800',
  ADR: 'bg-indigo-100 text-indigo-800',
  INLINE_COMMENT: 'bg-gray-100 text-gray-800',
};

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    fetchDocuments();
  }, [filter, page]);

  async function fetchDocuments() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    try {
      const params = new URLSearchParams({
        page: page.toString(),
        perPage: '20',
      });

      if (filter !== 'all') {
        params.set('type', filter);
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/documents?${params}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      const data = await response.json();

      if (data.success) {
        setDocuments(data.data);
        setHasMore(data.meta?.hasMore ?? false);
      }
    } catch (error) {
      console.error('Failed to fetch documents:', error);
    } finally {
      setLoading(false);
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
        <h1 className="text-2xl font-bold">Documents</h1>
      </div>

      {/* Filter buttons */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => {
            setFilter('all');
            setPage(1);
          }}
          className={`px-3 py-1 text-sm rounded-lg ${
            filter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          All
        </button>
        {Object.entries(DOC_TYPE_LABELS).map(([type, label]) => (
          <button
            key={type}
            onClick={() => {
              setFilter(type);
              setPage(1);
            }}
            className={`px-3 py-1 text-sm rounded-lg ${
              filter === type
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {documents.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
          <p className="text-gray-500 mb-4">No documents found.</p>
          <p className="text-sm text-gray-400">
            Documents will appear here after documentation is generated for your repositories.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {documents.map((doc) => (
            <DocumentCard key={doc.id} document={doc} />
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

function DocumentCard({ document }: { document: Document }) {
  const typeLabel = DOC_TYPE_LABELS[document.type] ?? document.type;
  const typeColor = DOC_TYPE_COLORS[document.type] ?? 'bg-gray-100 text-gray-800';

  // Get preview of content (first 200 chars)
  const preview = document.content
    ? document.content.replace(/^#.*\n/, '').substring(0, 200).trim() + '...'
    : 'No content available';

  return (
    <Link href={`/dashboard/documents/${document.id}`}>
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 hover:border-blue-400 hover:shadow-md transition-all cursor-pointer">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-3">
            <span className={`px-2 py-1 text-xs font-medium rounded-full ${typeColor}`}>
              {typeLabel}
            </span>
            <h3 className="font-semibold">{document.title ?? document.path}</h3>
          </div>
          <span className="text-xs text-gray-500">v{document.version}</span>
        </div>

        <p className="text-gray-600 dark:text-gray-400 text-sm mb-3 line-clamp-2">{preview}</p>

        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>{document.repository.githubFullName}</span>
          <span>Updated {new Date(document.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </Link>
  );
}
