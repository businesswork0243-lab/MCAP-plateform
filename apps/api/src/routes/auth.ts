// apps/api/src/routes/auth.ts
import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { query, queryOne, withTransaction } from '../db/connection'
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  authenticate,
  AuthenticatedRequest,
} from '../middleware/auth'
import { logger } from '../lib/logger'

export const authRouter = Router()
export default authRouter

// ─── Schemas ──────────────────────────────────────────────────────────────────

const signupSchema = z.object({
  name:        z.string().min(2).max(100).trim(),
  email:       z.string().email().toLowerCase().trim(),
  password:    z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
  companyName: z.string().min(2).max(200).trim(),
})

const loginSchema = z.object({
  email:    z.string().email().toLowerCase().trim(),
  password: z.string().min(1),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string()
    .min(8)
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[0-9]/, 'Must contain at least one number'),
})

// ─── DB Types ─────────────────────────────────────────────────────────────────

interface DBUser {
  id:              string
  name:            string
  email:           string
  role:            string
  status:          string
  organization_id: string
  password_hash:   string
}

interface DBOrg {
  id:   string
  name: string
}

// ─── Helper: Build user response ─────────────────────────────────────────────

function buildUserResponse(
  user: Omit<DBUser, 'password_hash'>,
  org:  DBOrg
) {
  return {
    id:               user.id,
    name:             user.name,
    email:            user.email,
    role:             user.role,
    organizationId:   user.organization_id,
    organizationName: org.name,
  }
}

// ─── POST /api/auth/register (alias: /signup) ─────────────────────────────────

async function handleRegister(req: Request, res: Response): Promise<void> {
  const parsed = signupSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({
      error:   'Validation failed',
      details: parsed.error.errors.map(e => ({
        field:   e.path.join('.'),
        message: e.message,
      }))
    })
    return
  }

  const { name, email, password, companyName } = parsed.data

  try {
    // Check existing user
    const existing = await queryOne(
      'SELECT id FROM users WHERE email = $1',
      [email]
    )
    if (existing) {
      res.status(409).json({ error: 'Email already registered' })
      return
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12)

    const orgId    = uuidv4()
    const userId   = uuidv4()

    // Create org + user in transaction
    await withTransaction(async (client) => {
      // Create organization
      await client.query(
        `INSERT INTO organizations (id, name, plan)
         VALUES ($1, $2, 'free')`,
        [orgId, companyName]
      )

      // Create owner user
      await client.query(
        `INSERT INTO users
          (id, organization_id, email, name, role, status, password_hash)
         VALUES ($1, $2, $3, $4, 'owner', 'active', $5)`,
        [userId, orgId, email, name, passwordHash]
      )
    })

    // Generate tokens
    const accessToken  = generateAccessToken(userId)
    const refreshToken = generateRefreshToken(userId)

    // Store refresh token
    await query(
      `UPDATE users
       SET refresh_token = $1,
           refresh_token_expires_at = NOW() + INTERVAL '30 days',
           last_login_at = NOW()
       WHERE id = $2`,
      [refreshToken, userId]
    )

    logger.info('New user registered', {
      userId,
      orgId,
      email,
    })

    res.status(201).json({
      accessToken,
      refreshToken,
      // Keep 'token' for backward compat with existing frontend
      token: accessToken,
      user: {
        id:               userId,
        name,
        email,
        role:             'owner',
        organizationId:   orgId,
        organizationName: companyName,
      },
    })

  } catch (err) {
    logger.error('Register error:', { error: err, email })
    res.status(500).json({ error: 'Registration failed' })
  }
}

authRouter.post('/signup',   handleRegister)
authRouter.post('/register', handleRegister)

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

