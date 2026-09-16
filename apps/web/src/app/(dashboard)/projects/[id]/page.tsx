'use client';

// The project list has always linked to /projects/<id>, and the API has
// always served GET /api/projects/:id with the project, its content requests
// and its stats — but this page never existed, so every project card led to
// a 404.

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Plus, FileText, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { formatRelative, formatNumber } from '@/lib/utils';

interface ContentRequest {
  id:                string;
  topic:             string;
  status:            string;
  platforms:         string[] | string | null;
  target_platform:   string | null;
  created_at:        string;
  created_by_name:   string | null;
  avg_score:         number | null;
  artifact_count:    number;
}

interface ProjectDetail {
  id:            string;
  title:         string;
  description:   string | null;
  status:        'active' | 'completed' | 'archived';
  owner_name:    string;
  client_name:   string | null;
  created_at:    string;
  updated_at:    string;
  requests:      ContentRequest[];
  stats:         { total: string; completed: string; total_tokens: string } | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active:    { label: 'Active',    color: 'bg-violet-500/10 text-violet-300 border-violet-500/30' },
  completed: { label: 'Completed', color: 'bg-green-500/10 text-green-400 border-green-500/30' },
  archived:  { label: 'Archived',  color: 'bg-white/5 text-gray-500 border-white/10' },
};

const REQUEST_STATUS_COLOR: Record<string, string> = {
  approved:          'text-green-400',
  published:         'text-green-400',
  awaiting_review:   'text-amber-400',
  generation_failed: 'text-red-400',
  failed:            'text-red-400',
};

function platformList(r: ContentRequest): string {
  if (Array.isArray(r.platforms)) return r.platforms.join(', ');
  if (typeof r.platforms === 'string') {
    try {
      const parsed = JSON.parse(r.platforms);
      if (Array.isArray(parsed)) return parsed.join(', ');
    } catch {
      return r.platforms;
    }
  }
  return r.target_platform ?? '';
}

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = String(params?.id ?? '');

  const { data: project, isLoading, error } = useQuery<ProjectDetail>({
    queryKey: ['project', id],
    queryFn: () => api.get(`/projects/${id}`).then((r: any) => r.data),
    enabled: !!id,
    retry: false,
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/projects/${id}/status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-24 text-gray-500">
        <Loader2 size={18} className="animate-spin" />
        Loading project...
      </div>
    );
  }

  if (error || !project) {
    const message =
      (error as any)?.response?.status === 404
        ? 'This project does not exist, or it belongs to another organization.'
        : (error as any)?.response?.data?.error || 'Could not load this project.';

    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center px-6">
        <AlertTriangle className="w-8 h-8 text-amber-400" />
        <h1 className="text-xl font-semibold text-white">Project unavailable</h1>
        <p className="text-sm text-gray-500 max-w-sm">{message}</p>
        <Link
          href="/projects"
          className="mt-2 px-5 py-2.5 text-sm font-medium bg-violet-600 hover:bg-violet-700 text-white rounded-xl transition-all"
        >
          Back to projects
        </Link>
      </div>
    );
  }

  const status = STATUS_CONFIG[project.status] ?? STATUS_CONFIG.active;
  const total = Number(project.stats?.total ?? 0);
  const completed = Number(project.stats?.completed ?? 0);
  const tokens = Number(project.stats?.total_tokens ?? 0);
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-[#080809] text-white">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">

        <button
          type="button"
          onClick={() => router.push('/projects')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-white transition-colors"
        >
          <ArrowLeft size={15} /> Projects
        </button>

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold">{project.title}</h1>
              <span className={`px-2.5 py-1 text-xs font-medium rounded-full border ${status.color}`}>
                {status.label}
              </span>
              {project.client_name && (
                <span className="text-xs px-2 py-0.5 bg-white/5 text-gray-500 rounded-full border border-white/10">
                  {project.client_name}
                </span>
              )}
            </div>
            {project.description && (
              <p className="text-sm text-gray-500 mt-2 max-w-2xl">{project.description}</p>
            )}
            <p className="text-xs text-gray-600 mt-2">
              Owned by {project.owner_name} · created {formatRelative(project.created_at)}
            </p>
          </div>

          <Link
            href="/content/new"
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-all shrink-0"
          >
            <Plus size={15} /> New content
          </Link>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Content pieces', value: formatNumber(total) },
            { label: 'Completed',      value: formatNumber(completed) },
            { label: 'Completion',     value: `${completionRate}%` },
            { label: 'Tokens used',    value: formatNumber(tokens) },
          ].map(stat => (
            <div
              key={stat.label}
              className="p-4 bg-white/3 border border-white/10 rounded-2xl"
            >
              <p className="text-xl font-semibold tabular-nums">{stat.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Status control */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500 uppercase tracking-wider">Status</span>
          {(['active', 'completed', 'archived'] as const).map(s => (
            <button
              key={s}
              type="button"
              disabled={statusMutation.isPending || project.status === s}
              onClick={() => statusMutation.mutate(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all disabled:cursor-not-allowed ${
                project.status === s
                  ? 'bg-violet-600/20 border-violet-500 text-violet-300'
                  : 'bg-white/5 border-white/10 text-gray-400 hover:border-white/20'
              }`}
            >
              {STATUS_CONFIG[s].label}
            </button>
          ))}
          {statusMutation.isError && (
            <span className="text-xs text-red-400">
              {(statusMutation.error as any)?.response?.data?.error ||
                'Could not change the status.'}
            </span>
          )}
        </div>

        {/* Content pieces */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
            Content in this project
          </h2>

          {project.requests?.length ? (
            <div className="space-y-2">
              {project.requests.map(r => (
                <Link key={r.id} href={`/content/${r.id}`}>
                  <div className="flex items-start justify-between gap-4 p-4 bg-white/3 border border-white/10 rounded-2xl hover:border-violet-500/30 hover:bg-white/5 transition-all cursor-pointer">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{r.topic}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-600 flex-wrap">
                        <span className={REQUEST_STATUS_COLOR[r.status] ?? 'text-gray-500'}>
                          {r.status.replace(/_/g, ' ')}
                        </span>
                        {platformList(r) && <><span>·</span><span>{platformList(r)}</span></>}
                        <span>·</span>
                        <span>{r.artifact_count} formats</span>
                        <span>·</span>
                        <span>{formatRelative(r.created_at)}</span>
                      </div>
                    </div>
                    {r.avg_score != null && (
                      <span className="text-xs text-gray-400 shrink-0 tabular-nums">
                        {r.avg_score}/100
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-12 px-6 text-center bg-white/3 border border-dashed border-white/10 rounded-2xl">
              <FileText className="w-6 h-6 text-gray-600" />
              <p className="text-sm text-gray-500">No content in this project yet.</p>
              <Link
                href="/content/new"
                className="text-sm text-violet-400 hover:text-violet-300"
              >
                Create the first piece
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
