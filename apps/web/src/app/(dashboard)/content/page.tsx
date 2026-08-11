'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { formatRelative } from '@/lib/utils';
import { PlatformIcon, getPlatformConfig } from '@/components/platform-icons';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContentRequest {
  id:                 string;
  topic:              string;
  status:             string;
  platforms:          string[] | string | null;
  target_platform:    string | null;
  language:           string | null;
  created_at:         string;
  created_by_name:    string | null;
  brand_profile_name: string | null;
  client_name:        string | null;
}

interface Pagination {
  page:  number;
  limit: number;
  total: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  approved:          { label: 'Approved',   color: 'text-green-400 bg-green-500/15 border-green-500/30'    },
  published:         { label: 'Published',  color: 'text-blue-400 bg-blue-500/15 border-blue-500/30'       },
  awaiting_review:   { label: 'Review',     color: 'text-amber-400 bg-amber-500/15 border-amber-500/30'    },
  running:           { label: 'Generating', color: 'text-violet-400 bg-violet-500/15 border-violet-500/30' },
  processing:        { label: 'Processing', color: 'text-violet-400 bg-violet-500/15 border-violet-500/30' },
  queued:            { label: 'Queued',     color: 'text-gray-400 bg-gray-500/15 border-gray-500/30'       },
  generation_failed: { label: 'Failed',     color: 'text-red-400 bg-red-500/15 border-red-500/30'          },
  failed:            { label: 'Failed',     color: 'text-red-400 bg-red-500/15 border-red-500/30'          },
  rejected:          { label: 'Rejected',   color: 'text-red-400 bg-red-500/15 border-red-500/30'          },
  completed:         { label: 'Complete',   color: 'text-green-400 bg-green-500/15 border-green-500/30'    },
  draft:             { label: 'Draft',      color: 'text-gray-500 bg-gray-500/10 border-gray-500/20'       },
  unknown:           { label: 'Unknown',    color: 'text-gray-500 bg-gray-500/10 border-gray-500/20'       },
};