authRouter.post('/login', async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid email or password format' })
    return
  }

  const { email, password } = parsed.data

  try {
    const user = await queryOne<DBUser>(
      `SELECT u.id, u.name, u.email, u.role, u.status,
              u.organization_id, u.password_hash
       FROM users u
       WHERE u.email = $1`,
      [email]
    )

    // Timing-safe: always run bcrypt even if user not found
    const dummyHash = '$2b$12$dummy.hash.to.prevent.timing.attacks.xxxxxxxxx'
    const hashToCompare = user?.password_hash || dummyHash

    const passwordValid = await bcrypt.compare(password, hashToCompare)

    if (!user || !passwordValid) {
      // Generic message — don't reveal which was wrong
      res.status(401).json({ error: 'Invalid email or password' })
      return
    }

    if (user.status === 'suspended') {
      res.status(403).json({ error: 'Account suspended. Contact support.' })
      return
    }

    if (!user.password_hash) {
      res.status(401).json({ error: 'Password not set. Use SSO login.' })
      return
    }

    // Fetch organization
    const org = await queryOne<DBOrg>(
      'SELECT id, name FROM organizations WHERE id = $1',
      [user.organization_id]
    )

    if (!org) {
      logger.error('User has no organization', { userId: user.id })
      res.status(500).json({ error: 'Account configuration error' })
      return
    }

    // Generate tokens
    const accessToken  = generateAccessToken(user.id)
    const refreshToken = generateRefreshToken(user.id)

    // Update last login + refresh token
    await query(
      `UPDATE users
       SET last_login_at = NOW(),
           refresh_token = $1,
           refresh_token_expires_at = NOW() + INTERVAL '30 days'
       WHERE id = $2`,
      [refreshToken, user.id]
    )

    logger.info('User logged in', { userId: user.id, email })

    res.json({
      accessToken,
      refreshToken,
      token: accessToken, // Backward compat
      user: buildUserResponse(user, org),
    })

  } catch (err) {
    logger.error('Login error:', { error: err, email })
    res.status(500).json({ error: 'Login failed' })
  }
})

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

authRouter.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const parsed = refreshSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Refresh token required' })
    return
  }

  const { refreshToken } = parsed.data

  try {
    // Verify refresh token signature
    const decoded = verifyRefreshToken(refreshToken)

    if (decoded.type !== 'refresh') {
      res.status(401).json({ error: 'Invalid token type' })
      return
    }

    // Check token is still stored (rotation check)
    const user = await queryOne<{
      id: string
      name: string
      email: string
      role: string
      status: string
      organization_id: string
      refresh_token: string
      refresh_token_expires_at: string
    }>(
      `SELECT id, name, email, role, status, organization_id,
              refresh_token, refresh_token_expires_at
       FROM users
       WHERE id = $1`,
      [decoded.userId]
    )

    if (!user) {
      res.status(401).json({ error: 'User not found' })
      return
    }

    if (user.status === 'suspended') {
      res.status(403).json({ error: 'Account suspended' })
      return
    }

    // Token rotation check — stored token must match
    if (user.refresh_token !== refreshToken) {
      // Possible token reuse attack — invalidate all tokens
      await query(
        'UPDATE users SET refresh_token = NULL WHERE id = $1',
        [user.id]
      )
      logger.warn('Refresh token reuse detected', { userId: user.id })
      res.status(401).json({ error: 'Invalid refresh token' })
      return
    }

    // Check expiry in DB
    const expiresAt = new Date(user.refresh_token_expires_at)
    if (expiresAt < new Date()) {
      res.status(401).json({
        error: 'Refresh token expired',
        code:  'REFRESH_EXPIRED',
      })
      return
    }

    // Issue new token pair (rotation)
    const newAccessToken  = generateAccessToken(user.id)
    const newRefreshToken = generateRefreshToken(user.id)

    await query(
      `UPDATE users
       SET refresh_token = $1,
           refresh_token_expires_at = NOW() + INTERVAL '30 days'
       WHERE id = $2`,
      [newRefreshToken, user.id]
    )

    const org = await queryOne<DBOrg>(
      'SELECT id, name FROM organizations WHERE id = $1',
      [user.organization_id]
    )

    res.json({
      accessToken:  newAccessToken,
      refreshToken: newRefreshToken,
      token:        newAccessToken, // backward compat
      user: buildUserResponse(user, org!),
    })

  } catch (err) {
    if (err instanceof Error && err.name.includes('jwt')) {
      res.status(401).json({ error: 'Invalid refresh token' })
      return
    }
    logger.error('Refresh error:', { error: err })
    res.status(500).json({ error: 'Token refresh failed' })
  }
})

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

