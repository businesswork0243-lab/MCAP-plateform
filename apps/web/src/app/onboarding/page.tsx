'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Check, ArrowLeft, ArrowRight, Loader2, Building2, Users,
  Layers, MessageSquare
} from 'lucide-react';
import {
  FaLinkedin,
  FaXTwitter,
  FaInstagram,
  FaYoutube,
  FaBlog,
  FaMicrophone,
} from 'react-icons/fa6';
import { LuMail } from 'react-icons/lu';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

// ─── Platform Config ─────────────────────────────────────────────────────────

const ONBOARDING_PLATFORMS = [
  { key: 'linkedin_post',     label: 'LinkedIn Posts',     Icon: FaLinkedin,   color: '#0A66C2' },
  { key: 'linkedin_article',  label: 'LinkedIn Articles',  Icon: FaLinkedin,   color: '#0A66C2' },
  { key: 'twitter_thread',    label: 'Twitter/X Threads',  Icon: FaXTwitter,   color: '#FFFFFF' },
  { key: 'blog_post',         label: 'Blog Posts',         Icon: FaBlog,       color: '#F97316' },
  { key: 'newsletter',        label: 'Newsletter',         Icon: LuMail,       color: '#3B82F6' },
  { key: 'instagram_caption', label: 'Instagram Captions', Icon: FaInstagram,  color: '#E4405F' },
  { key: 'youtube_script',    label: 'YouTube Scripts',    Icon: FaYoutube,    color: '#FF0000' },
  { key: 'podcast_notes',     label: 'Podcast Notes',      Icon: FaMicrophone, color: '#8B5CF6' },
];

