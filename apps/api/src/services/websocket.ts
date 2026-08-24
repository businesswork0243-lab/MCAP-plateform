import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { contentQueueEvents } from '../jobs/queue';
import { queryOne } from '../db/connection';
import { JWT_SECRET } from '../middleware/auth';
import { logger } from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuthenticatedSocket extends Socket {
  userId?:         string;
  organizationId?: string;
  role?:           string;
}

interface ProgressData {
  requestId?: string;
  percentage?: number;
  step?:       string;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let io: SocketServer;

// ─── Allowed Origins ──────────────────────────────────────────────────────────

function getAllowedOrigins(): string[] {
  const origins = [
    'http://localhost:3000',
    'http://localhost:3001',
  ];

  if (process.env.WEB_URL) {
    const url = process.env.WEB_URL.startsWith('http')
      ? process.env.WEB_URL
      : `https://${process.env.WEB_URL}`;
    origins.push(url);
  }

  return origins;
}

// ─── Auth Middleware for WebSocket ────────────────────────────────────────────

async function authenticateSocket(
  socket: AuthenticatedSocket,
  next:   (err?: Error) => void
): Promise<void> {
  try {
    // Token can come from:
    // 1. Auth header (for HTTP-upgrade)
    // 2. Query param (for EventSource/polling)
    // 3. handshake.auth.token
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token || typeof token !== 'string') {
      // Allow unauthenticated connections for public events
      // but mark them as anonymous
      logger.warn('WebSocket: unauthenticated connection', {
        ip: socket.handshake.address,
      });
      return next(); // Allow — but socket won't join org rooms
    }

    // Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      type:   string;
    };

    if (decoded.type !== 'access') {
      return next(new Error('Invalid token type'));
    }

    // Fetch user
    const user = await queryOne<{
      id:              string;
      organization_id: string;
      role:            string;
      status:          string;
    }>(
      'SELECT id, organization_id, role, status FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (!user || user.status === 'suspended') {
      return next(new Error('User not found or suspended'));
    }

    // Attach to socket
    socket.userId         = user.id;
    socket.organizationId = user.organization_id;
    socket.role           = user.role;

    next();

  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return next(new Error('TOKEN_EXPIRED'));
    }
    logger.warn('WebSocket auth failed:', {
      error: err instanceof Error ? err.message : err,
    });
    next(new Error('Authentication failed'));
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export function initWebSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: true,
      credentials: true,
      methods: ['GET', 'POST'],
    },

    // Connection settings
    transports:          ['websocket', 'polling'],
    pingInterval:        25_000,
    pingTimeout:         60_000,
    connectTimeout:      10_000,
    maxHttpBufferSize:   1e6, // 1MB
  });

  // ── Auth Middleware ─────────────────────────────────────────────────────────
  io.use(authenticateSocket);

  // ── Connection Handler ──────────────────────────────────────────────────────
  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info('WebSocket connected', {
      socketId: socket.id,
      userId:   socket.userId ?? 'anonymous',
    });

    // Auto-join org room if authenticated
    if (socket.organizationId) {
      socket.join(`org:${socket.organizationId}`);
    }

    // Join specific content request room
    const requestId = socket.handshake.query.requestId as string;
    if (requestId) {
      // Verify this request belongs to user's org before joining
      // (Security: users shouldn't listen to other orgs' events)
      if (socket.organizationId) {
        queryOne(
          'SELECT id FROM content_requests WHERE id = $1 AND organization_id = $2',
          [requestId, socket.organizationId]
        ).then(row => {
          if (row) {
            socket.join(`request:${requestId}`);
            logger.info('Socket joined request room', {
              socketId:  socket.id,
              requestId,
            });
          }
        }).catch(() => {});
      }
    }

    // ── Client Events ─────────────────────────────────────────────────────────

    // Subscribe to a specific content request
    socket.on('subscribe:request', async (id: string) => {
      if (!socket.organizationId || !id) return;

      try {
        const row = await queryOne(
          'SELECT id FROM content_requests WHERE id = $1 AND organization_id = $2',
          [id, socket.organizationId]
        );

        if (row) {
          socket.join(`request:${id}`);
          socket.emit('subscribed', { room: `request:${id}` });
          logger.info('Socket subscribed to request', {
            socketId: socket.id,
            requestId: id,
          });
        } else {
          socket.emit('error', { message: 'Request not found or access denied' });
        }
      } catch (err) {
        logger.error('subscribe:request error:', { error: err });
      }
    });

    // Unsubscribe from a request room
    socket.on('unsubscribe:request', (id: string) => {
      socket.leave(`request:${id}`);
    });

    socket.on('join:request', (requestId: string) => {
      if (!requestId) return;
      
      socket.join(`request:${requestId}`);
      logger.debug('Socket joined request room', {
        socketId: socket.id,
        requestId,
      });
      
      socket.emit('joined', { requestId });
    });

    // Ping/pong for connection health check
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.info('WebSocket disconnected', {
        socketId: socket.id,
        userId:   socket.userId ?? 'anonymous',
        reason,
      });
    });

    socket.on('error', (err) => {
      logger.error('Socket error:', {
        socketId: socket.id,
        error:    err.message,
      });
    });
  });

  // ── Queue Event Listeners ───────────────────────────────────────────────────
  setupQueueListeners();

  logger.info('WebSocket server initialized');
  return io;
}

