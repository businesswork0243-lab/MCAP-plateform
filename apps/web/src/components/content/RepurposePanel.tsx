'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { aiApi } from '@/lib/api';

interface RepurposePanelProps {
  contentId: string;
  originalContent: string;
  originalPlatform: string;
  onRepurposed?: (platform: string, content: string) => void;
}

const REPURPOSE_TARGETS = [
  { id: 'twitter_thread', label: 'Twitter Thread', icon: '🐦', desc: '5-7 tweets' },
  { id: 'instagram_caption', label: 'Instagram Caption', icon: '📸', desc: 'With hooks' },
  { id: 'linkedin_post', label: 'LinkedIn Post', icon: '💼', desc: 'Professional format' },
  { id: 'blog_post', label: 'Blog Post', icon: '✍️', desc: 'Long-form expansion' },
  { id: 'newsletter', label: 'Newsletter Section', icon: '📧', desc: 'Email-ready' },
  { id: 'youtube_script', label: 'YouTube Script', icon: '🎬', desc: 'Video format' },
  { id: 'podcast_notes', label: 'Podcast Talking Points', icon: '🎙️', desc: 'Key points' },
  { id: 'whatsapp_status', label: 'WhatsApp Status', icon: '💬', desc: 'Short & punchy' },
];

export default function RepurposePanel({
  contentId,
  originalContent,
  originalPlatform,
  onRepurposed,
}: RepurposePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});

  const availableTargets = REPURPOSE_TARGETS.filter(t => t.id !== originalPlatform);

  const handleRepurpose = async (targetPlatform: string) => {
    if (results[targetPlatform]) {
      setSelectedTarget(targetPlatform);
      return;
    }

    setGenerating(true);
    setSelectedTarget(targetPlatform);

    try {
      // The endpoint is /content/:id/repurpose and reads only targetPlatform
      // (plus an optional sourceArtifactId) — it loads the source content
      // itself. The previous call posted to a path that does not exist.
      const response = await aiApi.post(`/content/${contentId}/repurpose`, {
        targetPlatform,
      });

      const { content } = response.data;
      setResults(prev => ({ ...prev, [targetPlatform]: content }));
      onRepurposed?.(targetPlatform, content);
    } catch (error) {
      console.error('Repurpose failed:', error);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="mt-6">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-violet-500/40 text-white text-sm font-medium rounded-xl transition-all"
      >
        <span>♻️</span>
        Repurpose This Content
        <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 overflow-hidden"
          >
            <div className="p-5 bg-white/3 border border-white/10 rounded-2xl space-y-4">
              <p className="text-sm text-gray-400">
                Select a platform to repurpose your content for:
              </p>

              <div className="grid grid-cols-2 gap-2">
                {availableTargets.map(target => (
                  <button
                    key={target.id}
                    onClick={() => handleRepurpose(target.id)}
                    disabled={generating && selectedTarget === target.id}
                    className={`p-3 text-left rounded-xl border transition-all ${
                      selectedTarget === target.id
                        ? 'bg-violet-600/20 border-violet-500'
                        : results[target.id]
                        ? 'bg-green-500/10 border-green-500/30'
                        : 'bg-white/5 border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span>{target.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white">{target.label}</p>
                        <p className="text-xs text-gray-500">{target.desc}</p>
                      </div>
                      {results[target.id] && (
                        <span className="text-green-400 text-xs">✓</span>
                      )}
                      {generating && selectedTarget === target.id && (
                        <span className="w-3 h-3 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* Result Panel */}
              {selectedTarget && results[selectedTarget] && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="mt-4 p-4 bg-white/5 border border-white/10 rounded-xl"
                >
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-medium text-white">
                      {REPURPOSE_TARGETS.find(t => t.id === selectedTarget)?.icon}{' '}
                      {REPURPOSE_TARGETS.find(t => t.id === selectedTarget)?.label}
                    </p>
                    <button
                      onClick={() => navigator.clipboard.writeText(results[selectedTarget])}
                      className="text-xs text-gray-500 hover:text-white px-3 py-1 rounded-lg border border-white/10 hover:border-white/20 transition-all"
                    >
                      Copy
                    </button>
                  </div>
                  <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
                    {results[selectedTarget]}
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
