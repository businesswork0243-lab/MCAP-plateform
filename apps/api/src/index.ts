import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { startKeepAlive } from './services/keepalive';

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

// ── Security Middleware ───────────────────────────────────────────────────────

app.set('trust proxy', 1); // Render ke liye zaroori hai

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──────────────────────────────────────────────────────────────────────

const getAllowedOrigins = (): string[] => {
  const origins = [
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  if (process.env.WEB_URL) {
    const webUrl = process.env.WEB_URL.startsWith('http')
      ? process.env.WEB_URL
      : `https://${process.env.WEB_URL}`;
    origins.push(webUrl);
  }

  return origins;
};

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    // ✅ Vercel (production + all preview deployments)
    if (origin.endsWith('.vercel.app')) return callback(null, true);

    // ✅ Railway
    if (origin.endsWith('.up.railway.app')) return callback(null, true);
    if (origin.endsWith('.railway.app'))    return callback(null, true);

    // Legacy Render
    if (origin.endsWith('.onrender.com'))   return callback(null, true);

    // Localhost
    if (origin.includes('localhost'))       return callback(null, true);

    // Explicit whitelist
    if (getAllowedOrigins().includes(origin)) return callback(null, true);

    logger.warn(`CORS blocked: ${origin}`);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// ── Rate Limiting ─────────────────────────────────────────────────────────────

// Global rate limit
const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    error: 'Too many requests',
    retryAfter: 'Check Retry-After header'
  },
  skip: (req: Request) => req.path === '/health', // Health check skip karo
});

// Auth routes ke liye strict limit
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts
  message: { error: 'Too many auth attempts, try again later' },
});

// AI pipeline ke liye separate limit (expensive operation hai)
const pipelineLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 5,               // 5 pipeline runs per minute
  message: { error: 'Pipeline rate limit exceeded, wait 1 minute' },
});

app.use(globalLimiter);

// ── Body Parsing ──────────────────────────────────────────────────────────────

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Request Logging ───────────────────────────────────────────────────────────

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] || 
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  
  // Response header mein request ID add karo
  res.setHeader('X-Request-ID', requestId as string);
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    // Health check logs skip karo
    if (req.path !== '/health') {
      logger.info({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`,
        requestId,
        ip: req.ip,
      });
    }
  });
  
  next();
});

// ── Health Check ──────────────────────────────────────────────────────────────

app.get('/health', async (_req: Request, res: Response) => {
  try {
    // DB check bhi karo
    const { pool } = await import('./db/connection');
    await pool.query('SELECT 1');
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      services: {
        database: 'connected',
        api: 'running',
      },
    });
  } catch (error) {
    // DB down hai but service chal rahi hai
    res.status(503).json({
      status: 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        database: 'disconnected',
        api: 'running',
      },
    });
  }
});

// ── API Routes ────────────────────────────────────────────────────────────────

// Public
app.use('/api/auth', authLimiter, authRoutes);

app.use('/api/admin', adminRoutes);

// Protected
app.use('/api/content', contentRoutes);
app.use('/api/brand', brandRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/departments', departmentRoutes);

// ── 404 Handler ───────────────────────────────────────────────────────────────

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method,
  });
});

// ── Global Error Handler ──────────────────────────────────────────────────────

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // CORS error
  if (err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message });
  }

  // JSON parse error
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  // Log karo (lekin production mein stack trace hide karo)
  logger.error({
    error: err.message,
    path: req.path,
    method: req.method,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  res.status(500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// ── Server Start ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 4000;

async function start(): Promise<void> {
  try {
    // 1. Database connect karo
    await connectDB();
    logger.info('Database connected');

    // 2. WebSocket init karo
    initWebSocket(httpServer);
    logger.info('WebSocket initialized');

    if (process.env.NODE_ENV === 'production' && process.env.AI_ENGINE_URL) {
      startKeepAlive();
    }

    // 3. Worker sirf agar explicitly enabled ho
    if (process.env.RUN_WORKERS === 'true') {
      startContentWorker();
      logger.info('Content worker started');
    }

    // 4. Server start karo
    httpServer.listen(PORT, () => {
      logger.info(`MCAP API running on port ${PORT} [${process.env.NODE_ENV}]`);
    });

    // 5. Graceful shutdown
    setupGracefulShutdown();

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

function setupGracefulShutdown(): void {
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully...`);
    
    httpServer.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit after 10 seconds
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
