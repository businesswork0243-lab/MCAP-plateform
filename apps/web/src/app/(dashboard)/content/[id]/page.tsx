'use client';

import { useState, useMemo, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Copy, Download, RefreshCw, CheckCircle,
  XCircle, BarChart2, AlertTriangle, Lock
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
  platforms?: string[] | string;  // Which platforms user selected
  metadata?:  Record<string, any>;
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
  draft:             'secondary',
};

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
  // Try metadata first (where we store platform)
  if (artifact.metadata) {
    const meta = typeof artifact.metadata === 'string' 
      ? (() => { try { return JSON.parse(artifact.metadata); } catch { return {}; } })()
      : artifact.metadata;
    
    if (meta?.platform) return String(meta.platform);
  }
  
  // Try content_type
  if (artifact.content_type) return artifact.content_type;
  
  return 'unknown';
}

function getArtifactAgentType(artifact: Artifact): string {
  return artifact.agent_type || artifact.content_type || 'unknown';
}

function parsePlatforms(raw: string[] | string | null | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseMaybeJson<T = Record<string, unknown>>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return null;

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getArtifactQualityScore(artifact: Artifact | null | undefined): Record<string, unknown> {
  if (!artifact?.quality_score) return {};
  return parseMaybeJson<Record<string, unknown>>(artifact.quality_score) || {};
}

function getArtifactMetadata(artifact: Artifact | null | undefined): Record<string, unknown> {
  if (!artifact?.metadata) return {};
  return parseMaybeJson<Record<string, unknown>>(artifact.metadata) || {};
}

// ─── Score Bar Component ──────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  const safeValue = Math.max(0, Math.min(100, value || 0));
  const color =
    safeValue >= 80 ? 'bg-green-500'
    : safeValue >= 60 ? 'bg-yellow-500'
    : 'bg-red-500';

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{safeValue}/100</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', color)}
          style={{ width: `${safeValue}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ContentWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('canonical');
  const [copied, setCopied] = useState(false);

  // Fetch content
  const { data, isLoading, error } = useQuery({
    queryKey: ['content', id],
    queryFn: () => api.get(`/content/${id}`).then((r: any) => r.data),
    enabled: !!id,
    retry: 2,
  });

  // ── Safe Data Extraction ──────────────────────────────────────────────────
  const request: ContentRequest | undefined = data?.request;
  const artifacts: Artifact[] = useMemo(() => {
    const raw = data?.artifacts ?? [];
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }, [data]);

  // ── Get user's selected platforms ─────────────────────────────────────────
  const selectedPlatforms = useMemo(() => {
    return parsePlatforms(request?.platforms);
  }, [request]);

  // ── Get platforms that actually have content ──────────────────────────────
  const availablePlatforms = useMemo(() => {
    const set = new Set<string>();
    
    // Canonical is always available if any artifact exists
    if (artifacts.length > 0) set.add('canonical');
    
    // Add platforms that have artifacts
    artifacts.forEach(a => {
      const platform = getArtifactPlatform(a);
      const agentType = getArtifactAgentType(a);
      
      if (platform && platform !== 'unknown' && platform !== 'canonical') {
        set.add(platform);
      }
      
      // Canonical writer artifacts
      if (agentType.includes('canonical')) {
        set.add('canonical');
      }
    });
    
    return set;
  }, [artifacts]);

  // ── Set initial active tab to first available ─────────────────────────────
  useEffect(() => {
    if (artifacts.length > 0 && !availablePlatforms.has(activeTab)) {
      // Switch to first available platform
      const first = Array.from(availablePlatforms)[0];
      if (first) setActiveTab(first);
    }
  }, [artifacts, availablePlatforms]);

  // ── Find active artifact - STRICT MATCHING ────────────────────────────────
  const activeArtifact = useMemo((): Artifact | null => {
    if (artifacts.length === 0) return null;
    
    if (activeTab === 'canonical') {
      // Find canonical draft
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
    
    // For platform-specific tabs: STRICT match only
    // Find best artifact for this platform (prefer qa_reviewed > humanized > brand_aligned > platform_adapted)
    const platformArtifacts = artifacts.filter(a => {
      const platform = getArtifactPlatform(a).toLowerCase();
      return platform === activeTab.toLowerCase();
    });
    
    if (platformArtifacts.length === 0) return null;
    
    // Priority order
    const priorityOrder = ['qa_reviewed', 'humanized', 'brand_aligned', 'platform_adapted'];
    
    for (const priority of priorityOrder) {
      const found = platformArtifacts.find(a => {
        const type = getArtifactAgentType(a).toLowerCase();
        return type === priority || type.includes(priority);
      });
      if (found) return found;
    }
    
    // Fallback: latest version for this platform
    return platformArtifacts[platformArtifacts.length - 1];
  }, [artifacts, activeTab]);

  const content = getArtifactContent(activeArtifact);
  const hasContent = !!content && content.trim().length > 0;
  const isPlatformAvailable = availablePlatforms.has(activeTab);
  const wasSelected = activeTab === 'canonical' || selectedPlatforms.includes(activeTab);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const approveMutation = useMutation({
    mutationFn: (action: 'approve' | 'reject') => {
      if (!activeArtifact?.id) throw new Error('No artifact selected');
      const endpoint = action === 'approve' ? 'approve' : 'reject';
      return api.post(`/content/${id}/artifacts/${activeArtifact.id}/${endpoint}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['content', id] }),
  });

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

  // Copy handler
  const copyContent = () => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

  // ── Loading State ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading content...</p>
        </div>
      </div>
    );
  }

  // ── Error State ────────────────────────────────────────────────────────────
  if (error || !request) {
    return (
      <div className="flex items-center justify-center h-full min-h-screen">
        <div className="text-center space-y-4 max-w-md">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
          <div>
            <h2 className="text-lg font-semibold">Content not found</h2>
            <p className="text-sm text-muted-foreground mt-1">
              The content you are looking for does not exist or you do not have permission.
            </p>
          </div>
          <Button onClick={() => router.push('/content')} variant="outline">
            ← Back to Content Library
          </Button>
        </div>
      </div>
    );
  }

  const statusColor = STATUS_COLORS[request.status || ''] || 'outline';
  const statusLabel = safeReplace(request.status, /_/g, ' ') || 'Unknown';
  const activePlatformLabel = getPlatformConfig(activeTab).label || activeTab;

  return (
    <div className="h-full flex flex-col">
      {/* ═══ Top Bar ═══ */}
      <div className="h-14 border-b px-6 flex items-center gap-4 shrink-0">
        <button
          onClick={() => router.push('/content')}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <h1 className="font-semibold flex-1 truncate">
          {safeString(request.topic, 'Untitled Content')}
        </h1>

        <Badge variant={statusColor}>
          {statusLabel}
        </Badge>

        {score > 0 && (
          <div className="flex items-center gap-1 text-sm">
            <BarChart2 className="w-4 h-4 text-muted-foreground" />
            <span className="font-semibold">{score}/100</span>
          </div>
        )}

        <Button variant="outline" size="sm" onClick={copyContent} disabled={!hasContent}>
          <Download className="w-3.5 h-3.5 mr-1" />
          Export
        </Button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ═══ Left Panel — Platform Tabs ═══ */}
        <div className="w-56 border-r bg-muted/30 py-3 shrink-0 overflow-y-auto">
          {/* Info banner */}
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
            const wasUserSelected = platform.isBase || selectedPlatforms.includes(platform.key);
            const isActive = activeTab === platform.key;
            const { Icon, color, label } = config;

            return (
              <button
                key={platform.key}
                onClick={() => setActiveTab(platform.key)}
                className={cn(
                  'w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center gap-3 group',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium border-r-2 border-primary'
                    : isAvailable
                      ? 'text-foreground hover:bg-accent'
                      : 'text-muted-foreground/50 hover:bg-accent/50'
                )}
              >
                {/* Real Brand Icon */}
                <Icon 
                  className={cn(
                    'w-4 h-4 shrink-0 transition-opacity',
                    !isAvailable && 'opacity-40'
                  )} 
                  style={{ color: isAvailable ? color : undefined }}
                />
                
                {/* Label */}
                <span className="truncate flex-1">{label}</span>
                
                {/* Status Indicator */}
                {isAvailable ? (
                  <span className="text-green-500 text-xs shrink-0">●</span>
                ) : (
                  <Lock className="w-3 h-3 shrink-0 text-muted-foreground/40" />
                )}
              </button>
            );
          })}
        </div>

        {/* ═══ Center — Editor ═══ */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* ═══ Center — Editor Header ═══ */}
          <div className="flex items-center justify-between px-6 py-3 border-b">
            <div className="flex items-center gap-2">
              <PlatformIcon platform={activeTab} size="md" />
              <span className="text-sm font-medium">
                {getPlatformConfig(activeTab).label}
              </span>
            </div>
            <Button variant="ghost" size="sm" onClick={copyContent} disabled={!hasContent}>
              <Copy className="w-3.5 h-3.5 mr-1" />
              {copied ? 'Copied!' : 'Copy'}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {hasContent ? (
              <div className="prose prose-sm max-w-none">
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
            )}
          </div>

          {/* Agent Actions - only show if content exists */}
          {hasContent && (
            <div className="border-t px-6 py-3 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground mr-2">Actions:</span>

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
        <div className="w-64 border-l shrink-0 overflow-y-auto p-4 space-y-5">
          {/* Content Info */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Generated Formats
            </h3>
            <div className="space-y-1.5 text-xs">
              {selectedPlatforms.length === 0 ? (
                <p className="text-muted-foreground">No platforms selected</p>
              ) : (
                selectedPlatforms.map(p => {
                  const config = getPlatformConfig(p);
                  const isGenerated = availablePlatforms.has(p);
                  const { Icon, color, label } = config;
                  
                  return (
                    <div key={p} className="flex items-center gap-2">
                      {isGenerated ? (
                        <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-muted-foreground shrink-0" />
                      )}
                      <Icon 
                        className="w-3.5 h-3.5 shrink-0" 
                        style={{ color: isGenerated ? color : undefined, opacity: isGenerated ? 1 : 0.4 }} 
                      />
                      <span className={isGenerated ? '' : 'text-muted-foreground'}>
                        {label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Quality Scores */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Quality Scores
            </h3>
            <div className="space-y-2.5">
              <ScoreBar label="Overall" value={score} />
              <div className="border-t my-2" />
              <ScoreBar label="Brand (20%)" value={scoreMeta.brandScore} />
              <ScoreBar label="Readability (15%)" value={scoreMeta.readabilityScore} />
              <ScoreBar label="Platform (15%)" value={scoreMeta.platformScore} />
              <ScoreBar label="Structure (10%)" value={scoreMeta.structureScore} />
              <ScoreBar label="Humanization (10%)" value={scoreMeta.humanizationScore} />
              <ScoreBar label="Consistency (10%)" value={scoreMeta.consistencyScore} />
              <ScoreBar label="Clarity (10%)" value={scoreMeta.clarityScore} />
              <ScoreBar label="Engagement (5%)" value={scoreMeta.engagementScore} />
              <ScoreBar label="CTA (5%)" value={scoreMeta.ctaScore} />
            </div>
          </div>

          {/* QA Findings */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              QA Findings
            </h3>
            <div className="space-y-1.5">
              {qaFlags.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-green-600">
                  <CheckCircle className="w-3.5 h-3.5" /> No issues found
                </div>
              ) : (
                qaFlags.map((flag: string, i: number) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-yellow-600">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{safeReplace(flag, /_/g, ' ')}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Approval */}
          {hasContent && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
                Approval
              </h3>
              <div className="flex flex-col gap-2">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => approveMutation.mutate('approve')}
                  disabled={approveMutation.isPending || request.status === 'approved'}
                >
                  <CheckCircle className="w-3.5 h-3.5 mr-1" /> Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-destructive hover:bg-destructive/10"
                  onClick={() => approveMutation.mutate('reject')}
                  disabled={approveMutation.isPending}
                >
                  <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                </Button>
              </div>
            </div>
          )}

          {/* Version History */}
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">
              Version History
            </h3>
            <div className="space-y-1">
              {artifacts.length === 0 ? (
                <p className="text-xs text-muted-foreground">No versions yet</p>
              ) : (
                artifacts.slice().reverse().map((a, i) => {
                  const type = getArtifactAgentType(a);
                  const platform = getArtifactPlatform(a);
                  const displayName = safeReplace(type, /_/g, ' ');
                  return (
                    <div
                      key={a.id || i}
                      className="flex items-center gap-2 text-xs py-1 border-b border-border/50 last:border-0"
                    >
                      <span className="text-muted-foreground">v{artifacts.length - i}</span>
                      <span className="flex-1 truncate capitalize">
                        {displayName || 'Unknown'}
                      </span>
                      {platform !== 'unknown' && platform !== 'canonical' && (
                        <span className="text-[9px] text-muted-foreground truncate max-w-[60px]">
                          {platform.slice(0, 8)}
                        </span>
                      )}
                      {i === 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          latest
                        </Badge>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
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
    // Platform wasn't selected during generation
    return (
      <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto">
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
            {selectedPlatforms.map(p => (
              <Badge key={p} variant="secondary" className="text-xs">
                {p.replace(/_/g, ' ')}
              </Badge>
            ))}
          </div>
        </div>
        
        <p className="text-xs text-muted-foreground mb-4">
          To generate this format, create new content and include {platformLabel.toLowerCase()} in your selection.
        </p>
        
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

  // Platform was selected but content missing (error case)
  return (
    <div className="flex flex-col items-center justify-center h-full text-center max-w-md mx-auto">
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