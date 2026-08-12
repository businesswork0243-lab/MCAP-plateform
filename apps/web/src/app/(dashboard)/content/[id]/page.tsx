'use client';

import { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { aiApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Copy, Download, RefreshCw, CheckCircle,
  XCircle, BarChart2, AlertTriangle, Lock, Edit3, Sparkles,
  History, Save, X, Wand2, RotateCcw, Clock, Tag
} from 'lucide-react';
import { PlatformIcon, getPlatformConfig } from '@/components/platform-icons';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Artifact {
  id: string;
  request_id?: string;
  content_type?: string;
  agent_type?: string;
  body?: string;
  content?: string;
  original_content?: string;
  edited_content?: string | null;
  last_edited_at?: string | null;
  refinement_count?: number;
  version?: number;
  status?: string;
  quality_score?: Record<string, unknown> | string;
  metadata?: Record<string, unknown> | string;
  created_at?: string;
}

interface ContentRequest {
  id:         string;
  topic?:     string;
  status?:    string;
  platforms?: string[] | string;
  metadata?:  Record<string, any>;
}

interface VersionRecord {
  id: string;
  version_number: number;
  platform?: string;
  content: string;
  change_type: 'generated' | 'edited' | 'refined' | 'regenerated' | 'humanized';
  change_summary?: string;
  user_prompt?: string;
  quick_tags?: string[] | string;
  tokens_used?: number;
  char_diff?: number;
  created_at: string;
  created_by_name?: string;
  created_by_email?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_PLATFORMS = [
  { key: 'canonical',         isBase: true },
  { key: 'linkedin_post'                    },
  { key: 'linkedin_article'                 },
  { key: 'x_post'                           },
  { key: 'x_thread'                         },
  { key: 'twitter_post'                     },
  { key: 'twitter_thread'                   },
  { key: 'blog_post'                        },
  { key: 'blog'                             },
  { key: 'newsletter'                       },
  { key: 'instagram_caption'                },
  { key: 'instagram_post'                   },
  { key: 'youtube_script'                   },
];

const STATUS_COLORS: Record<string, any> = {
  approved:          'success',
  published:         'success',
  completed:         'success',
  awaiting_review:   'warning',
  awaiting_qa:       'warning',
  running:           'warning',
  processing:        'warning',
  queued:            'secondary',
  failed:            'destructive',
  generation_failed: 'destructive',
  rejected:          'destructive',
  draft:             'secondary',
};

const QUICK_TAGS = [
  { id: 'punchy',            label: '🔥 More punchy',      color: 'bg-orange-500/10 border-orange-500/30 text-orange-600 dark:text-orange-400' },
  { id: 'add_stats',         label: '📊 Add stats',        color: 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400' },
  { id: 'sharper_hook',      label: '🎯 Sharper hook',     color: 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400' },
  { id: 'more_casual',       label: '💬 More casual',      color: 'bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400' },
  { id: 'shorter',           label: '📏 Shorter',          color: 'bg-purple-500/10 border-purple-500/30 text-purple-600 dark:text-purple-400' },
  { id: 'more_detailed',     label: '📖 More detailed',    color: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-600 dark:text-indigo-400' },
  { id: 'add_cta',           label: '❓ Add CTA',          color: 'bg-pink-500/10 border-pink-500/30 text-pink-600 dark:text-pink-400' },
  { id: 'storytelling',      label: '🎭 Storytelling',     color: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-600 dark:text-yellow-400' },
  { id: 'more_professional', label: '💼 More professional',color: 'bg-slate-500/10 border-slate-500/30 text-slate-600 dark:text-slate-400' },
  { id: 'remove_jargon',     label: '🎓 Remove jargon',    color: 'bg-teal-500/10 border-teal-500/30 text-teal-600 dark:text-teal-400' },
  { id: 'add_examples',      label: '💡 Add examples',     color: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-600 dark:text-cyan-400' },
  { id: 'more_inspiring',    label: '🌟 More inspiring',   color: 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400' },
];

// ─── Safe Helpers ─────────────────────────────────────────────────────────────

function safeReplace(str: string | null | undefined, from: RegExp | string, to: string): string {
  if (!str || typeof str !== 'string') return '';
  return str.replace(from, to);
}

function safeString(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'string') return val;
  return String(val);
}

function getArtifactContent(artifact: Artifact | undefined | null): string {
  if (!artifact) return '';
  return artifact.body || artifact.content || '';
}

function getArtifactPlatform(artifact: Artifact): string {
  if (artifact.metadata) {
    const meta = typeof artifact.metadata === 'string' 
      ? (() => { try { return JSON.parse(artifact.metadata); } catch { return {}; } })()
      : artifact.metadata;
    
    if (meta?.platform) return String(meta.platform);
  }
  
  const type = (artifact.agent_type || artifact.content_type || '').toLowerCase();
  if (type.includes('platform_') || type.includes('brand_') || type.includes('humanized_')) {
    return type.replace(/^(platform_|brand_|humanized_)/, '');
  }
  
  return type || 'unknown';
}

function getArtifactAgentType(artifact: Artifact): string {
  return artifact.agent_type || artifact.content_type || 'unknown';
}

function getArtifactQualityScore(artifact: Artifact | null): Record<string, unknown> | null {
  if (!artifact?.quality_score) return null;
  if (typeof artifact.quality_score === 'string') {
    try { return JSON.parse(artifact.quality_score); } catch { return null; }
  }
  return artifact.quality_score;
}

function getArtifactMetadata(artifact: Artifact | null): Record<string, unknown> | null {
  if (!artifact?.metadata) return null;
  if (typeof artifact.metadata === 'string') {
    try { return JSON.parse(artifact.metadata); } catch { return null; }
  }
  return artifact.metadata;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN WORKSPACE COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export default function ContentWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('canonical');
  const [copied, setCopied] = useState(false);

  // Edit / Refine / History / Modal state
  const [mode, setMode] = useState<'view' | 'edit' | 'refine' | 'history'>('view');
  const [editedContent, setEditedContent] = useState('');
  const [refinePrompt, setRefinePrompt] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);

  // ── Fetch Content Request Data ────────────────────────────────────────────
  const { data, isLoading, error } = useQuery({
    queryKey: ['content', id],
    queryFn: () => api.get(`/content/${id}`).then((r: any) => r.data),
    enabled: !!id,
    retry: 2,
  });

  const request: ContentRequest = data?.request || {};
  const artifacts: Artifact[] = data?.artifacts || [];

  // Extract selected platforms from request
  const selectedPlatforms = useMemo(() => {
    if (!request.platforms) return [];
    if (Array.isArray(request.platforms)) return request.platforms;
    try {
      return JSON.parse(request.platforms);
    } catch {
      return [request.platforms];
    }
  }, [request.platforms]);

  // Extract active platform label for empty states
  const activePlatformConfig = getPlatformConfig(activeTab);
  const activePlatformLabel = activePlatformConfig.label;

  // Compute set of platforms that HAVE artifacts generated
  const availablePlatforms = useMemo(() => {
    const set = new Set<string>();
    if (artifacts.length > 0) set.add('canonical');
    
    artifacts.forEach(a => {
      const platform = getArtifactPlatform(a);
      const agentType = getArtifactAgentType(a);
      
      if (platform && platform !== 'unknown' && platform !== 'canonical') {
        set.add(platform);
      }
      if (agentType.includes('canonical')) {
        set.add('canonical');
      }
    });
    
    return set;
  }, [artifacts]);

  // Set initial active tab to first available
  useEffect(() => {
    if (artifacts.length > 0 && !availablePlatforms.has(activeTab)) {
      const first = Array.from(availablePlatforms)[0];
      if (first) setActiveTab(first);
    }
  }, [artifacts, availablePlatforms]);

  // Find active artifact
  const activeArtifact = useMemo((): Artifact | null => {
    if (artifacts.length === 0) return null;
    
    if (activeTab === 'canonical') {
      const canonical = artifacts.find(a => {
        const agentType = getArtifactAgentType(a).toLowerCase();
        const platform = getArtifactPlatform(a).toLowerCase();
        return (
          agentType === 'canonical' ||
          agentType === 'canonical_writer' ||
          platform === 'canonical'
        );
      });
      return canonical || null;
    }
    
    const platformArtifacts = artifacts.filter(a => {
      const platform = getArtifactPlatform(a).toLowerCase();
      return platform === activeTab.toLowerCase();
    });
    
    if (platformArtifacts.length === 0) return null;
    
    const priorityOrder = ['qa_reviewed', 'humanized', 'brand_aligned', 'platform_adapted'];
    for (const priority of priorityOrder) {
      const found = platformArtifacts.find(a => {
        const type = getArtifactAgentType(a).toLowerCase();
        return type === priority || type.includes(priority);
      });
      if (found) return found;
    }
    
    return platformArtifacts[platformArtifacts.length - 1];
  }, [artifacts, activeTab]);

  const content = getArtifactContent(activeArtifact);
  const hasContent = !!content && content.trim().length > 0;
  const wasSelected = activeTab === 'canonical' || selectedPlatforms.includes(activeTab);

  // ── Fetch Version History ─────────────────────────────────────────────────
  const { data: versionData, isLoading: isLoadingVersions } = useQuery({
    queryKey: ['versions', id, activeArtifact?.id],
    queryFn: () => api.get(`/content/${id}/artifacts/${activeArtifact?.id}/versions`).then((r: any) => r.data),
    enabled: !!activeArtifact?.id && mode === 'history',
  });

  const versionHistory: VersionRecord[] = versionData?.versions || [];

  // ── Mutations ─────────────────────────────────────────────────────────────
  
  // Manual Edit mutation
  const editMutation = useMutation({
    mutationFn: (newContent: string) => {
      if (!activeArtifact?.id) throw new Error('No artifact');
      return api.patch(`/content/${id}/artifacts/${activeArtifact.id}`, {
        content: newContent,
        changeSummary: 'Manual edit',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content', id] });
      queryClient.invalidateQueries({ 
        queryKey: ['content-list'],
        exact: false,
      });
      setMode('view');
    },
  });

  // AI Refine mutation
  const refineMutation = useMutation({
    mutationFn: () => {
      if (!activeArtifact?.id) throw new Error('No artifact');
      return aiApi.post(`/content/${id}/artifacts/${activeArtifact.id}/refine`, {
        userPrompt: refinePrompt,
        quickTags: selectedTags,
        preserveLength: false,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content', id] });
      queryClient.invalidateQueries({ 
        queryKey: ['content-list'],
        exact: false,
      });
      setRefinePrompt('');
      setSelectedTags([]);
      setMode('view');
    },
    onError: (error: any) => {
      console.error('Refine failed:', error);
      const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Unknown error';
      alert(`AI Refinement failed: ${detail}`);
    },
  });

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: () => {
      if (!activeArtifact?.id) throw new Error('No artifact');
      return api.post(`/content/${id}/artifacts/${activeArtifact.id}/approve`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content', id] });
      queryClient.invalidateQueries({ 
        queryKey: ['content-list'],
        exact: false,
      });
    },
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: (reason: string) => {
      if (!activeArtifact?.id) throw new Error('No artifact');
      return api.post(`/content/${id}/artifacts/${activeArtifact.id}/reject`, {
        reason,
        note: reason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content', id] });
      queryClient.invalidateQueries({ 
        queryKey: ['content-list'],
        exact: false,
      });
      setShowRejectModal(false);
      setRejectReason('');
    },
  });

  // Restore version mutation
  const restoreMutation = useMutation({
    mutationFn: (versionId: string) => {
      if (!activeArtifact?.id) throw new Error('No artifact');
      return api.post(`/content/${id}/artifacts/${activeArtifact.id}/restore/${versionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content', id] });
      setMode('view');
    },
  });

  // Rerun & Rehumanize
  const rerunMutation = useMutation({
    mutationFn: () => api.post(`/content/${id}/rerun`),
    onSuccess: (response: any) => {
      const newId = response.data?.requestId || response.data?.contentId;
      if (newId) {
        router.push(`/content/${newId}/generating`);
      }
    },
  });

  const rehumanizeMutation = useMutation({
    mutationFn: () => api.post(`/content/${id}/rehumanize`, { intensity: 'medium' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['content', id] }),
  });

  // Handlers
  const startEdit = () => {
    setEditedContent(content);
    setMode('edit');
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]
    );
  };

  const copyContent = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // QA score calculations
  const qaArtifact = useMemo(() => {
    return artifacts.find(a => {
      const type = getArtifactAgentType(a).toLowerCase();
      return type === 'qa_reviewed' || type.includes('qa');
    }) || null;
  }, [artifacts]);

  const qaQuality = useMemo(() => getArtifactQualityScore(qaArtifact), [qaArtifact]);
  const qaMetadata = useMemo(() => getArtifactMetadata(qaArtifact), [qaArtifact]);

  const score = Number(
    qaQuality?.overall ??
    qaQuality?.overallScore ??
    qaMetadata?.overallScore ??
    0
  );

  const scoreMeta = {
    brandScore: Number(qaQuality?.brand ?? qaMetadata?.brandScore ?? 0),
    readabilityScore: Number(qaQuality?.readability ?? qaMetadata?.readabilityScore ?? 0),
    platformScore: Number(qaQuality?.platform_fit ?? qaMetadata?.platformScore ?? 0),
    structureScore: Number(qaQuality?.structure ?? qaMetadata?.structureScore ?? 0),
    humanizationScore: Number(qaQuality?.humanization ?? qaMetadata?.humanizationScore ?? 0),
    consistencyScore: Number(qaQuality?.consistency ?? qaMetadata?.consistencyScore ?? 0),
    clarityScore: Number(qaQuality?.clarity ?? qaMetadata?.clarityScore ?? 0),
    engagementScore: Number(qaQuality?.engagement ?? qaMetadata?.engagementScore ?? 0),
    ctaScore: Number(qaQuality?.cta ?? qaMetadata?.ctaScore ?? 0),
  };

  const qaFlags = Array.isArray(qaMetadata?.flags)
    ? (qaMetadata.flags as string[])
    : [];

  // Loading State
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <div className="text-center space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground font-medium">Loading workspace...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-screen gap-4">
        <AlertTriangle className="w-12 h-12 text-destructive" />
        <h2 className="text-lg font-semibold">Failed to load content</h2>
        <Button variant="outline" onClick={() => router.push('/content')}>
          <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-screen bg-background">
      {/* ═══ Top Bar ═══ */}
      <div className="border-b px-6 py-3.5 flex items-center justify-between bg-card/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push('/content')}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div className="h-4 w-px bg-border" />
          <h1 className="text-base font-semibold text-foreground truncate max-w-md">
            {request.topic || 'Untitled Request'}
          </h1>
          <Badge variant={STATUS_COLORS[request.status || 'draft'] || 'secondary'} className="capitalize text-xs">
            {safeReplace(request.status, /_/g, ' ')}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          {score > 0 && (
            <div className="flex items-center gap-1.5 text-sm font-semibold bg-muted/50 px-3 py-1 rounded-full">
              <BarChart2 className="w-4 h-4 text-primary" />
              <span>{score}/100</span>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={copyContent} disabled={!hasContent}>
            <Download className="w-3.5 h-3.5 mr-1" />
            Export
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ═══ Left Panel — Platform Tabs ═══ */}
        <div className="w-56 border-r bg-muted/30 py-3 shrink-0 overflow-y-auto">
          <div className="px-4 pb-3 mb-2 border-b">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
              Available Content
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {availablePlatforms.size} of {ALL_PLATFORMS.length} formats generated
            </p>
          </div>

          {ALL_PLATFORMS.map((platform) => {
            const config = getPlatformConfig(platform.key);
            const isAvailable = availablePlatforms.has(platform.key);
            const isActive = activeTab === platform.key;
            const { Icon, color, label } = config;

            return (
              <button
                key={platform.key}
                onClick={() => {
                  setActiveTab(platform.key);
                  setMode('view');
                }}
                className={cn(
                  'w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-3 group',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium border-r-2 border-primary'
                    : isAvailable
                      ? 'text-foreground hover:bg-accent'
                      : 'text-muted-foreground/50 hover:bg-accent/50'
                )}
              >
                <Icon
                  className={cn('w-4 h-4 shrink-0 transition-opacity', !isAvailable && 'opacity-40')}
                  style={{ color: isAvailable ? color : undefined }}
                />
                <span className="truncate flex-1">{label}</span>
                {isAvailable ? (
                  <span className="text-green-500 text-xs shrink-0">●</span>
                ) : (
                  <Lock className="w-3 h-3 shrink-0 text-muted-foreground/40" />
                )}
              </button>
            );
          })}
        </div>

        {/* ═══ Center — Editor Workspace ═══ */}
        <div className="flex-1 flex flex-col overflow-hidden bg-background">
          {/* Header Bar */}
          <div className="flex items-center justify-between px-6 py-3 border-b bg-card/30">
            <div className="flex items-center gap-2">
              <PlatformIcon platform={activeTab} size="md" />
              <span className="text-sm font-medium">
                {activePlatformLabel}
              </span>
              {mode === 'edit' && <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 border-blue-500/30">Editing</Badge>}
              {mode === 'refine' && <Badge variant="secondary" className="bg-purple-500/10 text-purple-600 border-purple-500/30">Refining</Badge>}
              {mode === 'history' && <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 border-amber-500/30">History</Badge>}
            </div>

            <div className="flex items-center gap-2">
              {hasContent && (
                <>
                  <Button
                    variant={mode === 'edit' ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={startEdit}
                  >
                    <Edit3 className="w-3.5 h-3.5 mr-1" /> Manual Edit
                  </Button>

                  <Button
                    variant={mode === 'refine' ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setMode(mode === 'refine' ? 'view' : 'refine')}
                    className="text-purple-600 dark:text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
                  >
                    <Sparkles className="w-3.5 h-3.5 mr-1" /> AI Refine
                  </Button>

                  <Button
                    variant={mode === 'history' ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setMode(mode === 'history' ? 'view' : 'history')}
                  >
                    <History className="w-3.5 h-3.5 mr-1" /> History
                  </Button>

                  <Button variant="ghost" size="sm" onClick={copyContent}>
                    <Copy className="w-3.5 h-3.5 mr-1" />
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Body Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            {/* VIEW MODE */}
            {mode === 'view' && (
              hasContent ? (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-foreground">
                    {content}
                  </pre>
                </div>
              ) : (
                <EmptyContentState
                  platform={activeTab}
                  platformLabel={activePlatformLabel}
                  wasSelected={wasSelected}
                  selectedPlatforms={selectedPlatforms}
                  onRegenerate={() => rerunMutation.mutate()}
                  isRegenerating={rerunMutation.isPending}
                />
              )
            )}

            {/* EDIT MODE */}
            {mode === 'edit' && (
              <div className="space-y-4 max-w-4xl mx-auto">
                <div className="flex items-center gap-2 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                  <Edit3 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                    Manual Edit Mode — Edit directly below and save to record a new version.
                  </span>
                </div>
                <Textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="min-h-[480px] font-sans text-sm leading-relaxed p-4"
                  placeholder="Edit your content here..."
                />
                <div className="flex gap-2 sticky bottom-0 bg-background py-3 border-t">
                  <Button
                    onClick={() => editMutation.mutate(editedContent)}
                    disabled={editMutation.isPending || !editedContent.trim()}
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {editMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </Button>
                  <Button variant="outline" onClick={() => setMode('view')}>
                    <X className="w-4 h-4 mr-2" /> Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* REFINE MODE */}
            {mode === 'refine' && (
              <div className="space-y-6 max-w-4xl mx-auto">
                <div className="flex items-center gap-2 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                  <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
                  <span className="text-xs text-purple-600 dark:text-purple-400 font-medium">
                    AI Refinement — Pick quick tags or describe custom instructions.
                  </span>
                </div>

                {/* Quick Tags Section */}
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3 block">
                    Quick Improvements
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_TAGS.map((tag) => {
                      const isSelected = selectedTags.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          className={cn(
                            'text-xs px-3 py-1.5 rounded-full border font-medium transition-all flex items-center gap-1.5',
                            isSelected
                              ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                              : `${tag.color} hover:opacity-80`
                          )}
                        >
                          {tag.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Custom Instruction Prompt */}
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">
                    Custom Prompt (Optional)
                  </label>
                  <Textarea
                    value={refinePrompt}
                    onChange={(e) => setRefinePrompt(e.target.value)}
                    className="min-h-[120px] text-sm"
                    placeholder="e.g. Make the hook more contrarian, trim 20% filler, and highlight key bullet points..."
                  />
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 border-t pt-4">
                  <Button
                    onClick={() => refineMutation.mutate()}
                    disabled={refineMutation.isPending || (!refinePrompt.trim() && selectedTags.length === 0)}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    <Wand2 className={cn('w-4 h-4 mr-2', refineMutation.isPending && 'animate-spin')} />
                    {refineMutation.isPending ? 'Refining...' : 'Apply Refinements'}
                  </Button>
                  <Button variant="outline" onClick={() => setMode('view')}>
                    <X className="w-4 h-4 mr-2" /> Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* HISTORY MODE */}
            {mode === 'history' && (
              <div className="space-y-4 max-w-4xl mx-auto">
                <div className="flex items-center justify-between pb-3 border-b">
                  <h3 className="text-sm font-semibold text-foreground">
                    Version History ({versionHistory.length})
                  </h3>
                  <Button variant="ghost" size="sm" onClick={() => setMode('view')}>
                    <X className="w-4 h-4 mr-1" /> Close
                  </Button>
                </div>

                {isLoadingVersions ? (
                  <div className="flex justify-center py-8">
                    <RefreshCw className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : versionHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No version history found for this artifact.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {versionHistory.map((ver) => (
                      <div
                        key={ver.id}
                        className="border rounded-lg p-4 bg-card hover:border-primary/50 transition-colors space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="font-mono text-xs">
                              v{ver.version_number}
                            </Badge>
                            <Badge className="capitalize text-[11px]" variant={ver.change_type === 'refined' ? 'secondary' : 'outline'}>
                              {ver.change_type}
                            </Badge>
                            {ver.change_summary && (
                              <span className="text-xs text-muted-foreground truncate max-w-xs">
                                {ver.change_summary}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(ver.created_at).toLocaleString()}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => restoreMutation.mutate(ver.id)}
                              disabled={restoreMutation.isPending}
                            >
                              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Restore
                            </Button>
                          </div>
                        </div>

                        {/* Content Preview */}
                        <div className="bg-muted/30 rounded p-3 text-xs font-sans whitespace-pre-wrap max-h-32 overflow-y-auto text-foreground/80">
                          {ver.content}
                        </div>

                        {/* User Prompt / Tags if refined */}
                        {ver.user_prompt && (
                          <p className="text-xs text-purple-600 dark:text-purple-400">
                            <strong>Prompt:</strong> {ver.user_prompt}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Agent Actions Bar (View Mode) */}
          {mode === 'view' && hasContent && (
            <div className="border-t px-6 py-3 flex items-center gap-2 flex-wrap bg-card/30">
              <span className="text-xs text-muted-foreground mr-2 font-medium">Actions:</span>

              <Button
                variant="outline"
                size="sm"
                onClick={() => rerunMutation.mutate()}
                disabled={rerunMutation.isPending}
              >
                <RefreshCw className={cn('w-3 h-3 mr-1', rerunMutation.isPending && 'animate-spin')} />
                Regenerate All
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => rehumanizeMutation.mutate()}
                disabled={rehumanizeMutation.isPending}
              >
                <RefreshCw className={cn('w-3 h-3 mr-1', rehumanizeMutation.isPending && 'animate-spin')} />
                Re-humanize
              </Button>
            </div>
          )}
        </div>

        {/* ═══ Right Panel — Intelligence Sidebar ═══ */}
        <div className="w-64 border-l shrink-0 overflow-y-auto p-4 space-y-5 bg-card/20">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Generated Formats
            </h3>
            <div className="space-y-1.5 text-xs">
              {selectedPlatforms.length === 0 ? (
                <p className="text-muted-foreground">No platforms selected</p>
              ) : (
                selectedPlatforms.map((p: string) => {
                  const config = getPlatformConfig(p);
                  const isGenerated = availablePlatforms.has(p);
                  const { Icon, color, label } = config;
                  
                  return (
                    <div key={p} className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: isGenerated ? color : undefined }} />
                      <span className="truncate flex-1">{label}</span>
                      {isGenerated ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      ) : (
                        <Lock className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* QA Scores */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Quality Assessment
            </h3>

            {score === 0 ? (
              <p className="text-xs text-muted-foreground">No QA evaluation available</p>
            ) : (
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center py-1 border-b">
                  <span className="text-muted-foreground">Overall Score</span>
                  <span className="font-semibold text-foreground">{score}/100</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b">
                  <span className="text-muted-foreground">Brand Alignment</span>
                  <span>{scoreMeta.brandScore}%</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b">
                  <span className="text-muted-foreground">Readability</span>
                  <span>{scoreMeta.readabilityScore}%</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b">
                  <span className="text-muted-foreground">Platform Fit</span>
                  <span>{scoreMeta.platformScore}%</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b">
                  <span className="text-muted-foreground">Humanization</span>
                  <span>{scoreMeta.humanizationScore}%</span>
                </div>
              </div>
            )}
          </div>

          {/* QA Flags */}
          {qaFlags.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                QA Warnings ({qaFlags.length})
              </h3>
              <div className="space-y-1.5">
                {qaFlags.map((flag: string, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-yellow-600 dark:text-yellow-400">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{safeReplace(flag, /_/g, ' ')}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Approval Section */}
          {hasContent && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Review & Approval
              </h3>
              <div className="flex flex-col gap-2">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending || activeArtifact?.status === 'approved'}
                >
                  <CheckCircle className="w-3.5 h-3.5 mr-1" />
                  {activeArtifact?.status === 'approved' ? 'Approved' : 'Approve'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-destructive hover:bg-destructive/10 border-destructive/30"
                  onClick={() => setShowRejectModal(true)}
                  disabled={rejectMutation.isPending || activeArtifact?.status === 'rejected'}
                >
                  <XCircle className="w-3.5 h-3.5 mr-1" />
                  {activeArtifact?.status === 'rejected' ? 'Rejected' : 'Reject Content'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ REJECT MODAL ═══ */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border rounded-lg max-w-md w-full p-6 space-y-4 shadow-lg">
            <h3 className="text-base font-semibold text-foreground">Reject Content</h3>
            <p className="text-xs text-muted-foreground">
              Please provide a reason for rejecting this artifact.
            </p>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="min-h-[100px] text-sm"
              placeholder="e.g. Brand tone is off, missing key CTA..."
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowRejectModal(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => rejectMutation.mutate(rejectReason)}
                disabled={rejectMutation.isPending || rejectReason.trim().length < 3}
              >
                {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Empty Content State Component ────────────────────────────────────────────

function EmptyContentState({
  platform,
  platformLabel,
  wasSelected,
  selectedPlatforms,
  onRegenerate,
  isRegenerating,
}: {
  platform: string;
  platformLabel: string;
  wasSelected: boolean;
  selectedPlatforms: string[];
  onRegenerate: () => void;
  isRegenerating: boolean;
}) {
  if (!wasSelected) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto py-12">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
          <Lock className="w-8 h-8 text-muted-foreground" />
        </div>
        
        <h3 className="text-lg font-semibold text-foreground mb-2">
          {platformLabel} not generated
        </h3>
        
        <p className="text-sm text-muted-foreground mb-4">
          This format was not selected when creating the content.
        </p>
        
        <div className="bg-muted/30 border border-border rounded-lg p-4 mb-6 w-full">
          <p className="text-xs text-muted-foreground mb-2 font-medium">
            Selected platforms:
          </p>
          <div className="flex flex-wrap gap-1.5 justify-center">
            {selectedPlatforms.map((p: string) => (
              <Badge key={p} variant="secondary" className="text-xs">
                {p.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
        </div>
        
        <Button
          onClick={onRegenerate}
          disabled={isRegenerating}
          variant="outline"
        >
          <RefreshCw className={cn('w-3.5 h-3.5 mr-1', isRegenerating && 'animate-spin')} />
          Regenerate All Formats
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto py-12">
      <AlertTriangle className="w-12 h-12 text-yellow-500 mb-4" />
      
      <h3 className="text-lg font-semibold text-foreground mb-2">
        Content generation incomplete
      </h3>
      
      <p className="text-sm text-muted-foreground mb-6">
        {platformLabel} was selected but content generation may have failed for this format.
      </p>
      
      <Button
        onClick={onRegenerate}
        disabled={isRegenerating}
      >
        <RefreshCw className={cn('w-3.5 h-3.5 mr-1', isRegenerating && 'animate-spin')} />
        Try Regenerating
      </Button>
    </div>
  );
}