'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Document {
  id: string;
  path: string;
  type: string;
  title: string | null;
  content: string;
  version: number;
  repository: {
    id: string;
    name: string;
    githubFullName: string;
  };
}

export default function DocumentEditPage() {
  const params = useParams();
  const router = useRouter();
  const docId = params.docId as string;

  const [document, setDocument] = useState<Document | null>(null);
  const [content, setContent] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    fetchDocument();
  }, [docId]);

  useEffect(() => {
    if (document) {
      setHasChanges(content !== document.content || title !== (document.title ?? ''));
    }
  }, [content, title, document]);

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
        setContent(data.data.content);
        setTitle(data.data.title ?? '');
      }
    } catch (error) {
      console.error('Failed to fetch document:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    const token = localStorage.getItem('docsynth_token');
    if (!token) return;

    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/api/documents/${docId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            content,
            title: title || null,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        setDocument(data.data);
        setMessage({ type: 'success', text: `Saved as version ${data.data.version}` });
        setHasChanges(false);
      } else {
        setMessage({ type: 'error', text: 'Failed to save changes.' });
      }
    } catch (error) {
      console.error('Failed to save:', error);
      setMessage({ type: 'error', text: 'Failed to save changes.' });
    } finally {
      setSaving(false);
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <Link
            href={`/dashboard/documents/${docId}`}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            ← Back to Document
          </Link>
          <span className="text-gray-400">|</span>
          <span className="text-gray-600 dark:text-gray-400">{document.repository.githubFullName}</span>
          <span className="text-gray-600 dark:text-gray-400">/</span>
          <span className="font-medium">{document.path}</span>
        </div>

        <div className="flex items-center gap-3">
          {hasChanges && (
            <span className="text-sm text-yellow-600">Unsaved changes</span>
          )}
          <Link
            href={`/dashboard/documents/${docId}`}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
          >
            Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={saving || !hasChanges}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {message && (
        <div
          className={`mb-4 p-3 rounded-lg ${
            message.type === 'success'
              ? 'bg-green-50 text-green-800 border border-green-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Title input */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          Document Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Enter document title..."
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      {/* Split view: Editor and Preview */}
      <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">
        {/* Editor */}
        <div className="flex flex-col">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Markdown Editor
          </label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="flex-1 w-full p-4 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
            placeholder="Enter markdown content..."
            spellCheck={false}
          />
        </div>

        {/* Preview */}
        <div className="flex flex-col">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Preview
          </label>
          <div className="flex-1 overflow-auto border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 p-4">
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <MarkdownPreview content={content} />
            </div>
          </div>
        </div>
      </div>

      {/* Info bar */}
      <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
        <span>
          Current version: v{document.version} • Type: {document.type}
        </span>
        <span>
          {content.length.toLocaleString()} characters • ~{Math.ceil(content.split(/\s+/).length)} words
        </span>
      </div>
    </div>
  );
}

function MarkdownPreview({ content }: { content: string }) {
  const html = simpleMarkdownToHtml(content);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function simpleMarkdownToHtml(markdown: string): string {
  let html = markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/```(\w*)\n([\s\S]*?)```/gim, '<pre><code class="language-$1">$2</code></pre>')
    .replace(/`([^`]+)`/gim, '<code class="inline-code bg-gray-100 px-1 rounded">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" class="text-blue-600 hover:underline">$1</a>')
    .replace(/^\s*[-*]\s+(.*)$/gim, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  if (!html.startsWith('<h') && !html.startsWith('<pre') && !html.startsWith('<ul')) {
    html = '<p>' + html + '</p>';
  }

  html = html.replace(/(<li>[\s\S]*?<\/li>)+/gi, '<ul>$&</ul>');

  return html;
}
