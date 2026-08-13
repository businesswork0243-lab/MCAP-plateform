// apps/api/src/index.ts
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import dotenv from 'dotenv';

// ✅ Updated imports
import {
  startKeepAlive,
  stopKeepAlive,
  getAiEngineStats,
} from './services/keepalive';

// Routes
import authRoutes from './routes/auth';
import contentRoutes from './routes/content';
import brandRoutes from './routes/brand';
import projectRoutes from './routes/projects';
import analyticsRoutes from './routes/analytics';
import teamRoutes from './routes/team';
import campaignRoutes from './routes/campaigns';
import departmentRoutes from './routes/departments';
import adminRoutes from './routes/admin';

// Services
import { initWebSocket } from './services/websocket';
import { connectDB } from './db/connection';
import { startContentWorker } from './jobs/workers/contentWorker';
import { logger } from './lib/logger';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// ── Security ──────────────────────────────────────────────────────────────────

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────────────────────

const getAllowedOrigins = (): string[] => {
  const origins = ['http://localhost:3000', 'http://localhost:3001'];
  if (process.env.WEB_URL) {
    origins.push(
      process.env.WEB_URL.startsWith('http')
        ? process.env.WEB_URL
        : `https://${process.env.WEB_URL}`
    );
  }
  return origins;
};

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    if (origin.endsWith('.up.railway.app')) return callback(null, true);
    if (origin.endsWith('.railway.app')) return callback(null, true);
    if (origin.endsWith('.onrender.com')) return callback(null, true);
    if (origin.includes('localhost')) return callback(null, true);
    if (getAllowedOrigins().includes(origin)) return callback(null, true);
    logger.warn(`CORS blocked: ${origin}`);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// ── Rate Limiting ─────────────────────────────────────────────────────────────

const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', retryAfter: 'Check Retry-After header' },
  skip: (req: Request) => req.path === '/health' || req.path === '/',
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts' },
});

app.use(globalLimiter);

// ── Body Parsing ──────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Bot / Scanner Rejection ───────────────────────────────────────────────────

const KNOWN_BAD_PATHS = new Set([
  '/icps/all', '/generate', '/wp-admin', '/wp-login.php',
  '/.env', '/.git/config', '/admin', '/phpmyadmin',
  '/xmlrpc.php', '/wordpress',
]);

const BAD_PATH_PATTERNS = [
  /\.php$/i, /\.asp$/i, /\.aspx$/i,
  /\/wp-/i, /\/wordpress/i, /\/\.git/i,
  /\/\.env/i, /\/admin\.php/i, /\/phpinfo/i,
];

app.use((req: Request, res: Response, next: NextFunction) => {
  const path = req.path;
  if (KNOWN_BAD_PATHS.has(path)) { res.status(404).end(); return; }
  if (BAD_PATH_PATTERNS.some(p => p.test(path))) { res.status(404).end(); return; }
  if (path !== '/health' && path !== '/' && !path.startsWith('/api')) {
    res.status(404).end();
    return;
  }
  next();
});

// ── Request Logging ───────────────────────────────────────────────────────────

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  res.setHeader('X-Request-ID', requestId as string);

  res.on('finish', () => {
    if (req.path === '/health' || req.path === '/') return;
    const logData = {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: `${Date.now() - start}ms`,
      requestId,
      ip: req.ip,
    };
    if (res.statusCode >= 500) logger.error(logData);
    else if (res.statusCode >= 400) logger.warn(logData);
    else logger.info(logData);
  });

  next();
});

// ── Root ──────────────────────────────────────────────────────────────────────

app.get('/', (_req: Request, res: Response) => {
  res.json({ service: 'MCAP API', status: 'running', version: '1.0.0' });
});

// ── Health ────────────────────────────────────────────────────────────────────

app.get('/health', async (_req: Request, res: Response) => {
  try {
    const { pool } = await import('./db/connection');
    await pool.query('SELECT 1');

    // ✅ AI Engine stats bhi include
    const ai = getAiEngineStats();

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      services: {
        database: 'connected',
        api: 'running',
        ai_engine: {
          healthy: ai.healthy,
          last_seen: ai.lastSeenAt,
          last_seen_ago: ai.lastSeenAgoMs > 0
            ? `${Math.round(ai.lastSeenAgoMs / 1000)}s ago`
            : 'never',
          total_pings: ai.totalPings,
          failed_pings: ai.failedPings,
          url: ai.url,
        },
      },
    });
  } catch {
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: 'disconnected',
        api: 'running',
        ai_engine: getAiEngineStats(),
      },
    });
  }
});

// ── API Routes ────────────────────────────────────────────────────────────────

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/brand', brandRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/departments', departmentRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────

app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found', path: req.path, method: req.method });
});

// ── Global Error ──────────────────────────────────────────────────────────────

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  if (err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  logger.error({
    error: err.message,
    path: req.path,
    method: req.method,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000;

async function start(): Promise<void> {
  try {
    await connectDB();
    logger.info('✅ Database connected');

    initWebSocket(httpServer);
    logger.info('✅ WebSocket initialized');

    // ✅ Keep-alive: production mein hamesha start karo
    // Railway pe sleep nahi hoti, lekin cold start/crash protection ke liye zaroori hai
    if (process.env.AI_ENGINE_URL) {
      startKeepAlive();
    } else {
      logger.warn('⚠️ AI_ENGINE_URL not set — keep-alive disabled');
    }

    if (process.env.RUN_WORKERS === 'true') {
      startContentWorker();
      logger.info('✅ Content worker started');
    }

    httpServer.listen(PORT, () => {
      logger.info(`🚀 MCAP API on port ${PORT} [${process.env.NODE_ENV}]`);
    });

    setupGracefulShutdown();

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down...`);

    // ✅ Keep-alive pehle band karo
    stopKeepAlive();

    httpServer.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection:', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
  });
}

start();