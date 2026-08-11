// apps/web/src/app/(dashboard)/content/new/page.tsx
'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { PlatformIconBadge, PLATFORM_CONFIG } from '@/components/platform-icons';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WritingStructure {
  id: string;
  name: string;
  description: string;
  isCustom?: boolean;
  flow?: string[];
}

interface ICPProfile {
  id: string;
  name: string;
  basicChars: { role?: string; industry?: string; };
  currentChallenges?: string[];
  goals?: string[];
}

interface TonalitySettings {
  angry: number;
  frustrated: number;
  excited: number;
  confident: number;
  curious: number;
  empathetic: number;
  playful: number;
  serious: number;
}

interface ContentForm {
  // Step 1: Topic
  topic: string;
  objective: string;
  context: string;
  
  // Step 2: Audience (ICP)
  selectedIcpId: string | null;
  customAudience: string;
  icpDescription: string;
  
  // Step 3: Platform & Format
  targetPlatforms: string[];
  contentType: string;
  wordCount: number | null;  // Blog ke liye
  
  // Step 4: Tone & Style
  brandProfileId: string | null;
  writingStructureId: string;
  customStructureFlow: string;
  perspective: string;
  language: string;
  keywords: string[];
  
  // CTA
  ctaType: string;
  customCta: string;
  
  // Tonality Spectrum (NEW)
  tonality: TonalitySettings;
  
