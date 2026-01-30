import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { createLogger } from '@docsynth/utils';
import { connectDatabase, disconnectDatabase } from '@docsynth/database';
import { initializeRedis, closeAllQueues } from '@docsynth/queue';
import { initializeGitHubApp } from '@docsynth/github';

// Route registry - organizes all routes in one place
import { registerAllRoutes } from './routes/index.js';

// API Documentation
import { docsApp } from './docs/openapi.js';
import { errorHandler } from './middleware/error-handler.js';
import { initializeWebSocket, closeWebSocket } from './services/websocket.js';

const log = createLogger('api');

// Create Hono app
const app = new Hono();

// Global middleware
app.use('*', honoLogger());
app.use('*', prettyJSON());
app.use(
  '*',
  cors({
    origin: process.env.APP_URL ?? 'http://localhost:3000',
    credentials: true,
  })
);

// Error handling
app.onError(errorHandler);

// Register all routes from the route registry
const routeCount = registerAllRoutes(app);
log.info({ routeCount }, 'Registered API routes');

// API Documentation (Swagger UI)
app.route('/', docsApp);

// 404 handler
app.notFound((c) => {
  return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
});

// Startup
async function start() {
  const port = parseInt(process.env.PORT ?? '3001', 10);

  try {
    // Initialize database
    log.info('Connecting to database...');
    await connectDatabase();

    // Initialize Redis
    log.info('Connecting to Redis...');
    initializeRedis(process.env.REDIS_URL ?? 'redis://localhost:6379');

    // Initialize GitHub App
    log.info('Initializing GitHub App...');
    initializeGitHubApp({
      appId: process.env.GITHUB_APP_ID ?? '',
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY ?? '',
      clientId: process.env.GITHUB_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    });

    // Start server
    log.info({ port }, 'Starting API server...');
    const server = serve({
      fetch: app.fetch,
      port,
    });

    // Initialize WebSocket (cast to http.Server for ws compatibility)
    log.info('Initializing WebSocket server...');
    initializeWebSocket(server as unknown as import('http').Server);

    log.info({ port }, '🚀 DocSynth API server running');
  } catch (error) {
    log.error({ error }, 'Failed to start server');
    process.exit(1);
  }
}

// Graceful shutdown
async function shutdown() {
  log.info('Shutting down...');

  try {
    closeWebSocket();
    await closeAllQueues();
    await disconnectDatabase();
    log.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    log.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();

export { app };
