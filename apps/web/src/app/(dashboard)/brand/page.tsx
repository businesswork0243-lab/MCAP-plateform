// apps/web/src/app/(dashboard)/brand/page.tsx
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BrandDocument {
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'uploading' | 'done' | 'error';
  progress: number;
  url?: string;
}

interface ICPProfile {
  id: string;
  name: string;
  basicChars: {
    ageGroup: string;
    education: string;
    role: string;
    industry: string;
    orgType: string;
    seniority: string;
    geography: string;
    revenueRange: string;
    teamSize: string;
    purchasingAuthority: string;
  };
  interests: string[];
  currentChallenges: string[];
  emotionalMotivations: string[];
  frustrations: string[];
  goals: string[];
  infoSources: string[];
  personalityScores: Record<string, number>;
  positioningStrategy: string;
}

interface BrandProfile {
  // Basic
  name: string;
  website: string;
  industry: string;
  description: string;
  missionStatement: string;
  
  // Extended - New Fields
  likes: string[];
  hates: string[];
  dislikes: string[];
  standsFor: string[];
  standsAgainst: string[];
  coreMotivations: string[];
  coreValues: string[];
  lifePurpose: string;
  
  // Voice
  toneSettings: {
    formality: number;
    enthusiasm: number;
    technicality: number;
    humor: number;
    empathy: number;
  };
  preferredTerms: string[];
  bannedPhrases: string[];
  keyMessages: string[];
  complianceNotes: string;
  
  // Documents
  documents: BrandDocument[];
  
  // ICPs
  icpProfiles: ICPProfile[];
}

// ─── Sub Components ───────────────────────────────────────────────────────────

