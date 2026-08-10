// apps/web/src/app/(dashboard)/brand/page.tsx
'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Mic2,
  Gem,
  FolderOpen,
  Target,
  X,
  FileText,
  FileEdit,
  Image,
  Paperclip,
  ArrowLeft,
  ArrowRight,
  Check,
  AlertTriangle,
  XCircle,
  Heart,
  ThumbsDown,
  Frown,
  Shield,
  Ban,
  Zap,
  Plus,
  Loader2,
  ChevronRight,
  Circle,
  Star,
  BookOpen,
  Upload,
  Trash2,
  Users,
  Briefcase,
} from 'lucide-react';
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

interface ToneSettings {
  formality: number;
  enthusiasm: number;
  technicality: number;
  humor: number;
  empathy: number;
}

interface BrandProfile {
  name: string;
  website: string;
  industry: string;
  description: string;
  missionStatement: string;
  likes: string[];
  hates: string[];
  dislikes: string[];
  standsFor: string[];
  standsAgainst: string[];
  coreMotivations: string[];
  coreValues: string[];
  lifePurpose: string;
  toneSettings: ToneSettings;
  preferredTerms: string[];
  bannedPhrases: string[];
  keyMessages: string[];
  complianceNotes: string;
  documents: BrandDocument[];
  icpProfiles: ICPProfile[];
}

// ─── Default Form State ───────────────────────────────────────────────────────

const DEFAULT_FORM: BrandProfile = {
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
    formality: 5,
    enthusiasm: 5,
    technicality: 5,
    humor: 3,
    empathy: 7,
  },
  preferredTerms: [],
  bannedPhrases: [],
  keyMessages: [],
  complianceNotes: '',
  documents: [],
  icpProfiles: [],
};

// ─── DB → Form Mapper ─────────────────────────────────────────────────────────

function dbProfileToForm(p: any): BrandProfile {
  return {
    name: p.name ?? '',
    website: p.website ?? '',
    industry: p.industry ?? '',
    description: p.description ?? '',
    missionStatement: p.mission ?? '',
    likes: Array.isArray(p.likes) ? p.likes : [],
    hates: Array.isArray(p.hates) ? p.hates : [],
    dislikes: Array.isArray(p.dislikes) ? p.dislikes : [],
    standsFor: Array.isArray(p.stands_for) ? p.stands_for : [],
    standsAgainst: Array.isArray(p.stands_against) ? p.stands_against : [],
    coreMotivations: Array.isArray(p.core_motivations) ? p.core_motivations : [],
    coreValues: Array.isArray(p.core_values) ? p.core_values : [],
    lifePurpose: p.life_purpose ?? '',
    toneSettings: {
      formality: typeof p.tone_formality === 'number' ? p.tone_formality : 5,
      enthusiasm: typeof p.tone_enthusiasm === 'number' ? p.tone_enthusiasm : 5,
      technicality: typeof p.tone_technical === 'number' ? p.tone_technical : 5,
      humor: typeof p.tone_humor === 'number' ? p.tone_humor : 3,
      empathy: typeof p.tone_empathy === 'number' ? p.tone_empathy : 7,
    },
    preferredTerms: Array.isArray(p.preferred_terms) ? p.preferred_terms : [],
    bannedPhrases: Array.isArray(p.banned_phrases) ? p.banned_phrases : [],
    keyMessages: Array.isArray(p.key_messages) ? p.key_messages : [],
    complianceNotes: p.compliance_notes ?? '',
    documents: [],
    icpProfiles: [],
  };
}

// ─── Tab Config ───────────────────────────────────────────────────────────────

const TABS = [
  { id: 'identity', label: 'Identity', Icon: Building2 },
  { id: 'voice', label: 'Voice & Tone', Icon: Mic2 },
  { id: 'values', label: 'Values & Beliefs', Icon: Gem },
  { id: 'documents', label: 'Documents', Icon: FolderOpen },
  { id: 'icp', label: 'ICP Profiles', Icon: Target },
];

// ─── Tone Sliders Config ──────────────────────────────────────────────────────