const INDUSTRIES = [
  'SaaS', 'FinTech', 'Healthcare', 'E-commerce',
  'Consulting', 'Marketing', 'Education', 'Real Estate',
  'Web3/Crypto', 'AI/ML', 'Manufacturing', 'Other',
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface OnboardingData {
  primaryIndustries:   string[];
  secondaryIndustries: string[];
  teamSize:  string;
  language:  string;
  platforms: string[];
  useCase:   string;
}

const DEFAULT_DATA: OnboardingData = {
  primaryIndustries:   [],
  secondaryIndustries: [],
  teamSize:  '',
  language:  'English',
  platforms: [],
  useCase:   '',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [data, setData] = useState<OnboardingData>(DEFAULT_DATA);

  const totalSteps = 4;

  const onboardMutation = useMutation({
    mutationFn: (payload: OnboardingData) =>
      api.post('/auth/onboarding', payload),
    onSuccess: () => {
      router.push('/dashboard');
    },
    onError: (err: any) => {
      console.error('Onboarding error:', err);
      // Non-critical - proceed anyway
      router.push('/dashboard');
    },
  });

  const updateData = (updates: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...updates }));
  };

  // An industry is either primary or secondary, never both — selecting it
  // on one side clears it from the other.
  const togglePrimaryIndustry = (ind: string) => {
    setData(prev => ({
      ...prev,
      primaryIndustries: prev.primaryIndustries.includes(ind)
        ? prev.primaryIndustries.filter(i => i !== ind)
        : [...prev.primaryIndustries, ind],
      secondaryIndustries: prev.secondaryIndustries.filter(i => i !== ind),
    }));
  };

  const toggleSecondaryIndustry = (ind: string) => {
    setData(prev => ({
      ...prev,
      secondaryIndustries: prev.secondaryIndustries.includes(ind)
        ? prev.secondaryIndustries.filter(i => i !== ind)
        : [...prev.secondaryIndustries, ind],
      primaryIndustries: prev.primaryIndustries.filter(i => i !== ind),
    }));
  };

  const togglePlatform = (key: string) => {
    updateData({
      platforms: data.platforms.includes(key)
        ? data.platforms.filter(p => p !== key)
        : [...data.platforms, key],
    });
  };

  const canProceed = () => {
    if (step === 1) return data.primaryIndustries.length > 0;
    if (step === 2) return !!data.teamSize;
    if (step === 3) return data.platforms.length > 0;
    return true;
  };

  const handleNext = () => {
    if (step < totalSteps) {
      setStep(step + 1);
    } else {
      onboardMutation.mutate(data);
    }
  };

  const handleSkip = () => {
    router.push('/dashboard');
  };

  const stepIcons = [Building2, Users, Layers, MessageSquare];
  const StepIcon = stepIcons[step - 1];

  return (
    <div className="min-h-screen bg-[#080809] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-2xl">

        {/* Header */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-violet-500/10 border border-violet-500/20 mb-4">
            <StepIcon className="w-6 h-6 text-violet-400" />
          </div>
          <h1 className="text-3xl font-bold mb-2">Welcome to M-CAP!</h1>
          <p className="text-sm text-gray-500">
            Let&apos;s customize your experience — Step {step} of {totalSteps}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="flex gap-2 mb-8">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full transition-all duration-500',
                i < step ? 'bg-violet-500' : 'bg-white/10'
              )}
            />
          ))}
        </div>

        {/* Form Card */}
        <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-6 sm:p-8">
          <AnimatePresence mode="wait">

            {/* ── Step 1: Industry ── */}
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div>
                  <label className="text-sm font-semibold text-white">
                    Which industries are you in?{' '}
                    <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Helps AI tailor content to your industry. Pick as many as
                    apply — primary ones lead, secondary ones add context.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-violet-300">
                      Primary <span className="text-red-500">*</span>
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {data.primaryIndustries.length} selected
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {INDUSTRIES.map(ind => {
                      const selected = data.primaryIndustries.includes(ind);
                      return (
                        <button
                          key={ind}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => togglePrimaryIndustry(ind)}
                          className={cn(
                            'flex items-center justify-between gap-2 p-3 text-sm font-medium rounded-xl border transition-all',
                            selected
                              ? 'bg-violet-500/10 border-violet-500 text-white'
                              : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                          )}
                        >
                          <span>{ind}</span>
                          {selected && (
                            <Check className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                      Secondary <span className="text-gray-600">(optional)</span>
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {data.secondaryIndustries.length} selected
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {INDUSTRIES.map(ind => {
                      const selected = data.secondaryIndustries.includes(ind);
                      const isPrimary = data.primaryIndustries.includes(ind);
                      return (
                        <button
                          key={ind}
                          type="button"
                          aria-pressed={selected}
                          disabled={isPrimary}
                          onClick={() => toggleSecondaryIndustry(ind)}
                          title={isPrimary ? 'Already selected as primary' : undefined}
                          className={cn(
                            'flex items-center justify-between gap-2 p-3 text-sm font-medium rounded-xl border transition-all',
                            isPrimary
                              ? 'bg-white/[0.02] border-white/5 text-gray-600 cursor-not-allowed'
                              : selected
                              ? 'bg-sky-500/10 border-sky-500 text-white'
                              : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                          )}
                        >
                          <span>{ind}</span>
                          {selected && (
                            <Check className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            )}

            {/* ── Step 2: Team Size ── */}
            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div>
                  <label className="text-sm font-semibold text-white">
                    How large is your team? <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-muted-foreground mt-1 mb-4">
                    Helps us set up collaboration features
                  </p>
                </div>

                <div className="space-y-2">
                  {[
                    { value: '1',      label: 'Just me',       desc: 'Solo entrepreneur' },
                    { value: '2-10',   label: '2-10 people',    desc: 'Small team' },
                    { value: '10-50',  label: '10-50 people',   desc: 'Growing team' },
                    { value: '50-200', label: '50-200 people',  desc: 'Established team' },
                    { value: '200+',   label: '200+ people',    desc: 'Large organization' },
                  ].map(size => (
                    <button
                      key={size.value}
                      onClick={() => updateData({ teamSize: size.value })}
                      className={cn(
                        'w-full p-4 text-left rounded-xl border transition-all',
                        data.teamSize === size.value
                          ? 'bg-violet-500/10 border-violet-500'
                          : 'bg-white/5 border-white/10 hover:border-white/20'
                      )}
                    >
                      <p className="text-sm font-semibold text-white">{size.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{size.desc}</p>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── Step 3: Platforms (REAL ICONS!) ── */}
            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div>
                  <label className="text-sm font-semibold text-white">
                    Preferred Platforms <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-muted-foreground mt-1 mb-4">
                    Select all platforms you plan to publish on
                  </p>
                </div>

                <div className="space-y-2">
                  {ONBOARDING_PLATFORMS.map((platform) => {
                    const isSelected = data.platforms.includes(platform.key);
                    const { Icon, color, label, key } = platform;

                    return (
                      <button
                        key={key}
                        onClick={() => togglePlatform(key)}
                        className={cn(
                          'group w-full flex items-center gap-3 p-4 rounded-xl border-2 transition-all',
                          isSelected
                            ? 'bg-violet-500/10 border-violet-500'
                            : 'bg-white/[0.02] border-white/10 hover:border-white/20'
                        )}
                      >
                        {/* Brand Icon Container */}
                        <div className={cn(
                          'flex items-center justify-center w-10 h-10 rounded-lg shrink-0 transition-transform',
                          'bg-white/5 border border-white/10',
                          'group-hover:scale-110'
                        )}>
                          <Icon
                            className="w-5 h-5"
                            style={{ color }}
                          />
                        </div>

                        {/* Label */}
                        <span className={cn(
                          'flex-1 text-left text-sm font-medium',
                          isSelected ? 'text-white' : 'text-gray-300'
                        )}>
                          {label}
                        </span>

                        {/* Check */}
                        {isSelected && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            className="w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center shrink-0"
                          >
                            <Check className="w-3 h-3 text-white" strokeWidth={3} />
                          </motion.div>
                        )}
                      </button>
                    );
                  })}
                </div>

                {data.platforms.length > 0 && (
                  <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-violet-400 flex items-center gap-1.5"
                  >
                    <Check className="w-3 h-3" />
                    {data.platforms.length} selected
                  </motion.p>
                )}
              </motion.div>
            )}

            {/* ── Step 4: Language & Use Case ── */}
            {step === 4 && (
              <motion.div
                key="step4"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div>
                  <label className="text-sm font-semibold text-white">
                    Preferred Language
                  </label>
                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                    Default language for content generation
                  </p>
                  <select
                    value={data.language}
                    onChange={e => updateData({ language: e.target.value })}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:border-violet-500/50 outline-none transition-colors"
                  >
                    <option value="English">English</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Hinglish">Hinglish</option>
                    <option value="Spanish">Spanish</option>
                    <option value="French">French</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-semibold text-white">
                    Primary Use Case
                  </label>
                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                    What will you mainly use M-CAP for?
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      'Thought Leadership',
                      'Marketing Content',
                      'Personal Brand',
                      'Client Content',
                    ].map(uc => (
                      <button
                        key={uc}
                        onClick={() => updateData({ useCase: uc })}
                        className={cn(
                          'p-3 text-sm rounded-xl border transition-all',
                          data.useCase === uc
                            ? 'bg-violet-500/10 border-violet-500 text-white'
                            : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                        )}
                      >
                        {uc}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={step > 1 ? () => setStep(step - 1) : handleSkip}
            className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            {step > 1 ? (
              <>
                <ArrowLeft className="w-4 h-4" />
                Back
              </>
            ) : (
              'Skip'
            )}
          </button>

          <button
            onClick={handleNext}
            disabled={!canProceed() || onboardMutation.isPending}
            className={cn(
              'flex items-center gap-2 px-6 py-2.5 text-sm font-medium rounded-xl transition-all',
              canProceed() && !onboardMutation.isPending
                ? 'bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-500/20'
                : 'bg-white/5 text-gray-600 cursor-not-allowed'
            )}
          >
            {onboardMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Saving...
              </>
            ) : step === totalSteps ? (
              <>
                Finish
                <ArrowRight className="w-4 h-4" />
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