  // Special Instructions
  specialInstructions: string;
  enableHumanization: boolean;
  humanizationIntensity: string;
  enableQA: boolean;
  enableSEO: boolean;
  seoKeywords: string[];
  seoMetaDescription: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SYSTEM_WRITING_STRUCTURES: WritingStructure[] = [
  { 
    id: 'thesis', 
    name: 'Thesis', 
    description: 'Strong argument → Evidence → Conclusion',
    flow: ['Hook', 'Thesis Statement', 'Supporting Arguments', 'Evidence', 'Conclusion']
  },
  { 
    id: 'story', 
    name: 'Storytelling', 
    description: 'Setup → Conflict → Resolution',
    flow: ['Scene Setting', 'Challenge/Conflict', 'Journey', 'Resolution', 'Takeaway']
  },
  { 
    id: 'listicle', 
    name: 'Listicle', 
    description: 'Key points in structured list format',
    flow: ['Hook', 'Point 1', 'Point 2', 'Point 3+', 'Summary CTA']
  },
  { 
    id: 'problem_solution', 
    name: 'Problem → Solution', 
    description: 'Identify pain → Present fix',
    flow: ['Problem Statement', 'Why it Matters', 'Common Mistakes', 'The Solution', 'Next Steps']
  },
  { 
    id: 'before_after', 
    name: 'Before → After → Bridge', 
    description: 'BAB framework',
    flow: ['Before State', 'After State', 'Bridge (How to get there)', 'CTA']
  },
  { 
    id: 'aida', 
    name: 'AIDA', 
    description: 'Attention → Interest → Desire → Action',
    flow: ['Attention Hook', 'Interest Builder', 'Desire Creation', 'Action CTA']
  },
  { 
    id: 'opinion', 
    name: 'Hot Take / Opinion', 
    description: 'Controversial stance with backing',
    flow: ['Bold Claim', 'Why Most People Disagree', 'My Evidence', 'Nuanced Conclusion']
  },
  { 
    id: 'case_study', 
    name: 'Case Study', 
    description: 'Real example with results',
    flow: ['Context', 'Challenge', 'Approach', 'Results', 'Key Lessons']
  },
];

const PLATFORMS = [
  { id: 'linkedin_post', label: 'LinkedIn Post', icon: '💼', maxWords: 300 },
  { id: 'linkedin_article', label: 'LinkedIn Article', icon: '📰', maxWords: 2000 },
  { id: 'twitter_thread', label: 'Twitter/X Thread', icon: '🐦', maxWords: 280 },
  { id: 'instagram_caption', label: 'Instagram Caption', icon: '📸', maxWords: 150 },
  { id: 'blog_post', label: 'Blog Post', icon: '✍️', maxWords: 3000 },
  { id: 'newsletter', label: 'Newsletter', icon: '📧', maxWords: 1000 },
  { id: 'youtube_script', label: 'YouTube Script', icon: '🎬', maxWords: 1500 },
  { id: 'podcast_notes', label: 'Podcast Notes', icon: '🎙️', maxWords: 500 },
];

const CTA_OPTIONS = [
  { value: 'comment', label: 'Ask to Comment' },
  { value: 'share', label: 'Ask to Share' },
  { value: 'follow', label: 'Ask to Follow' },
  { value: 'visit_website', label: 'Visit Website' },
  { value: 'book_call', label: 'Book a Call' },
  { value: 'download', label: 'Download Resource' },
  { value: 'subscribe', label: 'Subscribe' },
  { value: 'none', label: 'No CTA' },
  { value: 'custom', label: '✏️ Custom CTA...' },
];

const OBJECTIVES = [
  'Build thought leadership',
  'Generate leads',
  'Build community',
  'Drive website traffic',
  'Educate audience',
  'Launch a product/service',
  'Share a case study',
  'Recruitment / Hiring',
  'Brand awareness',
  'Announce news',
];

const TONALITY_DIMENSIONS = [
  { key: 'angry', label: 'Angry', emoji: '😤', description: 'Righteous anger about an issue' },
  { key: 'frustrated', label: 'Frustrated', emoji: '😤', description: 'Mild irritation/exasperation' },
  { key: 'excited', label: 'Excited', emoji: '🔥', description: 'Energy and enthusiasm' },
  { key: 'confident', label: 'Confident', emoji: '💪', description: 'Certainty and authority' },
  { key: 'curious', label: 'Curious', emoji: '🤔', description: 'Questioning and exploring' },
  { key: 'empathetic', label: 'Empathetic', emoji: '🤝', description: 'Understanding and warmth' },
  { key: 'playful', label: 'Playful', emoji: '😄', description: 'Humor and lightness' },
  { key: 'serious', label: 'Serious', emoji: '🎯', description: 'Gravity and importance' },
];

const BLOG_WORD_COUNTS = [
  { value: 500, label: '500 words', desc: 'Quick read' },
  { value: 800, label: '800 words', desc: 'Standard' },
  { value: 1200, label: '1,200 words', desc: 'In-depth' },
  { value: 1500, label: '1,500 words', desc: 'Long-form' },
  { value: 2000, label: '2,000 words', desc: 'Comprehensive' },
  { value: 2500, label: '2,500 words', desc: 'Authority piece' },
  { value: 3000, label: '3,000+ words', desc: 'Pillar content' },
];

// ─── Step Components ──────────────────────────────────────────────────────────

// Step 1: Topic & Objective
function StepTopic({ 
  form, 
  update 
}: { 
  form: ContentForm; 
  update: (key: keyof ContentForm, val: unknown) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-400 mb-2">
          What do you want to write about? *
        </label>
        <input
          value={form.topic}
          onChange={e => update('topic', e.target.value)}
          placeholder="e.g. Why most startups fail at content marketing"
          className="w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors text-lg"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-3">Objective *</label>
        <div className="grid grid-cols-2 gap-2">
          {OBJECTIVES.map(obj => (
            <button
              key={obj}
              onClick={() => update('objective', obj)}
              className={`p-3 text-sm text-left rounded-xl border transition-all ${
                form.objective === obj
                  ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-300'
              }`}
            >
              {obj}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-400 mb-2">
          Additional Context
          <span className="ml-2 text-xs text-gray-600">(optional)</span>
        </label>
        <textarea
          value={form.context}
          onChange={e => update('context', e.target.value)}
          placeholder="Any specific angle, data points, personal story, or extra info the AI should know..."
          rows={4}
          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none resize-none transition-colors"
        />
      </div>
    </div>
  );
}

// Step 2: Audience / ICP Selection  
function StepAudience({
  form,
  update,
  savedICPs,
}: {
  form: ContentForm;
  update: (key: keyof ContentForm, val: unknown) => void;
  savedICPs: ICPProfile[];
}) {
  const [mode, setMode] = useState<'icp' | 'custom'>(
    form.selectedIcpId ? 'icp' : 'custom'
  );
  
  const selectedICP = savedICPs.find(i => i.id === form.selectedIcpId);

  return (
    <div className="space-y-6">
      {/* Mode Toggle */}
      <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-white/10">
        <button
          onClick={() => setMode('icp')}
          className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
            mode === 'icp'
              ? 'bg-violet-600 text-white'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          🎯 Use Saved ICP
        </button>
        <button
          onClick={() => {
            setMode('custom');
            update('selectedIcpId', null);
          }}
          className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${
            mode === 'custom'
              ? 'bg-violet-600 text-white'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          ✍️ Describe Manually
        </button>
      </div>

      {mode === 'icp' && (
        <>
          {savedICPs.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-white/10 rounded-2xl">
              <div className="text-4xl mb-3">🎯</div>
              <p className="text-white font-medium">No ICP profiles yet</p>
              <p className="text-gray-500 text-sm mt-1">
                Build ICPs in Brand Profile → ICP Profiles tab
              </p>
              <a
                href="/brand"
                className="mt-4 inline-block px-5 py-2 bg-violet-600/20 text-violet-300 text-sm rounded-xl border border-violet-500/30 hover:bg-violet-600/30 transition-all"
              >
                Go Build ICPs →
              </a>
            </div>
          ) : (
            <div className="grid gap-3">
              {savedICPs.map(icp => (
                <button
                  key={icp.id}
                  onClick={() => update('selectedIcpId', icp.id)}
                  className={`p-4 text-left rounded-xl border transition-all ${
                    form.selectedIcpId === icp.id
                      ? 'bg-violet-600/20 border-violet-500'
                      : 'bg-white/5 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-white">{icp.name}</p>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {[icp.basicChars?.role, icp.basicChars?.industry]
                          .filter(Boolean).join(' • ')}
                      </p>
                      {icp.currentChallenges && icp.currentChallenges.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {icp.currentChallenges.slice(0, 2).map((c, i) => (
                            <span key={i} className="text-xs px-2 py-0.5 bg-red-500/15 text-red-400 rounded-full">
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    {form.selectedIcpId === icp.id && (
                      <span className="text-violet-400 text-lg">✓</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Additional context even with ICP */}
          {form.selectedIcpId && (
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Additional Audience Notes
                <span className="ml-2 text-xs text-gray-600">(optional override)</span>
              </label>
              <textarea
                value={form.icpDescription}
                onChange={e => update('icpDescription', e.target.value)}
                placeholder="Anything specific about this piece's audience beyond the ICP..."
                rows={2}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none resize-none transition-colors text-sm"
              />
            </div>
          )}
        </>
      )}

      {mode === 'custom' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Target Audience *
            </label>
            <input
              value={form.customAudience}
              onChange={e => update('customAudience', e.target.value)}
              placeholder="e.g. Early-stage SaaS founders, B2B Marketing Directors"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Describe Them Further
            </label>
            <textarea
              value={form.icpDescription}
              onChange={e => update('icpDescription', e.target.value)}
              placeholder="Their biggest challenges, what they care about, what keeps them up at night..."
              rows={4}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none resize-none transition-colors"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Platform Selector Grid ──────────────────────────────────────────────────

const AVAILABLE_PLATFORMS = [
  'linkedin_post',
  'linkedin_article',
  'twitter_thread',
  'instagram_caption',
  'blog_post',
  'newsletter',
  'youtube_script',
  'podcast_notes',
];

interface PlatformSelectorProps {
  selected: string[];
  onChange: (platforms: string[]) => void;
}

function PlatformSelector({ selected, onChange }: PlatformSelectorProps) {
  const togglePlatform = (key: string) => {
    if (selected.includes(key)) {
      onChange(selected.filter(p => p !== key));
    } else {
      onChange([...selected, key]);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <label className="text-sm font-semibold text-white">
          Target Platform(s) <span className="text-red-500">*</span>
        </label>
        <p className="text-xs text-muted-foreground mt-1">
          Select multiple — AI will create platform-optimized variants for each
        </p>
      </div>

      {/* Platform Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {AVAILABLE_PLATFORMS.map((key) => {
          const config = PLATFORM_CONFIG[key];
          if (!config) return null;

          const isSelected = selected.includes(key);
          const { Icon, color, bgColor, label, wordCount } = config;

          return (
            <button
              key={key}
              type="button"
              onClick={() => togglePlatform(key)}
              className={cn(
                'group relative flex items-center gap-3 p-4 rounded-xl border transition-all',
                'text-left overflow-hidden',
                isSelected
                  ? 'bg-violet-500/10 border-violet-500/50 shadow-lg shadow-violet-500/10'
                  : 'bg-white/[0.02] border-white/10 hover:bg-white/[0.04] hover:border-white/20'
              )}
            >
              {/* Icon Container */}
              <div className={cn(
                'flex items-center justify-center w-11 h-11 rounded-lg shrink-0 transition-transform',
                bgColor,
                'group-hover:scale-110'
              )}>
                <Icon
                  className="w-6 h-6"
                  style={{ color }}
                />
              </div>

              {/* Label */}
              <div className="flex-1 min-w-0">
                <p className={cn(
                  'text-sm font-medium transition-colors',
                  isSelected ? 'text-white' : 'text-gray-300'
                )}>
                  {label}
                </p>
                {wordCount && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {wordCount}
                  </p>
                )}
              </div>

              {/* Check Indicator */}
              {isSelected && (
                <div className="w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center shrink-0 shadow-lg">
                  <Check className="w-3 h-3 text-white" strokeWidth={3} />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selection Count */}
      {selected.length > 0 && (
        <p className="text-xs text-violet-400">
          ✓ {selected.length} platform{selected.length !== 1 ? 's' : ''} selected
        </p>
      )}
    </div>
  );
}

// Step 3: Platform & Format
function StepPlatform({
  form,
  update,
}: {
  form: ContentForm;
  update: (key: keyof ContentForm, val: unknown) => void;
}) {
  const isBlogSelected = form.targetPlatforms.some(p => 
    p.includes('blog') || p.includes('newsletter') || p.includes('article')
  );

  return (
    <div className="space-y-6">
      <PlatformSelector
        selected={form.targetPlatforms}
        onChange={(platforms) => update('targetPlatforms', platforms)}
      />

      {/* Word Count — only for blog/long-form */}
      {isBlogSelected && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="space-y-3"
        >
          <label className="block text-sm font-medium text-gray-400">
            Blog / Article Word Count
          </label>
          <div className="grid grid-cols-4 gap-2">
            {BLOG_WORD_COUNTS.map(({ value, label, desc }) => (
              <button
                key={value}
                onClick={() => update('wordCount', value)}
                className={`p-3 text-center rounded-xl border transition-all ${
                  form.wordCount === value
                    ? 'bg-violet-600/20 border-violet-500'
                    : 'bg-white/5 border-white/10 hover:border-white/20'
                }`}
              >
                <p className="text-sm font-medium text-white">{label}</p>
                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </div>
  );
}

// Step 4: Tone, Style & Settings
function StepToneStyle({
  form,
  update,
  savedStructures,
  brandProfiles,
}: {
  form: ContentForm;
  update: (key: keyof ContentForm, val: unknown) => void;
  savedStructures: WritingStructure[];
  brandProfiles: Array<{ id: string; name: string }>;
}) {
  const [showCustomStructure, setShowCustomStructure] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('brand');

  const allStructures = [
    ...SYSTEM_WRITING_STRUCTURES,
    ...savedStructures,
  ];

  const selectedStructure = allStructures.find(s => s.id === form.writingStructureId);

  const SECTIONS = [
    { id: 'brand', label: '🏢 Brand & Structure' },
    { id: 'tonality', label: '🎭 Tonality Spectrum' },
    { id: 'cta', label: '🎯 CTA & Settings' },
    { id: 'seo', label: '🔍 SEO' },
  ];

  const updateTonality = (key: keyof TonalitySettings, value: number) => {
    update('tonality', { ...form.tonality, [key]: value });
  };

  return (
    <div className="space-y-5">
      {/* Section Tabs */}
      <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/10">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`flex-1 py-2 text-xs font-medium rounded-lg transition-all ${
              activeSection === s.id
                ? 'bg-violet-600 text-white'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Brand & Structure */}
      {activeSection === 'brand' && (
        <div className="space-y-5">
          {/* Brand Profile */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-3">
              Brand Profile
            </label>
            {brandProfiles.length === 0 ? (
              <div className="p-4 bg-white/3 border border-dashed border-white/10 rounded-xl text-center">
                <p className="text-sm text-gray-500">
                  No brand profiles yet.{' '}
                  <a href="/brand" className="text-violet-400 hover:underline">Create one →</a>
                </p>
              </div>
            ) : (
              <div className="grid gap-2">
                <button
                  onClick={() => update('brandProfileId', null)}
                  className={`p-3 text-left rounded-xl border text-sm transition-all ${
                    !form.brandProfileId
                      ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                  }`}
                >
                  ✕ No brand profile
                </button>
                {brandProfiles.map(bp => (
                  <button
                    key={bp.id}
                    onClick={() => update('brandProfileId', bp.id)}
                    className={`p-3 text-left rounded-xl border text-sm transition-all ${
                      form.brandProfileId === bp.id
                        ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                    }`}
                  >
                    🏢 {bp.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Writing Structure */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-medium text-gray-400">
                Writing Structure
              </label>
              <button
                onClick={() => setShowCustomStructure(!showCustomStructure)}
                className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
              >
                + Create Custom
              </button>
            </div>

            {showCustomStructure && (
              <div className="mb-4 p-4 bg-violet-500/10 border border-violet-500/20 rounded-xl space-y-3">
                <p className="text-xs text-violet-300 font-medium">Custom Structure</p>
                <textarea
                  value={form.customStructureFlow}
                  onChange={e => update('customStructureFlow', e.target.value)}
                  placeholder="Describe your structure flow:
e.g.
1. Open with a controversial question
2. Share a personal failure story
3. The lesson that changed everything
4. 3 actionable steps
5. What happens if you ignore this"
                  rows={6}
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 outline-none resize-none focus:border-violet-500/50 transition-colors"
                />
                <div className="flex gap-2">
                  <input
                    placeholder="Name this structure"
                    className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 outline-none focus:border-violet-500/50"
                  />
                  <button className="px-4 py-2 bg-violet-600 text-white text-sm rounded-xl hover:bg-violet-700 transition-all">
                    Save
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {allStructures.map(structure => (
                <button
                  key={structure.id}
                  onClick={() => update('writingStructureId', structure.id)}
                  className={`p-3 text-left rounded-xl border transition-all ${
                    form.writingStructureId === structure.id
                      ? 'bg-violet-600/20 border-violet-500'
                      : 'bg-white/5 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{structure.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{structure.description}</p>
                    </div>
                    {structure.isCustom && (
                      <span className="text-xs text-violet-400 ml-1">Custom</span>
                    )}
                  </div>
                  {form.writingStructureId === structure.id && structure.flow && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {structure.flow.map((step, i) => (
                        <span key={i} className="text-xs px-1.5 py-0.5 bg-violet-500/20 text-violet-300 rounded">
                          {i + 1}. {step}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Perspective & Language */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Perspective</label>
              <select
                value={form.perspective}
                onChange={e => update('perspective', e.target.value)}
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm outline-none focus:border-violet-500/50 transition-colors"
              >
                <option value="Founder">Founder</option>
                <option value="CEO">CEO</option>
                <option value="Expert">Expert</option>
                <option value="Practitioner">Practitioner</option>
                <option value="Educator">Educator</option>
                <option value="Brand">Brand (Company Voice)</option>
                <option value="Thought Leader">Thought Leader</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">Language</label>
              <select
                value={form.language}
                onChange={e => update('language', e.target.value)}
                className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm outline-none focus:border-violet-500/50 transition-colors"
              >
                <option value="English">English</option>
                <option value="Hindi">Hindi</option>
                <option value="Hinglish">Hinglish</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Arabic">Arabic</option>
                <option value="Portuguese">Portuguese</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Tonality Spectrum (NEW) */}
      {activeSection === 'tonality' && (
        <div className="space-y-5">
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
            <p className="text-amber-300 text-sm font-medium">🎭 Tonality Spectrum</p>
            <p className="text-amber-300/70 text-xs mt-1">
              This controls the emotional tone of THIS specific piece — 
              separate from your brand voice. 0 = not at all, 10 = very.
            </p>
          </div>

          {TONALITY_DIMENSIONS.map(({ key, label, emoji, description }) => {
            const value = form.tonality[key as keyof TonalitySettings];
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span>{emoji}</span>
                    <span className="text-sm font-medium text-white">{label}</span>
                    <span className="text-xs text-gray-600">{description}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${
                      value >= 7 ? 'text-violet-400' : 
                      value >= 4 ? 'text-gray-300' : 
                      'text-gray-600'
                    }`}>
                      {value}/10
                    </span>
                    {value >= 7 && (
                      <span className="text-xs px-2 py-0.5 bg-violet-500/20 text-violet-300 rounded-full">
                        HIGH
                      </span>
                    )}
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10}
                  value={value}
                  onChange={e => updateTonality(key as keyof TonalitySettings, Number(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #7c3aed ${value * 10}%, rgba(255,255,255,0.1) ${value * 10}%)`
                  }}
                />
              </div>
            );
          })}

          {/* Active tones summary */}
          {Object.entries(form.tonality).some(([, v]) => v >= 5) && (
            <div className="p-3 bg-white/5 rounded-xl border border-white/10">
              <p className="text-xs text-gray-500 mb-2">Active tones for this piece:</p>
              <div className="flex flex-wrap gap-2">
                {TONALITY_DIMENSIONS
                  .filter(d => form.tonality[d.key as keyof TonalitySettings] >= 5)
                  .sort((a, b) => 
                    form.tonality[b.key as keyof TonalitySettings] - 
                    form.tonality[a.key as keyof TonalitySettings]
                  )
                  .map(d => (
                    <span key={d.key} className="flex items-center gap-1 px-2 py-1 bg-violet-500/20 text-violet-300 text-xs rounded-full border border-violet-500/20">
                      {d.emoji} {d.label} {form.tonality[d.key as keyof TonalitySettings]}/10
                    </span>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      )}

      {/* CTA & Settings */}
      {activeSection === 'cta' && (
        <div className="space-y-5">
          {/* CTA */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-3">
              Call to Action
            </label>
            <div className="grid grid-cols-2 gap-2">
              {CTA_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => update('ctaType', option.value)}
                  className={`p-3 text-sm text-left rounded-xl border transition-all ${
                    form.ctaType === option.value
                      ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            
            {/* Custom CTA Input */}
            <AnimatePresence>
              {form.ctaType === 'custom' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3"
                >
                  <textarea
                    value={form.customCta}
                    onChange={e => update('customCta', e.target.value)}
                    placeholder={`Write your exact CTA here...
e.g. "If this resonated, DM me the word GROWTH and I'll send you the full framework."`}
                    rows={3}
                    className="w-full px-4 py-3 bg-white/5 border border-violet-500/30 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none resize-none transition-colors text-sm"
                    autoFocus
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Keywords */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Keywords to Include
              <span className="ml-2 text-xs text-gray-600">(press Enter to add)</span>
            </label>
            <div className="min-h-[44px] p-2 bg-white/5 border border-white/10 rounded-xl flex flex-wrap gap-2 focus-within:border-violet-500/50 transition-colors">
              {form.keywords.map((kw, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-500/20 text-blue-300 text-xs rounded-lg border border-blue-500/30">
                  {kw}
                  <button onClick={() => update('keywords', form.keywords.filter((_, idx) => idx !== i))}>×</button>
                </span>
              ))}
              <input
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val && !form.keywords.includes(val)) {
                      update('keywords', [...form.keywords, val]);
                    }
                    (e.target as HTMLInputElement).value = '';
                    e.preventDefault();
                  }
                }}
                placeholder={form.keywords.length === 0 ? "Type keywords..." : ""}
                className="flex-1 min-w-[120px] bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
              />
            </div>
          </div>

          {/* AI Options */}
          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-400">AI Processing</p>
            {[
              { 
                key: 'enableHumanization', 
                label: 'Humanization', 
                desc: 'Make content sound more natural and less AI-like' 
              },
              { 
                key: 'enableQA', 
                label: 'Quality Check', 
                desc: 'Auto QA and scoring pass at the end' 
              },
            ].map(({ key, label, desc }) => (
              <div 
                key={key}
                className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10"
              >
                <div>
                  <p className="text-sm font-medium text-white">{label}</p>
                  <p className="text-xs text-gray-500">{desc}</p>
                </div>
                <button
                  onClick={() => update(key as keyof ContentForm, !form[key as keyof ContentForm])}
                  className={`w-12 h-6 rounded-full transition-all relative ${
                    form[key as keyof ContentForm] 
                      ? 'bg-violet-600' 
                      : 'bg-white/10'
                  }`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${
                    form[key as keyof ContentForm] ? 'left-7' : 'left-1'
                  }`} />
                </button>
              </div>
            ))}

            {form.enableHumanization && (
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="text-sm text-gray-400 mb-3">Humanization Intensity</p>
                <div className="grid grid-cols-3 gap-2">
                  {['light', 'medium', 'aggressive'].map(level => (
                    <button
                      key={level}
                      onClick={() => update('humanizationIntensity', level)}
                      className={`py-2 text-sm rounded-xl border transition-all capitalize ${
                        form.humanizationIntensity === level
                          ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                          : 'bg-white/5 border-white/10 text-gray-400'
                      }`}
                    >
                      {level === 'aggressive' ? 'heavy' : level}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Special Instructions */}
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Special Instructions
            </label>
            <textarea
              value={form.specialInstructions}
              onChange={e => update('specialInstructions', e.target.value)}
              placeholder="Any extra rules or instructions for this specific piece..."
              rows={3}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none resize-none transition-colors text-sm"
            />
          </div>
        </div>
      )}

      {/* SEO Settings */}
      {activeSection === 'seo' && (
        <div className="space-y-5">
          <div className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/10">
            <div>
              <p className="text-sm font-medium text-white">Enable SEO Optimization</p>
              <p className="text-xs text-gray-500">
                AI will optimize for search engines — headings, meta, structure
              </p>
            </div>
            <button
              onClick={() => update('enableSEO', !form.enableSEO)}
              className={`w-12 h-6 rounded-full transition-all relative ${
                form.enableSEO ? 'bg-violet-600' : 'bg-white/10'
              }`}
            >
              <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${
                form.enableSEO ? 'left-7' : 'left-1'
              }`} />
            </button>
          </div>

          {form.enableSEO && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              {/* ✅ FIX: Primary Keyword input NOW WIRED + length validation */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Primary SEO Keyword
                  <span className="ml-2 text-xs text-gray-600">(max 200 chars)</span>
                </label>
                <input
                  value={form.seoKeywords[0] || ''}
                  onChange={e => {
                    const val = e.target.value.slice(0, 200); // Hard limit
                    const rest = form.seoKeywords.slice(1);
                    update('seoKeywords', val ? [val, ...rest] : rest);
                  }}
                  placeholder="e.g. content marketing for startups"
                  maxLength={200}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors"
                />
                <p className="text-xs text-gray-600 mt-1 text-right">
                  {(form.seoKeywords[0] || '').length}/200
                </p>
              </div>

              {/* ✅ FIX: Secondary keywords - each tag limited */}
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Secondary Keywords
                  <span className="ml-2 text-xs text-gray-600">(press Enter, max 100 chars each)</span>
                </label>
                <div className="min-h-[44px] p-2 bg-white/5 border border-white/10 rounded-xl flex flex-wrap gap-2 focus-within:border-violet-500/50">
                  {form.seoKeywords.slice(1).map((kw, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 px-2 py-1 bg-green-500/20 text-green-300 text-xs rounded-lg border border-green-500/30 max-w-full"
                    >
                      <span className="truncate max-w-[200px]">{kw}</span>
                      <button
                        onClick={() => {
                          const primary = form.seoKeywords[0] || '';
                          const secondary = form.seoKeywords.slice(1);
                          const newSecondary = secondary.filter((_, idx) => idx !== i);
                          update('seoKeywords', primary ? [primary, ...newSecondary] : newSecondary);
                        }}
                      >×</button>
                    </span>
                  ))}
                  <input
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        const raw = (e.target as HTMLInputElement).value.trim();
                        if (!raw) return;
                        const val = raw.slice(0, 100); // Per-tag limit
                        if (val && !form.seoKeywords.includes(val)) {
                          update('seoKeywords', [...form.seoKeywords, val]);
                        }
                        (e.target as HTMLInputElement).value = '';
                        e.preventDefault();
                      }
                    }}
                    maxLength={100}
                    className="flex-1 min-w-[120px] bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
                    placeholder="Add keywords..."
                  />
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  Tip: Add individual keywords one at a time. Long comma-separated lists don't work well.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  Target Meta Description
                  <span className="ml-2 text-xs text-gray-600">(optional — AI will generate if empty)</span>
                </label>
                <textarea
                  value={form.seoMetaDescription}
                  onChange={e => update('seoMetaDescription', e.target.value)}
                  placeholder="Describe what this content is about for search engines..."
                  rows={2}
                  maxLength={160}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none resize-none transition-colors text-sm"
                />
                <p className="text-xs text-gray-600 mt-1 text-right">
                  {form.seoMetaDescription.length}/160
                </p>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const STEPS = [
  { id: 'topic', label: 'Topic', icon: '💡' },
  { id: 'audience', label: 'Audience', icon: '🎯' },
  { id: 'platform', label: 'Platform', icon: '📱' },
  { id: 'style', label: 'Style', icon: '🎨' },
];

const defaultTonality: TonalitySettings = {
  angry: 0,
  frustrated: 0,
  excited: 5,
  confident: 6,
  curious: 4,
  empathetic: 5,
  playful: 3,
  serious: 5,
};

export default function NewContentPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // ✅ FIX: Real API calls
  const { data: brandData } = useQuery({
    queryKey: ['brand-profiles'],
    queryFn:  () => api.get('/brand').then((r: any) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: icpData } = useQuery({
    queryKey: ['icp-profiles-all'],
    queryFn:  () => api.get('/brand/icps/all').then((r: any) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // ✅ FIX: Correct variable names
  const brandProfiles = (brandData?.profiles ?? []).map((p: any) => ({
    id:   p.id,
    name: p.name,
  }));

  const savedICPs: ICPProfile[] = (icpData?.icps ?? []).map((i: any) => ({
    id:   i.id,
    name: i.name,
    basicChars: i.basic_characteristics ?? {},
    currentChallenges: i.current_challenges ?? [],
    goals: i.goals ?? [],
    frustrations: i.frustrations ?? [],
    emotionalMotivations: i.emotional_motivations ?? [],
    interests: i.interests ?? [],
    infoSources: i.information_sources ?? [],
    personalityScores: i.personality_scores ?? {},
    positioningStrategy: i.positioning_strategy ?? '',
  }));

  const savedStructures: WritingStructure[] = [];

  const [form, setForm] = useState<ContentForm>({
    topic: '',
    objective: '',
    context: '',
    selectedIcpId: null,
    customAudience: '',
    icpDescription: '',
    targetPlatforms: [],
    contentType: '',
    wordCount: null,
    brandProfileId: null,
    writingStructureId: 'thesis',
    customStructureFlow: '',
    perspective: 'Founder',
    language: 'English',
    keywords: [],
    ctaType: 'comment',
    customCta: '',
    tonality: defaultTonality,
    specialInstructions: '',
    enableHumanization: true,
    humanizationIntensity: 'medium',
    enableQA: true,
    enableSEO: false,
    seoKeywords: [],
    seoMetaDescription: '',
  });

  const update = useCallback((key: keyof ContentForm, val: unknown) => {
    setForm(p => ({ ...p, [key]: val }));
  }, []);

  const canProceed = () => {
    switch (step) {
      case 0: return !!form.topic && !!form.objective;
      case 1: return !!(form.selectedIcpId || form.customAudience);
      case 2: return form.targetPlatforms.length > 0;
      case 3: return true;
      default: return false;
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');

    try {
      // Client-side validation
      if (!form.topic.trim()) {
        setError('Topic is required');
        setGenerating(false);
        return;
      }

      if (form.targetPlatforms.length === 0) {
        setError('Select at least one platform');
        setGenerating(false);
        return;
      }

      // ✅ NEW: Length validation before send
      const primaryKw = form.seoKeywords[0] || '';
      if (primaryKw.length > 200) {
        setError('Primary SEO keyword is too long (max 200 chars). Split into secondary keywords.');
        setGenerating(false);
        return;
      }

      if (form.customAudience.length > 500) {
        setError('Custom audience field is too long. Please shorten it.');
        setGenerating(false);
        return;
      }

      const isSystemStructure = [
        'thesis', 'story', 'listicle', 'problem_solution',
        'before_after', 'aida', 'opinion', 'case_study'
      ].includes(form.writingStructureId);

      const payload: Record<string, unknown> = {
        topic:     form.topic.trim().slice(0, 500),  // Hard cap
        objective: (form.objective || 'Build thought leadership').slice(0, 200),
        context:   form.context || '',

        audience:            (form.customAudience || 'General Business').slice(0, 500),
        audienceDescription: form.icpDescription || '',
        icpProfileId:        form.selectedIcpId ?? undefined,

        platforms: form.targetPlatforms,

        writingStructure:    isSystemStructure ? form.writingStructureId : 'custom',
        customStructureId:   !isSystemStructure ? form.writingStructureId : undefined,
        customStructureFlow: form.customStructureFlow || undefined,

        narrativePerspective: (form.perspective || 'Founder').slice(0, 100),
        language:             (form.language     || 'English').slice(0, 30),
        keywords:             form.keywords     || [],

        ctaType:   (form.ctaType || 'comment').slice(0, 100),
        customCta: form.customCta || undefined,

        brandProfileId: form.brandProfileId ?? undefined,

        humanizationEnabled: form.enableHumanization,
        humanizationLevel:   form.humanizationIntensity || 'medium',
        qaEnabled:           form.enableQA,

        tonalitySpectrum: form.tonality || {},

        wordCount: form.wordCount ?? undefined,

        seoEnabled: form.enableSEO || false,
        seoSettings: form.enableSEO ? {
          primaryKeyword:    primaryKw.slice(0, 200) || undefined,
          secondaryKeywords: form.seoKeywords.slice(1).map(k => k.slice(0, 100)),
          metaDescription:   form.seoMetaDescription.slice(0, 160) || undefined,
        } : {},

        specialInstructions: form.specialInstructions || '',
      };

      const cleanPayload = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined)
      );

      const response = await api.post('/content/generate', cleanPayload);
      const { requestId, contentId } = response.data;

      router.push(`/content/${contentId || requestId}/generating`);

    } catch (err: any) {
      // ✅ NEW: Better error messages from backend
      const backendErr = err?.response?.data;
      let msg = 'Generation failed';

      if (backendErr?.error) {
        msg = typeof backendErr.error === 'string'
          ? backendErr.error
          : 'Validation failed';
      }

      if (backendErr?.details && Array.isArray(backendErr.details)) {
        msg = backendErr.details.map((d: any) => `${d.field}: ${d.message}`).join(', ');
      }

      if (backendErr?.hint) {
        msg += ` — ${backendErr.hint}`;
      }

      setError(msg);
      setGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080809] text-white">
      <div className="max-w-2xl mx-auto px-6 py-10">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Create Content</h1>
          <p className="text-gray-500 text-sm mt-1">
            {STEPS[step].icon} Step {step + 1} of {STEPS.length} — {STEPS[step].label}
          </p>
        </div>

        {/* Progress */}
        <div className="flex gap-2 mb-8">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              onClick={() => i < step && setStep(i)}
              className={`flex-1 h-1.5 rounded-full transition-all ${
                i < step ? 'bg-violet-500 cursor-pointer' :
                i === step ? 'bg-violet-600' :
                'bg-white/10'
              }`}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Step Content */}
        <div className="bg-white/3 border border-white/10 rounded-2xl p-6 mb-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {step === 0 && <StepTopic form={form} update={update} />}
              {step === 1 && (
                <StepAudience 
                  form={form} 
                  update={update} 
                  savedICPs={savedICPs}
                />
              )}
              {step === 2 && <StepPlatform form={form} update={update} />}
              {step === 3 && (
                <StepToneStyle
                  form={form}
                  update={update}
                  savedStructures={savedStructures}
                  brandProfiles={brandProfiles}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Navigation */}
        <div className="flex justify-between">
          <button
            onClick={() => step > 0 ? setStep(step - 1) : router.back()}
            className="px-5 py-2.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            {step === 0 ? '← Cancel' : '← Back'}
          </button>

          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all"
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={generating || !canProceed()}
              className="flex items-center gap-2 px-8 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-all"
            >
              {generating ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Generating...
                </>
              ) : (
                '✨ Generate Content'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}