const TONE_SLIDERS = [
  { key: 'formality', label: 'Formality', left: 'Casual', right: 'Formal' },
  { key: 'enthusiasm', label: 'Enthusiasm', left: 'Reserved', right: 'Energetic' },
  { key: 'technicality', label: 'Technicality', left: 'Simple', right: 'Technical' },
  { key: 'humor', label: 'Humor', left: 'Serious', right: 'Playful' },
  { key: 'empathy', label: 'Empathy', left: 'Direct', right: 'Empathetic' },
] as const;

// ─── TagInput Component ───────────────────────────────────────────────────────

function TagInput({
  label,
  tags,
  onChange,
  placeholder = 'Type and press Enter',
  color = 'violet',
  icon: Icon,
}: {
  label: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  color?: string;
  icon?: React.ElementType;
}) {
  const [input, setInput] = useState('');

  const colorMap: Record<string, string> = {
    violet: 'bg-violet-500/20 text-violet-300 border-violet-500/30',
    green: 'bg-green-500/20  text-green-300  border-green-500/30',
    red: 'bg-red-500/20    text-red-300    border-red-500/30',
    blue: 'bg-blue-500/20   text-blue-300   border-blue-500/30',
    amber: 'bg-amber-500/20  text-amber-300  border-amber-500/30',
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
      <label className="flex items-center gap-2 text-sm font-medium text-gray-400 mb-2">
        {Icon && <Icon size={14} />}
        {label}
      </label>
      <div className="min-h-[44px] p-2 bg-white/5 border border-white/10 rounded-xl flex flex-wrap gap-2 focus-within:border-violet-500/50 transition-colors">
        {tags.map((tag, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium ${colorMap[color]}`}
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter((_, idx) => idx !== i))}
              className="hover:opacity-70 ml-1 flex items-center"
            >
              <X size={10} />
            </button>
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

// ─── Document Uploader ────────────────────────────────────────────────────────

function DocumentUploader({
  documents,
  onDocumentsChange,
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
  const MAX_FILE_SIZE = 10 * 1024 * 1024;

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
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

      let currentDocs = [...documents, ...newDocs];
      onDocumentsChange(currentDocs);

      for (const doc of newDocs) {
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
    },
    [documents, onDocumentsChange]
  );

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

  // File type → Lucide icon
  const getFileIcon = (type: string) => {
    if (type.includes('pdf')) return <FileText size={20} className="text-red-400" />;
    if (type.includes('word') || type.includes('document')) return <FileEdit size={20} className="text-blue-400" />;
    if (type.includes('image')) return <Image size={20} className="text-green-400" />;
    return <Paperclip size={20} className="text-gray-400" />;
  };

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-medium text-gray-400">
        <FolderOpen size={14} />
        Brand Documents
        <span className="text-xs text-gray-600">(PDF, DOCX, TXT, Images — max 10MB each)</span>
      </label>

      {/* Drop Zone */}
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${isDragging
            ? 'border-violet-500 bg-violet-500/10'
            : 'border-white/10 hover:border-violet-500/40 hover:bg-white/5'
          }`}
      >
        <div className="flex justify-center mb-3">
          <Upload
            size={36}
            className={isDragging ? 'text-violet-400' : 'text-gray-600'}
          />
        </div>
        <p className="text-white font-medium">Drop files here</p>
        <p className="text-gray-500 text-sm mt-1">
          or click to browse — brand guidelines, style guides, tone docs
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
              {getFileIcon(doc.type)}
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
                  <span className="flex items-center gap-1 text-green-400 text-xs">
                    <Check size={12} /> Done
                  </span>
                )}
                {doc.status === 'uploading' && (
                  <span className="flex items-center gap-1 text-violet-400 text-xs">
                    <Loader2 size={12} className="animate-spin" />
                    {doc.progress}%
                  </span>
                )}
                {doc.status === 'error' && (
                  <span className="flex items-center gap-1 text-red-400 text-xs">
                    <XCircle size={12} /> Failed
                  </span>
                )}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    onDocumentsChange(documents.filter(d => d.id !== doc.id));
                  }}
                  className="text-gray-500 hover:text-red-400 transition-colors p-1 rounded-lg hover:bg-red-400/10"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ICP Builder Modal ────────────────────────────────────────────────────────

