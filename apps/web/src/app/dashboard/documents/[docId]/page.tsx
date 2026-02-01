'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface DocVersion {
  id: string;
  version: number;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  generationJob?: {
    id: string;
    status: string;
    completedAt: string | null;
  } | null;
}

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
  versions: DocVersion[];
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

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const docId = params.docId as string;

  const [document, setDocument] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'preview' | 'raw'>('preview');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchDocument();
  }, [docId]);

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
        setSelectedVersion(data.data.version);
      }
    } catch (error) {
      console.error('Failed to fetch document:', error);
    } finally {
      setLoading(false);
    }
  }

  async function copyToClipboard() {
    if (!document) return;
    try {
      await navigator.clipboard.writeText(document.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }

  function downloadMarkdown() {
    if (!document) return;
    const blob = new Blob([document.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = document.path.replace(/\//g, '_') || 'document.md';
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadHtml() {
    if (!document) return;
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${document.title ?? document.path}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 2rem; line-height: 1.6; }
    h1, h2, h3 { margin-top: 1.5em; }
    code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f4f4f4; padding: 1em; border-radius: 5px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    a { color: #0066cc; }
    ul, ol { padding-left: 2em; }
  </style>
</head>
<body>
${simpleMarkdownToHtml(document.content)}
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = (document.path.replace(/\//g, '_') || 'document') + '.html';
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadPlainText() {
    if (!document) return;
    // Strip markdown formatting for plain text
    const plainText = document.content
      .replace(/^#{1,6}\s+/gm, '') // Remove headers
      .replace(/\*\*\*(.*?)\*\*\*/g, '$1') // Bold italic
      .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
      .replace(/\*(.*?)\*/g, '$1') // Italic
      .replace(/`([^`]+)`/g, '$1') // Inline code
      .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/g, '')) // Code blocks
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Links
    
    const blob = new Blob([plainText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = (document.path.replace(/\//g, '_') || 'document') + '.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  function printAsPdf() {
    if (!document) return;
    
    // Create a print-friendly version
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${document.title ?? document.path}</title>
  <style>
    @media print {
      body { margin: 0; padding: 20mm; }
      .no-print { display: none; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.6;
      color: #1a1a1a;
    }
    h1 { font-size: 2em; margin-top: 1.5em; margin-bottom: 0.5em; border-bottom: 2px solid #eee; padding-bottom: 0.3em; }
    h2 { font-size: 1.5em; margin-top: 1.3em; margin-bottom: 0.5em; }
    h3 { font-size: 1.25em; margin-top: 1.2em; margin-bottom: 0.5em; }
    code { background: #f4f4f4; padding: 0.2em 0.4em; border-radius: 3px; font-size: 0.9em; font-family: 'SF Mono', Monaco, Consolas, monospace; }
    pre { background: #f4f4f4; padding: 1em; border-radius: 5px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    ul, ol { padding-left: 2em; }
    blockquote { margin: 1em 0; padding-left: 1em; border-left: 4px solid #ddd; color: #666; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f4f4f4; }
    .header { margin-bottom: 2em; padding-bottom: 1em; border-bottom: 1px solid #eee; }
    .header h1 { border: none; margin: 0; }
    .meta { color: #666; font-size: 0.9em; margin-top: 0.5em; }
    .print-btn { position: fixed; top: 20px; right: 20px; padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 5px; cursor: pointer; }
    .print-btn:hover { background: #0052a3; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>
  <div class="header">
    <h1>${document.title ?? document.path}</h1>
    <div class="meta">
      Repository: ${document.repository.githubFullName} • 
      Type: ${document.type} • 
      Version: ${document.version} •
      Generated by DocSynth
    </div>
  </div>
  ${simpleMarkdownToHtml(document.content)}
</body>
</html>`;
    
    printWindow.document.write(html);
    printWindow.document.close();
  }

  const [showExportMenu, setShowExportMenu] = useState(false);

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

  const currentContent =
    selectedVersion === document.version
      ? document.content
      : document.versions.find((v) => v.version === selectedVersion)?.content ?? document.content;

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Link
              href="/dashboard/documents"
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              ← Documents
            </Link>
          </div>
          <h1 className="text-2xl font-bold">{document.title ?? document.path}</h1>
          <div className="flex items-center gap-3 mt-2">
            <span
              className={`px-2 py-1 text-xs font-medium rounded-full ${getTypeColor(document.type)}`}
            >
              {DOC_TYPE_LABELS[document.type] ?? document.type}
            </span>
            <span className="text-gray-500">{document.repository.githubFullName}</span>
            <span className="text-gray-500">•</span>
            <span className="text-gray-500">{document.path}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={copyToClipboard}
            className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          
          {/* Export dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="px-3 py-2 text-sm bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 flex items-center gap-1"
            >
              Export
              <span className="text-xs">▼</span>
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-10">
                <button
                  onClick={() => { downloadMarkdown(); setShowExportMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-t-lg"
                >
                  📄 Markdown (.md)
                </button>
                <button
                  onClick={() => { downloadHtml(); setShowExportMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  🌐 HTML (.html)
                </button>
                <button
                  onClick={() => { downloadPlainText(); setShowExportMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  📝 Plain Text (.txt)
                </button>
                <button
                  onClick={() => { printAsPdf(); setShowExportMenu(false); }}
                  className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-b-lg"
                >
                  📑 Print / PDF
                </button>
              </div>
            )}
          </div>
          
          <Link
            href={`/dashboard/documents/${document.id}/edit`}
            className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Edit
          </Link>
        </div>
      </div>

      {/* Version selector and view toggle */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-4">
          <label className="text-sm text-gray-600 dark:text-gray-400">Version:</label>
          <select
            value={selectedVersion ?? document.version}
            onChange={(e) => setSelectedVersion(parseInt(e.target.value, 10))}
            className="px-3 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm"
          >
            {document.versions.map((v) => (
              <option key={v.id} value={v.version}>
                v{v.version} - {new Date(v.createdAt).toLocaleDateString()}
              </option>
            ))}
          </select>
          {document.versions.length > 1 && (
            <Link
              href={`/dashboard/documents/${document.id}/diff`}
              className="text-sm text-blue-600 hover:underline"
            >
              Compare versions
            </Link>
          )}
        </div>

        <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
          <button
            onClick={() => setViewMode('preview')}
            className={`px-4 py-1 text-sm ${
              viewMode === 'preview'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
            }`}
          >
            Preview
          </button>
          <button
            onClick={() => setViewMode('raw')}
            className={`px-4 py-1 text-sm ${
              viewMode === 'raw'
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300'
            }`}
          >
            Raw
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {viewMode === 'preview' ? (
          <div className="prose prose-sm dark:prose-invert max-w-none p-6">
            <MarkdownRenderer content={currentContent} />
          </div>
        ) : (
          <pre className="p-6 overflow-x-auto text-sm bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
            <code>{currentContent}</code>
          </pre>
        )}
      </div>

      {/* Metadata */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm text-gray-500">Current Version</p>
          <p className="font-semibold">v{document.version}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm text-gray-500">Total Versions</p>
          <p className="font-semibold">{document.versions.length}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm text-gray-500">Created</p>
          <p className="font-semibold">{new Date(document.createdAt).toLocaleDateString()}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm text-gray-500">Last Updated</p>
          <p className="font-semibold">{new Date(document.updatedAt).toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  );
}

function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    README: 'bg-blue-100 text-blue-800',
    API_REFERENCE: 'bg-purple-100 text-purple-800',
    CHANGELOG: 'bg-green-100 text-green-800',
    GUIDE: 'bg-yellow-100 text-yellow-800',
    TUTORIAL: 'bg-orange-100 text-orange-800',
    ARCHITECTURE: 'bg-pink-100 text-pink-800',
    ADR: 'bg-indigo-100 text-indigo-800',
    INLINE_COMMENT: 'bg-gray-100 text-gray-800',
  };
  return colors[type] ?? 'bg-gray-100 text-gray-800';
}

function MarkdownRenderer({ content }: { content: string }) {
  // Simple markdown rendering - in production use a library like react-markdown
  const html = simpleMarkdownToHtml(content);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

function simpleMarkdownToHtml(markdown: string): string {
  let html = markdown
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold and Italic
    .replace(/\*\*\*(.*?)\*\*\*/gim, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    // Code blocks
    .replace(/```(\w*)\n([\s\S]*?)```/gim, '<pre><code class="language-$1">$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/gim, '<code class="inline-code">$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/gim, '<a href="$2" class="text-blue-600 hover:underline">$1</a>')
    // Lists
    .replace(/^\s*[-*]\s+(.*)$/gim, '<li>$1</li>')
    // Line breaks
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // Wrap in paragraph if not starting with a block element
  if (!html.startsWith('<h') && !html.startsWith('<pre') && !html.startsWith('<ul')) {
    html = '<p>' + html + '</p>';
  }

  // Wrap list items
  html = html.replace(/(<li>[\s\S]*?<\/li>)+/gi, '<ul>$&</ul>');

  return html;
}
