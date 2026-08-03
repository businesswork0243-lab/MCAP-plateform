'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import api from '@/lib/api';
import * as XLSX from 'xlsx';
import {
  Upload, FileSpreadsheet, CheckCircle,
  XCircle, AlertTriangle, Download,
  ArrowRight, Info, RefreshCw, Layers, CheckCircle2, FileText, ArrowLeft
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ValidationRow {
  rowNumber: number;
  valid:     boolean;
  errors:    string[];
  warnings:  string[];
  raw:       Record<string, unknown>;
  parsed?: {
    topic:              string;
    platforms:          string;
    brand_profile_name: string;
    icp_name:           string;
    writing_structure:  string;
    language:           string;
    objective:          string;
  };
}

interface ValidationResult {
  totalRows:     number;
  validRows:     number;
  invalidRows:   number;
  canProceed:    boolean;
  rows:          ValidationRow[];
  brandProfiles: string[];
  icpProfiles:   string[];
}

interface BulkJobRow {
  id:                 string;
  topic:              string;
  status:             string;
  bulk_row_number:    number;
  error_message:      string | null;
  total_tokens_used:  number | null;
  platforms:          string[] | string;
  artifact_count:     number;
}

interface BulkJobStatusResponse {
  bulkJob: {
    id:               string;
    status:           string;
    total_rows:       number;
    queued_count:     number;
    processing_count: number;
    completed_count:  number;
    failed_count:     number;
    original_filename: string;
    created_at:       string;
  };
  progress:   number;
  rows:       BulkJobRow[];
  isComplete: boolean;
}

// ── Template Downloader ───────────────────────────────────────────────────────

function downloadTemplate() {
  const workbook = XLSX.utils.book_new();

  const headers = [
    'topic', 'objective', 'context', 'platforms',
    'writing_structure', 'perspective', 'language',
    'cta_type', 'keywords', 'tone_excited', 'tone_confident',
    'tone_curious', 'tone_serious', 'humanization_level',
    'word_count', 'special_instructions', 'brand_profile_name',
    'icp_name', 'custom_audience', 'enable_qa',
    'seo_enabled', 'seo_primary_keyword',
  ];

  const exampleRow1 = [
    'Why most startups fail at content marketing',
    'Build thought leadership',
    'Focus on early-stage founders. Include data points.',
    'linkedin_post,newsletter',
    'thesis',
    'Founder',
    'English',
    'comment',
    'content marketing,startup,growth',
    7, 8, 5, 4,
    'medium',
    '800',
    'Write from a first-person founder perspective.',
    '',  // brand_profile_name — fill from your saved profiles
    '',  // icp_name — fill from your saved ICPs
    'B2B SaaS founders at Series A',
    'TRUE',
    'FALSE',
    '',
  ];

  const exampleRow2 = [
    '10 AI tools that save 20 hours per week for marketing teams',
    'Product Awareness',
    'Target productivity enthusiasts and marketing leads.',
    'twitter_thread,linkedin_post',
    'listicle',
    'Tech Expert',
    'English',
    'follow',
    'AI tools, productivity, marketing tech',
    8, 6, 9, 3,
    'aggressive',
    '1200',
    'Include practical prompt examples for each tool.',
    '',
    '',
    'Marketing Operations Leads',
    'TRUE',
    'TRUE',
    'AI marketing tools',
  ];

  const data = [headers, exampleRow1, exampleRow2];
  const sheet = XLSX.utils.aoa_to_sheet(data);

  // Set column widths
  sheet['!cols'] = headers.map(h => ({
    wch: Math.max(h.length + 2, 16),
  }));

  // Freeze header row
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };

  XLSX.utils.book_append_sheet(
    workbook, sheet, 'Content Requests'
  );

  XLSX.writeFile(workbook, 'mcap-bulk-template.xlsx');
}

// ── Main Page Component ───────────────────────────────────────────────────────

type Step = 'upload' | 'preview' | 'processing' | 'done';

