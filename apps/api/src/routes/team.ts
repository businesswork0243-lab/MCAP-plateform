import { Router, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import crypto from 'crypto'
import { query, queryOne, withTransaction } from '../db/connection'
import {
  AuthenticatedRequest,
  authenticate,
  requireRole,
} from '../middleware/auth'
import { generateAccessToken, generateRefreshToken } from '../middleware/auth'
import { logger } from '../lib/logger'

const router = Router()

// An invited person is not signed in yet, so the two invitation endpoints
// cannot sit behind authenticate. They were marked "public" in a comment but
// the blanket middleware below still applied to them, which made an
// invitation link impossible to accept. Registering this sub-router first
// lets those two routes through; everything else still falls through to
// authenticate.
const publicRoutes = Router()
router.use(publicRoutes)
router.use(authenticate)
export default router

// ─── Schemas ──────────────────────────────────────────────────────────────────

const VALID_ROLES = ['admin', 'editor', 'writer', 'reviewer', 'analyst', 'viewer'] as const
type InviteRole = typeof VALID_ROLES[number]

const inviteSchema = z.object({
  email: z.string().email().toLowerCase().trim(),
  role:  z.enum(VALID_ROLES),
})

const roleUpdateSchema = z.object({
  role: z.enum(VALID_ROLES),
})

const acceptInviteSchema = z.object({
  name:     z.string().min(2).max(100).trim(),
  password: z.string().min(8),
})

// ─── GET /api/team/members ────────────────────────────────────────────────────

router.get('/members', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const members = await query(
      `SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.status,
        u.created_at,
        u.last_login_at,
        COUNT(DISTINCT cr.id)::int                              AS content_count,
        COUNT(DISTINCT cr.id) FILTER (
          WHERE cr.created_at >= NOW() - INTERVAL '30 days'
        )::int                                                  AS recent_content_count
       FROM users u
       LEFT JOIN content_requests cr ON cr.created_by = u.id
       WHERE u.organization_id = $1
       GROUP BY u.id
       ORDER BY
         CASE u.role
           WHEN 'owner' THEN 1
           WHEN 'admin' THEN 2
           ELSE 3
         END,
         u.created_at ASC`,
      [req.user!.organizationId]
    )

    res.json({ members })

  } catch (err) {
    logger.error('GET /team/members error:', { error: err })
    res.status(500).json({ error: 'Failed to fetch team members' })
  }
})

// ─── POST /api/team/invite ────────────────────────────────────────────────────

