'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserPreferences {
  defaultHumanizationLevel: string;
  defaultLanguage:          string;
  defaultPerspective:       string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'account',      label: 'Account',       icon: '👤' },
  { id: 'organization', label: 'Organization',  icon: '🏢' },
  { id: 'ai',          label: 'AI Preferences', icon: '✦'  },
  { id: 'security',    label: 'Security',       icon: '🔐' },
  { id: 'integrations',label: 'Integrations',   icon: '🔗' },
];

// ─── Sub Components ───────────────────────────────────────────────────────────

function SettingsSection({
  title,
  description,
  children,
}: {
  title:        string;
  description?: string;
  children:     React.ReactNode;
}) {
  return (
    <div className="bg-white/3 border border-white/10 rounded-2xl p-6 space-y-5">
      <div>
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {description && (
          <p className="text-sm text-gray-500 mt-0.5">{description}</p>
        )}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label:    string;
  hint?:    string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-gray-300">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-600">{hint}</p>}
    </div>
  );
}

function StyledInput({
  value,
  onChange,
  placeholder,
  disabled,
  type = 'text',
}: {
  value:        string;
  onChange?:    (v: string) => void;
  placeholder?: string;
  disabled?:    boolean;
  type?:        string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`
        w-full px-4 py-2.5 rounded-xl text-sm border transition-colors outline-none
        ${disabled
          ? 'bg-white/3 border-white/5 text-gray-600 cursor-not-allowed'
          : 'bg-white/5 border-white/10 text-white placeholder:text-gray-600 focus:border-violet-500/50'
        }
      `}
    />
  );
}

function StyledSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value:    string;
  onChange: (v: string) => void;
  options:  Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-violet-500/50 transition-colors disabled:opacity-50"
    >
      {options.map(opt => (
        <option key={opt.value} value={opt.value} className="bg-[#0F0F10]">
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function SaveButton({
  onClick,
  loading,
  saved,
  disabled,
}: {
  onClick:  () => void;
  loading:  boolean;
  saved:    boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`
        flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl
        transition-all disabled:opacity-50 disabled:cursor-not-allowed
        ${saved
          ? 'bg-green-600 text-white'
          : 'bg-violet-600 hover:bg-violet-700 text-white'
        }
      `}
    >
      {loading ? (
        <>
          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          Saving...
        </>
      ) : saved ? (
        <>✓ Saved</>
      ) : (
        'Save Changes'
      )}
    </button>
  );
}

// ─── Account Section ──────────────────────────────────────────────────────────

function AccountSection() {
  const user     = useAuthStore(s => s.user);
  const fetchMe  = useAuthStore(s => s.fetchMe);
  const [name,   setName]   = useState(user?.name ?? '');
  const [saved,  setSaved]  = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.patch('/auth/me', { name }),
    onSuccess: async () => {
      await fetchMe(); // Refresh user in store
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <SettingsSection title="Account" description="Your personal information">
      <Field label="Full Name">
        <StyledInput
          value={name}
          onChange={setName}
          placeholder="Your name"
        />
      </Field>
      <Field label="Email" hint="Email cannot be changed. Contact support if needed.">
        <StyledInput value={user?.email ?? ''} disabled />
      </Field>
      <Field label="Role">
        <StyledInput value={user?.role ?? ''} disabled />
      </Field>
      <Field label="Organization">
        <StyledInput value={user?.organizationName ?? ''} disabled />
      </Field>
      <SaveButton
        onClick={() => mutation.mutate()}
        loading={mutation.isPending}
        saved={saved}
        disabled={!name.trim() || name === user?.name}
      />
    </SettingsSection>
  );
}

// ─── Organization Section ─────────────────────────────────────────────────────

function OrganizationSection() {
  const user = useAuthStore(s => s.user);
  const [orgName,  setOrgName]  = useState(user?.organizationName ?? '');
  const [language, setLanguage] = useState('English');
  const [saved,    setSaved]    = useState(false);

  const isOwnerOrAdmin = ['owner', 'admin'].includes(user?.role ?? '');

  const mutation = useMutation({
    mutationFn: () => api.patch('/auth/organization', {
      name:     orgName,
      language,
    }),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  return (
    <SettingsSection
      title="Organization"
      description="Settings for your entire workspace"
    >
      {!isOwnerOrAdmin && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-sm text-amber-300">
          Only owners and admins can edit organization settings
        </div>
      )}

      <Field label="Organization Name">
        <StyledInput
          value={orgName}
          onChange={setOrgName}
          placeholder="Company name"
          disabled={!isOwnerOrAdmin}
        />
      </Field>

      <Field label="Default Content Language">
        <StyledSelect
          value={language}
          onChange={setLanguage}
          disabled={!isOwnerOrAdmin}
          options={[
            { value: 'English',   label: 'English'   },
            { value: 'Hindi',     label: 'Hindi'     },
            { value: 'Hinglish',  label: 'Hinglish'  },
            { value: 'Spanish',   label: 'Spanish'   },
            { value: 'French',    label: 'French'    },
            { value: 'German',    label: 'German'    },
            { value: 'Arabic',    label: 'Arabic'    },
            { value: 'Portuguese',label: 'Portuguese'},
          ]}
        />
      </Field>

      {isOwnerOrAdmin && (
        <SaveButton
          onClick={() => mutation.mutate()}
          loading={mutation.isPending}
          saved={saved}
        />
      )}
    </SettingsSection>
  );
}

// ─── AI Preferences Section ───────────────────────────────────────────────────

function AIPreferencesSection() {
  const [prefs, setPrefs] = useState<UserPreferences>({
    defaultHumanizationLevel: 'medium',
    defaultLanguage:          'English',
    defaultPerspective:       'Founder',
  });
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.patch('/auth/preferences', prefs),
    onSuccess: () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const updatePref = (key: keyof UserPreferences, value: string) => {
    setPrefs(p => ({ ...p, [key]: value }));
  };

  return (
    <div className="space-y-5">
      <SettingsSection
        title="AI Preferences"
        description="Default settings for content generation"
      >
        <Field label="Default Humanization Level">
          <StyledSelect
            value={prefs.defaultHumanizationLevel}
            onChange={v => updatePref('defaultHumanizationLevel', v)}
            options={[
              { value: 'light',     label: 'Light — Preserve structure'       },
              { value: 'medium',    label: 'Medium — Recommended'             },
              { value: 'aggressive',label: 'Aggressive — Full rewrite feel'   },
            ]}
          />
        </Field>

        <Field label="Default Perspective">
          <StyledSelect
            value={prefs.defaultPerspective}
            onChange={v => updatePref('defaultPerspective', v)}
            options={[
              { value: 'Founder',       label: 'Founder'        },
              { value: 'CEO',           label: 'CEO'            },
              { value: 'Expert',        label: 'Expert'         },
              { value: 'Practitioner',  label: 'Practitioner'  },
              { value: 'Brand',         label: 'Brand Voice'    },
              { value: 'Thought Leader',label: 'Thought Leader' },
            ]}
          />
        </Field>

        <Field label="Default Language">
          <StyledSelect
            value={prefs.defaultLanguage}
            onChange={v => updatePref('defaultLanguage', v)}
            options={[
              { value: 'English',    label: 'English'    },
              { value: 'Hindi',      label: 'Hindi'      },
              { value: 'Hinglish',   label: 'Hinglish'   },
              { value: 'Spanish',    label: 'Spanish'    },
              { value: 'French',     label: 'French'     },
            ]}
          />
        </Field>

        <SaveButton
          onClick={() => mutation.mutate()}
          loading={mutation.isPending}
          saved={saved}
        />
      </SettingsSection>

      {/* Model Info */}
      <div className="p-4 bg-white/3 border border-white/10 rounded-2xl">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
          Active Models
        </p>
        <div className="space-y-2">
          {[
            { label: 'Primary',   model: 'DeepSeek Chat',       icon: '✦' },
            { label: 'Fallback',  model: 'Claude Sonnet 4.6',   icon: '◈' },
          ].map(({ label, model, icon }) => (
            <div key={label} className="flex items-center justify-between">
              <span className="text-xs text-gray-600">{label}</span>
              <span className="text-xs text-gray-400 flex items-center gap-1.5">
                <span>{icon}</span>
                {model}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Security Section ─────────────────────────────────────────────────────────

function SecuritySection() {
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd,     setNewPwd]     = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.post('/auth/change-password', {
      currentPassword: currentPwd,
      newPassword:     newPwd,
    }),
    onSuccess: () => {
      setSuccess(true);
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
      setError('');
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = () => {
    setError('');
    if (newPwd !== confirmPwd) {
      setError('New passwords do not match');
      return;
    }
    if (newPwd.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    mutation.mutate();
  };

  return (
    <SettingsSection
      title="Security"
      description="Manage your password and security settings"
    >
      {success && (
        <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-xl text-sm text-green-400">
          ✓ Password changed. You may need to log in again on other devices.
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      <Field label="Current Password">
        <StyledInput
          type="password"
          value={currentPwd}
          onChange={setCurrentPwd}
          placeholder="Enter current password"
        />
      </Field>

      <Field label="New Password" hint="Min 8 characters, include uppercase and number">
        <StyledInput
          type="password"
          value={newPwd}
          onChange={setNewPwd}
          placeholder="New password"
        />
      </Field>

      <Field label="Confirm New Password">
        <StyledInput
          type="password"
          value={confirmPwd}
          onChange={setConfirmPwd}
          placeholder="Repeat new password"
        />
      </Field>

      <button
        onClick={handleSubmit}
        disabled={mutation.isPending || !currentPwd || !newPwd || !confirmPwd}
        className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium rounded-xl transition-all"
      >
        {mutation.isPending ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Updating...
          </>
        ) : (
          'Update Password'
        )}
      </button>
    </SettingsSection>
  );
}

// ─── Integrations Section ─────────────────────────────────────────────────────

const INTEGRATIONS = [
  { id: 'wordpress',    name: 'WordPress',     icon: '📝', status: 'available', desc: 'Publish directly to WordPress' },
  { id: 'hubspot',      name: 'HubSpot',       icon: '🟠', status: 'available', desc: 'Sync content to HubSpot'       },
  { id: 'notion',       name: 'Notion',        icon: '◻',  status: 'available', desc: 'Export to Notion pages'        },
  { id: 'buffer',       name: 'Buffer',        icon: '📱', status: 'available', desc: 'Schedule social posts'         },
  { id: 'slack',        name: 'Slack',         icon: '💬', status: 'available', desc: 'Get notifications in Slack'    },
  { id: 'google_drive', name: 'Google Drive',  icon: '📁', status: 'available', desc: 'Save docs to Drive'           },
];

function IntegrationsSection() {
  return (
    <SettingsSection
      title="Integrations"
      description="Connect Semantiq with your favorite tools"
    >
      <div className="space-y-3">
        {INTEGRATIONS.map(integration => (
          <div
            key={integration.id}
            className="flex items-center justify-between p-4 bg-white/3 rounded-xl border border-white/8 hover:border-white/15 transition-all"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">{integration.icon}</span>
              <div>
                <p className="text-sm font-medium text-white">{integration.name}</p>
                <p className="text-xs text-gray-600">{integration.desc}</p>
              </div>
            </div>
            <button className="px-3 py-1.5 text-xs text-gray-500 border border-white/10 rounded-xl hover:border-violet-500/40 hover:text-violet-300 transition-all">
              Coming Soon
            </button>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState('account');

  return (
    <div className="min-h-screen bg-[#080809] text-white">
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-gray-500 text-sm mt-1">
            Manage your account and preferences
          </p>
        </div>

        <div className="flex gap-8">
          {/* Sidebar */}
          <nav className="w-44 shrink-0 space-y-1">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-xl
                  transition-all text-left
                  ${activeSection === s.id
                    ? 'bg-violet-500/15 text-white border border-violet-500/20 font-medium'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-transparent'
                  }
                `}
              >
                <span>{s.icon}</span>
                {s.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeSection}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
              >
                {activeSection === 'account'      && <AccountSection />}
                {activeSection === 'organization' && <OrganizationSection />}
                {activeSection === 'ai'           && <AIPreferencesSection />}
                {activeSection === 'security'     && <SecuritySection />}
                {activeSection === 'integrations' && <IntegrationsSection />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