export default function BulkUploadPage() {
  const router = useRouter();

  const [step, setStep]  = useState<Step>('upload');
  const [file, setFile]  = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [bulkJobId, setBulkJobId]   = useState<string | null>(null);
  const [filterRows, setFilterRows] = useState<'all' | 'valid' | 'invalid'>('all');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Validate mutation ───────────────────────────────────────────────────────
  const validateMutation = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return api.post<ValidationResult>(
        '/content/bulk/validate', form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      ).then(r => r.data);
    },
    onSuccess: (data) => {
      setValidation(data);
      setStep('preview');
    },
  });

  // ── Upload mutation ─────────────────────────────────────────────────────────
  const uploadMutation = useMutation({
    mutationFn: (f: File) => {
      const form = new FormData();
      form.append('file', f);
      return api.post<{ bulkJobId: string }>(
        '/content/bulk/upload', form,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      ).then(r => r.data);
    },
    onSuccess: (data) => {
      setBulkJobId(data.bulkJobId);
      setStep('processing');
    },
  });

  // ── Polling Job Status Query ────────────────────────────────────────────────
  const jobStatusQuery = useQuery({
    queryKey: ['bulkJobStatus', bulkJobId],
    queryFn: () => api.get<BulkJobStatusResponse>(`/content/bulk/${bulkJobId}`).then(r => r.data),
    enabled: !!bulkJobId && (step === 'processing' || step === 'done'),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.isComplete) return false;
      return 3000;
    },
  });

  // Transition from processing to done when job is complete
  useEffect(() => {
    if (jobStatusQuery.data?.isComplete && step === 'processing') {
      setStep('done');
    }
  }, [jobStatusQuery.data?.isComplete, step]);

  // ── File handling ───────────────────────────────────────────────────────────
  const handleFile = useCallback((f: File) => {
    setFile(f);
    validateMutation.mutate(f);
  }, [validateMutation]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
  };

  // ── Download Results Handler ────────────────────────────────────────────────
  const handleDownloadResults = async () => {
    if (!bulkJobId) return;
    try {
      const response = await api.get(`/content/bulk/${bulkJobId}/download`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `mcap-bulk-results-${bulkJobId.slice(0, 8)}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      console.error('Download failed', err);
    }
  };

  // ── Filtered rows ───────────────────────────────────────────────────────────
  const filteredRows = validation?.rows.filter(r => {
    if (filterRows === 'valid')   return r.valid;
    if (filterRows === 'invalid') return !r.valid;
    return true;
  }) ?? [];

  return (
    <div className="min-h-screen bg-[#080809] text-white">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-8">

        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push('/content')}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all"
                title="Back to Content"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h1 className="text-2xl font-bold tracking-tight">Bulk Content Generation</h1>
            </div>
            <p className="text-gray-400 text-sm mt-1">
              Upload an Excel spreadsheet with up to 50 content requests to generate multi-channel content at scale.
            </p>
          </div>

          <button
            onClick={downloadTemplate}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-300 rounded-xl transition-all shadow-sm shrink-0"
          >
            <Download className="w-4 h-4 text-violet-400" />
            Download Excel Template
          </button>
        </div>

        {/* ── Step Indicator ── */}
        <div className="flex items-center justify-between max-w-2xl mx-auto bg-white/3 border border-white/10 rounded-2xl p-3">
          {(['upload', 'preview', 'processing', 'done'] as Step[]).map(
            (s, i, arr) => {
              const stepNames = {
                upload: '1. Upload File',
                preview: '2. Validate & Preview',
                processing: '3. Processing Jobs',
                done: '4. Complete & Export'
              };
              const isCurrent = step === s;
              const isPast = arr.indexOf(step) > i;

              return (
                <div key={s} className="flex items-center gap-2">
                  <div className={cn(
                    'flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all',
                    isCurrent
                      ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/30 ring-1 ring-violet-400/50'
                      : isPast
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-white/5 text-gray-500'
                  )}>
                    {isPast ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <span className="w-4 h-4 rounded-full bg-black/30 flex items-center justify-center text-[10px]">
                        {i + 1}
                      </span>
                    )}
                    <span>{s === 'upload' ? 'Upload' : s === 'preview' ? 'Preview' : s === 'processing' ? 'Processing' : 'Export'}</span>
                  </div>
                  {i < arr.length - 1 && (
                    <div className={cn(
                      'w-6 h-px transition-all',
                      isPast ? 'bg-emerald-500/50' : 'bg-white/10'
                    )} />
                  )}
                </div>
              );
            }
          )}
        </div>

        <AnimatePresence mode="wait">

          {/* ════ STEP 1: UPLOAD ════ */}
          {step === 'upload' && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="space-y-6"
            >
              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'border-2 border-dashed rounded-2xl p-14 text-center cursor-pointer transition-all relative overflow-hidden',
                  isDragging
                    ? 'border-violet-500 bg-violet-500/10 scale-[1.01]'
                    : validateMutation.isPending
                    ? 'border-white/10 bg-white/3 cursor-wait'
                    : 'border-white/15 hover:border-violet-500/50 hover:bg-white/5 bg-white/2'
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={handleFileInput}
                />

                {validateMutation.isPending ? (
                  <div className="py-6">
                    <div className="w-12 h-12 border-3 border-violet-500/30 border-t-violet-500 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-white font-semibold text-lg">Parsing & Validating File...</p>
                    <p className="text-gray-400 text-sm mt-1">
                      Checking schema requirements and resolving brand profiles
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="w-16 h-16 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mx-auto mb-4 text-violet-400">
                      <FileSpreadsheet className="w-8 h-8" />
                    </div>
                    <p className="text-white font-bold text-xl">
                      Drop your Excel or CSV file here
                    </p>
                    <p className="text-gray-400 text-sm mt-2 max-w-md mx-auto">
                      Supports <span className="text-violet-300 font-medium">.xlsx</span>, <span className="text-violet-300 font-medium">.xls</span>, or <span className="text-violet-300 font-medium">.csv</span> formats. Max 50 rows per batch upload.
                    </p>
                    <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/15 text-white text-xs font-semibold rounded-xl transition-all border border-white/10">
                      <Upload className="w-3.5 h-3.5" />
                      Browse Files
                    </div>
                  </>
                )}
              </div>

              {validateMutation.isError && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 flex items-center gap-3">
                  <XCircle className="w-5 h-5 shrink-0 text-red-400" />
                  <span>
                    {(validateMutation.error as Error)?.message || 'Failed to parse file. Check sheet structure.'}
                  </span>
                </div>
              )}

              {/* Column guide */}
              <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-white flex items-center gap-2">
                    <Info className="w-4 h-4 text-violet-400" />
                    Template Column Specification Guide
                  </h3>
                  <span className="text-xs text-gray-500 font-mono">* required fields</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  {[
                    { col: 'A', name: 'topic', req: true, desc: 'Content topic or title (required)' },
                    { col: 'B', name: 'objective', req: false, desc: 'Goal (e.g. Build thought leadership)' },
                    { col: 'C', name: 'context', req: false, desc: 'Additional background context' },
                    { col: 'D', name: 'platforms', req: true, desc: 'Comma-separated (e.g. linkedin_post, newsletter)' },
                    { col: 'E', name: 'writing_structure', req: false, desc: 'thesis, story, listicle, how_to, etc.' },
                    { col: 'F', name: 'perspective', req: false, desc: 'Founder, CEO, Technical Expert, etc.' },
                    { col: 'G', name: 'language', req: false, desc: 'English, Spanish, German, French, etc.' },
                    { col: 'H', name: 'cta_type', req: false, desc: 'comment, follow, subscribe, visit_link' },
                    { col: 'I', name: 'keywords', req: false, desc: 'Comma-separated keywords' },
                    { col: 'J-M', name: 'tone_*', req: false, desc: 'tone_excited, tone_confident, tone_curious, tone_serious (0-10)' },
                    { col: 'N', name: 'humanization_level', req: false, desc: 'light, medium, or aggressive' },
                    { col: 'O', name: 'word_count', req: false, desc: 'Target word count (e.g. 800)' },
                    { col: 'P', name: 'special_instructions', req: false, desc: 'Row-specific custom prompt instructions' },
                    { col: 'Q', name: 'brand_profile_name', req: false, desc: 'Exact name of saved Brand Profile' },
                    { col: 'R', name: 'icp_name', req: false, desc: 'Exact name of saved ICP Profile' },
                    { col: 'S', name: 'custom_audience', req: false, desc: 'Target audience description' },
                    { col: 'T', name: 'enable_qa', req: false, desc: 'TRUE or FALSE (default TRUE)' },
                    { col: 'U-V', name: 'seo_*', req: false, desc: 'seo_enabled (TRUE/FALSE), seo_primary_keyword' },
                  ].map(({ col, name, req, desc }) => (
                    <div
                      key={col}
                      className="p-3 rounded-xl bg-white/3 border border-white/5 space-y-1 hover:border-white/10 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-violet-400 font-mono font-bold text-[11px]">{col}</span>
                        <span className="text-white font-semibold font-mono">{name}</span>
                        {req ? (
                          <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 text-[9px] font-bold">REQ</span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-white/5 text-gray-500 text-[9px]">OPT</span>
                        )}
                      </div>
                      <p className="text-gray-400 text-[11px] leading-tight">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {/* ════ STEP 2: PREVIEW ════ */}
          {step === 'preview' && validation && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="space-y-6"
            >
              {/* Summary stat cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total Rows Parsed', value: validation.totalRows, color: 'text-white', border: 'border-white/10' },
                  { label: 'Valid Rows', value: validation.validRows, color: 'text-emerald-400', border: 'border-emerald-500/30' },
                  { label: 'Invalid Rows', value: validation.invalidRows, color: 'text-rose-400', border: 'border-rose-500/30' },
                  { label: 'Will Generate', value: validation.validRows, color: 'text-violet-400', border: 'border-violet-500/30' },
                ].map(stat => (
                  <div
                    key={stat.label}
                    className={cn('p-4 bg-white/3 border rounded-2xl space-y-1', stat.border)}
                  >
                    <p className="text-xs text-gray-400 font-medium">{stat.label}</p>
                    <p className={cn('text-3xl font-extrabold tracking-tight', stat.color)}>
                      {stat.value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Profiles Information */}
              {(validation.brandProfiles.length > 0 || validation.icpProfiles.length > 0) && (
                <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-sm flex items-start gap-3">
                  <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-blue-300 font-semibold">Saved profiles available for auto-resolution:</p>
                    {validation.brandProfiles.length > 0 && (
                      <p className="text-blue-200/80 text-xs">
                        <span className="font-medium text-blue-300">Brands:</span> {validation.brandProfiles.join(', ')}
                      </p>
                    )}
                    {validation.icpProfiles.length > 0 && (
                      <p className="text-blue-200/80 text-xs">
                        <span className="font-medium text-blue-300">ICPs:</span> {validation.icpProfiles.join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Row filter tabs & Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex gap-2 bg-white/3 p-1 rounded-xl border border-white/10 w-fit">
                  {(['all', 'valid', 'invalid'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFilterRows(f)}
                      className={cn(
                        'px-4 py-1.5 text-xs font-semibold rounded-lg transition-all capitalize',
                        filterRows === f
                          ? 'bg-violet-600 text-white shadow-sm'
                          : 'text-gray-400 hover:text-white'
                      )}
                    >
                      {f} ({
                        f === 'all'     ? validation.totalRows
                        : f === 'valid'   ? validation.validRows
                        : validation.invalidRows
                      })
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => { setStep('upload'); setFile(null); setValidation(null); }}
                    className="px-4 py-2 text-xs font-semibold border border-white/10 rounded-xl hover:bg-white/5 transition-all text-gray-400 hover:text-white"
                  >
                    Re-upload File
                  </button>

                  <button
                    disabled={!validation.canProceed || uploadMutation.isPending}
                    onClick={() => file && uploadMutation.mutate(file)}
                    className={cn(
                      'flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl transition-all shadow-lg',
                      validation.canProceed && !uploadMutation.isPending
                        ? 'bg-violet-600 hover:bg-violet-500 text-white shadow-violet-600/30'
                        : 'bg-white/10 text-gray-500 cursor-not-allowed'
                    )}
                  >
                    {uploadMutation.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Queueing Jobs...
                      </>
                    ) : (
                      <>
                        Start Bulk Generation ({validation.validRows} rows)
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Table */}
              <div className="bg-white/3 border border-white/10 rounded-2xl overflow-hidden shadow-xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5 text-gray-400 font-semibold uppercase tracking-wider">
                        <th className="px-4 py-3.5 w-16">Row #</th>
                        <th className="px-4 py-3.5 w-24">Status</th>
                        <th className="px-4 py-3.5 min-w-[220px]">Topic</th>
                        <th className="px-4 py-3.5">Platforms</th>
                        <th className="px-4 py-3.5">Brand Profile</th>
                        <th className="px-4 py-3.5 min-w-[200px]">Validation Issues & Warnings</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {filteredRows.map(row => (
                        <tr
                          key={row.rowNumber}
                          className={cn(
                            'hover:bg-white/3 transition-colors',
                            !row.valid && 'bg-rose-500/5'
                          )}
                        >
                          <td className="px-4 py-3 text-gray-400 font-mono font-semibold">
                            {row.rowNumber}
                          </td>
                          <td className="px-4 py-3">
                            {row.valid ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-medium">
                                <CheckCircle className="w-3.5 h-3.5" />
                                Valid
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-400 font-medium">
                                <XCircle className="w-3.5 h-3.5" />
                                Invalid
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-medium text-white">
                            {row.parsed?.topic || String(row.raw.topic || row.raw.Topic || 'N/A')}
                          </td>
                          <td className="px-4 py-3 text-gray-300">
                            {row.parsed?.platforms || String(row.raw.platforms || 'N/A')}
                          </td>
                          <td className="px-4 py-3 text-gray-400">
                            {row.parsed?.brand_profile_name || '-'}
                          </td>
                          <td className="px-4 py-3 space-y-1">
                            {row.errors.map((e, idx) => (
                              <div key={idx} className="text-rose-400 font-medium flex items-start gap-1">
                                <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <span>{e}</span>
                              </div>
                            ))}
                            {row.warnings.map((w, idx) => (
                              <div key={idx} className="text-amber-400 flex items-start gap-1">
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                <span>{w}</span>
                              </div>
                            ))}
                            {row.valid && row.warnings.length === 0 && (
                              <span className="text-gray-500 italic">No issues</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {/* ════ STEP 3: PROCESSING & STEP 4: DONE ════ */}
          {(step === 'processing' || step === 'done') && (
            <motion.div
              key="processing"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className="space-y-6"
            >
              {/* Status Header Banner */}
              <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-white">
                        {step === 'done' ? 'Bulk Generation Complete' : 'Processing Content Jobs...'}
                      </h2>
                      {step === 'processing' && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/20 text-violet-300 text-xs font-semibold border border-violet-500/30">
                          <RefreshCw className="w-3 h-3 animate-spin text-violet-400" />
                          Live Polling
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 text-sm mt-1">
                      Job ID: <span className="font-mono text-violet-300">{bulkJobId}</span>
                    </p>
                  </div>

                  {step === 'done' && (
                    <button
                      onClick={handleDownloadResults}
                      className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl transition-all shadow-lg shadow-emerald-600/20"
                    >
                      <Download className="w-4 h-4" />
                      Download Excel Results (.xlsx)
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-gray-400">Overall Progress</span>
                    <span className="text-violet-400 font-mono">{jobStatusQuery.data?.progress ?? 0}%</span>
                  </div>
                  <div className="w-full bg-white/5 h-3 rounded-full overflow-hidden p-0.5 border border-white/10">
                    <div
                      className="bg-gradient-to-r from-violet-600 to-emerald-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${jobStatusQuery.data?.progress ?? 0}%` }}
                    />
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                  <div className="bg-white/3 border border-white/5 p-3 rounded-xl">
                    <p className="text-[11px] text-gray-500 font-medium">Total Rows</p>
                    <p className="text-xl font-bold text-white mt-0.5">
                      {jobStatusQuery.data?.bulkJob.total_rows ?? 0}
                    </p>
                  </div>
                  <div className="bg-white/3 border border-white/5 p-3 rounded-xl">
                    <p className="text-[11px] text-gray-500 font-medium">In Queue / Processing</p>
                    <p className="text-xl font-bold text-violet-400 mt-0.5">
                      {jobStatusQuery.data?.bulkJob.processing_count ?? 0}
                    </p>
                  </div>
                  <div className="bg-white/3 border border-white/5 p-3 rounded-xl">
                    <p className="text-[11px] text-gray-500 font-medium">Completed</p>
                    <p className="text-xl font-bold text-emerald-400 mt-0.5">
                      {jobStatusQuery.data?.bulkJob.completed_count ?? 0}
                    </p>
                  </div>
                  <div className="bg-white/3 border border-white/5 p-3 rounded-xl">
                    <p className="text-[11px] text-gray-500 font-medium">Failed</p>
                    <p className="text-xl font-bold text-rose-400 mt-0.5">
                      {jobStatusQuery.data?.bulkJob.failed_count ?? 0}
                    </p>
                  </div>
                </div>
              </div>

              {/* Rows Status Table */}
              <div className="bg-white/3 border border-white/10 rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-white/10 flex items-center justify-between">
                  <h3 className="font-semibold text-white text-sm flex items-center gap-2">
                    <Layers className="w-4 h-4 text-violet-400" />
                    Individual Content Request Items
                  </h3>
                  <span className="text-xs text-gray-500 font-mono">
                    {jobStatusQuery.data?.rows.length ?? 0} items
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/5 text-gray-400 font-semibold uppercase tracking-wider">
                        <th className="px-4 py-3 w-16">Row #</th>
                        <th className="px-4 py-3 min-w-[220px]">Topic</th>
                        <th className="px-4 py-3">Platforms</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Artifacts</th>
                        <th className="px-4 py-3">Tokens</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {jobStatusQuery.data?.rows.map(row => {
                        const isDone = ['awaiting_review', 'approved', 'completed'].includes(row.status);
                        const isFailed = ['generation_failed', 'failed'].includes(row.status);

                        return (
                          <tr key={row.id} className="hover:bg-white/3 transition-colors">
                            <td className="px-4 py-3 text-gray-400 font-mono font-semibold">
                              {row.bulk_row_number}
                            </td>
                            <td className="px-4 py-3 font-medium text-white">
                              {row.topic}
                              {row.error_message && (
                                <p className="text-[11px] text-rose-400 mt-0.5">{row.error_message}</p>
                              )}
                            </td>
                            <td className="px-4 py-3 text-gray-300">
                              {Array.isArray(row.platforms) ? row.platforms.join(', ') : String(row.platforms || '')}
                            </td>
                            <td className="px-4 py-3">
                              <span className={cn(
                                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium capitalize',
                                isDone
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : isFailed
                                  ? 'bg-rose-500/10 text-rose-400'
                                  : 'bg-violet-500/10 text-violet-300'
                              )}>
                                {!isDone && !isFailed && <RefreshCw className="w-3 h-3 animate-spin" />}
                                {row.status.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-gray-300 font-mono">
                              {row.artifact_count}
                            </td>
                            <td className="px-4 py-3 text-gray-300 font-mono">
                              {row.total_tokens_used ?? 0}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => router.push(`/content/${row.id}`)}
                                className="px-3 py-1 bg-white/5 hover:bg-white/10 text-white rounded-lg transition-all text-[11px] font-medium inline-flex items-center gap-1"
                              >
                                <FileText className="w-3 h-3 text-violet-400" />
                                View
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {step === 'done' && (
                <div className="flex justify-between items-center bg-white/3 border border-white/10 rounded-2xl p-6">
                  <div>
                    <h3 className="text-base font-bold text-white">Ready for Export</h3>
                    <p className="text-gray-400 text-xs mt-0.5">
                      You can download the full spreadsheet containing all generated copy, quality metrics, and metadata.
                    </p>
                  </div>
                  <button
                    onClick={handleDownloadResults}
                    className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-xl transition-all shadow-lg"
                  >
                    <Download className="w-4 h-4" />
                    Download Excel Results (.xlsx)
                  </button>
                </div>
              )}
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
