// apps/api/src/middleware/auth.ts
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { queryOne } from '../db/connection'
import { logger } from '../lib/logger'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
  user?: {
    id:             string
    organizationId: string
    email:          string
    role:           string
    name:           string
  }
}

interface JWTPayload {
  userId:  string
  type:    'access' | 'refresh'
  iat?:    number
  exp?:    number
}

// ─── JWT Secret Validation ────────────────────────────────────────────────────

function getJWTSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    // Production mein hard crash karo — insecure state allow mat karo
    if (process.env.NODE_ENV === 'production') {
      logger.error('FATAL: JWT_SECRET not set in production')
      process.exit(1)
    }
    logger.warn('JWT_SECRET not set — using insecure dev fallback')
    return 'dev-secret-change-in-production-32chars!!'
  }
  return secret
}

export const JWT_SECRET = getJWTSecret()

export const JWT_REFRESH_SECRET = (() => {
  const secret = process.env.JWT_REFRESH_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('JWT_REFRESH_SECRET not set in production — falling back to JWT_SECRET derivative')
      return JWT_SECRET + '-refresh-fallback'
    }
    return 'dev-refresh-secret-change-in-production!!'
  }
  return secret
})()

// ─── Token Generators ─────────────────────────────────────────────────────────

export function generateAccessToken(userId: string): string {
  // ✅ Use env variable, fallback to 1h
  const expiresIn = (process.env.JWT_EXPIRES_IN || '1h') as jwt.SignOptions['expiresIn'];

  return jwt.sign(
    { userId, type: 'access' } satisfies Omit<JWTPayload, 'iat' | 'exp'>,
    JWT_SECRET,
    { expiresIn }
  )
}

export function generateRefreshToken(userId: string): string {
  // Refresh token longer than access token
  const expiresIn = (process.env.JWT_REFRESH_EXPIRES_IN || '30d') as jwt.SignOptions['expiresIn'];

  return jwt.sign(
    { userId, type: 'refresh' } satisfies Omit<JWTPayload, 'iat' | 'exp'>,
    JWT_REFRESH_SECRET,
    { expiresIn }
  )
}

export function verifyAccessToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload
}

export function verifyRefreshToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_REFRESH_SECRET) as JWTPayload
}

// ─── DB User Type ─────────────────────────────────────────────────────────────

interface DBUser {
  id:              string
  organization_id: string
  email:           string
  role:            string
  name:            string
  status:          string
}

// ─── Main Auth Middleware ─────────────────────────────────────────────────────

export async function authenticate(
  req:  AuthenticatedRequest,
  res:  Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' })
    return
  }

  const token = authHeader.split(' ')[1]

  if (!token || token === 'null' || token === 'undefined') {
    res.status(401).json({ error: 'Invalid token format' })
    return
  }

  try {
    // Verify token
    const decoded = verifyAccessToken(token)

    // Type guard — refresh tokens should not be used for API calls
    if (decoded.type !== 'access') {
      res.status(401).json({ error: 'Invalid token type' })
      return
    }

    // Fetch user from DB
    const user = await queryOne<DBUser>(
      `SELECT id, organization_id, email, role, name, status
       FROM users
       WHERE id = $1`,
      [decoded.userId]
    )

    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    // Check user is active
    if (user.status === 'suspended') {
      res.status(403).json({ error: 'Account suspended' })
      return
    }

    req.user = {
      id:             user.id,
      organizationId: user.organization_id,
      email:          user.email,
      role:           user.role,
      name:           user.name,
    }

    next()

  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      // Frontend ko batao ki refresh karna hai
      res.status(401).json({
        error:   'Token expired',
        code:    'TOKEN_EXPIRED',
        message: 'Use /auth/refresh to get a new access token',
      })
      return
    }

    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' })
      return
    }

    logger.error('Auth middleware error:', { error: err })
    res.status(500).json({ error: 'Auth check failed' })
  }
}

// ─── Optional Auth ────────────────────────────────────────────────────────────
// Use this for routes that work both authenticated and unauthenticated

export async function optionalAuthenticate(
  req:  AuthenticatedRequest,
  res:  Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return next() // No token — continue without user
  }

  // Reuse main middleware but catch errors
  try {
    await authenticate(req, res, next)
  } catch {
    next() // Error — continue without user
  }
}

// ─── Role Guard ───────────────────────────────────────────────────────────────

// Role hierarchy — higher index = more permissions
const ROLE_HIERARCHY = [
  'viewer',
  'analyst',
  'writer',
  'reviewer',
  'editor',
  'admin',
  'owner',
] as const

type Role = typeof ROLE_HIERARCHY[number]

export function requireRole(...roles: string[]) {
  return (
    req:  AuthenticatedRequest,
    res:  Response,
    next: NextFunction
  ): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('Permission denied', {
        userId:   req.user.id,
        userRole: req.user.role,
        required: roles,
        path:     req.path,
      })
      res.status(403).json({
        error:    'Insufficient permissions',
        required: roles,
        current:  req.user.role,
      })
      return
    }

    next()
  }
}

// requireMinRole('editor') — editor ya usse upar wale allow
export function requireMinRole(minRole: Role) {
  return (
    req:  AuthenticatedRequest,
    res:  Response,
    next: NextFunction
  ): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }

    const userRoleIdx = ROLE_HIERARCHY.indexOf(req.user.role as Role)
    const minRoleIdx  = ROLE_HIERARCHY.indexOf(minRole)

    if (userRoleIdx < minRoleIdx) {
      res.status(403).json({
        error:    'Insufficient permissions',
        required: `${minRole} or above`,
        current:  req.user.role,
      })
      return
    }

    next()
  }
}