router.post(
  '/invite',
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = inviteSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors })
      return
    }

    const { email, role } = parsed.data

    try {
      // Check if already a member
      const existingMember = await queryOne(
        'SELECT id FROM users WHERE email = $1 AND organization_id = $2',
        [email, req.user!.organizationId]
      )
      if (existingMember) {
        res.status(409).json({ error: 'User is already a team member' })
        return
      }

      // Check for pending invite
      const pendingInvite = await queryOne(
        `SELECT id FROM team_invitations
         WHERE organization_id = $1 AND email = $2
           AND status = 'pending' AND expires_at > NOW()`,
        [req.user!.organizationId, email]
      )
      if (pendingInvite) {
        res.status(409).json({ error: 'Invitation already sent and pending' })
        return
      }

      // Create invite token
      const token     = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
      const inviteId  = uuidv4()

      await query(
        `INSERT INTO team_invitations
          (id, organization_id, email, role, token, invited_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          inviteId,
          req.user!.organizationId,
          email,
          role,
          token,
          req.user!.id,
          expiresAt,
        ]
      )

      // TODO: Send invitation email
      // await emailService.sendInvite({
      //   to: email,
      //   inviterName: req.user!.name,
      //   orgName: '...',
      //   role,
      //   acceptUrl: `${process.env.WEB_URL}/invite/${token}`,
      // })

      const inviteUrl = `${process.env.WEB_URL || 'http://localhost:3000'}/invite/${token}`

      logger.info('Team invite sent', {
        email,
        role,
        orgId: req.user!.organizationId,
        invitedBy: req.user!.id,
      })

      res.status(201).json({
        message:    'Invitation sent',
        inviteId,
        inviteUrl,  // Return for manual sharing if email fails
        expiresAt,
      })

    } catch (err) {
      logger.error('POST /team/invite error:', { error: err })
      res.status(500).json({ error: 'Failed to send invitation' })
    }
  }
)

// ─── GET /api/team/invitations ────────────────────────────────────────────────

router.get(
  '/invitations',
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const invitations = await query(
        `SELECT
          ti.id,
          ti.email,
          ti.role,
          ti.status,
          ti.expires_at,
          ti.created_at,
          u.name                                                AS invited_by_name,
          ti.expires_at < NOW()                                 AS is_expired
         FROM team_invitations ti
         LEFT JOIN users u ON u.id = ti.invited_by
         WHERE ti.organization_id = $1
         ORDER BY ti.created_at DESC`,
        [req.user!.organizationId]
      )

      res.json({ invitations })

    } catch (err) {
      logger.error('GET /team/invitations error:', { error: err })
      res.status(500).json({ error: 'Failed to fetch invitations' })
    }
  }
)

// ─── DELETE /api/team/invitations/:id (cancel invite) ────────────────────────

router.delete(
  '/invitations/:id',
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await query(
        `UPDATE team_invitations
         SET status = 'expired'
         WHERE id = $1 AND organization_id = $2 AND status = 'pending'
         RETURNING id`,
        [req.params.id, req.user!.organizationId]
      )

      if (!result.length) {
        res.status(404).json({ error: 'Invite not found or already processed' })
        return
      }

      res.json({ message: 'Invitation cancelled' })

    } catch (err) {
      logger.error('DELETE /team/invitations/:id error:', { error: err })
      res.status(500).json({ error: 'Failed to cancel invitation' })
    }
  }
)

// ─── GET /api/team/invitations/:token/validate ────────────────────────────────
// Public — no auth required (pre-accept check)

publicRoutes.get('/invitations/:token/validate', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const invite = await queryOne<{
      id:              string
      email:           string
      role:            string
      organization_id: string
      status:          string
      expires_at:      string
      org_name:        string
    }>(
      `SELECT ti.*, o.name as org_name
       FROM team_invitations ti
       JOIN organizations o ON o.id = ti.organization_id
       WHERE ti.token = $1`,
      [req.params.token]
    )

    if (!invite) {
      res.status(404).json({ error: 'Invalid invitation link' })
      return
    }

    if (invite.status !== 'pending') {
      res.status(400).json({ error: 'Invitation already used or cancelled' })
      return
    }

    if (new Date(invite.expires_at) < new Date()) {
      res.status(400).json({ error: 'Invitation has expired' })
      return
    }

    // Check if user already exists (they just need to login)
    const existingUser = await queryOne(
      'SELECT id FROM users WHERE email = $1',
      [invite.email]
    )

    res.json({
      valid:        true,
      email:        invite.email,
      role:         invite.role,
      orgName:      invite.org_name,
      userExists:   !!existingUser,
      expiresAt:    invite.expires_at,
    })

  } catch (err) {
    logger.error('GET /team/invitations/:token/validate error:', { error: err })
    res.status(500).json({ error: 'Failed to validate invitation' })
  }
})

// ─── POST /api/team/invitations/:token/accept ─────────────────────────────────

publicRoutes.post('/invitations/:token/accept', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Validate invite token
    const invite = await queryOne<{
      id:              string
      email:           string
      role:            string
      organization_id: string
      status:          string
      expires_at:      string
    }>(
      `SELECT * FROM team_invitations
       WHERE token = $1 AND status = 'pending' AND expires_at > NOW()`,
      [req.params.token]
    )

    if (!invite) {
      res.status(404).json({ error: 'Invalid or expired invitation' })
      return
    }

    // Check if user already exists
    const existingUser = await queryOne<{
      id:   string
      name: string
      email: string
    }>(
      'SELECT id, name, email FROM users WHERE email = $1',
      [invite.email]
    )

    let userId: string

    if (existingUser) {
      // User exists — update their org and role
      await withTransaction(async (client) => {
        await client.query(
          `UPDATE users
           SET organization_id = $1, role = $2, status = 'active', updated_at = NOW()
           WHERE id = $3`,
          [invite.organization_id, invite.role, existingUser.id]
        )

        await client.query(
          `UPDATE team_invitations SET status = 'accepted' WHERE id = $1`,
          [invite.id]
        )
      })

      userId = existingUser.id

    } else {
      // New user — they must provide name + password
      const parsed = acceptInviteSchema.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({
          error:        'Name and password required for new accounts',
          details:      parsed.error.errors,
          requiresInfo: true,
        })
        return
      }

      const { name, password } = parsed.data
      const bcrypt = await import('bcryptjs')
      const passwordHash = await bcrypt.hash(password, 12)
      const newUserId = uuidv4()

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO users
            (id, organization_id, email, name, role, status, password_hash)
           VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
          [
            newUserId,
            invite.organization_id,
            invite.email,
            name,
            invite.role,
            passwordHash,
          ]
        )

        await client.query(
          `UPDATE team_invitations SET status = 'accepted' WHERE id = $1`,
          [invite.id]
        )
      })

      userId = newUserId
    }

    // Auto-login after accepting
    const accessToken  = generateAccessToken(userId)
    const refreshToken = generateRefreshToken(userId)

    await query(
      `UPDATE users
       SET refresh_token = $1,
           refresh_token_expires_at = NOW() + INTERVAL '30 days',
           last_login_at = NOW()
       WHERE id = $2`,
      [refreshToken, userId]
    )

    logger.info('Team invite accepted', {
      userId,
      email:   invite.email,
      role:    invite.role,
      orgId:   invite.organization_id,
    })

    res.json({
      message:      'Invitation accepted',
      accessToken,
      refreshToken,
      token:        accessToken,
    })

  } catch (err) {
    logger.error('POST /team/invitations/:token/accept error:', { error: err })
    res.status(500).json({ error: 'Failed to accept invitation' })
  }
})

// ─── PATCH /api/team/members/:id/role ────────────────────────────────────────

router.patch(
  '/members/:id/role',
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    const parsed = roleUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid role' })
      return
    }

    const { role } = parsed.data

    try {
      // Cannot change your own role
      if (req.params.id === req.user!.id) {
        res.status(400).json({ error: 'Cannot change your own role' })
        return
      }

      // Admin cannot promote to owner
      if ((role as string) === 'owner' && req.user!.role !== 'owner') {
        res.status(403).json({ error: 'Only owners can assign the owner role' })
        return
      }

      // Cannot modify owner's role (unless you're an owner)
      const target = await queryOne<{ role: string }>(
        'SELECT role FROM users WHERE id = $1 AND organization_id = $2',
        [req.params.id, req.user!.organizationId]
      )

      if (!target) {
        res.status(404).json({ error: 'Member not found' })
        return
      }

      if (target.role === 'owner' && req.user!.role !== 'owner') {
        res.status(403).json({ error: "Cannot modify owner's role" })
        return
      }

      const result = await query(
        `UPDATE users
         SET role = $1, updated_at = NOW()
         WHERE id = $2 AND organization_id = $3
         RETURNING id, name, email, role`,
        [role, req.params.id, req.user!.organizationId]
      )

      logger.info('Member role updated', {
        targetId:  req.params.id,
        newRole:   role,
        updatedBy: req.user!.id,
      })

      res.json({ member: result[0] })

    } catch (err) {
      logger.error('PATCH /team/members/:id/role error:', { error: err })
      res.status(500).json({ error: 'Failed to update role' })
    }
  }
)

// ─── DELETE /api/team/members/:id ────────────────────────────────────────────

router.delete(
  '/members/:id',
  requireRole('owner', 'admin'),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Cannot remove yourself
      if (req.params.id === req.user!.id) {
        res.status(400).json({ error: 'Cannot remove yourself' })
        return
      }

      // Check target exists and get role
      const target = await queryOne<{ role: string; name: string }>(
        'SELECT role, name FROM users WHERE id = $1 AND organization_id = $2',
        [req.params.id, req.user!.organizationId]
      )

      if (!target) {
        res.status(404).json({ error: 'Member not found' })
        return
      }

      // Cannot remove owner
      if (target.role === 'owner') {
        res.status(403).json({ error: 'Cannot remove the organization owner' })
        return
      }

      // Soft remove — suspend instead of delete
      // (Hard delete would break content_requests FK)
      await query(
        `UPDATE users
         SET status = 'suspended',
             organization_id = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [req.params.id]
      )

      logger.info('Team member removed', {
        removedId:   req.params.id,
        removedName: target.name,
        removedBy:   req.user!.id,
      })

      res.json({ message: `${target.name} removed from team` })

    } catch (err) {
      logger.error('DELETE /team/members/:id error:', { error: err })
      res.status(500).json({ error: 'Failed to remove member' })
    }
  }
)
