'use client';

// The API mails a link to /invite/<token> and exposes validate + accept
// endpoints, but nothing in the app ever answered that route, so every
// invitation was a dead end. This page is that destination.

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Loader2, Check, XCircle, Users, Eye, EyeOff } from 'lucide-react';
import api from '@/lib/api';

interface InviteInfo {
  valid: boolean;
  email: string;
  role: string;
  orgName: string;
  userExists: boolean;
  expiresAt: string;
}

export default function AcceptInvitePage() {
  const router = useRouter();
  const params = useParams();
  const token = String(params?.token ?? '');

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data: invite,
    isLoading,
    error: validateError,
  } = useQuery<InviteInfo>({
    queryKey: ['invite', token],
    queryFn: () =>
      api.get(`/team/invitations/${token}/validate`).then((r: any) => r.data),
    enabled: !!token,
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: async () => {
      // An existing account only needs to be moved into the organization;
      // a new one has to supply a name and password first.
      const body = invite?.userExists ? {} : { name: name.trim(), password };
      const res = await api.post(`/team/invitations/${token}/accept`, body);
      return (res as any).data;
    },
    onSuccess: (data: any) => {
      const accessToken = data?.accessToken || data?.token;
      if (accessToken) {
        localStorage.setItem('accessToken', accessToken);
        if (data?.refreshToken) {
          localStorage.setItem('refreshToken', data.refreshToken);
        }
        router.replace('/dashboard');
        return;
      }
      // Accepted, but no session came back — send them to sign in rather
      // than leaving them on a page that looks stuck.
      router.replace('/login?reason=invite-accepted');
    },
    onError: (err: any) => {
      setFormError(
        err?.response?.data?.error ||
        err?.message ||
        'Could not accept this invitation.'
      );
    },
  });

  const handleAccept = () => {
    setFormError(null);
    if (!invite?.userExists) {
      if (name.trim().length < 2) {
        setFormError('Enter your full name.');
        return;
      }
      if (password.length < 8) {
        setFormError('Password must be at least 8 characters.');
        return;
      }
    }
    acceptMutation.mutate();
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-[#080809] text-white flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {children}
      </motion.div>
    </div>
  );

  if (isLoading) {
    return shell(
      <div className="flex items-center justify-center gap-3 text-gray-500 py-16">
        <Loader2 size={18} className="animate-spin" />
        Checking your invitation...
      </div>
    );
  }

  if (validateError || !invite?.valid) {
    const message =
      (validateError as any)?.response?.data?.error ||
      'This invitation link is not valid.';
    return shell(
      <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-8 space-y-4 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/20">
          <XCircle className="w-6 h-6 text-red-400" />
        </div>
        <h1 className="text-2xl font-bold">Invitation unavailable</h1>
        <p className="text-sm text-gray-500">{message}</p>
        <p className="text-xs text-gray-600">
          Invitations expire, and each one can only be used once. Ask whoever
          invited you to send a new link.
        </p>
        <Link
          href="/login"
          className="inline-block mt-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-all"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return shell(
    <div className="space-y-6">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20">
          <Users className="w-6 h-6 text-violet-400" />
        </div>
        <h1 className="text-3xl font-bold">Join {invite.orgName}</h1>
        <p className="text-sm text-gray-500">
          You have been invited as{' '}
          <span className="text-violet-300 font-medium">{invite.role}</span>
        </p>
      </div>

      <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 space-y-5">
        <div className="flex items-center justify-between text-sm border-b border-white/10 pb-4">
          <span className="text-gray-500">Invitation for</span>
          <span className="font-medium">{invite.email}</span>
        </div>

        {invite.userExists ? (
          <p className="text-sm text-gray-400">
            You already have an M-CAP account with this email. Accepting moves
            it into {invite.orgName}.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="invite-name" className="text-sm text-gray-400">
                Your name
              </label>
              <input
                id="invite-name"
                value={name}
                onChange={e => setName(e.target.value)}
                autoComplete="name"
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-violet-500"
                placeholder="Jane Cooper"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="invite-password" className="text-sm text-gray-400">
                Create a password
              </label>
              <div className="relative">
                <input
                  id="invite-password"
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full px-4 py-2.5 pr-11 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-violet-500"
                  placeholder="At least 8 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  aria-label={showPwd ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
          </div>
        )}

        {formError && (
          <p className="flex items-start gap-1.5 text-red-400 text-xs">
            <XCircle size={12} className="shrink-0 mt-0.5" /> {formError}
          </p>
        )}

        <button
          type="button"
          onClick={handleAccept}
          disabled={acceptMutation.isPending}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all"
        >
          {acceptMutation.isPending ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Joining...
            </>
          ) : (
            <>
              <Check size={16} /> Join {invite.orgName}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