authRouter.get(
  '/me',
  authenticate,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      // Re-fetch fresh data (role may have changed)
      const user = await queryOne<Omit<DBUser, 'password_hash'>>(
        `SELECT id, name, email, role, status, organization_id
         FROM users
         WHERE id = $1`,
        [req.user!.id]
      )

      if (!user) {
        res.status(404).json({ error: 'User not found' })
        return
      }

      const org = await queryOne<DBOrg>(
        'SELECT id, name FROM organizations WHERE id = $1',
        [user.organization_id]
      )

      res.json(buildUserResponse(user, org!))

    } catch (err) {
      logger.error('/me error:', { error: err })
      res.status(500).json({ error: 'Failed to fetch user' })
    }
  }
)

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

authRouter.post(
  '/logout',
  authenticate,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    try {
      // Invalidate refresh token
      await query(
        'UPDATE users SET refresh_token = NULL WHERE id = $1',
        [req.user!.id]
      )

      logger.info('User logged out', { userId: req.user!.id })
      res.json({ message: 'Logged out successfully' })

    } catch (err) {
      logger.error('Logout error:', { error: err })
      res.status(500).json({ error: 'Logout failed' })
    }
  }
)

// ─── POST /api/auth/change-password ──────────────────────────────────────────

authRouter.post(
  '/change-password',
  authenticate,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const parsed = changePasswordSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({
        error:   'Validation failed',
        details: parsed.error.errors,
      })
      return
    }

    const { currentPassword, newPassword } = parsed.data

    try {
      const user = await queryOne<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1',
        [req.user!.id]
      )

      if (!user?.password_hash) {
        res.status(400).json({ error: 'No password set on this account' })
        return
      }

      const currentValid = await bcrypt.compare(currentPassword, user.password_hash)
      if (!currentValid) {
        res.status(401).json({ error: 'Current password is incorrect' })
        return
      }

      const newHash = await bcrypt.hash(newPassword, 12)

      // Update password + invalidate refresh tokens (force re-login everywhere)
      await query(
        `UPDATE users
         SET password_hash = $1,
             refresh_token = NULL,
             updated_at = NOW()
         WHERE id = $2`,
        [newHash, req.user!.id]
      )

      logger.info('Password changed', { userId: req.user!.id })
      res.json({ message: 'Password changed. Please log in again.' })

    } catch (err) {
      logger.error('Change password error:', { error: err })
      res.status(500).json({ error: 'Failed to change password' })
    }
  }
)

// ─── PATCH /api/auth/me ───────────────────────────────────────────────────────

authRouter.patch(
  '/me',
  authenticate,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const schema = z.object({
      name: z.string().min(2).max(100).trim().optional(),
    })

    const parsed = schema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors })
      return
    }

    try {
      const sets: string[] = ['updated_at = NOW()']
      const vals: unknown[] = []
      let idx = 1

      if (parsed.data.name) {
        sets.push(`name = $${idx++}`)
        vals.push(parsed.data.name)
      }

      if (sets.length === 1) {
        res.json({ message: 'Nothing to update' })
        return
      }

      vals.push(req.user!.id)
      const result = await query(
        `UPDATE users SET ${sets.join(', ')}
         WHERE id = $${idx}
         RETURNING id, name, email, role, organization_id`,
        vals
      )

      res.json(result[0])
    } catch (err) {
      logger.error('PATCH /auth/me error:', { error: err })
      res.status(500).json({ error: 'Failed to update profile' })
    }
  }
)

// ─── POST /api/auth/onboarding ────────────────────────────────────────────────

const onboardingSchema = z.object({
  // `industry` stays for older clients; new clients send the arrays.
  industry:            z.string().optional(),
  primaryIndustries:   z.array(z.string().min(1).max(100)).max(20).optional(),
  secondaryIndustries: z.array(z.string().min(1).max(100)).max(20).optional(),
  teamSize:         z.string().optional(),
  useCase:          z.string().optional(),
  language:         z.string().optional(),
  defaultStructure: z.string().optional(),
  platforms:        z.array(z.string()).optional(),
})

