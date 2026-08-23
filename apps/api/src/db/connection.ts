import { Pool, PoolClient } from 'pg';
import { runMigrations } from './migrate';
import { logger } from '../lib/logger';

// ── Pool Singleton ─────────────────────────────────────────────────────────────

let _pool: Pool | null = null;
export let pool: Pool;

export function getPool(): Pool {
  if (!_pool) throw new Error('DB not initialized. Call connectDB() first.');
  return _pool;
}

// ── Connection ────────────────────────────────────────────────────────────────

export async function connectDB(): Promise<void> {
  if (_pool) {
    logger.warn('connectDB() called again — pool already exists');
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  const isLocal = 
    connectionString.includes('localhost') || 
    connectionString.includes('127.0.0.1') ||
    connectionString.includes('@postgres') ||
    connectionString.includes('mcap_secret');

  _pool = new Pool({
    connectionString,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLocal 
      ? false 
      : { rejectUnauthorized: false }, // Cloud database self-signed cert
  });
  pool = _pool;

  // Pool error handler
  _pool.on('error', (err) => {
    logger.error('PostgreSQL pool error:', { error: err.message });
  });

  _pool.on('connect', () => {
    logger.debug('New DB client connected');
  });

  // Connection test
  try {
    const client = await _pool.connect();
    await client.query('SELECT 1');
    client.release();
    logger.info('PostgreSQL connected successfully');
  } catch (error) {
    logger.error('PostgreSQL connection failed:', { 
      error: error instanceof Error ? error.message : error 
    });
    throw error;
  }

  // Migrations run karo
  await runMigrations(_pool);
}

// ── Query Helpers ─────────────────────────────────────────────────────────────

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const pool = getPool();
  
  try {
    const result = await pool.query(sql, params);
    return result.rows as T[];
  } catch (error) {
    // SQL error log karo lekin expose mat karo
    logger.error('Query failed:', {
      error: error instanceof Error ? error.message : error,
      // Production mein SQL log mat karo (sensitive data ho sakta hai)
      sql: process.env.NODE_ENV === 'development' ? sql : undefined,
    });
    throw error;
  }
}

export async function queryOne<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

// ── Transaction Helper ────────────────────────────────────────────────────────

export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Transaction rolled back:', { 
      error: error instanceof Error ? error.message : error 
    });
    throw error;
  } finally {
    client.release();
  }
}

// ── Graceful Disconnect ───────────────────────────────────────────────────────

export async function disconnectDB(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    logger.info('PostgreSQL pool closed');
  }
}