// ─── Queue → Socket Bridge ────────────────────────────────────────────────────

function setupQueueListeners(): void {

  // ─── Queue → Socket Bridge (FIXED) ───────────────────────────────────────────
  // BullMQ progress event mein job.data.requestId available nahi hota
  // isliye hum jobId → requestId mapping maintain karte hain
  const jobToRequest = new Map<string, string>();

  contentQueueEvents.on('progress', ({ jobId, data }) => {
    let progress = 0;
    let requestId: string | undefined;
    let step: string | undefined;

    // BullMQ v4: data is the value passed to job.updateProgress()
    if (typeof data === 'number') {
      progress = data;
    } else if (data && typeof data === 'object') {
      const d = data as { percentage?: number; requestId?: string; step?: string };
      progress  = d.percentage ?? 0;
      requestId = d.requestId;
      step      = d.step;
    }

    // Cache requestId from job data
    if (requestId) {
      jobToRequest.set(jobId, requestId);
    } else {
      // Lookup from cache
      requestId = jobToRequest.get(jobId);
    }

    if (requestId) {
      emitToRequest(requestId, 'job:progress', {
        jobId,
        requestId,
        progress,
        step: step ?? getProgressStep(progress),
        timestamp: Date.now(),
      });

      logger.info('Progress emitted', { requestId, progress, jobId });
    }
  });

  // ── Job Active (started processing) ──────────────────────────────────────
  contentQueueEvents.on('active', ({ jobId, prev }) => {
    const requestId = jobToRequest.get(jobId);
    if (requestId) {
      emitToRequest(requestId, 'job:started', {
        jobId,
        requestId,
        message: 'Generation started',
        timestamp: Date.now(),
      });
    }
  });

  // ── Job Waiting (queued) ──────────────────────────────────────────────────
  contentQueueEvents.on('waiting', ({ jobId }) => {
    logger.info('Job waiting in queue', { jobId });
  });

  // ── Job Completed ─────────────────────────────────────────────────────────
  contentQueueEvents.on('completed', ({ jobId, returnvalue }) => {
    // Try returnvalue first
    const parsed = safeParseJSON(returnvalue);
    let requestId = parsed?.requestId as string | undefined;

    // Fallback to cache
    if (!requestId) {
      requestId = jobToRequest.get(jobId);
    }

    if (requestId) {
      emitToRequest(requestId, 'job:completed', {
        jobId,
        requestId,
        message: 'Content generation complete',
        timestamp: Date.now(),
      });

      // Also notify org room (for dashboard refresh)
      // We'd need orgId — fetch from DB or include in job data
      logger.info('Completion emitted to socket', { jobId, requestId });
    }

    // Cleanup cache
    jobToRequest.delete(jobId);
  });

  // ── Job Failed ────────────────────────────────────────────────────────────
  contentQueueEvents.on('failed', ({ jobId, failedReason }) => {
    // Try cache first (most reliable)
    let requestId = jobToRequest.get(jobId);

    // Fallback: try to extract from error message
    if (!requestId) {
      const match = failedReason?.match(
        /requestId[:\s]+([0-9a-f-]{36})/i
      );
      requestId = match?.[1];
    }

    if (requestId) {
      emitToRequest(requestId, 'job:failed', {
        jobId,
        requestId,
        reason:    failedReason,
        message:   'Content generation failed',
        timestamp: Date.now(),
      });
    }

    logger.warn('Job failed, emitted to socket', {
      jobId,
      requestId,
      reason: failedReason?.slice(0, 200),
    });

    // Cleanup cache
    jobToRequest.delete(jobId);
  });

  // ── Job Stalled ───────────────────────────────────────────────────────────
  contentQueueEvents.on('stalled', ({ jobId }) => {
    const requestId = jobToRequest.get(jobId);
    logger.warn('Job stalled', { jobId, requestId });

    if (requestId) {
      emitToRequest(requestId, 'job:stalled', {
        jobId,
        requestId,
        message: 'Generation stalled — may retry automatically',
      });
    }
  });

  // Cleanup old entries periodically (prevent memory leak)
  setInterval(() => {
    if (jobToRequest.size > 500) {
      // Keep only last 100 entries
      const entries = [...jobToRequest.entries()];
      const toDelete = entries.slice(0, entries.length - 100);
      for (const [key] of toDelete) {
        jobToRequest.delete(key);
      }
      logger.info('jobToRequest cache cleaned', {
        removed: toDelete.length,
        remaining: jobToRequest.size,
      });
    }
  }, 5 * 60 * 1000); // Every 5 minutes
}

