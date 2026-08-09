'use client';

import { useEffect, useState } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { ChessboardContainer } from '@/components/board/ChessboardContainer';
import { EvalBar } from '@/components/board/EvalBar';
import { PlayerHeader } from '@/components/game/PlayerHeader';
import { MoveHistoryTable } from '@/components/game/MoveHistoryTable';
import { GameControls } from '@/components/game/GameControls';
import { NarrativePanel } from '@/components/commentary/NarrativePanel';
import { ThreatList } from '@/components/commentary/ThreatList';
import { CoachChatDrawer } from '@/components/commentary/CoachChatDrawer';
import { EvalChart } from '@/components/review/EvalChart';
import { AccuracySummary } from '@/components/review/AccuracySummary';
import { PgnImportModal } from '@/components/review/PgnImportModal';
import { ExportDialog } from '@/components/review/ExportDialog';
import { ProviderSettingsModal } from '@/components/settings/ProviderSettingsModal';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Gamepad2, Bot, FileSearch, Settings2, Volume2, VolumeX,
  Sun, Moon, RotateCcw, Crown, Zap,
} from 'lucide-react';
import { toast } from 'sonner';

const ELO_TIERS = [800, 1200, 1500, 1800, 2200, 2800];

export default function Home() {
  const mode = useGameStore((s) => s.mode);
  const setMode = useGameStore((s) => s.setMode);
  const playerColor = useGameStore((s) => s.playerColor);
  const setPlayerColor = useGameStore((s) => s.setPlayerColor);
  const aiPlayElo = useGameStore((s) => s.aiPlayElo);
  const setAiPlayElo = useGameStore((s) => s.setAiPlayElo);
  const coachElo = useGameStore((s) => s.coachElo);
  const setCoachElo = useGameStore((s) => s.setCoachElo);
  const autoPlaySpeedMs = useGameStore((s) => s.autoPlaySpeedMs);
  const setAutoPlaySpeedMs = useGameStore((s) => s.setAutoPlaySpeedMs);
  const resetGame = useGameStore((s) => s.resetGame);
  const startSelfPlay = useGameStore((s) => s.startSelfPlay);
  const gameResult = useGameStore((s) => s.gameResult);
  const moveHistory = useGameStore((s) => s.moveHistory);

  const theme = useSettingsStore((s) => s.theme);
  const toggleTheme = useSettingsStore((s) => s.toggleTheme);
  const soundEnabled = useSettingsStore((s) => s.soundEnabled);
  const setSoundEnabled = useSettingsStore((s) => s.setSoundEnabled);
  const boardOrientation = useSettingsStore((s) => s.boardOrientation);
  const setBoardOrientation = useSettingsStore((s) => s.setBoardOrientation);

  // Apply theme class to <html>
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Show result toast when game ends
  useEffect(() => {
    if (gameResult) {
      toast.success(`Game Over: ${gameResult}`, { duration: 5000 });
    }
  }, [gameResult]);

  const handleModeChange = (newMode: typeof mode) => {
    setMode(newMode);
    resetGame();
    if (newMode === 'SIMULATE') {
      setBoardOrientation('white');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="sticky top-0 z-30 backdrop-blur bg-slate-950/80 border-b border-slate-800">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-amber-500 to-rose-600 flex items-center justify-center shadow-lg">
              <Crown className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">CaissaXAI</h1>
              <p className="text-[10px] text-slate-400 uppercase tracking-wider">Symbolic Chess Intelligence</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={soundEnabled ? 'outline' : 'ghost'}
              size="icon"
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? 'Sound on' : 'Sound off'}
            >
              {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              title="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <ProviderSettingsModal />
            <PgnImportModal />
            <ExportDialog />
          </div>
        </div>
      </header>

      {/* Main grid */}
      <main className="flex-1 container mx-auto px-4 py-6">
        {/* Mode tabs */}
        <Tabs value={mode} onValueChange={(v) => handleModeChange(v as any)} className="mb-6">
          <TabsList className="grid w-full max-w-2xl grid-cols-3 bg-slate-800/50">
            <TabsTrigger value="HUMAN_VS_AI" className="data-[state=active]:bg-slate-700">
              <Gamepad2 className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">Play vs AI</span>
              <span className="sm:hidden">Play</span>
            </TabsTrigger>
            <TabsTrigger value="SIMULATE" className="data-[state=active]:bg-slate-700">
              <Bot className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">AI vs AI</span>
              <span className="sm:hidden">Sim</span>
            </TabsTrigger>
            <TabsTrigger value="IMPORT_REVIEW" className="data-[state=active]:bg-slate-700">
              <FileSearch className="h-3.5 w-3.5 mr-1" />
              <span className="hidden sm:inline">Review</span>
              <span className="sm:hidden">Review</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="HUMAN_VS_AI" className="mt-4">
            <ModeAConfig
              playerColor={playerColor}
              setPlayerColor={setPlayerColor}
              aiPlayElo={aiPlayElo}
              setAiPlayElo={setAiPlayElo}
              coachElo={coachElo}
              setCoachElo={setCoachElo}
            />
          </TabsContent>

          <TabsContent value="SIMULATE" className="mt-4">
            <ModeBConfig
              aiPlayElo={aiPlayElo}
              setAiPlayElo={setAiPlayElo}
              coachElo={coachElo}
              setCoachElo={setCoachElo}
              autoPlaySpeedMs={autoPlaySpeedMs}
              setAutoPlaySpeedMs={setAutoPlaySpeedMs}
              startSelfPlay={startSelfPlay}
            />
          </TabsContent>

          <TabsContent value="IMPORT_REVIEW" className="mt-4">
            <div className="text-sm text-slate-400 mb-3">
              Import a PGN game above (or paste via the Import PGN button) to begin a full game review with classification badges, eval chart, and accuracy summary.
            </div>
          </TabsContent>
        </Tabs>

        {/* Review summary (only in review mode) */}
        {mode === 'IMPORT_REVIEW' && moveHistory.length > 0 && (
          <div className="mb-6">
            <AccuracySummary />
          </div>
        )}

        {/* Game area */}
        <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-6">
          {/* Left column: board + eval bar */}
          <div className="flex flex-col items-center gap-3">
            {/* Top player (opponent) */}
            <div className="w-full max-w-[480px]">
              <PlayerHeader color={playerColor === 'white' ? 'black' : 'white'} />
            </div>

            {/* Eval bar + board */}
            <div className="flex gap-2 items-stretch">
              <EvalBar height={480} width={28} />
              <ChessboardContainer size={480} />
            </div>

            {/* Bottom player (you) */}
            <div className="w-full max-w-[480px]">
              <PlayerHeader color={playerColor} />
            </div>

            {/* Game controls */}
            <GameControls />

            {/* Game result banner */}
            {gameResult && (
              <div className="w-full max-w-[480px] mt-2 p-3 rounded-lg bg-slate-800 border border-slate-700 text-center">
                <div className="text-xs uppercase tracking-wider text-slate-400 mb-1">Game Result</div>
                <div className="text-2xl font-bold text-amber-400">{gameResult}</div>
              </div>
            )}
          </div>

          {/* Right column: analysis panels */}
          <div className="flex flex-col gap-4 min-w-0">
            <NarrativePanel />
            <ThreatList />

            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Move History</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <MoveHistoryTable />
              </CardContent>
            </Card>

            {mode === 'IMPORT_REVIEW' && moveHistory.length > 0 && (
              <EvalChart />
            )}

            <CoachChatDrawer />
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800 bg-slate-950/80">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between text-xs text-slate-500 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Zap className="h-3 w-3 text-amber-400" />
            <span>CaissaXAI v1.0 — Deterministic symbolic feature extraction + LLM narration</span>
          </div>
          <div className="flex items-center gap-3">
            <span>Move: ← →  •  Home/End: jump</span>
            <Badge variant="outline" className="text-[10px]">
              Layer 2 active
            </Badge>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mode A config: Human vs AI
// ---------------------------------------------------------------------------
function ModeAConfig({
  playerColor, setPlayerColor,
  aiPlayElo, setAiPlayElo,
  coachElo, setCoachElo,
}: {
  playerColor: 'white' | 'black';
  setPlayerColor: (c: 'white' | 'black') => void;
  aiPlayElo: number;
  setAiPlayElo: (e: number) => void;
  coachElo: number;
  setCoachElo: (e: number) => void;
}) {
  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <Label className="text-xs text-slate-400">Your Color</Label>
          <Select value={playerColor} onValueChange={(v) => setPlayerColor(v as any)}>
            <SelectTrigger className="mt-1 bg-slate-900 border-slate-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700">
              <SelectItem value="white">♔ White</SelectItem>
              <SelectItem value="black">♚ Black</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-slate-400">AI Play Strength: {aiPlayElo} Elo</Label>
          <Slider
            value={[aiPlayElo]}
            onValueChange={(v) => setAiPlayElo(v[0])}
            min={800}
            max={2800}
            step={100}
            className="mt-3"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-400">Coach Explanation Level</Label>
          <Select value={String(coachElo)} onValueChange={(v) => setCoachElo(Number(v))}>
            <SelectTrigger className="mt-1 bg-slate-900 border-slate-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700">
              {ELO_TIERS.slice(0, 4).map(e => (
                <SelectItem key={e} value={String(e)}>{e} Elo</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Mode B config: AI vs AI
// ---------------------------------------------------------------------------
function ModeBConfig({
  aiPlayElo, setAiPlayElo,
  coachElo, setCoachElo,
  autoPlaySpeedMs, setAutoPlaySpeedMs,
  startSelfPlay,
}: {
  aiPlayElo: number;
  setAiPlayElo: (e: number) => void;
  coachElo: number;
  setCoachElo: (e: number) => void;
  autoPlaySpeedMs: number;
  setAutoPlaySpeedMs: (ms: number) => void;
  startSelfPlay: () => Promise<void>;
}) {
  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div>
          <Label className="text-xs text-slate-400">White AI: {aiPlayElo} Elo</Label>
          <Slider
            value={[aiPlayElo]}
            onValueChange={(v) => setAiPlayElo(v[0])}
            min={800}
            max={2800}
            step={100}
            className="mt-3"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-400">Black AI: {aiPlayElo} Elo</Label>
          <Slider
            value={[aiPlayElo]}
            onValueChange={(v) => setAiPlayElo(v[0])}
            min={800}
            max={2800}
            step={100}
            className="mt-3"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-400">Auto-play: {(autoPlaySpeedMs / 1000).toFixed(1)}s/move</Label>
          <Slider
            value={[autoPlaySpeedMs]}
            onValueChange={(v) => setAutoPlaySpeedMs(v[0])}
            min={500}
            max={5000}
            step={250}
            className="mt-3"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-400">Commentary Level</Label>
          <Select value={String(coachElo)} onValueChange={(v) => setCoachElo(Number(v))}>
            <SelectTrigger className="mt-1 bg-slate-900 border-slate-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-900 border-slate-700">
              {ELO_TIERS.slice(0, 4).map(e => (
                <SelectItem key={e} value={String(e)}>{e} Elo</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
