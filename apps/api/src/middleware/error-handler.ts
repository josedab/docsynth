import type { Context } from 'hono';
import { AppError, generateId } from '@docsynth/utils';

/**
 * Standardized error response format
 */
interface ErrorResponse {
  success: false;
  error: {
    id: string;          // Unique error ID for tracking
    code: string;        // Machine-readable error code
    message: string;     // Human-readable message
    details?: Record<string, unknown>;  // Additional error context
  };
  meta?: {
    timestamp: string;
    requestId?: string;
  };
}

export function errorHandler(err: Error, c: Context): Response {
  const errorId = generateId('err');
  const timestamp = new Date().toISOString();
  const requestId = c.req.header('x-request-id');

  if (err instanceof AppError) {
    const response: ErrorResponse = {
      success: false,
      error: {
        id: errorId,
        code: err.code,
        message: err.message,
        details: err.details,
      },
      meta: {
        timestamp,
        ...(requestId && { requestId }),
      },
    };

    return c.json(response, err.statusCode as 400 | 401 | 403 | 404 | 429 | 500);
  }

  // Log unexpected errors
  console.error('Unexpected error:', { errorId, error: err });

  const response: ErrorResponse = {
    success: false,
    error: {
      id: errorId,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
    meta: {
      timestamp,
      ...(requestId && { requestId }),
    },
  };

  return c.json(response, 500);
}
