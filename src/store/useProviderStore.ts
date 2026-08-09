// Provider store — secure-ish key vault for multi-LLM gateway.
// Keys persist to localStorage (masked in UI), passed via headers per request.
// Mirrors the spec §4.1 ProviderStoreState.

'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProviderConfig, ProviderID, ProviderHealthResult } from '@/types/chess';
import { PROVIDER_META } from '@/types/chess';

interface ProviderState {
  activeProvider: ProviderID;
  providers: Record<ProviderID, ProviderConfig>;

  // Actions
  setActiveProvider: (p: ProviderID) => void;
  setProviderKey: (p: ProviderID, key: string) => void;
  setProviderModel: (p: ProviderID, model: string) => void;
  setProviderStatus: (p: ProviderID, status: ProviderConfig['status'], latencyMs?: number, errorMessage?: string) => void;
  testProviderConnection: (p: ProviderID) => Promise<boolean>;
  testAllProviders: () => Promise<void>;
}

const initialProviders = (): Record<ProviderID, ProviderConfig> => ({
  groq:           { apiKey: '', selectedModel: PROVIDER_META.groq.models[0],           status: 'UNTESTED' },
  openrouter:     { apiKey: '', selectedModel: PROVIDER_META.openrouter.models[0],     status: 'UNTESTED' },
  google_gemini:  { apiKey: '', selectedModel: PROVIDER_META.google_gemini.models[0],  status: 'UNTESTED' },
  openai:         { apiKey: '', selectedModel: PROVIDER_META.openai.models[0],         status: 'UNTESTED' },
  anthropic:      { apiKey: '', selectedModel: PROVIDER_META.anthropic.models[0],      status: 'UNTESTED' },
});

export const useProviderStore = create<ProviderState>()(
  persist(
    (set, get) => ({
      activeProvider: 'groq',
      providers: initialProviders(),

      setActiveProvider: (p) => set({ activeProvider: p }),

      setProviderKey: (p, key) => {
        const cur = get().providers[p];
        set({
          providers: { ...get().providers, [p]: { ...cur, apiKey: key, status: key ? 'UNTESTED' : 'UNTESTED' } },
        });
      },

      setProviderModel: (p, model) => {
        const cur = get().providers[p];
        set({ providers: { ...get().providers, [p]: { ...cur, selectedModel: model } } });
      },

      setProviderStatus: (p, status, latencyMs, errorMessage) => {
        const cur = get().providers[p];
        set({
          providers: { ...get().providers, [p]: { ...cur, status, latencyMs, errorMessage } },
        });
      },

      testProviderConnection: async (p) => {
        const cfg = get().providers[p];
        if (!cfg.apiKey) {
          get().setProviderStatus(p, 'ERROR', undefined, 'No API key set');
          return false;
        }
        get().setProviderStatus(p, 'TESTING');
        try {
          const resp = await fetch('/api/v1/providers/test', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Caissa-Provider': p,
              [`X-Caissa-ApiKey-${headerSuffix(p)}`]: cfg.apiKey,
              'X-Caissa-Model': cfg.selectedModel,
            },
          });
          const data: ProviderHealthResult = await resp.json();
          if (data.status === 'SUCCESS') {
            get().setProviderStatus(p, 'HEALTHY', data.latencyMs);
            return true;
          } else {
            get().setProviderStatus(p, 'ERROR', data.latencyMs, data.errorMessage || data.status);
            return false;
          }
        } catch (err: any) {
          get().setProviderStatus(p, 'ERROR', undefined, err.message || 'Network error');
          return false;
        }
      },

      testAllProviders: async () => {
        const ids = Object.keys(get().providers) as ProviderID[];
        await Promise.all(
          ids
            .filter(id => get().providers[id].apiKey)
            .map(id => get().testProviderConnection(id))
        );
      },
    }),
    {
      name: 'caissaxai-providers',
      partialize: (s) => ({
        activeProvider: s.activeProvider,
        providers: s.providers,
      }),
    }
  )
);

function headerSuffix(p: ProviderID): string {
  switch (p) {
    case 'groq': return 'Groq';
    case 'openrouter': return 'OpenRouter';
    case 'google_gemini': return 'Gemini';
    case 'openai': return 'Openai';
    case 'anthropic': return 'Anthropic';
  }
}
