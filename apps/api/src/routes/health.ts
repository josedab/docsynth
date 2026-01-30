import { Hono } from 'hono';
import { isDatabaseHealthy } from '@docsynth/database';
import { getRedisConnection } from '@docsynth/queue';

const app = new Hono();

app.get('/', async (c) => {
  const dbHealthy = await isDatabaseHealthy();

  let redisHealthy = false;
  try {
    const redis = getRedisConnection();
    const pong = await redis.ping();
    redisHealthy = pong === 'PONG';
  } catch {
    redisHealthy = false;
  }

  const healthy = dbHealthy && redisHealthy;

  return c.json(
    {
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down',
      },
    },
    healthy ? 200 : 503
  );
});

app.get('/ready', (c) => {
  return c.json({ ready: true });
});

app.get('/live', (c) => {
  return c.json({ alive: true });
});

export { app as healthRoutes };
