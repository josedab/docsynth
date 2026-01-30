import type { Context, Next, MiddlewareHandler } from 'hono';
import type { z, ZodError, ZodIssue } from 'zod';
import { ValidationError } from '@docsynth/utils';

type ValidationTarget = 'json' | 'query' | 'param';

interface ValidationConfig<T extends z.ZodType> {
  schema: T;
  target?: ValidationTarget;
}

/**
 * Middleware factory for Zod request validation.
 * Validates request body, query params, or route params against a Zod schema.
 * 
 * @example
 * const createSessionSchema = z.object({
 *   repositoryId: z.string().uuid(),
 * });
 * 
 * app.post('/sessions', validate({ schema: createSessionSchema }), async (c) => {
 *   const body = c.get('validatedBody');
 *   // body is fully typed as { repositoryId: string }
 * });
 */
export function validate<T extends z.ZodType>(
  config: ValidationConfig<T>
): MiddlewareHandler {
  const { schema, target = 'json' } = config;

  return async (c: Context, next: Next) => {
    let data: unknown;

    try {
      switch (target) {
        case 'json':
          data = await c.req.json();
          break;
        case 'query':
          data = c.req.query();
          break;
        case 'param':
          data = c.req.param();
          break;
      }
    } catch {
      throw new ValidationError('Invalid request body: expected JSON');
    }

    const result = schema.safeParse(data);

    if (!result.success) {
      const zodError = result.error as ZodError;
      const errors = zodError.issues.map((issue: ZodIssue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      throw new ValidationError('Request validation failed', { errors });
    }

    // Store validated data in context for handler to use
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c as any).set('validatedBody', result.data);

    await next();
  };
}

/**
 * Validate JSON body with a Zod schema.
 * Shorthand for validate({ schema, target: 'json' })
 */
export function validateBody<T extends z.ZodType>(schema: T): MiddlewareHandler {
  return validate({ schema, target: 'json' });
}

/**
 * Validate query parameters with a Zod schema.
 * Shorthand for validate({ schema, target: 'query' })
 */
export function validateQuery<T extends z.ZodType>(schema: T): MiddlewareHandler {
  return validate({ schema, target: 'query' });
}

/**
 * Validate route parameters with a Zod schema.
 * Shorthand for validate({ schema, target: 'param' })
 */
export function validateParams<T extends z.ZodType>(schema: T): MiddlewareHandler {
  return validate({ schema, target: 'param' });
}