authRouter.post(
  '/onboarding',
  authenticate,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const parsed = onboardingSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ 
        error: 'Invalid input',
        details: parsed.error.errors 
      })
      return
    }

    try {
      const d = parsed.data

      // Build dynamic UPDATE (only fields provided)
      const updates: string[] = []
      const values: unknown[] = []
      let idx = 1

      // Keep the legacy single-value column in sync with the first primary
      // industry so anything still reading `industry` keeps working.
      const primary   = d.primaryIndustries
      const secondary = d.secondaryIndustries
      const legacyIndustry = d.industry ?? primary?.[0]

      if (primary !== undefined) {
        updates.push(`primary_industries = $${idx++}`)
        values.push(JSON.stringify(primary))
      }

      if (secondary !== undefined) {
        updates.push(`secondary_industries = $${idx++}`)
        values.push(JSON.stringify(secondary))
      }

      if (legacyIndustry !== undefined) {
        updates.push(`industry = $${idx++}`)
        values.push(legacyIndustry)
      }
      
      if (d.teamSize !== undefined) {
        updates.push(`team_size = $${idx++}`)
        values.push(d.teamSize)
      }
      
      if (d.language !== undefined) {
        updates.push(`default_language = $${idx++}`)
        values.push(d.language)
      }

      // Always update updated_at
      updates.push(`updated_at = NOW()`)

      if (updates.length === 1) {
        // Only updated_at, nothing else - skip
        res.json({ 
          message: 'No changes to save',
          completed: true 
        })
        return
      }

      // Execute update
      values.push(req.user!.organizationId)
      
      try {
        await query(
          `UPDATE organizations 
           SET ${updates.join(', ')}
           WHERE id = $${idx}`,
          values
        )
      } catch (updateErr) {
        logger.error('Onboarding UPDATE failed:', {
          error: updateErr instanceof Error ? updateErr.message : updateErr,
          orgId: req.user!.organizationId,
          fields: {
            industry: legacyIndustry,
            primaryIndustries: primary,
            secondaryIndustries: secondary,
            teamSize: d.teamSize,
            language: d.language,
          },
        })
        // This used to swallow the error and return completed: true, so the
        // user was told their setup saved when nothing was written.
        res.status(500).json({
          error: 'Could not save your setup. Please try again.',
          completed: false,
        })
        return
      }

      logger.info('Onboarding completed', {
        userId:   req.user!.id,
        orgId:    req.user!.organizationId,
        industry: legacyIndustry,
        primaryIndustries: primary,
        secondaryIndustries: secondary,
        teamSize: d.teamSize,
      })

      res.json({ 
        message: 'Onboarding saved',
        completed: true 
      })

    } catch (err) {
      logger.error('POST /auth/onboarding error:', { 
        error: err instanceof Error ? err.message : err,
        userId: req.user?.id,
      })
      
      // Return success anyway - onboarding data is optional
      res.json({ 
        message: 'Onboarding skipped due to error',
        completed: true 
      })
    }
  }
)

// ─── PATCH /api/auth/organization ────────────────────────────────────────────

const orgUpdateSchema = z.object({
  name:     z.string().min(2).max(200).trim().optional(),
  language: z.string().optional(),
  industry: z.string().optional(),
  primaryIndustries:   z.array(z.string().min(1).max(100)).max(20).optional(),
  secondaryIndustries: z.array(z.string().min(1).max(100)).max(20).optional(),
  timezone: z.string().optional(),
})

authRouter.patch(
  '/organization',
  authenticate,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    // Only owner or admin can update org settings
    if (!['owner', 'admin'].includes(req.user!.role)) {
      res.status(403).json({ error: 'Insufficient permissions' })
      return
    }

    const parsed = orgUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors })
      return
    }

    try {
      const d = parsed.data
      const sets: string[] = ['updated_at = NOW()']
      const vals: unknown[] = []
      let idx = 1

      if (d.name)     { sets.push(`name = $${idx++}`);             vals.push(d.name)     }
      if (d.language) { sets.push(`default_language = $${idx++}`); vals.push(d.language) }
      if (d.primaryIndustries) {
        sets.push(`primary_industries = $${idx++}`)
        vals.push(JSON.stringify(d.primaryIndustries))
      }
      if (d.secondaryIndustries) {
        sets.push(`secondary_industries = $${idx++}`)
        vals.push(JSON.stringify(d.secondaryIndustries))
      }
      const orgIndustry = d.industry ?? d.primaryIndustries?.[0]
      if (orgIndustry) { sets.push(`industry = $${idx++}`);         vals.push(orgIndustry) }
      if (d.timezone) { sets.push(`timezone = $${idx++}`);         vals.push(d.timezone) }

      if (sets.length === 1) {
        res.json({ message: 'Nothing to update' })
        return
      }

      vals.push(req.user!.organizationId)

      await query(
        `UPDATE organizations SET ${sets.join(', ')} WHERE id = $${idx}`,
        vals
      )

      logger.info('Organization updated', { orgId: req.user!.organizationId })
      res.json({ message: 'Organization updated' })

    } catch (err) {
      logger.error('PATCH /auth/organization error:', { error: err })
      res.status(500).json({ error: 'Failed to update organization' })
    }
  }
)