const STATUS_FILTERS = [
  { value: '',                  label: 'All'        },
  { value: 'approved',          label: 'Approved'   },
  { value: 'awaiting_review',   label: 'Review'     },
  { value: 'running',           label: 'Generating' },
  { value: 'rejected',          label: 'Rejected'   },
  { value: 'generation_failed', label: 'Failed'     },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function safeStatusLabel(status: string | null | undefined): string {
  if (!status || typeof status !== 'string') return 'Unknown';
  return status.replace(/_/g, ' ');
}

function getStatusConfig(status: string | null | undefined) {
  if (!status || typeof status !== 'string') {
    return STATUS_CONFIG.unknown;
  }
  return STATUS_CONFIG[status] ?? {
    label: safeStatusLabel(status),
    color: 'text-gray-400 bg-gray-500/15 border-gray-500/30',
  };
}

function safeString(val: unknown, fallback = ''): string {
  if (val === null || val === undefined) return fallback;
  return String(val);
}

// ─── Content Row ──────────────────────────────────────────────────────────────

function ContentRow({ item }: { item: ContentRequest }) {
  // ✅ SAFE: All fields have fallbacks
  const status = getStatusConfig(item.status);
  const platforms = parsePlatforms(item.platforms);
  const isActive = ['queued', 'running', 'processing'].includes(item.status || '');
  const topic = safeString(item.topic, 'Untitled');
  const language = safeString(item.language, 'English');

  return (
    <Link
      href={`/content/${item.id}${isActive ? '/generating' : ''}`}
      className="flex items-center gap-4 px-5 py-4 hover:bg-white/5 transition-all group"
    >
      {/* Platform icons */}
      <div className="flex -space-x-1 shrink-0 w-16">
        {platforms.length === 0 ? (
          <PlatformIcon platform="canonical" size="sm" className="opacity-40" />
        ) : (
          <>
            {platforms.slice(0, 3).map((p, i) => (
              <div 
                key={i} 
                className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
                title={getPlatformConfig(p).label}
              >
                <PlatformIcon platform={p} size="sm" />
              </div>
            ))}
            {platforms.length > 3 && (
              <div className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center">
                <span className="text-[10px] text-gray-500 font-medium">
                  +{platforms.length - 3}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Topic */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate group-hover:text-violet-300 transition-colors">
          {topic}
        </p>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-600">
          {item.brand_profile_name && (
            <>
              <span>🏢 {item.brand_profile_name}</span>
              <span>·</span>
            </>
          )}
          <span>{formatRelative(item.created_at)}</span>
          {item.created_by_name && (
            <>
              <span>·</span>
              <span>{item.created_by_name}</span>
            </>
          )}
        </div>
      </div>

      {/* Language */}
      <span className="text-xs text-gray-600 shrink-0 hidden sm:block">
        {language}
      </span>

      {/* Status */}
      <span
        className={`px-2.5 py-1 rounded-full text-xs font-medium border shrink-0 ${status.color}`}
      >
        {isActive && (
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
        )}
        {status.label}
      </span>

      {/* Arrow */}
      <span className="text-gray-700 group-hover:text-gray-400 transition-colors shrink-0">
        →
      </span>
    </Link>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ContentLibraryPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const queryStr = useMemo(() => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(LIMIT));
    if (statusFilter) params.set('status', statusFilter);
    return params.toString();
  }, [page, statusFilter]);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['content-list', queryStr],
    queryFn: () => api.get(`/content?${queryStr}`).then(r => r.data),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  // ✅ SAFE: Filter out invalid items
  const requests: ContentRequest[] = useMemo(() => {
    const raw = data?.requests ?? [];
    return raw.filter((r: unknown): r is ContentRequest => {
      return !!r && typeof r === 'object' && 'id' in r;
    });
  }, [data]);

  const pagination: Pagination = data?.pagination ?? { page: 1, limit: LIMIT, total: 0 };

  const filtered = useMemo(() => {
    if (!search.trim()) return requests;
    const q = search.toLowerCase();
    return requests.filter(r => {
      const topic = safeString(r.topic).toLowerCase();
      const brand = safeString(r.brand_profile_name).toLowerCase();
      const author = safeString(r.created_by_name).toLowerCase();
      return topic.includes(q) || brand.includes(q) || author.includes(q);
    });
  }, [requests, search]);

  const totalPages = Math.ceil(pagination.total / LIMIT);

  return (
    <div className="min-h-screen bg-[#080809] text-white">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Content Library</h1>
            <p className="text-gray-500 text-sm mt-1">
              {pagination.total} piece{pagination.total !== 1 ? 's' : ''} total
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/content/bulk"
              className="flex items-center gap-2 px-4 py-2.5 border border-white/15 bg-white/5 hover:bg-white/10 text-white text-sm font-medium rounded-xl transition-all"
            >
              📊 Bulk Upload
            </Link>
            <Link
              href="/content/new"
              className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-all shadow-lg shadow-violet-600/20"
            >
              ✦ New Content
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-64">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-600">⌕</span>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by topic, brand, or author..."
              className="w-full pl-9 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-gray-600 focus:border-violet-500/50 outline-none transition-colors"
            />
          </div>

          <div className="flex gap-1 p-1 bg-white/5 rounded-xl border border-white/10 flex-wrap">
            {STATUS_FILTERS.map(f => (
              <button
                key={f.value}
                onClick={() => { setStatusFilter(f.value); setPage(1); }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                  statusFilter === f.value
                    ? 'bg-violet-600 text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
            Failed to load content. Please refresh the page.
          </div>
        )}

        {/* Content Table */}
        <div className={`bg-white/3 border border-white/10 rounded-2xl overflow-hidden transition-opacity ${
          isFetching ? 'opacity-70' : ''
        }`}>
          <div className="flex items-center gap-4 px-5 py-3 border-b border-white/5">
            <div className="w-16 text-xs text-gray-600 font-medium">PLATFORM</div>
            <div className="flex-1 text-xs text-gray-600 font-medium">TOPIC</div>
            <div className="text-xs text-gray-600 font-medium hidden sm:block">LANG</div>
            <div className="text-xs text-gray-600 font-medium w-24 text-right">STATUS</div>
            <div className="w-4" />
          </div>

          {isLoading ? (
            <div className="divide-y divide-white/5">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4 animate-pulse">
                  <div className="w-16 h-4 bg-white/10 rounded" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 bg-white/10 rounded w-3/4" />
                    <div className="h-2.5 bg-white/10 rounded w-1/3" />
                  </div>
                  <div className="w-16 h-5 bg-white/10 rounded-full" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <div className="text-5xl mb-4">✦</div>
              <p className="text-white font-medium">
                {search ? 'No results found' : 'No content yet'}
              </p>
              <p className="text-gray-500 text-sm mt-1">
                {search ? 'Try a different search' : 'Generate your first piece of content'}
              </p>
              {!search && (
                <Link
                  href="/content/new"
                  className="mt-6 inline-block px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-all"
                >
                  Create Content →
                </Link>
              )}
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filtered.map(item => (
                <ContentRow key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-600">
              Page {page} of {totalPages} · {pagination.total} total
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-4 py-2 text-sm text-gray-400 border border-white/10 rounded-xl hover:border-white/20 disabled:opacity-40 transition-all"
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-4 py-2 text-sm text-gray-400 border border-white/10 rounded-xl hover:border-white/20 disabled:opacity-40 transition-all"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
