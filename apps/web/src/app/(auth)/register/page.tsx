'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useAuthStore } from '@/store/auth';

interface FormData {
  name:        string;
  email:       string;
  password:    string;
  companyName: string;
}

function getPasswordStrength(pwd: string) {
  let score = 0;
  if (pwd.length >= 8)          score++;
  if (pwd.length >= 12)         score++;
  if (/[A-Z]/.test(pwd))       score++;
  if (/[0-9]/.test(pwd))       score++;
  if (/[^A-Za-z0-9]/.test(pwd))score++;

  if (score <= 1) return { score, label: 'Weak',   color: 'bg-red-500'    };
  if (score <= 2) return { score, label: 'Fair',   color: 'bg-amber-500'  };
  if (score <= 3) return { score, label: 'Good',   color: 'bg-yellow-500' };
  if (score <= 4) return { score, label: 'Strong', color: 'bg-green-500'  };
  return { score, label: 'Very Strong', color: 'bg-emerald-500' };
}

export default function RegisterPage() {
  const router    = useRouter();
  const register  = useAuthStore(s => s.register);
  const isLoading = useAuthStore(s => s.isLoading);
  const user      = useAuthStore(s => s.user);

  const [form,   setForm]   = useState<FormData>({
    name: '', email: '', password: '', companyName: '',
  });
  const [error,   setError]   = useState('');
  const [showPwd, setShowPwd] = useState(false);

  useEffect(() => {
    const hasToken = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (user && hasToken) {
      router.replace('/dashboard');
    }
  }, [user, router]);

  const update = (field: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));

  const pwdStrength = getPasswordStrength(form.password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (form.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!/[A-Z]/.test(form.password)) {
      setError('Password must contain at least one uppercase letter');
      return;
    }
    if (!/[0-9]/.test(form.password)) {
      setError('Password must contain at least one number');
      return;
    }

    try {
      await register(form);
      router.replace('/onboarding');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="w-full max-w-[440px]"
    >
      {/* Logo & Header */}
      <div className="flex flex-col items-center mb-8">
        <div className="w-14 h-14 bg-violet-600 rounded-2xl flex items-center justify-center mb-5 shadow-lg shadow-violet-600/30">
          <span className="text-white text-2xl font-bold">M</span>
        </div>
        <h1 className="text-2xl font-bold text-white mb-1">
          Create your account
        </h1>
        <p className="text-gray-500 text-sm">
          Start generating content with AI
        </p>
      </div>

      {/* Form Card */}
      <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
        <form onSubmit={handleSubmit} className="space-y-4">

          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400"
            >
              {error}
            </motion.div>
          )}

          {/* Name + Company row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-300">Full Name</label>
              <input
                value={form.name}
                onChange={update('name')}
                placeholder="Jane Smith"
                required
                autoComplete="name"
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 focus:bg-white/[0.07] outline-none transition-all text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-gray-300">Company</label>
              <input
                value={form.companyName}
                onChange={update('companyName')}
                placeholder="Acme Inc."
                required
                autoComplete="organization"
                className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 focus:bg-white/[0.07] outline-none transition-all text-sm"
              />
            </div>
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={update('email')}
              placeholder="you@company.com"
              required
              autoComplete="email"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 focus:bg-white/[0.07] outline-none transition-all text-sm"
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-gray-300">Password</label>
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={form.password}
                onChange={update('password')}
                placeholder="Min 8 chars, 1 uppercase, 1 number"
                required
                minLength={8}
                autoComplete="new-password"
                className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 focus:bg-white/[0.07] outline-none transition-all text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPwd(!showPwd)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors p-1"
              >
                {showPwd ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>

            {/* Password strength */}
            {form.password.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <div className="flex gap-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded-full transition-all ${
                        i < pwdStrength.score ? pwdStrength.color : 'bg-white/10'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-600">
                  Strength:{' '}
                  <span className={
                    pwdStrength.score >= 4 ? 'text-green-400' :
                    pwdStrength.score >= 3 ? 'text-yellow-400' :
                    'text-red-400'
                  }>
                    {pwdStrength.label}
                  </span>
                </p>
              </div>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading || !form.name || !form.email || !form.password || !form.companyName}
            className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-violet-600/20 hover:shadow-violet-600/40"
          >
            {isLoading ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating account...
              </>
            ) : (
              'Create Account →'
            )}
          </button>

          <p className="text-xs text-gray-600 text-center pt-1">
            By creating an account, you agree to our Terms of Service.
          </p>
        </form>
      </div>

      {/* Sign in link */}
      <p className="text-center text-sm text-gray-500 mt-6">
        Already have an account?{' '}
        <Link
          href="/login"
          className="text-violet-400 hover:text-violet-300 font-medium transition-colors"
        >
          Sign in
        </Link>
      </p>

      <p className="text-center text-xs text-gray-700 mt-8">
        © {new Date().getFullYear()} M-CAP · Multi-Agent Content Platform
      </p>
    </motion.div>
  );
}
