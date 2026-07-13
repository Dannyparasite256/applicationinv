import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

let redis: Redis | null = null;
let redisAvailable = false;

export function getRedis(): Redis | null {
  return redis;
}

export function isRedisAvailable(): boolean {
  return redisAvailable;
}

export async function connectRedis(): Promise<Redis | null> {
  try {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true,
    });

    redis.on('error', (err) => {
      redisAvailable = false;
      logger.warn('Redis error', { message: err.message });
    });

    redis.on('connect', () => {
      redisAvailable = true;
      logger.info('Redis connected');
    });

    await redis.connect();
    redisAvailable = true;
    return redis;
  } catch (error) {
    logger.warn('Redis unavailable — falling back to in-memory cache/rate-limit', {
      error: error instanceof Error ? error.message : error,
    });
    redis = null;
    redisAvailable = false;
    return null;
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    redisAvailable = false;
  }
}

/** Simple cache helpers with Redis fallback to memory */
const memoryCache = new Map<string, { value: string; expiresAt: number }>();

/** Never let a stuck Redis peer hang an API request (staff approve, auth, etc.). */
function withRedisTimeout<T>(op: Promise<T>, ms = 800): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Redis op timed out')), ms);
    op.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

export async function cacheGet(key: string): Promise<string | null> {
  if (redis && redisAvailable) {
    try {
      return await withRedisTimeout(redis.get(key));
    } catch {
      redisAvailable = false;
    }
  }
  const entry = memoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key);
    return null;
  }
  return entry.value;
}

export async function cacheSet(key: string, value: string, ttlSeconds = 300): Promise<void> {
  if (redis && redisAvailable) {
    try {
      await withRedisTimeout(redis.setex(key, ttlSeconds, value));
      return;
    } catch {
      redisAvailable = false;
    }
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheDel(key: string): Promise<void> {
  if (redis && redisAvailable) {
    try {
      await withRedisTimeout(redis.del(key));
      return;
    } catch {
      redisAvailable = false;
    }
  }
  memoryCache.delete(key);
}