// Tag Input Component
function TagInput({ 
  label, 
  tags, 
  onChange,
  placeholder = "Type and press Enter",
  color = "violet"
}: { 
  label: string; 
  tags: string[]; 
  onChange: (tags: string[]) => void;
  placeholder?: string;
  color?: string;
}) {
  const [input, setInput] = useState('');
  
  const colorMap: Record<string, string> = {
    violet: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    green: 'bg-green-500/20 text-green-300 border-green-500/30',
    red: 'bg-red-500/20 text-red-300 border-red-500/30',
    blue: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    amber: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      if (!tags.includes(input.trim())) {
        onChange([...tags, input.trim()]);
      }
      setInput('');
    }
    if (e.key === 'Backspace' && !input && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-400 mb-2">{label}</label>
      <div className="min-h-[44px] p-2 bg-white/5 border border-white/10 rounded-xl flex flex-wrap gap-2 focus-within:border-violet-500/50 transition-colors">
        {tags.map((tag, i) => (
          <span 
            key={i} 
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium ${colorMap[color]}`}
          >
            {tag}
            <button 
              onClick={() => onChange(tags.filter((_, idx) => idx !== i))}
              className="hover:opacity-70 ml-1"
            >×</button>
          </span>
        ))}
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] bg-transparent text-sm text-white outline-none placeholder:text-gray-600"
        />
      </div>
    </div>
  );
}

// Document Upload Component
function DocumentUploader({ 
  documents, 
  onDocumentsChange 
}: { 
  documents: BrandDocument[];
  onDocumentsChange: (docs: BrandDocument[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const ACCEPTED_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'image/png',
    'image/jpeg',
  ];
  
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    
    const newDocs: BrandDocument[] = fileArray
      .filter(f => ACCEPTED_TYPES.includes(f.type) && f.size <= MAX_FILE_SIZE)
      .map(f => ({
        id: `doc-${Date.now()}-${Math.random()}`,
        name: f.name,
        size: f.size,
        type: f.type,
        status: 'uploading' as const,
        progress: 0,
      }));

    const updatedDocs = [...documents, ...newDocs];
    onDocumentsChange(updatedDocs);

    // Simulate upload (replace with actual API call)
    let currentDocs = updatedDocs;
    for (const doc of newDocs) {
      // Simulate progress
      for (let progress = 0; progress <= 100; progress += 20) {
        await new Promise(r => setTimeout(r, 100));
        currentDocs = currentDocs.map(d => 
          d.id === doc.id 
            ? { ...d, progress, status: progress === 100 ? 'done' : 'uploading' }
            : d
        ) as BrandDocument[];
        onDocumentsChange(currentDocs);
      }
    }
  }, [documents, onDocumentsChange]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  const getFileIcon = (type: string) => {
    if (type.includes('pdf')) return '📄';
    if (type.includes('word') || type.includes('document')) return '📝';
    if (type.includes('image')) return '🖼️';
    return '📎';
  };

  return (
    <div className="space-y-4">
      <label className="block text-sm font-medium text-gray-400">
        Brand Documents
        <span className="ml-2 text-xs text-gray-600">
          (PDF, DOCX, TXT, Images — max 10MB each)
        </span>
      </label>

      {/* Drop Zone */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`
          relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
          ${isDragging 
            ? 'border-violet-500 bg-violet-500/10' 
            : 'border-white/10 hover:border-violet-500/40 hover:bg-white/5'
          }
        `}
      >
        <div className="text-4xl mb-3">📁</div>
        <p className="text-white font-medium">Drop files here</p>
        <p className="text-gray-500 text-sm mt-1">
          or click to browse — brand guidelines, style guides, tone docs, etc.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
          className="hidden"
          onChange={e => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* File List */}
      {documents.length > 0 && (
        <div className="space-y-2">
          {documents.map(doc => (
            <div 
              key={doc.id}
              className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10"
            >
              <span className="text-xl">{getFileIcon(doc.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{doc.name}</p>
                <p className="text-xs text-gray-500">{formatSize(doc.size)}</p>
                {doc.status === 'uploading' && (
                  <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-violet-500 transition-all duration-200"
                      style={{ width: `${doc.progress}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {doc.status === 'done' && (
                  <span className="text-green-400 text-xs">✓ Done</span>
                )}
                {doc.status === 'uploading' && (
                  <span className="text-violet-400 text-xs">{doc.progress}%</span>
                )}
                {doc.status === 'error' && (
                  <span className="text-red-400 text-xs">✗ Failed</span>
                )}
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onDocumentsChange(documents.filter(d => d.id !== doc.id));
                  }}
                  className="text-gray-500 hover:text-red-400 transition-colors p-1"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ICP Builder Modal
function ICPBuilderModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (icp: ICPProfile) => void;
}) {
  const [step, setStep] = useState(0);
  const [icp, setIcp] = useState<ICPProfile>({
    id: `icp-${Date.now()}`,
    name: '',
    basicChars: {
      ageGroup: '',
      education: '',
      role: '',
      industry: '',
      orgType: '',
      seniority: '',
      geography: '',
      revenueRange: '',
      teamSize: '',
      purchasingAuthority: '',
    },
    interests: [],
    currentChallenges: [],
    emotionalMotivations: [],
    frustrations: [],
    goals: [],
    infoSources: [],
    personalityScores: {
      introversion_extroversion: 5,
      creativity_analytical: 5,
      emotional_rational: 5,
      conservative_experimental: 5,
      short_long_term: 5,
    },
    positioningStrategy: '',
  });

  const PERSONALITY_SCALES = [
    { key: 'introversion_extroversion', left: 'Introvert', right: 'Extrovert' },
    { key: 'creativity_analytical', left: 'Creative', right: 'Analytical' },
    { key: 'emotional_rational', left: 'Emotional', right: 'Rational' },
    { key: 'conservative_experimental', left: 'Conservative', right: 'Experimental' },
    { key: 'short_long_term', left: 'Short-term', right: 'Long-term' },
  ];

  const steps = [
    'Basic Info',
    'Characteristics', 
    'Psychology',
    'Behavioral Map',
    'Strategy',
  ];

  const updateBasicChar = (key: string, value: string) => {
    setIcp(prev => ({
      ...prev,
      basicChars: { ...prev.basicChars, [key]: value }
    }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="absolute inset-0 bg-black/80 backdrop-blur-sm" 
        onClick={onClose} 
      />
      <div className="relative w-full max-w-2xl bg-[#0F0F10] border border-white/10 rounded-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">
              Build ICP Profile
            </h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white">
              ✕
            </button>
          </div>
          
          {/* Step Indicators */}
          <div className="flex gap-2">
            {steps.map((s, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-all ${
                  i === step 
                    ? 'bg-violet-600 text-white' 
                    : i < step
                    ? 'bg-violet-500/20 text-violet-400'
                    : 'bg-white/5 text-gray-500'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-5">
          
          {/* Step 0: Basic Info */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-2">
                  ICP Name *
                </label>
                <input
                  value={icp.name}
                  onChange={e => setIcp(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Mid-Market SaaS Founder"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: 'role', label: 'Job Role / Title', placeholder: 'e.g. VP Marketing' },
                  { key: 'seniority', label: 'Seniority', placeholder: 'e.g. Director, C-Suite' },
                  { key: 'industry', label: 'Industry', placeholder: 'e.g. SaaS, Healthcare' },
                  { key: 'orgType', label: 'Organization Type', placeholder: 'e.g. Startup, Enterprise' },
                  { key: 'ageGroup', label: 'Age Group', placeholder: 'e.g. 30-45' },
                  { key: 'teamSize', label: 'Team Size', placeholder: 'e.g. 10-50' },
                  { key: 'revenueRange', label: 'Revenue Range', placeholder: 'e.g. $1M-$10M' },
                  { key: 'geography', label: 'Geography', placeholder: 'e.g. North America' },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="block text-sm font-medium text-gray-400 mb-1">{label}</label>
                    <input
                      value={icp.basicChars[key as keyof typeof icp.basicChars]}
                      onChange={e => updateBasicChar(key, e.target.value)}
                      placeholder={placeholder}
                      className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none"
                    />
                  </div>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Purchasing Authority
                </label>
                <select
                  value={icp.basicChars.purchasingAuthority}
                  onChange={e => updateBasicChar('purchasingAuthority', e.target.value)}
                  className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white focus:border-violet-500/50 outline-none"
                >
                  <option value="">Select...</option>
                  <option value="sole_decision_maker">Sole Decision Maker</option>
                  <option value="strong_influence">Strong Influence</option>
                  <option value="committee">Part of Committee</option>
                  <option value="recommender">Recommender Only</option>
                </select>
              </div>
            </div>
          )}

          {/* Step 1: Characteristics (SIRF Layer 1) */}
          {step === 1 && (
            <div className="space-y-5">
              <TagInput
                label="Current Challenges"
                tags={icp.currentChallenges}
                onChange={v => setIcp(p => ({ ...p, currentChallenges: v }))}
                placeholder="Add a challenge and press Enter"
                color="red"
              />
              <TagInput
                label="Goals & Desired Outcomes"
                tags={icp.goals}
                onChange={v => setIcp(p => ({ ...p, goals: v }))}
                placeholder="Add a goal and press Enter"
                color="green"
              />
              <TagInput
                label="Frustrations (with current solutions)"
                tags={icp.frustrations}
                onChange={v => setIcp(p => ({ ...p, frustrations: v }))}
                placeholder="Add a frustration and press Enter"
                color="amber"
              />
              <TagInput
                label="Information Sources (where they learn)"
                tags={icp.infoSources}
                onChange={v => setIcp(p => ({ ...p, infoSources: v }))}
                placeholder="e.g. LinkedIn, G2, Industry Reports"
                color="blue"
              />
              <TagInput
                label="Professional Interests"
                tags={icp.interests}
                onChange={v => setIcp(p => ({ ...p, interests: v }))}
                placeholder="e.g. Growth hacking, Product-led growth"
                color="violet"
              />
            </div>
          )}

          {/* Step 2: Psychology */}
          {step === 2 && (
            <div className="space-y-5">
              <TagInput
                label="Emotional Motivations"
                tags={icp.emotionalMotivations}
                onChange={v => setIcp(p => ({ ...p, emotionalMotivations: v }))}
                placeholder="e.g. Recognition, Career advancement"
                color="violet"
              />
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-3">
                  Positioning Strategy
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    'Strategic Advisor',
                    'Technology Partner', 
                    'Cost Optimizer',
                    'Innovation Leader',
                    'Reliability Specialist',
                    'Growth Accelerator',
                    'Risk Reduction Expert',
                    'Industry Expert',
                  ].map(strategy => (
                    <button
                      key={strategy}
                      onClick={() => setIcp(p => ({ ...p, positioningStrategy: strategy }))}
                      className={`p-3 rounded-xl text-sm text-left transition-all border ${
                        icp.positioningStrategy === strategy
                          ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                      }`}
                    >
                      {strategy}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Behavioral Map (SIRF Layer 2) */}
          {step === 3 && (
            <div className="space-y-6">
              <p className="text-sm text-gray-500">
                Rate this ICP on each scale (1 = left, 10 = right)
              </p>
              {PERSONALITY_SCALES.map(({ key, left, right }) => (
                <div key={key}>
                  <div className="flex justify-between text-xs text-gray-500 mb-2">
                    <span>{left}</span>
                    <span className="text-white font-medium">
                      {icp.personalityScores[key] ?? 5}/10
                    </span>
                    <span>{right}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={icp.personalityScores[key] ?? 5}
                    onChange={e => setIcp(p => ({
                      ...p,
                      personalityScores: {
                        ...p.personalityScores,
                        [key]: Number(e.target.value)
                      }
                    }))}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #7c3aed ${((icp.personalityScores[key] ?? 5) - 1) * 11.1}%, rgba(255,255,255,0.1) ${((icp.personalityScores[key] ?? 5) - 1) * 11.1}%)`
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Step 4: Strategy Summary */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="p-4 bg-violet-500/10 border border-violet-500/20 rounded-xl">
                <h3 className="text-violet-300 font-medium mb-3">ICP Summary Preview</h3>
                <div className="space-y-2 text-sm">
                  <p className="text-white font-medium">{icp.name || 'Unnamed ICP'}</p>
                  <p className="text-gray-400">
                    {icp.basicChars.role} • {icp.basicChars.industry} • {icp.basicChars.seniority}
                  </p>
                  {icp.currentChallenges.length > 0 && (
                    <div>
                      <p className="text-gray-500 text-xs mt-2 mb-1">KEY CHALLENGES</p>
                      <div className="flex flex-wrap gap-1">
                        {icp.currentChallenges.slice(0, 3).map((c, i) => (
                          <span key={i} className="px-2 py-0.5 bg-red-500/20 text-red-300 text-xs rounded-full">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {icp.positioningStrategy && (
                    <p className="text-gray-400 text-xs mt-2">
                      Position as: <span className="text-violet-300">{icp.positioningStrategy}</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 flex justify-between">
          <button
            onClick={() => step > 0 ? setStep(step - 1) : onClose()}
            className="px-5 py-2.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            {step === 0 ? 'Cancel' : '← Back'}
          </button>
          
          {step < steps.length - 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={step === 0 && !icp.name}
              className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-all"
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={() => onSave(icp)}
              disabled={!icp.name}
              className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-all"
            >
              Save ICP Profile ✓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Brand Page ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'identity', label: 'Identity', icon: '🏢' },
  { id: 'voice', label: 'Voice & Tone', icon: '🎙️' },
  { id: 'values', label: 'Values & Beliefs', icon: '💎' },
  { id: 'documents', label: 'Documents', icon: '📁' },
  { id: 'icp', label: 'ICP Profiles', icon: '🎯' },
];

export default function BrandPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('identity');
  const [showICPModal, setShowICPModal] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  // ── Fetch brand profiles ──────────────────────────────────────────────────
  const { data: brandData, isLoading: brandsLoading } = useQuery({
    queryKey: ['brand-profiles'],
    queryFn:  () => api.get('/brand').then((r: any) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const profiles = brandData?.profiles ?? [];

  // ── Fetch ICPs ────────────────────────────────────────────────────────────
  const { data: icpData } = useQuery({
    queryKey: ['icp-profiles-all'],
    queryFn:  () => api.get('/brand/icps/all').then((r: any) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const icpProfiles = icpData?.icps ?? [];

  // ── Active profile ────────────────────────────────────────────────────────
  const activeProfile = profiles.find(
    (p: { id: string }) => p.id === activeProfileId
  ) ?? profiles[0] ?? null;

  // Auto-select first profile
  useEffect(() => {
    if (!activeProfileId && profiles.length > 0) {
      setActiveProfileId(profiles[0].id);
    }
  }, [profiles, activeProfileId]);

  // ── Local form state ──────────────────────────────────────────────────────
  const [formProfile, setFormProfile] = useState<BrandProfile>({
    name: '',
    website: '',
    industry: '',
    description: '',
    missionStatement: '',
    likes: [],
    hates: [],
    dislikes: [],
    standsFor: [],
    standsAgainst: [],
    coreMotivations: [],
    coreValues: [],
    lifePurpose: '',
    toneSettings: {
      formality:   5,
      enthusiasm:  5,
      technicality: 5,
      humor:       3,
      empathy:     7,
    },
    preferredTerms: [],
    bannedPhrases:  [],
    keyMessages:    [],
    complianceNotes: '',
    documents:   [],
    icpProfiles: [],
  });

  // Sync form when active profile loads
  useEffect(() => {
    if (!activeProfile) return;
    setFormProfile({
      name:            activeProfile.name             ?? '',
      website:         activeProfile.website          ?? '',
      industry:        activeProfile.industry         ?? '',
      description:     activeProfile.description      ?? '',
      missionStatement: activeProfile.mission         ?? '',
      likes:           activeProfile.likes            ?? [],
      hates:           activeProfile.hates            ?? [],
      dislikes:        activeProfile.dislikes         ?? [],
      standsFor:       activeProfile.stands_for       ?? [],
      standsAgainst:   activeProfile.stands_against   ?? [],
      coreMotivations: activeProfile.core_motivations ?? [],
      coreValues:      activeProfile.core_values      ?? [],
      lifePurpose:     activeProfile.life_purpose     ?? '',
      toneSettings: {
        formality:    activeProfile.tone_formality    ?? 5,
        enthusiasm:   activeProfile.tone_enthusiasm   ?? 5,
        technicality: activeProfile.tone_technical    ?? 5,
        humor:        activeProfile.tone_humor        ?? 3,
        empathy:      activeProfile.tone_empathy      ?? 7,
      },
      preferredTerms:  activeProfile.preferred_terms  ?? [],
      bannedPhrases:   activeProfile.banned_phrases   ?? [],
      keyMessages:     activeProfile.key_messages     ?? [],
      complianceNotes: activeProfile.compliance_notes ?? '',
      documents:       [],
      icpProfiles:     [],
    });
  }, [activeProfile]);

  const update = (key: keyof BrandProfile, value: unknown) => {
    setFormProfile(p => ({ ...p, [key]: value }));
  };

  // ── Save mutation ─────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (data: BrandProfile) => {
      const payload = {
        name:             data.name,
        website:          data.website,
        industry:         data.industry,
        description:      data.description,
        mission:          data.missionStatement,
        life_purpose:     data.lifePurpose,
        likes:            data.likes,
        hates:            data.hates,
        dislikes:         data.dislikes,
        stands_for:       data.standsFor,
        stands_against:   data.standsAgainst,
        core_motivations: data.coreMotivations,
        core_values:      data.coreValues,
        preferredTerms:   data.preferredTerms,
        bannedPhrases:    data.bannedPhrases,
        keyMessages:      data.keyMessages,
        complianceNotes:  data.complianceNotes,
        tone: {
          formality:      data.toneSettings.formality,
          enthusiasm:     data.toneSettings.enthusiasm,
          technical:      data.toneSettings.technicality,
          humor:          data.toneSettings.humor,
          empathy:        data.toneSettings.empathy,
        },
      };

      if (activeProfileId) {
        return api.put(`/brand/${activeProfileId}`, payload);
      } else {
        return api.post('/brand', { ...payload, isDefault: true });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['brand-profiles'] });
    },
  });

  // ── Create ICP mutation ───────────────────────────────────────────────────
  const createIcpMutation = useMutation({
    mutationFn: (icp: ICPProfile) => {
      const profileId = activeProfileId ?? profiles[0]?.id;
      if (!profileId) throw new Error('No brand profile selected');

      return api.post(`/brand/${profileId}/icps`, {
        name:                  icp.name,
        basic_characteristics: icp.basicChars,
        interests:             icp.interests,
        current_challenges:    icp.currentChallenges,
        emotional_motivations: icp.emotionalMotivations,
        frustrations:          icp.frustrations,
        goals:                 icp.goals,
        information_sources:   icp.infoSources,
        personality_scores:    icp.personalityScores,
        positioning_strategy:  icp.positioningStrategy,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['icp-profiles-all'] });
      setShowICPModal(false);
    },
  });

  const handleSaveICP = (icp: ICPProfile) => {
    createIcpMutation.mutate(icp);
  };

  const handleSave = () => {
    saveMutation.mutate(formProfile);
  };

  const TONE_SLIDERS = [
    { key: 'formality',    label: 'Formality',    left: 'Casual',   right: 'Formal'     },
    { key: 'enthusiasm',   label: 'Enthusiasm',   left: 'Reserved', right: 'Energetic'  },
    { key: 'technicality', label: 'Technicality', left: 'Simple',   right: 'Technical'  },
    { key: 'humor',        label: 'Humor',        left: 'Serious',  right: 'Playful'    },
    { key: 'empathy',      label: 'Empathy',      left: 'Direct',   right: 'Empathetic' },
  ];

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#080809] text-white">
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">Brand Profile</h1>
            <p className="text-gray-500 mt-1">
              Define your brand identity — the AI uses this across all content.
            </p>
          </div>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-60 text-white font-medium rounded-xl transition-all"
          >
            {saveMutation.isPending ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving...
              </>
            ) : saveMutation.isSuccess ? (
              <>✓ Saved</>
            ) : (
              <>Save Profile</>
            )}
          </button>
        </div>

        {/* Profile Selector */}
        {profiles.length > 1 && (
          <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
            {profiles.map((p: { id: string; name: string }) => (
              <button
                key={p.id}
                onClick={() => setActiveProfileId(p.id)}
                className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all border ${
                  activeProfileId === p.id
                    ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                    : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                }`}
              >
                {p.name}
              </button>
            ))}
            <button
              onClick={() => {
                setActiveProfileId(null);
                setFormProfile(prev => ({ ...prev, name: '' }));
              }}
              className="px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all border bg-white/5 border-white/10 text-gray-400 hover:border-white/20"
            >
              + New Profile
            </button>
          </div>
        )}

        {/* Loading state */}
        {brandsLoading && (
          <div className="text-center py-12 text-gray-500">
            Loading brand profile...
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-white/5 rounded-xl mb-8 border border-white/10">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-all ${
                activeTab === tab.id
                  ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <span>{tab.icon}</span>
              <span className="hidden sm:block">{tab.label}</span>
            </button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="space-y-6"
          >
            {/* Identity Tab */}
            {activeTab === 'identity' && (
              <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-5">
                <h2 className="text-lg font-semibold">Core Identity</h2>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                      Brand / Person Name *
                    </label>
                    <input
                      value={formProfile.name}
                      onChange={e => update('name', e.target.value)}
                      placeholder="e.g. Sameer Thakur or Acme Corp"
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                      Website
                    </label>
                    <input
                      value={formProfile.website}
                      onChange={e => update('website', e.target.value)}
                      placeholder="https://yoursite.com"
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    Industry
                  </label>
                  <input
                    value={formProfile.industry}
                    onChange={e => update('industry', e.target.value)}
                    placeholder="e.g. SaaS, Marketing Agency, Consulting"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    Brand Description
                  </label>
                  <textarea
                    value={formProfile.description}
                    onChange={e => update('description', e.target.value)}
                    placeholder="What does your brand do? Who do you serve?"
                    rows={3}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    Mission Statement
                  </label>
                  <textarea
                    value={formProfile.missionStatement}
                    onChange={e => update('missionStatement', e.target.value)}
                    placeholder="Why does your brand exist?"
                    rows={2}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors resize-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">
                    Life Purpose / Brand Purpose
                  </label>
                  <textarea
                    value={formProfile.lifePurpose}
                    onChange={e => update('lifePurpose', e.target.value)}
                    placeholder="What is the deeper purpose beyond revenue?"
                    rows={3}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors resize-none"
                  />
                </div>
              </div>
            )}

            {/* Voice Tab — same as before but use formProfile */}
            {activeTab === 'voice' && (
              <div className="space-y-6">
                <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-6">
                  <h2 className="text-lg font-semibold">Tone Sliders</h2>
                  {TONE_SLIDERS.map(({ key, label, left, right }) => (
                    <div key={key}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-sm font-medium text-white">{label}</span>
                        <span className="text-xs text-violet-400 font-medium">
                          {formProfile.toneSettings[key as keyof typeof formProfile.toneSettings]}/10
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 w-16 text-right">{left}</span>
                        <input
                          type="range" min={1} max={10}
                          value={formProfile.toneSettings[key as keyof typeof formProfile.toneSettings]}
                          onChange={e => update('toneSettings', {
                            ...formProfile.toneSettings,
                            [key]: Number(e.target.value),
                          })}
                          className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
                          style={{
                            background: `linear-gradient(to right, #7c3aed ${
                              (formProfile.toneSettings[key as keyof typeof formProfile.toneSettings] - 1) * 11.1
                            }%, rgba(255,255,255,0.1) ${
                              (formProfile.toneSettings[key as keyof typeof formProfile.toneSettings] - 1) * 11.1
                            }%)`
                          }}
                        />
                        <span className="text-xs text-gray-500 w-16">{right}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-5">
                  <h2 className="text-lg font-semibold">Vocabulary Control</h2>
                  <TagInput
                    label="Preferred Terms"
                    tags={formProfile.preferredTerms}
                    onChange={v => update('preferredTerms', v)}
                    placeholder="e.g. growth, founder, build"
                    color="green"
                  />
                  <TagInput
                    label="Banned Phrases"
                    tags={formProfile.bannedPhrases}
                    onChange={v => update('bannedPhrases', v)}
                    placeholder="e.g. leverage, synergy, paradigm"
                    color="red"
                  />
                  <TagInput
                    label="Key Messages"
                    tags={formProfile.keyMessages}
                    onChange={v => update('keyMessages', v)}
                    placeholder="e.g. founders build the future"
                    color="violet"
                  />
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                      Compliance Notes
                    </label>
                    <textarea
                      value={formProfile.complianceNotes}
                      onChange={e => update('complianceNotes', e.target.value)}
                      rows={3}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none resize-none transition-colors"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Values Tab */}
            {activeTab === 'values' && (
              <div className="space-y-6">
                <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-5">
                  <h2 className="text-lg font-semibold">Loves & Hates</h2>
                  <TagInput label="❤️ Likes" tags={formProfile.likes} onChange={v => update('likes', v)} color="green" />
                  <TagInput label="😤 Hates" tags={formProfile.hates} onChange={v => update('hates', v)} color="red" />
                  <TagInput label="😒 Dislikes" tags={formProfile.dislikes} onChange={v => update('dislikes', v)} color="amber" />
                </div>
                <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-5">
                  <h2 className="text-lg font-semibold">Positions</h2>
                  <TagInput label="✊ Stands For" tags={formProfile.standsFor} onChange={v => update('standsFor', v)} color="green" />
                  <TagInput label="🚫 Stands Against" tags={formProfile.standsAgainst} onChange={v => update('standsAgainst', v)} color="red" />
                </div>
                <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-5">
                  <h2 className="text-lg font-semibold">Core Motivations & Values</h2>
                  <TagInput label="⚡ Core Motivations" tags={formProfile.coreMotivations} onChange={v => update('coreMotivations', v)} color="violet" />
                  <TagInput label="💎 Core Values" tags={formProfile.coreValues} onChange={v => update('coreValues', v)} color="blue" />
                </div>
              </div>
            )}

            {/* Documents Tab — same as before */}
            {activeTab === 'documents' && (
              <div className="bg-white/3 border border-white/10 rounded-2xl p-6">
                <h2 className="text-lg font-semibold mb-2">Brand Documents</h2>
                <p className="text-sm text-gray-500 mb-6">
                  Upload brand guidelines, tone docs, style guides.
                </p>
                <DocumentUploader
                  documents={formProfile.documents}
                  onDocumentsChange={v => update('documents', v)}
                />
              </div>
            )}

            {/* ICP Tab */}
            {activeTab === 'icp' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold">ICP Profiles</h2>
                    <p className="text-sm text-gray-500 mt-1">
                      Build detailed audience profiles using the SIRF framework.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowICPModal(true)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-all"
                  >
                    + New ICP
                  </button>
                </div>

                {icpProfiles.length === 0 ? (
                  <div className="bg-white/3 border border-dashed border-white/10 rounded-2xl p-12 text-center">
                    <div className="text-5xl mb-4">🎯</div>
                    <p className="text-white font-medium">No ICP profiles yet</p>
                    <button
                      onClick={() => setShowICPModal(true)}
                      className="mt-6 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-all inline-block"
                    >
                      Build First ICP →
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {icpProfiles.map((icp: any) => (
                      <div
                        key={icp.id}
                        className="p-5 bg-white/3 border border-white/10 hover:border-violet-500/30 rounded-2xl transition-all"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold text-white">{icp.name}</h3>
                            <p className="text-sm text-gray-500 mt-1">
                              {[
                                icp.basic_characteristics?.role,
                                icp.basic_characteristics?.industry,
                              ].filter(Boolean).join(' • ')}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showICPModal && (
          <ICPBuilderModal
            onClose={() => setShowICPModal(false)}
            onSave={handleSaveICP}
          />
        )}
      </AnimatePresence>
    </div>
  );
}