function ICPBuilderModal({
  onClose,
  onSave,
  isSaving,
}: {
  onClose: () => void;
  onSave: (icp: ICPProfile) => void;
  isSaving: boolean;
}) {
  const [step, setStep] = useState(0);
  const [icp, setIcp] = useState<ICPProfile>({
    id: `icp-${Date.now()}`,
    name: '',
    basicChars: {
      ageGroup: '', education: '', role: '', industry: '',
      orgType: '', seniority: '', geography: '',
      revenueRange: '', teamSize: '', purchasingAuthority: '',
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

  const STEPS = [
    { label: 'Basic Info', Icon: Users },
    { label: 'Characteristics', Icon: BookOpen },
    { label: 'Psychology', Icon: Zap },
    { label: 'Behavioral Map', Icon: Target },
    { label: 'Strategy', Icon: Star },
  ];

  const updateBasicChar = (key: string, value: string) => {
    setIcp(prev => ({ ...prev, basicChars: { ...prev.basicChars, [key]: value } }));
  };

  const canProceed = step !== 0 || icp.name.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-[#0F0F10] border border-white/10 rounded-2xl overflow-hidden">

        {/* Header */}
        <div className="p-6 border-b border-white/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Target size={20} className="text-violet-400" />
              <h2 className="text-xl font-semibold text-white">Build ICP Profile</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5"
            >
              <X size={18} />
            </button>
          </div>

          {/* Step Indicators */}
          <div className="flex gap-2">
            {STEPS.map(({ label, Icon: StepIcon }, i) => (
              <button
                key={i}
                type="button"
                onClick={() => i < step && setStep(i)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded-lg font-medium transition-all ${i === step
                    ? 'bg-violet-600 text-white'
                    : i < step
                      ? 'bg-violet-500/20 text-violet-400 cursor-pointer'
                      : 'bg-white/5 text-gray-500 cursor-default'
                  }`}
              >
                <StepIcon size={11} />
                <span className="hidden sm:block">{label}</span>
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
                <label className="flex items-center gap-2 text-sm font-medium text-gray-400 mb-2">
                  <Users size={14} />
                  ICP Name <span className="text-red-400">*</span>
                </label>
                <input
                  value={icp.name}
                  onChange={e => setIcp(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Mid-Market SaaS Founder"
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none"
                />
                {icp.name.trim().length === 0 && (
                  <p className="flex items-center gap-1 text-xs text-red-400 mt-1">
                    <AlertTriangle size={11} /> Name is required to continue
                  </p>
                )}
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
                  className="w-full px-3 py-2.5 bg-[#0F0F10] border border-white/10 rounded-xl text-sm text-white focus:border-violet-500/50 outline-none"
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

          {/* Step 1: Characteristics */}
          {step === 1 && (
            <div className="space-y-5">
              <TagInput label="Current Challenges" tags={icp.currentChallenges} onChange={v => setIcp(p => ({ ...p, currentChallenges: v }))} placeholder="Add a challenge and press Enter" color="red" />
              <TagInput label="Goals & Desired Outcomes" tags={icp.goals} onChange={v => setIcp(p => ({ ...p, goals: v }))} placeholder="Add a goal and press Enter" color="green" />
              <TagInput label="Frustrations" tags={icp.frustrations} onChange={v => setIcp(p => ({ ...p, frustrations: v }))} placeholder="Add a frustration and press Enter" color="amber" />
              <TagInput label="Information Sources" tags={icp.infoSources} onChange={v => setIcp(p => ({ ...p, infoSources: v }))} placeholder="e.g. LinkedIn, G2, Industry Reports" color="blue" />
              <TagInput label="Professional Interests" tags={icp.interests} onChange={v => setIcp(p => ({ ...p, interests: v }))} placeholder="e.g. Growth hacking, Product-led growth" color="violet" />
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
                <label className="flex items-center gap-2 text-sm font-medium text-gray-400 mb-3">
                  <Star size={14} />
                  Positioning Strategy
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Strategic Advisor', Icon: Briefcase },
                    { label: 'Technology Partner', Icon: Zap },
                    { label: 'Cost Optimizer', Icon: Shield },
                    { label: 'Innovation Leader', Icon: Star },
                    { label: 'Reliability Specialist', Icon: Check },
                    { label: 'Growth Accelerator', Icon: ArrowRight },
                    { label: 'Risk Reduction Expert', Icon: AlertTriangle },
                    { label: 'Industry Expert', Icon: BookOpen },
                  ].map(({ label, Icon: StratIcon }) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setIcp(p => ({ ...p, positioningStrategy: label }))}
                      className={`flex items-center gap-2 p-3 rounded-xl text-sm text-left transition-all border ${icp.positioningStrategy === label
                          ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                          : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                        }`}
                    >
                      <StratIcon size={14} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Behavioral Map */}
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
                    type="range" min={1} max={10}
                    value={icp.personalityScores[key] ?? 5}
                    onChange={e => setIcp(p => ({
                      ...p,
                      personalityScores: {
                        ...p.personalityScores,
                        [key]: Number(e.target.value),
                      },
                    }))}
                    className="w-full h-2 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, #7c3aed ${((icp.personalityScores[key] ?? 5) - 1) * 11.1
                        }%, rgba(255,255,255,0.1) ${((icp.personalityScores[key] ?? 5) - 1) * 11.1
                        }%)`,
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
                <div className="flex items-center gap-2 mb-3">
                  <Star size={16} className="text-violet-400" />
                  <h3 className="text-violet-300 font-medium">ICP Summary Preview</h3>
                </div>
                <div className="space-y-2 text-sm">
                  <p className="text-white font-medium">{icp.name || 'Unnamed ICP'}</p>
                  <p className="text-gray-400">
                    {[icp.basicChars.role, icp.basicChars.industry, icp.basicChars.seniority]
                      .filter(Boolean).join(' • ')}
                  </p>
                  {icp.currentChallenges.length > 0 && (
                    <div>
                      <p className="text-gray-500 text-xs mt-2 mb-1 uppercase tracking-wider">
                        Key Challenges
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {icp.currentChallenges.slice(0, 3).map((c, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 bg-red-500/20 text-red-300 text-xs rounded-full"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {icp.positioningStrategy && (
                    <p className="flex items-center gap-1.5 text-gray-400 text-xs mt-2">
                      <ChevronRight size={12} className="text-violet-400" />
                      Position as:
                      <span className="text-violet-300">{icp.positioningStrategy}</span>
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
            type="button"
            onClick={() => step > 0 ? setStep(step - 1) : onClose()}
            className="flex items-center gap-2 px-5 py-2.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            {step === 0 ? 'Cancel' : 'Back'}
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={!canProceed}
              className="flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all"
            >
              Continue
              <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSave(icp)}
              disabled={!icp.name.trim() || isSaving}
              className="flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all"
            >
              {isSaving ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check size={14} />
                  Save ICP Profile
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tone Sliders Section ─────────────────────────────────────────────────────

function ToneSlidersSection({
  toneSettings,
  onChange,
}: {
  toneSettings: ToneSettings;
  onChange: (updated: ToneSettings) => void;
}) {
  const handleSliderChange = (key: keyof ToneSettings, value: number) => {
    onChange({ ...toneSettings, [key]: value });
  };

  return (
    <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Mic2 size={18} className="text-violet-400" />
        <h2 className="text-lg font-semibold">Tone Sliders</h2>
      </div>

      {TONE_SLIDERS.map(({ key, label, left, right }) => {
        const value = toneSettings[key] ?? 5;
        const pct = (value - 1) * 11.1;
        return (
          <div key={key}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-white">{label}</span>
              <span className="text-xs text-violet-400 font-medium">{value}/10</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-16 text-right">{left}</span>
              <input
                type="range" min={1} max={10}
                value={value}
                onChange={e => handleSliderChange(key, Number(e.target.value))}
                className="flex-1 h-2 rounded-full appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #7c3aed ${pct}%, rgba(255,255,255,0.1) ${pct}%)`,
                }}
              />
              <span className="text-xs text-gray-500 w-16">{right}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Brand Page ──────────────────────────────────────────────────────────

export default function BrandPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('identity');
  const [showICPModal, setShowICPModal] = useState(false);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ── Fetch brand profiles ──────────────────────────────────────────────────
  const { data: brandData, isLoading: brandsLoading } = useQuery({
    queryKey: ['brand-profiles'],
    queryFn: () => api.get('/brand').then((r: any) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const profiles: any[] = brandData?.profiles ?? [];

  // ── Fetch ICPs ────────────────────────────────────────────────────────────
  const { data: icpData, isLoading: icpsLoading } = useQuery({
    queryKey: ['icp-profiles-all'],
    queryFn: () => api.get('/brand/icps/all').then((r: any) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const icpProfiles: any[] = icpData?.icps ?? [];

  // ── Active profile resolve ────────────────────────────────────────────────
  const activeProfile = profiles.find(p => p.id === activeProfileId) ?? null;

  useEffect(() => {
    if (!activeProfileId && profiles.length > 0) {
      setActiveProfileId(profiles[0].id);
    }
  }, [profiles, activeProfileId]);

  // ── Form state ────────────────────────────────────────────────────────────
  const [formProfile, setFormProfile] = useState<BrandProfile>(DEFAULT_FORM);
  const lastSyncedProfileId = useRef<string | null>(null);

  useEffect(() => {
    if (!activeProfile) {
      if (lastSyncedProfileId.current !== null) {
        setFormProfile(DEFAULT_FORM);
        lastSyncedProfileId.current = null;
      }
      return;
    }
    if (lastSyncedProfileId.current === activeProfile.id) return;
    setFormProfile(dbProfileToForm(activeProfile));
    lastSyncedProfileId.current = activeProfile.id;
    setSaveError(null);
    setSaveSuccess(false);
  }, [activeProfile?.id]);

  const update = useCallback((key: keyof BrandProfile, value: unknown) => {
    setFormProfile(prev => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
    setSaveError(null);
  }, []);

  const updateTone = useCallback((updated: ToneSettings) => {
    setFormProfile(prev => ({ ...prev, toneSettings: updated }));
    setSaveSuccess(false);
    setSaveError(null);
  }, []);

  // ── Save mutation ─────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (data: BrandProfile) => {
      if (!data.name.trim()) throw new Error('Brand name is required');

      const payload = {
        name: data.name.trim(),
        website: data.website || undefined,
        industry: data.industry || undefined,
        description: data.description || undefined,
        mission: data.missionStatement || undefined,
        life_purpose: data.lifePurpose || undefined,
        likes: data.likes,
        hates: data.hates,
        dislikes: data.dislikes,
        stands_for: data.standsFor,
        stands_against: data.standsAgainst,
        core_motivations: data.coreMotivations,
        core_values: data.coreValues,
        preferredTerms: data.preferredTerms,
        bannedPhrases: data.bannedPhrases,
        keyMessages: data.keyMessages,
        complianceNotes: data.complianceNotes || undefined,
        tone: {
          formality: data.toneSettings.formality,
          enthusiasm: data.toneSettings.enthusiasm,
          technical: data.toneSettings.technicality,
          humor: data.toneSettings.humor,
          empathy: data.toneSettings.empathy,
        },
        isDefault: !activeProfileId,
      };

      if (activeProfileId) {
        const res = await api.put(`/brand/${activeProfileId}`, payload);
        return (res as any).data;
      } else {
        const res = await api.post('/brand', payload);
        return (res as any).data;
      }
    },
    onSuccess: (data: any) => {
      if (!activeProfileId && data?.id) {
        setActiveProfileId(data.id);
        lastSyncedProfileId.current = data.id;
      }
      setSaveSuccess(true);
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: ['brand-profiles'] });
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: (err: any) => {
      const message =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        err?.message ||
        'Save failed. Please try again.';
      setSaveError(Array.isArray(message) ? message[0]?.message || 'Validation failed' : message);
    },
  });

  // ── ICP mutation ──────────────────────────────────────────────────────────
  const createIcpMutation = useMutation({
    mutationFn: (icp: ICPProfile) => {
      const profileId = activeProfileId ?? profiles[0]?.id;
      if (!profileId) throw new Error('Please save a brand profile first');
      return api.post(`/brand/${profileId}/icps`, {
        name: icp.name,
        basic_characteristics: icp.basicChars,
        interests: icp.interests,
        current_challenges: icp.currentChallenges,
        emotional_motivations: icp.emotionalMotivations,
        frustrations: icp.frustrations,
        goals: icp.goals,
        information_sources: icp.infoSources,
        personality_scores: icp.personalityScores,
        positioning_strategy: icp.positioningStrategy,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['icp-profiles-all'] });
      setShowICPModal(false);
    },
    onError: (err: any) => {
      alert(err?.response?.data?.error || err?.message || 'Failed to save ICP');
    },
  });

  const handleSave = () => { setSaveError(null); saveMutation.mutate(formProfile); };
  const handleSaveICP = (icp: ICPProfile) => createIcpMutation.mutate(icp);

  const handleSelectProfile = (id: string) => {
    setActiveProfileId(id);
    setSaveError(null);
    setSaveSuccess(false);
  };

  const handleNewProfile = () => {
    setActiveProfileId(null);
    lastSyncedProfileId.current = null;
    setFormProfile(DEFAULT_FORM);
    setSaveError(null);
    setSaveSuccess(false);
    setActiveTab('identity');
  };

  // ── Save button JSX (reused top + bottom) ────────────────────────────────
  const SaveButton = ({ className = '' }: { className?: string }) => (
    <button
      type="button"
      onClick={handleSave}
      disabled={saveMutation.isPending}
      className={`flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700
        disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium
        rounded-xl transition-all ${className}`}
    >
      {saveMutation.isPending ? (
        <><Loader2 size={16} className="animate-spin" /> Saving...</>
      ) : saveSuccess ? (
        <><Check size={16} className="text-green-300" /> Saved!</>
      ) : (
        'Save Profile'
      )}
    </button>
  );

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

          <div className="flex flex-col items-end gap-2">
            <SaveButton />
            {saveError && (
              <p className="flex items-center gap-1 text-red-400 text-xs max-w-[220px] text-right">
                <XCircle size={11} /> {saveError}
              </p>
            )}
          </div>
        </div>

        {/* Profile Selector */}
        {(profiles.length >= 1 || !brandsLoading) && (
          <div className="mb-6">
            <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">
              Brand Profiles
            </p>
            <div className="flex gap-2 overflow-x-auto pb-2">

              {profiles.map((p: any) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectProfile(p.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium
                    whitespace-nowrap transition-all border ${activeProfileId === p.id
                      ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
                    }`}
                >
                  <Circle
                    size={8}
                    className={activeProfileId === p.id ? 'fill-violet-400 text-violet-400' : 'text-gray-600'}
                  />
                  {p.name}
                  {p.is_default && (
                    <span className="text-[10px] text-gray-500">(default)</span>
                  )}
                </button>
              ))}

              <button
                type="button"
                onClick={handleNewProfile}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium
                  whitespace-nowrap transition-all border ${activeProfileId === null
                    ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                    : 'bg-white/5 border-dashed border-white/20 text-gray-500 hover:border-violet-500/40 hover:text-gray-300'
                  }`}
              >
                <Plus size={14} />
                New Profile
              </button>
            </div>

            {!activeProfileId && (
              <p className="flex items-center gap-1.5 text-xs text-amber-400 mt-2">
                <AlertTriangle size={12} />
                Creating new profile — fill details and save
              </p>
            )}
          </div>
        )}

        {/* Loading */}
        {brandsLoading && (
          <div className="flex items-center gap-3 py-8 text-gray-500">
            <Loader2 size={18} className="animate-spin" />
            Loading brand profiles...
          </div>
        )}

        {/* Tab Navigation */}
        <div className="flex gap-1 p-1 bg-white/5 rounded-xl mb-8 border border-white/10">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm
                font-medium rounded-lg transition-all ${activeTab === id
                  ? 'bg-violet-600 text-white shadow-lg shadow-violet-500/20'
                  : 'text-gray-500 hover:text-gray-300'
                }`}
            >
              <Icon size={15} />
              <span className="hidden sm:block">{label}</span>
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.12 }}
            className="space-y-6"
          >

            {/* Identity */}
            {activeTab === 'identity' && (
              <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-5">
                <div className="flex items-center gap-2">
                  <Building2 size={18} className="text-violet-400" />
                  <h2 className="text-lg font-semibold">Core Identity</h2>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                      Brand / Person Name <span className="text-red-400">*</span>
                    </label>
                    <input
                      value={formProfile.name}
                      onChange={e => update('name', e.target.value)}
                      placeholder="e.g. Sameer Thakur or Acme Corp"
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">Website</label>
                    <input
                      value={formProfile.website}
                      onChange={e => update('website', e.target.value)}
                      placeholder="https://yoursite.com"
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Industry</label>
                  <input
                    value={formProfile.industry}
                    onChange={e => update('industry', e.target.value)}
                    placeholder="e.g. SaaS, Marketing Agency, Consulting"
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Brand Description</label>
                  <textarea
                    value={formProfile.description}
                    onChange={e => update('description', e.target.value)}
                    placeholder="What does your brand do? Who do you serve?"
                    rows={3}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors resize-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-400 mb-2">Mission Statement</label>
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

            {/* Voice & Tone */}
            {activeTab === 'voice' && (
              <div className="space-y-6">
                <ToneSlidersSection
                  toneSettings={formProfile.toneSettings}
                  onChange={updateTone}
                />

                <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-5">
                  <div className="flex items-center gap-2">
                    <BookOpen size={18} className="text-violet-400" />
                    <h2 className="text-lg font-semibold">Vocabulary Control</h2>
                  </div>

                  <TagInput
                    label="Preferred Terms"
                    tags={formProfile.preferredTerms}
                    onChange={v => update('preferredTerms', v)}
                    placeholder="e.g. growth, founder, build"
                    color="green"
                    icon={Check}
                  />
                  <TagInput
                    label="Banned Phrases"
                    tags={formProfile.bannedPhrases}
                    onChange={v => update('bannedPhrases', v)}
                    placeholder="e.g. leverage, synergy, paradigm"
                    color="red"
                    icon={Ban}
                  />
                  <TagInput
                    label="Key Messages"
                    tags={formProfile.keyMessages}
                    onChange={v => update('keyMessages', v)}
                    placeholder="e.g. founders build the future"
                    color="violet"
                    icon={Star}
                  />

                  <div>
                    <label className="block text-sm font-medium text-gray-400 mb-2">
                      Compliance Notes
                    </label>
                    <textarea
                      value={formProfile.complianceNotes}
                      onChange={e => update('complianceNotes', e.target.value)}
                      rows={3}
                      placeholder="Any legal or compliance restrictions..."
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none resize-none transition-colors"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Values & Beliefs */}
            {activeTab === 'values' && (
              <div className="space-y-6">
                <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-5">
                  <div className="flex items-center gap-2">
                    <Heart size={18} className="text-violet-400" />
                    <h2 className="text-lg font-semibold">Loves & Hates</h2>
                  </div>
                  <TagInput label="Likes" tags={formProfile.likes} onChange={v => update('likes', v)} color="green" icon={Heart} />
                  <TagInput label="Hates" tags={formProfile.hates} onChange={v => update('hates', v)} color="red" icon={ThumbsDown} />
                  <TagInput label="Dislikes" tags={formProfile.dislikes} onChange={v => update('dislikes', v)} color="amber" icon={Frown} />
                </div>

                <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-5">
                  <div className="flex items-center gap-2">
                    <Shield size={18} className="text-violet-400" />
                    <h2 className="text-lg font-semibold">Positions</h2>
                  </div>
                  <TagInput label="Stands For" tags={formProfile.standsFor} onChange={v => update('standsFor', v)} color="green" icon={Shield} />
                  <TagInput label="Stands Against" tags={formProfile.standsAgainst} onChange={v => update('standsAgainst', v)} color="red" icon={Ban} />
                </div>

                <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-5">
                  <div className="flex items-center gap-2">
                    <Zap size={18} className="text-violet-400" />
                    <h2 className="text-lg font-semibold">Core Motivations & Values</h2>
                  </div>
                  <TagInput label="Core Motivations" tags={formProfile.coreMotivations} onChange={v => update('coreMotivations', v)} color="violet" icon={Zap} />
                  <TagInput label="Core Values" tags={formProfile.coreValues} onChange={v => update('coreValues', v)} color="blue" icon={Gem} />
                </div>
              </div>
            )}

            {/* Documents */}
            {activeTab === 'documents' && (
              <div className="bg-white/3 border border-white/10 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-2">
                  <FolderOpen size={18} className="text-violet-400" />
                  <h2 className="text-lg font-semibold">Brand Documents</h2>
                </div>
                <p className="text-sm text-gray-500 mb-6">
                  Upload brand guidelines, tone docs, style guides.
                </p>
                <DocumentUploader
                  documents={formProfile.documents}
                  onDocumentsChange={v => update('documents', v)}
                />
              </div>
            )}

            {/* ICP Profiles */}
            {activeTab === 'icp' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Target size={18} className="text-violet-400" />
                      <h2 className="text-lg font-semibold">ICP Profiles</h2>
                    </div>
                    <p className="text-sm text-gray-500 mt-1 ml-7">
                      Build detailed audience profiles using the SIRF framework.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeProfileId && profiles.length === 0) {
                        alert('Please save a brand profile first before adding ICPs.');
                        return;
                      }
                      setShowICPModal(true);
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-all"
                  >
                    <Plus size={15} />
                    New ICP
                  </button>
                </div>

                {!activeProfileId && profiles.length === 0 && (
                  <div className="flex items-center gap-2 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                    <AlertTriangle size={16} className="text-amber-400 shrink-0" />
                    <p className="text-amber-300 text-sm">
                      Save a brand profile first, then add ICP profiles.
                    </p>
                  </div>
                )}

                {icpsLoading ? (
                  <div className="flex items-center gap-3 py-8 text-gray-500">
                    <Loader2 size={18} className="animate-spin" />
                    Loading ICPs...
                  </div>
                ) : icpProfiles.length === 0 ? (
                  <div className="bg-white/3 border border-dashed border-white/10 rounded-2xl p-12 text-center">
                    <div className="flex justify-center mb-4">
                      <Target size={48} className="text-gray-700" />
                    </div>
                    <p className="text-white font-medium">No ICP profiles yet</p>
                    <p className="text-gray-500 text-sm mt-2">
                      Build your first Ideal Customer Profile
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowICPModal(true)}
                      className="mt-6 flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-all mx-auto"
                    >
                      Build First ICP
                      <ArrowRight size={14} />
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
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <Users size={15} className="text-violet-400" />
                              <h3 className="font-semibold text-white">{icp.name}</h3>
                            </div>
                            <p className="text-sm text-gray-500 mt-1 ml-[23px]">
                              {[
                                icp.basic_characteristics?.role,
                                icp.basic_characteristics?.industry,
                                icp.basic_characteristics?.seniority,
                              ].filter(Boolean).join(' • ')}
                            </p>

                            <div className="flex items-center gap-3 mt-3 ml-[23px]">
                              {icp.current_challenges?.length > 0 && (
                                <span className="flex items-center gap-1 text-xs text-gray-500">
                                  <AlertTriangle size={10} />
                                  {icp.current_challenges.length} challenges
                                </span>
                              )}
                              {icp.goals?.length > 0 && (
                                <span className="flex items-center gap-1 text-xs text-gray-500">
                                  <Target size={10} />
                                  {icp.goals.length} goals
                                </span>
                              )}
                              {icp.positioning_strategy && (
                                <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-violet-500/10 text-violet-400 rounded-full">
                                  <Star size={9} />
                                  {icp.positioning_strategy}
                                </span>
                              )}
                            </div>
                          </div>

                          {icp.brand_profile_name && (
                            <span className="flex items-center gap-1 text-xs px-2 py-1 bg-white/5 border border-white/10 text-gray-500 rounded-lg">
                              <Building2 size={10} />
                              {icp.brand_profile_name}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </motion.div>
        </AnimatePresence>

        {/* Bottom Save Bar */}
        <div className="mt-8 pt-6 border-t border-white/10 flex items-center justify-between">
          <div>
            {saveError && (
              <p className="flex items-center gap-1.5 text-red-400 text-sm">
                <XCircle size={14} /> {saveError}
              </p>
            )}
            {saveSuccess && (
              <p className="flex items-center gap-1.5 text-green-400 text-sm">
                <Check size={14} /> Profile saved successfully
              </p>
            )}
          </div>
          <SaveButton />
        </div>

      </div>

      {/* ICP Modal */}
      <AnimatePresence>
        {showICPModal && (
          <ICPBuilderModal
            onClose={() => setShowICPModal(false)}
            onSave={handleSaveICP}
            isSaving={createIcpMutation.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  );
}