// ─── PATCH /api/auth/preferences ─────────────────────────────────────────────

const preferencesSchema = z.object({
  defaultHumanizationLevel: z.enum(['light', 'medium', 'aggressive']).optional(),
  defaultLanguage:          z.string().optional(),
  defaultPerspective:       z.string().optional(),
})

authRouter.patch(
  '/preferences',
  authenticate,
  async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const parsed = preferencesSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors })
      return
    }

    try {
      // Preferences stored in user metadata
      // For now, store in organization default_language
      const d = parsed.data

      if (d.defaultLanguage) {
        await query(
          'UPDATE organizations SET default_language = $1 WHERE id = $2',
          [d.defaultLanguage, req.user!.organizationId]
        )
      }

      res.json({
        message: 'Preferences saved',
        preferences: parsed.data,
      })

    } catch (err) {
      logger.error('PATCH /auth/preferences error:', { error: err })
      res.status(500).json({ error: 'Failed to save preferences' })
    }
  }
)

import crypto from 'crypto'

const forgotPasswordSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
})

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

authRouter.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  const parsed = forgotPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    // Always return success — don't reveal if email exists
    res.json({ message: 'If this email is registered, a reset link has been sent' })
    return
  }

  const { email } = parsed.data

  try {
    const user = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM users WHERE email = $1 AND status = $2',
      [email, 'active']
    )

    // Silently return success even if user doesn't exist (security)
    if (!user) {
      logger.info('Forgot password: user not found', { email })
      res.json({ message: 'If this email is registered, a reset link has been sent' })
      return
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex')
    const expiresAt  = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    // Store in DB (add password_reset_token column if not exists)
    await query(
      `UPDATE users
       SET password_reset_token = $1,
           password_reset_expires_at = $2
       WHERE id = $3`,
      [resetToken, expiresAt, user.id]
    )

    // TODO: Send email with reset link
    // const resetUrl = `${process.env.WEB_URL}/reset-password?token=${resetToken}`
    // await emailService.sendPasswordReset({ to: email, name: user.name, resetUrl })

    logger.info('Password reset requested', { userId: user.id, email })
    res.json({ message: 'If this email is registered, a reset link has been sent' })

  } catch (err) {
    logger.error('Forgot password error:', { error: err })
    // Still return success (security)
    res.json({ message: 'If this email is registered, a reset link has been sent' })
  }
})

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

const resetPasswordSchema = z.object({
  token:       z.string().min(1),
  newPassword: z.string()
    .min(8)
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
})

authRouter.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  const parsed = resetPasswordSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors })
    return
  }

  const { token, newPassword } = parsed.data

  try {
    const user = await queryOne<{ id: string }>(
      `SELECT id FROM users
       WHERE password_reset_token = $1
         AND password_reset_expires_at > NOW()
         AND status = 'active'`,
      [token]
    )

    if (!user) {
      res.status(400).json({ error: 'Invalid or expired reset token' })
      return
    }

    const newHash = await bcrypt.hash(newPassword, 12)

    await query(
      `UPDATE users
       SET password_hash = $1,
           password_reset_token = NULL,
           password_reset_expires_at = NULL,
           refresh_token = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [newHash, user.id]
    )

    logger.info('Password reset successful', { userId: user.id })
    res.json({ message: 'Password reset successful. Please sign in with your new password.' })

  } catch (err) {
    logger.error('Reset password error:', { error: err })
    res.status(500).json({ error: 'Failed to reset password' })
  }
})