// ─── Progress Step Labels ─────────────────────────────────────────────────────

function getProgressStep(progress: number): string {
  if (progress < 10)  return 'Initializing...';
  if (progress < 20)  return 'Fetching brand profile...';
  if (progress < 30)  return 'Compiling instructions...';
  if (progress < 50)  return 'Writing canonical draft...';
  if (progress < 65)  return 'Optimizing for platforms...';
  if (progress < 75)  return 'Applying brand voice...';
  if (progress < 85)  return 'Humanizing content...';
  if (progress < 95)  return 'Running quality checks...';
  if (progress < 100) return 'Saving results...';
  return 'Complete!';
}

// ─── Emit Helpers ─────────────────────────────────────────────────────────────

export function emit(
  room:  string,
  event: string,
  data:  object
): void {
  if (!io) {
    logger.warn('emit() called before WebSocket init', { room, event });
    return;
  }
  io.to(room).emit(event, data);
}

export function emitToRequest(
  requestId: string,
  event:     string,
  data:      object
): void {
  emit(`request:${requestId}`, event, data);
}

export function emitToOrg(
  orgId:  string,
  event:  string,
  data:   object
): void {
  emit(`org:${orgId}`, event, data);
}

// ─── Utils ────────────────────────────────────────────────────────────────────

function safeParseJSON(val: unknown): Record<string, unknown> | null {
  if (!val) return null;
  try {
    return typeof val === 'string'
      ? JSON.parse(val)
      : val as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

export async function closeWebSocket(): Promise<void> {
  if (!io) return;

  return new Promise((resolve) => {
    io.close(() => {
      logger.info('WebSocket server closed');
      resolve();
    });
  });
}

export { io };
