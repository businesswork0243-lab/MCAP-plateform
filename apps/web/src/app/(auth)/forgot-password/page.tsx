'use client';

import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import api from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email,   setEmail]   = useState('');
  const [sent,    setSent]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      // Show generic message — don't reveal if email exists
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full max-w-[400px]"
    >
      {/* Logo & Header */}
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 bg-violet-600 rounded-2xl flex items-center justify-center mb-5 shadow-lg shadow-violet-600/30">
          <span className="text-white text-2xl font-bold">S</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-1">
          {sent ? 'Check your email' : 'Reset your password'}
        </h1>
        <p className="text-gray-500 text-sm text-center">
          {sent
            ? "We've sent you a reset link if this email is registered"
            : "We'll email you a link to reset your password"
          }
        </p>
      </div>

      {/* Form Card */}
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 backdrop-blur-sm">

        {sent ? (
          <div className="space-y-4 text-center py-4">
            <div className="w-16 h-16 bg-green-500/20 border-2 border-green-500/40 rounded-full flex items-center justify-center mx-auto">
              <span className="text-3xl animate-bounce">✓</span>
            </div>
            <div>
              <p className="text-white font-medium">Email sent</p>
              <p className="text-sm text-gray-500 mt-1">
                Check <span className="text-violet-400">{email}</span> for the reset link.
              </p>
            </div>
            <p className="text-xs text-gray-600 pt-2">
              Didn&apos;t receive it? Check spam or{' '}
              <button
                onClick={() => setSent(false)}
                className="text-violet-400 hover:text-violet-300 transition-colors"
              >
                try again
              </button>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-300">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                autoComplete="email"
                autoFocus
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 focus:bg-white/[0.07] outline-none transition-all text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={loading || !email}
              className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-600/20"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Sending...
                </>
              ) : (
                'Send Reset Link'
              )}
            </button>
          </form>
        )}
      </div>

      {/* Back to login */}
      <p className="text-center text-sm text-gray-500 mt-6">
        Remember your password?{' '}
        <Link
          href="/login"
          className="text-violet-400 hover:text-violet-300 font-medium transition-colors"
        >
          Sign in
        </Link>
      </p>

      <p className="text-center text-xs text-gray-700 mt-8">
        © {new Date().getFullYear()} Semantiq
      </p>
    </motion.div>
  );
}
