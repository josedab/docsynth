'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

interface ReviewRequest {
  id: string;
  documentId: string;
  documentPath: string;
  title: string;
  description?: string;
  reviewType: 'content' | 'technical' | 'style' | 'all';
  status: 'pending' | 'in_review' | 'approved' | 'rejected' | 'changes_requested';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  dueDate?: string;
  requesterId: string;
  requesterName?: string;
  assignees: { id: string; name: string; status: string; decision?: string }[];
  commentsCount: number;
  createdAt: string;
  updatedAt: string;
}

interface ReviewComment {
  id: string;
  authorId: string;
  authorName?: string;
  content: string;
  lineStart?: number;
  lineEnd?: number;
  resolved: boolean;
  createdAt: string;
}

interface CollaborativeReviewsProps {
  repositoryId: string;
  token: string;
  userId: string;
  onOpenDocument?: (documentId: string) => void;
}

export function CollaborativeReviews({ repositoryId, token, userId, onOpenDocument }: CollaborativeReviewsProps) {
  const [reviews, setReviews] = useState<ReviewRequest[]>([]);
  const [selectedReview, setSelectedReview] = useState<ReviewRequest | null>(null);
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'my_reviews' | 'requested_by_me'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newComment, setNewComment] = useState('');

  const fetchReviews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (filter === 'my_reviews') params.append('reviewerId', userId);
      if (filter === 'requested_by_me') params.append('requesterId', userId);

      const response = await apiFetch<{ success: boolean; data: ReviewRequest[] }>(
        `/api/review-workflow/repositories/${repositoryId}/reviews?${params}`,
        { token }
      );
      setReviews(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }, [repositoryId, token, filter, statusFilter, userId]);

  const fetchComments = async (reviewId: string) => {
    try {
      const response = await apiFetch<{ success: boolean; data: ReviewComment[] }>(
        `/api/review-workflow/reviews/${reviewId}/comments`,
        { token }
      );
      setComments(response.data);
    } catch (err) {
      console.error('Failed to load comments:', err);
    }
  };

  const handleSubmitDecision = async (reviewId: string, decision: string) => {
    try {
      await apiFetch(`/api/review-workflow/reviews/${reviewId}/decision`, {
        method: 'POST',
        token,
        body: JSON.stringify({ decision }),
      });
      fetchReviews();
      if (selectedReview?.id === reviewId) {
        setSelectedReview(prev => prev ? { ...prev, status: decision === 'approve' ? 'approved' : 'changes_requested' } : null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit decision');
    }
  };

  const handleAddComment = async () => {
    if (!selectedReview || !newComment.trim()) return;

    try {
      await apiFetch(`/api/review-workflow/reviews/${selectedReview.id}/comments`, {
        method: 'POST',
        token,
        body: JSON.stringify({ content: newComment }),
      });
      setNewComment('');
      fetchComments(selectedReview.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add comment');
    }
  };

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    if (selectedReview) {
      fetchComments(selectedReview.id);
    }
  }, [selectedReview]);

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: 'bg-gray-100 text-gray-800',
      in_review: 'bg-blue-100 text-blue-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      changes_requested: 'bg-yellow-100 text-yellow-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      low: 'bg-gray-100 text-gray-600',
      normal: 'bg-blue-100 text-blue-600',
      high: 'bg-orange-100 text-orange-600',
      urgent: 'bg-red-100 text-red-600',
    };
    return colors[priority] || 'bg-gray-100 text-gray-600';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            👥 Collaborative Reviews
          </h2>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Request Review
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mt-4">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All Reviews</option>
            <option value="my_reviews">Assigned to Me</option>
            <option value="requested_by_me">Requested by Me</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="in_review">In Review</option>
            <option value="approved">Approved</option>
            <option value="changes_requested">Changes Requested</option>
          </select>
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            {error}
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Reviews List */}
        <div className="col-span-2 bg-white rounded-lg shadow divide-y">
          {reviews.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <div className="text-4xl mb-2">📋</div>
              <div>No reviews found</div>
            </div>
          ) : (
            reviews.map((review) => (
              <div
                key={review.id}
                onClick={() => setSelectedReview(review)}
                className={`p-4 cursor-pointer hover:bg-gray-50 ${
                  selectedReview?.id === review.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-medium">{review.title}</div>
                    <div className="text-sm text-gray-500">{review.documentPath}</div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`px-2 py-0.5 rounded text-xs ${getStatusBadge(review.status)}`}>
                        {review.status.replace('_', ' ')}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs ${getPriorityBadge(review.priority)}`}>
                        {review.priority}
                      </span>
                      <span className="text-xs text-gray-400">
                        {review.commentsCount} comments
                      </span>
                    </div>
                  </div>
                  {review.dueDate && (
                    <div className="text-xs text-gray-500">
                      Due: {new Date(review.dueDate).toLocaleDateString()}
                    </div>
                  )}
                </div>

                {/* Assignees */}
                <div className="flex items-center gap-1 mt-2">
                  {review.assignees.map((assignee, i) => (
                    <div
                      key={i}
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs text-white ${
                        assignee.decision === 'approve' ? 'bg-green-500' :
                        assignee.decision === 'reject' ? 'bg-red-500' :
                        assignee.decision === 'request_changes' ? 'bg-yellow-500' : 'bg-gray-400'
                      }`}
                      title={`${assignee.name}: ${assignee.status}`}
                    >
                      {assignee.name?.[0] || '?'}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Review Detail */}
        <div className="bg-white rounded-lg shadow">
          {selectedReview ? (
            <div className="h-full flex flex-col">
              <div className="p-4 border-b">
                <h3 className="font-medium">{selectedReview.title}</h3>
                <p className="text-sm text-gray-500 mt-1">{selectedReview.description}</p>
              </div>

              {/* Actions */}
              {selectedReview.assignees.some(a => a.id === userId && a.status !== 'completed') && (
                <div className="p-4 border-b flex gap-2">
                  <button
                    onClick={() => handleSubmitDecision(selectedReview.id, 'approve')}
                    className="flex-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => handleSubmitDecision(selectedReview.id, 'request_changes')}
                    className="flex-1 px-3 py-2 bg-yellow-500 text-white rounded-lg hover:bg-yellow-600 text-sm"
                  >
                    ↻ Changes
                  </button>
                </div>
              )}

              {/* Comments */}
              <div className="flex-1 overflow-auto p-4 space-y-3 max-h-64">
                {comments.map((comment) => (
                  <div key={comment.id} className={`p-3 rounded-lg ${
                    comment.resolved ? 'bg-gray-100' : 'bg-blue-50'
                  }`}>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                      <span className="font-medium">{comment.authorName || 'User'}</span>
                      <span>{new Date(comment.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="text-sm">{comment.content}</div>
                    {comment.lineStart && (
                      <div className="text-xs text-gray-400 mt-1">
                        Line {comment.lineStart}{comment.lineEnd ? `-${comment.lineEnd}` : ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Add Comment */}
              <div className="p-4 border-t">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Add a comment..."
                  className="w-full border rounded-lg px-3 py-2 text-sm resize-none"
                  rows={2}
                />
                <button
                  onClick={handleAddComment}
                  disabled={!newComment.trim()}
                  className="mt-2 w-full px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  Add Comment
                </button>
              </div>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">
              Select a review to see details
            </div>
          )}
        </div>
      </div>

      {/* Create Review Modal */}
      {showCreateModal && (
        <CreateReviewModal
          repositoryId={repositoryId}
          token={token}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => { setShowCreateModal(false); fetchReviews(); }}
        />
      )}
    </div>
  );
}

interface CreateReviewModalProps {
  repositoryId: string;
  token: string;
  onClose: () => void;
  onCreated: () => void;
}

function CreateReviewModal({ repositoryId, token, onClose, onCreated }: CreateReviewModalProps) {
  const [title, setTitle] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [reviewType, setReviewType] = useState('all');
  const [priority, setPriority] = useState('normal');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !documentId.trim()) return;

    try {
      setSubmitting(true);
      setError(null);
      await apiFetch(`/api/review-workflow/repositories/${repositoryId}/reviews`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          title,
          documentId,
          reviewType,
          priority,
          description,
        }),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create review');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h3 className="text-lg font-semibold mb-4">Request Document Review</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Review request title"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Document ID</label>
            <input
              type="text"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Document to review"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Review Type</label>
              <select
                value={reviewType}
                onChange={(e) => setReviewType(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="all">All Aspects</option>
                <option value="content">Content</option>
                <option value="technical">Technical</option>
                <option value="style">Style</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 resize-none"
              rows={3}
              placeholder="Additional context for reviewers..."
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !title.trim() || !documentId.trim()}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create Review'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
