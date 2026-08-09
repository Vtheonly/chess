// Settings store — UI theme, sound on/off, board orientation.

'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  theme: 'light' | 'dark';
  soundEnabled: boolean;
  boardOrientation: 'white' | 'black';
  toggleTheme: () => void;
  setSoundEnabled: (v: boolean) => void;
  setBoardOrientation: (o: 'white' | 'black') => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      soundEnabled: true,
      boardOrientation: 'white',
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setBoardOrientation: (boardOrientation) => set({ boardOrientation }),
    }),
    { name: 'caissaxai-settings' }
  )
);
