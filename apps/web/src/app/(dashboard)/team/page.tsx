'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatRelative, copyToClipboard } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TeamMember {
  id:                   string;
  name:                 string;
  email:                string;
  role:                 string;
  status:               string;
  created_at:           string;
  last_login_at:        string | null;
  content_count:        number;
  recent_content_count: number;
}

interface Invitation {
  id:              string;
  email:           string;
  role:            string;
  status:          string;
  expires_at:      string;
  created_at:      string;
  invited_by_name: string;
  is_expired:      boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ASSIGNABLE_ROLES = ['admin', 'editor', 'writer', 'reviewer', 'analyst', 'viewer'] as const;

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  owner:    { label: 'Owner',    color: 'text-violet-300', bg: 'bg-violet-500/20 border-violet-500/30'  },
  admin:    { label: 'Admin',    color: 'text-blue-300',   bg: 'bg-blue-500/20 border-blue-500/30'      },
  editor:   { label: 'Editor',   color: 'text-green-300',  bg: 'bg-green-500/20 border-green-500/30'    },
  writer:   { label: 'Writer',   color: 'text-emerald-300',bg: 'bg-emerald-500/20 border-emerald-500/30'},
  reviewer: { label: 'Reviewer', color: 'text-amber-300',  bg: 'bg-amber-500/20 border-amber-500/30'    },
  analyst:  { label: 'Analyst',  color: 'text-cyan-300',   bg: 'bg-cyan-500/20 border-cyan-500/30'      },
  viewer:   { label: 'Viewer',   color: 'text-gray-400',   bg: 'bg-gray-500/20 border-gray-500/30'      },
};

const PERMISSIONS_TABLE = [
  { feature: 'Generate Content',    perms: [true,  true,  true,  true,  false, false, false] },
  { feature: 'Edit Content',        perms: [true,  true,  true,  true,  false, false, false] },
  { feature: 'Approve Content',     perms: [true,  true,  true,  false, true,  false, false] },
  { feature: 'Publish Content',     perms: [true,  true,  true,  false, false, false, false] },
  { feature: 'Manage Brand',        perms: [true,  true,  false, false, false, false, false] },
  { feature: 'View Analytics',      perms: [true,  true,  false, false, false, true,  false] },
  { feature: 'Invite Members',      perms: [true,  true,  false, false, false, false, false] },
  { feature: 'Manage Team',         perms: [true,  true,  false, false, false, false, false] },
  { feature: 'View Only',           perms: [true,  true,  true,  true,  true,  true,  true ] },
];

// ─── Sub Components ───────────────────────────────────────────────────────────

function MemberAvatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map(n => n[0])
    .join('')
    .toUpperCase();

  return (
    <div className="w-9 h-9 rounded-full bg-violet-500/20 border border-violet-500/20 flex items-center justify-center shrink-0">
      <span className="text-xs font-bold text-violet-400">{initials}</span>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const config = ROLE_CONFIG[role] ?? ROLE_CONFIG.viewer;
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${config.bg} ${config.color}`}>
      {config.label}
    </span>
  );
}

function InviteModal({
  onClose,
  onSuccess,
}: {
  onClose:   () => void;
  onSuccess: (inviteUrl: string) => void;
}) {
  const [email, setEmail] = useState('');
  const [role,  setRole]  = useState<typeof ASSIGNABLE_ROLES[number]>('writer');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => api.post<{ inviteUrl: string; message: string }>(
      '/team/invite',
      { email, role }
    ),
    onSuccess: (res) => {
      onSuccess(res.data.inviteUrl);
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-md bg-[#0F0F10] border border-white/10 rounded-2xl p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Invite Team Member</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">✕</button>
        </div>

        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors text-sm"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1.5">Role</label>
            <div className="grid grid-cols-3 gap-2">
              {ASSIGNABLE_ROLES.map(r => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`py-2 text-sm rounded-xl border transition-all capitalize ${
                    role === r
                      ? `${ROLE_CONFIG[r].bg} ${ROLE_CONFIG[r].color}`
                      : 'bg-white/5 border-white/10 text-gray-500 hover:border-white/20'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            {/* Role description */}
            <div className="mt-3 p-3 bg-white/3 rounded-xl border border-white/8 text-xs text-gray-500">
              {role === 'admin'    && 'Full access except billing. Can manage team.'}
              {role === 'editor'   && 'Can generate, edit, publish content.'}
              {role === 'writer'   && 'Can generate and edit content.'}
              {role === 'reviewer' && 'Can approve or reject content.'}
              {role === 'analyst'  && 'View-only access to analytics.'}
              {role === 'viewer'   && 'Read-only access to all content.'}
            </div>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm text-gray-400 border border-white/10 rounded-xl hover:border-white/20 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!email || mutation.isPending}
            className="flex-1 py-2.5 text-sm text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {mutation.isPending ? (
              <>
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Sending...
              </>
            ) : (
              'Send Invite'
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function InviteLinkToast({
  url,
  onClose,
}: {
  url:     string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void copyToClipboard(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      className="fixed bottom-6 right-6 z-50 w-96 p-4 bg-[#0F0F10] border border-green-500/30 rounded-2xl shadow-2xl"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-medium text-green-400">✓ Invite Sent!</p>
          <p className="text-xs text-gray-500 mt-0.5">Share this link manually if needed</p>
        </div>
        <button onClick={onClose} className="text-gray-600 hover:text-white">✕</button>
      </div>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          className="flex-1 text-xs bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-gray-400 outline-none"
        />
        <button
          onClick={copy}
          className="px-3 py-2 text-xs bg-violet-600 hover:bg-violet-700 text-white rounded-xl transition-all whitespace-nowrap"
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function TeamPage() {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore(s => s.user);

  const [showInvite,  setShowInvite]  = useState(false);
  const [inviteUrl,   setInviteUrl]   = useState<string | null>(null);
  const [activeTab,   setActiveTab]   = useState<'members' | 'invites' | 'permissions'>('members');
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null);

  const canManage = ['owner', 'admin'].includes(currentUser?.role ?? '');

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: membersData, isLoading: membersLoading } = useQuery({
    queryKey: ['team-members'],
    queryFn:  () => api.get('/team/members').then(r => r.data),
  });

  const { data: invitesData } = useQuery({
    queryKey: ['team-invitations'],
    queryFn:  () => api.get('/team/invitations').then(r => r.data),
    enabled:  canManage,
  });

  const members:     TeamMember[]  = membersData?.members     ?? [];
  const invitations: Invitation[]  = invitesData?.invitations ?? [];
  const pending = invitations.filter(i => i.status === 'pending' && !i.is_expired);

  // ── Mutations ────────────────────────────────────────────────────────────────

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/team/members/${id}`),
    onSuccess:  () => {
      queryClient.invalidateQueries({ queryKey: ['team-members'] });
      setConfirmRemove(null);
    },
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.patch(`/team/members/${id}/role`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['team-members'] }),
  });

  const cancelInviteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/team/invitations/${id}`),
    onSuccess:  () => queryClient.invalidateQueries({ queryKey: ['team-invitations'] }),
  });

  const TABS = [
    { id: 'members',     label: `Members (${members.length})`          },
    { id: 'invites',     label: `Pending Invites (${pending.length})`, hidden: !canManage },
    { id: 'permissions', label: 'Permissions'                          },
  ].filter(t => !t.hidden);

  return (
    <div className="min-h-screen bg-[#080809] text-white">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Team</h1>
            <p className="text-gray-500 text-sm mt-1">
              Manage members and permissions
            </p>
          </div>
          {canManage && (
            <button
              onClick={() => setShowInvite(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-all"
            >
              + Invite Member
            </button>
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/10 w-fit">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-violet-600 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >

            {/* ── Members Tab ── */}
            {activeTab === 'members' && (
              <div className="bg-white/3 border border-white/10 rounded-2xl overflow-hidden">
                {membersLoading ? (
                  <div className="divide-y divide-white/5">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
                        <div className="w-9 h-9 rounded-full bg-white/10" />
                        <div className="flex-1 space-y-1.5">
                          <div className="h-3.5 w-32 bg-white/10 rounded" />
                          <div className="h-2.5 w-44 bg-white/10 rounded" />
                        </div>
                        <div className="h-6 w-16 bg-white/10 rounded-full" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {members.map(member => {
                      const isSelf    = member.id === currentUser?.id;
                      const isOwner   = member.role === 'owner';
                      const canEdit   = canManage && !isSelf && !isOwner;

                      return (
                        <div
                          key={member.id}
                          className="flex items-center gap-4 px-5 py-4 hover:bg-white/3 transition-all"
                        >
                          <MemberAvatar name={member.name} />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-white">
                                {member.name}
                              </p>
                              {isSelf && (
                                <span className="text-xs text-gray-600">(you)</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500 mt-0.5 truncate">
                              {member.email}
                            </p>
                            <p className="text-xs text-gray-700 mt-0.5">
                              {member.content_count} pieces
                              {member.last_login_at && (
                                <> · Last active {formatRelative(member.last_login_at)}</>
                              )}
                            </p>
                          </div>

                          {/* Role selector */}
                          <div className="flex items-center gap-2">
                            {canEdit ? (
                              <select
                                value={member.role}
                                onChange={e => roleMutation.mutate({
                                  id:   member.id,
                                  role: e.target.value,
                                })}
                                className="text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-gray-300 outline-none focus:border-violet-500/50 transition-colors"
                              >
                                {ASSIGNABLE_ROLES.map(r => (
                                  <option key={r} value={r} className="bg-[#0F0F10]">
                                    {r.charAt(0).toUpperCase() + r.slice(1)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <RoleBadge role={member.role} />
                            )}

                            {/* Remove */}
                            {canEdit && (
                              <button
                                onClick={() => setConfirmRemove(member)}
                                className="p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                                title="Remove member"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Pending Invites Tab ── */}
            {activeTab === 'invites' && (
              <div className="bg-white/3 border border-white/10 rounded-2xl overflow-hidden">
                {pending.length === 0 ? (
                  <div className="py-12 text-center">
                    <p className="text-gray-500 text-sm">No pending invitations</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {pending.map(invite => {
                      const daysLeft = Math.ceil(
                        (new Date(invite.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                      );
                      return (
                        <div
                          key={invite.id}
                          className="flex items-center gap-4 px-5 py-4"
                        >
                          <div className="w-9 h-9 rounded-full bg-amber-500/20 border border-amber-500/20 flex items-center justify-center shrink-0">
                            <span className="text-sm">✉</span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">
                              {invite.email}
                            </p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              Invited by {invite.invited_by_name} · {daysLeft}d left
                            </p>
                          </div>

                          <RoleBadge role={invite.role} />

                          <button
                            onClick={() => cancelInviteMutation.mutate(invite.id)}
                            disabled={cancelInviteMutation.isPending}
                            className="text-xs text-gray-600 hover:text-red-400 transition-colors px-2 py-1 rounded-lg border border-white/10 hover:border-red-500/30"
                          >
                            Cancel
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Permissions Tab ── */}
            {activeTab === 'permissions' && (
              <div className="bg-white/3 border border-white/10 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/10">
                        <th className="text-left px-5 py-3 text-gray-500 font-medium">
                          Permission
                        </th>
                        {['Owner', 'Admin', 'Editor', 'Writer', 'Reviewer', 'Analyst', 'Viewer'].map(r => (
                          <th key={r} className="px-3 py-3 text-center font-medium">
                            <span className={`${ROLE_CONFIG[r.toLowerCase()]?.color ?? 'text-gray-400'}`}>
                              {r}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PERMISSIONS_TABLE.map(({ feature, perms }) => (
                        <tr
                          key={feature}
                          className="border-b border-white/5 last:border-0 hover:bg-white/3 transition-all"
                        >
                          <td className="px-5 py-3 text-gray-400">{feature}</td>
                          {perms.map((allowed, i) => (
                            <td key={i} className="px-3 py-3 text-center">
                              {allowed ? (
                                <span className="text-green-400 text-sm">✓</span>
                              ) : (
                                <span className="text-gray-700">—</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {showInvite && (
          <InviteModal
            onClose={() => setShowInvite(false)}
            onSuccess={(url) => {
              setInviteUrl(url);
              setTimeout(() => setInviteUrl(null), 15_000);
            }}
          />
        )}
      </AnimatePresence>

      {/* Confirm Remove Dialog */}
      <AnimatePresence>
        {confirmRemove && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={() => setConfirmRemove(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative bg-[#0F0F10] border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-4"
            >
              <h3 className="text-base font-semibold text-white">Remove Member</h3>
              <p className="text-sm text-gray-400">
                Remove <span className="text-white font-medium">{confirmRemove.name}</span> from
                the team? They will lose access immediately.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmRemove(null)}
                  className="flex-1 py-2.5 text-sm text-gray-400 border border-white/10 rounded-xl hover:border-white/20 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={() => removeMutation.mutate(confirmRemove.id)}
                  disabled={removeMutation.isPending}
                  className="flex-1 py-2.5 text-sm text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 rounded-xl transition-all"
                >
                  {removeMutation.isPending ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Invite URL Toast */}
      <AnimatePresence>
        {inviteUrl && (
          <InviteLinkToast
            url={inviteUrl}
            onClose={() => setInviteUrl(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
