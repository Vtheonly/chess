// Game store — central Zustand state for the entire CaissaXAI UI.
// Mirrors the spec's `useGameStore.ts` (§3.2).

'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Chess } from 'chess.js';
import type { ChessMove, GameMode, PlayerColor } from '@/types/chess';
import { evaluate, winChance, searchBestMove, see, pickMoveAtElo, classifyMove } from '@/lib/chess/engine';
import { buildPayload, generateNarrative } from '@/lib/chess/narrator';
import { generateTilesAndCalc, checkNarrativeAgainstTiles } from '@/lib/chess/ruleTiles';
import { useProviderStore } from './useProviderStore';

interface GameState {
  // Config
  mode: GameMode;
  playerColor: PlayerColor;
  aiPlayElo: number;
  coachElo: number;
  autoPlaySpeedMs: number;

  // Active board
  fen: string;
  moveHistory: ChessMove[];
  currentPly: number;       // -1 = position before move 1
  selectedSquare: string | null;
  legalMovesFromSelected: string[];

  // Game status
  isEngineThinking: boolean;
  isGameActive: boolean;
  isPaused: boolean;
  gameResult: string | null;

  // Visuals
  activeArrows: Array<[string, string, string]>;
  activeHighlights: Array<[string, string]>;
  lastMove: { from: string; to: string } | null;

  // ─── Dual-View: temporary (tile-hover) board overlays (spec §4) ──────────
  // When the user hovers a rule tile, we paint these on the board for
  // as long as the hover lasts.  They take precedence over `activeArrows`.
  temporaryArrows: Array<[string, string, string]>;
  temporaryHighlights: string[];
  hoveredTileId: string | null;

  // Narrative
  currentCommentary: string | null;
  isGeneratingNarrative: boolean;

  // Actions
  setMode: (mode: GameMode) => void;
  setPlayerColor: (c: PlayerColor) => void;
  setAiPlayElo: (elo: number) => void;
  setCoachElo: (elo: number) => void;
  setAutoPlaySpeedMs: (ms: number) => void;
  selectSquare: (sq: string | null) => void;
  makeMove: (uci: string) => Promise<boolean>;
  navigateToPly: (ply: number) => void;
  resetGame: () => void;
  startSelfPlay: () => Promise<void>;
  pauseSelfPlay: () => void;
  importPgn: (pgn: string) => Promise<void>;
  stepSelfPlay: () => Promise<void>;
  askCoach: (question: string) => Promise<string>;
  setArrows: (arrows: Array<[string, string, string]>) => void;
  clearArrows: () => void;
  // ─── Dual-View tile-hover actions (spec §4) ──────────────────────────────
  setTileHover: (tileId: string | null, arrows: Array<[string, string, string]>, highlights: string[]) => void;
  clearTileHover: () => void;
}

const INITIAL_FEN = new Chess().fen();

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      // Config defaults
      mode: 'HUMAN_VS_AI',
      playerColor: 'white',
      aiPlayElo: 1500,
      coachElo: 1200,
      autoPlaySpeedMs: 1500,

      // Board defaults
      fen: INITIAL_FEN,
      moveHistory: [],
      currentPly: -1,
      selectedSquare: null,
      legalMovesFromSelected: [],

      // Status defaults
      isEngineThinking: false,
      isGameActive: false,
      isPaused: false,
      gameResult: null,

      // Visual defaults
      activeArrows: [],
      activeHighlights: [],
      lastMove: null,

      // Dual-View tile-hover defaults
      temporaryArrows: [],
      temporaryHighlights: [],
      hoveredTileId: null,

      // Narrative
      currentCommentary: null,
      isGeneratingNarrative: false,

      // --- Actions ----------------------------------------------------------
      setMode: (mode) => set({ mode }),
      setPlayerColor: (playerColor) => set({ playerColor }),
      setAiPlayElo: (aiPlayElo) => set({ aiPlayElo }),
      setCoachElo: (coachElo) => set({ coachElo }),
      setAutoPlaySpeedMs: (autoPlaySpeedMs) => set({ autoPlaySpeedMs }),

      selectSquare: (sq) => {
        if (!sq) {
          set({ selectedSquare: null, legalMovesFromSelected: [] });
          return;
        }
        const chess = new Chess(get().fen);
        const piece = chess.get(sq as any);
        if (!piece || piece.color !== chess.turn()) {
          set({ selectedSquare: null, legalMovesFromSelected: [] });
          return;
        }
        const moves = chess.moves({ square: sq as any, verbose: true }) as any[];
        const targets = [...new Set(moves.map(m => m.to))];
        set({ selectedSquare: sq, legalMovesFromSelected: targets });
      },

      makeMove: async (uci) => {
        const state = get();
        const chess = new Chess(state.fen);
        let move;
        try { move = chess.move(uci); } catch { return false; }
        if (!move) return false;

        const fenBefore = state.fen;
        const fenAfter = chess.fen();
        const eBefore = evaluate(fenBefore);
        const eAfter = evaluate(fenAfter);

        const playerColor: PlayerColor = move.color === 'w' ? 'white' : 'black';
        const wcBefore = winChance(eBefore.cp, eBefore.isMate, eBefore.mateIn);
        const wcAfter = winChance(eAfter.cp, eAfter.isMate, eAfter.mateIn);
        const playerSign = playerColor === 'white' ? 1 : -1;
        const deltaW = (wcAfter - wcBefore) * playerSign;

        const best = searchBestMove(fenBefore, 1);
        const seeScore = see(fenBefore, uci);
        const isBestMove = best.bestMoveSan === move.san;
        const isSacrifice = seeScore < -150;

        const classification = classifyMove({
          isBestMove,
          isSacrifice,
          seeScore,
          deltaW,
          wBefore: playerColor === 'white' ? wcBefore : 1 - wcBefore,
          wAfter:  playerColor === 'white' ? wcAfter  : 1 - wcAfter,
          isOnlyViable: false,
        });

        // ─── Dual-View: compute concrete threats + atomic rule tiles ────────
        // (spec §3.1 — RuleTileSynthesizer port)
        const concreteThreats: Array<{ san: string; gainCp: number; target: string; piece: string }> = [];
        if (!chess.isCheckmate() && !chess.isStalemate()) {
          try {
            // Null-move proxy: toggle side via FEN to find what captures the
            // mover would have if the opponent passed.
            const fenParts = fenAfter.split(' ');
            fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w';
            fenParts[3] = '-';
            const tmpBoard = new Chess();
            tmpBoard.load(fenParts.join(' '));
            const captureMoves = tmpBoard.moves({ verbose: true }) as any[];
            for (const m of captureMoves.slice(0, 12)) {
              if (!m.captured) continue;
              const gain = see(tmpBoard.fen(), m.lan);
              if (gain >= 0) {
                concreteThreats.push({
                  san: m.san,
                  gainCp: gain,
                  target: m.to,
                  piece: m.captured,
                });
              }
            }
          } catch { /* skip */ }
        }

        // Generate atomic rule tiles + calculation breakdown.
        const { tiles, breakdown } = generateTilesAndCalc({
          fenBefore,
          fenAfter,
          moveUci: move.lan,
          moveSan: move.san,
          playerColor,
          seeScore,
          isCapture: !!move.captured,
          isCheck: chess.inCheck(),
          isCheckmate: chess.isCheckmate(),
          capturedPiece: move.captured,
          concreteThreats,
          evalBeforeCp: eBefore.cp,
          evalAfterCp: eAfter.cp,
          bestMoveSan: best.bestMoveSan,
          pvLineSan: best.pv,
        });

        const moveRecord: ChessMove = {
          ply: state.moveHistory.length,
          moveNumber: Math.floor(state.moveHistory.length / 2) + 1,
          turn: playerColor,
          san: move.san,
          uci: move.lan,
          fenBefore,
          fenAfter,
          evalCp: eAfter.cp,
          evalType: eAfter.isMate ? 'mate' : 'cp',
          winChance: wcAfter,
          bestMoveSan: best.bestMoveSan,
          classification,
          seeScore,
          isCapture: !!move.captured,
          isCheck: chess.inCheck(),
          isCheckmate: chess.isCheckmate(),
          concreteThreats,
          arrows: [[move.from, move.to, 'rgba(34, 197, 94, 0.85)']],
          atomicRuleTiles: tiles,
          calculationBreakdown: breakdown,
        };

        set({
          fen: fenAfter,
          moveHistory: [...state.moveHistory, moveRecord],
          currentPly: state.moveHistory.length,
          selectedSquare: null,
          legalMovesFromSelected: [],
          lastMove: { from: move.from, to: move.to },
          isGameActive: !chess.isGameOver(),
          gameResult: chess.isCheckmate() ? (chess.turn() === 'w' ? '0-1' : '1-0') :
                      chess.isDraw() ? '1/2-1/2' : null,
        });

        // Generate narrative (async) — passes tiles + breakdown so the LLM
        // can ground its prose in the verified symbolic facts.
        const providerState = useProviderStore.getState();
        const activeProvider = providerState.activeProvider;
        const providerConfig = providerState.providers[activeProvider];

        const finalizeNarrative = (rawCommentary: string): string => {
          // ─── Anti-hallucination filter (spec §5) ────────────────────────
          // Verify the LLM's text doesn't contradict the symbolic engine.
          const synthInput = {
            fenBefore, fenAfter, moveUci: move.lan, moveSan: move.san,
            playerColor, seeScore,
            isCapture: !!move.captured, isCheck: chess.inCheck(),
            isCheckmate: chess.isCheckmate(),
            capturedPiece: move.captured,
            concreteThreats,
            evalBeforeCp: eBefore.cp, evalAfterCp: eAfter.cp,
          };
          const check = checkNarrativeAgainstTiles(rawCommentary, tiles, synthInput);
          if (check.passed) {
            return rawCommentary;
          }
          // If the LLM hallucinated, append a system-generated correction
          // notice so the user sees BOTH the LLM claim and the truth.
          const correction = `\n\n⚠️ Verification notice: ${check.violations.join(' ')}`;
          return rawCommentary + correction;
        };

        if (providerConfig?.apiKey) {
          set({ isGeneratingNarrative: true });
          try {
            const payload = buildPayload({
              fenBefore, moveUci: move.lan, moveSan: move.san,
              playerColor, targetElo: state.coachElo,
              pvContinuation: best.pv,
            });
            // Inject the tiles into the payload so the LLM sees them.
            (payload as any).atomic_rule_tiles = tiles;
            (payload as any).calculation_breakdown = breakdown;
            const result = await generateNarrative(payload, {
              provider: activeProvider,
              apiKey: providerConfig.apiKey,
              model: providerConfig.selectedModel,
            });
            const finalized = finalizeNarrative(result.commentary);
            // Patch the move record with the finalized commentary.
            const updatedHistory = [...get().moveHistory];
            if (updatedHistory[moveRecord.ply]) {
              updatedHistory[moveRecord.ply] = {
                ...updatedHistory[moveRecord.ply],
                commentary: finalized,
              };
            }
            set({
              currentCommentary: finalized,
              isGeneratingNarrative: false,
              moveHistory: updatedHistory,
            });
          } catch {
            set({ isGeneratingNarrative: false });
          }
        } else {
          // Use local LLM (no API key)
          set({ isGeneratingNarrative: true });
          try {
            const payload = buildPayload({
              fenBefore, moveUci: move.lan, moveSan: move.san,
              playerColor, targetElo: state.coachElo,
              pvContinuation: best.pv,
            });
            (payload as any).atomic_rule_tiles = tiles;
            (payload as any).calculation_breakdown = breakdown;
            const result = await generateNarrative(payload);
            const finalized = finalizeNarrative(result.commentary);
            const updatedHistory = [...get().moveHistory];
            if (updatedHistory[moveRecord.ply]) {
              updatedHistory[moveRecord.ply] = {
                ...updatedHistory[moveRecord.ply],
                commentary: finalized,
              };
            }
            set({
              currentCommentary: finalized,
              isGeneratingNarrative: false,
              moveHistory: updatedHistory,
            });
          } catch {
            set({ isGeneratingNarrative: false });
          }
        }

        // If Mode A and opponent's turn, schedule AI move
        if (state.mode === 'HUMAN_VS_AI' && !chess.isGameOver() && state.playerColor !== (chess.turn() === 'w' ? 'white' : 'black')) {
          setTimeout(() => {
            const s2 = get();
            const chess2 = new Chess(s2.fen);
            const aiMove = pickMoveAtElo(s2.fen, s2.aiPlayElo);
            if (aiMove) {
              get().makeMove(aiMove.lan);
            }
          }, 300);
        }

        return true;
      },

      navigateToPly: (ply) => {
        const state = get();
        if (ply < -1 || ply >= state.moveHistory.length) return;
        const chess = new Chess();
        for (let i = 0; i <= ply; i++) {
          chess.move(state.moveHistory[i].uci);
        }
        const move = ply >= 0 ? state.moveHistory[ply] : null;
        set({
          currentPly: ply,
          fen: ply === -1 ? new Chess().fen() : chess.fen(),
          lastMove: move ? { from: move.uci.slice(0, 2), to: move.uci.slice(2, 4) } : null,
          currentCommentary: move?.commentary || null,
        });
      },

      resetGame: () => {
        set({
          fen: INITIAL_FEN,
          moveHistory: [],
          currentPly: -1,
          selectedSquare: null,
          legalMovesFromSelected: [],
          isEngineThinking: false,
          isGameActive: false,
          isPaused: false,
          gameResult: null,
          activeArrows: [],
          activeHighlights: [],
          lastMove: null,
          temporaryArrows: [],
          temporaryHighlights: [],
          hoveredTileId: null,
          currentCommentary: null,
          isGeneratingNarrative: false,
        });
      },

      startSelfPlay: async () => {
        set({ isGameActive: true, isPaused: false });
        // Kick off the loop
        get().stepSelfPlay();
      },

      pauseSelfPlay: () => set({ isPaused: true }),

      stepSelfPlay: async () => {
        const state = get();
        if (state.isPaused || state.gameResult) return;
        const chess = new Chess(state.fen);
        if (chess.isGameOver()) {
          set({
            gameResult: chess.isCheckmate() ? (chess.turn() === 'w' ? '0-1' : '1-0') : '1/2-1/2',
            isGameActive: false,
          });
          return;
        }
        const turn: PlayerColor = chess.turn() === 'w' ? 'white' : 'black';
        const elo = turn === 'white' ? state.aiPlayElo : state.aiPlayElo; // could differentiate
        const move = pickMoveAtElo(state.fen, elo);
        if (move) {
          await get().makeMove(move.lan);
        }
        // Schedule next step
        if (!get().isPaused && !get().gameResult) {
          setTimeout(() => get().stepSelfPlay(), state.autoPlaySpeedMs);
        }
      },

      importPgn: async (pgn) => {
        const { parsePgn } = await import('@/lib/chess/engine');
        const parsed = parsePgn(pgn);
        if (!parsed) {
          throw new Error('Invalid PGN — could not parse');
        }
        // Reset and replay
        const chess = new Chess();
        const records: ChessMove[] = [];
        for (const san of parsed.sans) {
          const fenBefore = chess.fen();
          let mv;
          try { mv = chess.move(san); } catch { break; }
          if (!mv) break;
          const fenAfter = chess.fen();
          const eBefore = evaluate(fenBefore);
          const eAfter = evaluate(fenAfter);
          const playerColor: PlayerColor = mv.color === 'w' ? 'white' : 'black';
          const wcBefore = winChance(eBefore.cp, eBefore.isMate, eBefore.mateIn);
          const wcAfter = winChance(eAfter.cp, eAfter.isMate, eAfter.mateIn);
          const playerSign = playerColor === 'white' ? 1 : -1;
          const deltaW = (wcAfter - wcBefore) * playerSign;
          const best = searchBestMove(fenBefore, 1);
          const seeScore = see(fenBefore, mv.lan);
          const isBestMove = best.bestMoveSan === mv.san;
          const isSacrifice = seeScore < -150;
          const classification = classifyMove({
            isBestMove, isSacrifice, seeScore, deltaW,
            wBefore: playerColor === 'white' ? wcBefore : 1 - wcBefore,
            wAfter:  playerColor === 'white' ? wcAfter  : 1 - wcAfter,
            isOnlyViable: false,
          });

          // ─── Dual-View: generate atomic rule tiles + breakdown ──────────
          const threats: Array<{ san: string; gainCp: number; target: string; piece: string }> = [];
          if (!chess.isCheckmate() && !chess.isStalemate()) {
            try {
              const fenParts = fenAfter.split(' ');
              fenParts[1] = fenParts[1] === 'w' ? 'b' : 'w';
              fenParts[3] = '-';
              const tmpBoard = new Chess();
              tmpBoard.load(fenParts.join(' '));
              const captureMoves = tmpBoard.moves({ verbose: true }) as any[];
              for (const m of captureMoves.slice(0, 12)) {
                if (!m.captured) continue;
                const gain = see(tmpBoard.fen(), m.lan);
                if (gain >= 0) {
                  threats.push({ san: m.san, gainCp: gain, target: m.to, piece: m.captured });
                }
              }
            } catch { /* skip */ }
          }

          const { tiles, breakdown } = generateTilesAndCalc({
            fenBefore, fenAfter,
            moveUci: mv.lan, moveSan: mv.san,
            playerColor, seeScore,
            isCapture: !!mv.captured, isCheck: chess.inCheck(),
            isCheckmate: chess.isCheckmate(),
            capturedPiece: mv.captured,
            concreteThreats: threats,
            evalBeforeCp: eBefore.cp, evalAfterCp: eAfter.cp,
            bestMoveSan: best.bestMoveSan,
            pvLineSan: best.pv,
          });

          records.push({
            ply: records.length,
            moveNumber: Math.floor(records.length / 2) + 1,
            turn: playerColor,
            san: mv.san,
            uci: mv.lan,
            fenBefore, fenAfter,
            evalCp: eAfter.cp,
            evalType: eAfter.isMate ? 'mate' : 'cp',
            winChance: wcAfter,
            bestMoveSan: best.bestMoveSan,
            classification,
            seeScore,
            isCapture: !!mv.captured,
            isCheck: chess.inCheck(),
            isCheckmate: chess.isCheckmate(),
            concreteThreats: threats,
            atomicRuleTiles: tiles,
            calculationBreakdown: breakdown,
          });
        }
        set({
          mode: 'IMPORT_REVIEW',
          moveHistory: records,
          currentPly: records.length - 1,
          fen: records.length > 0 ? records[records.length - 1].fenAfter : INITIAL_FEN,
          lastMove: records.length > 0 ? { from: records[records.length - 1].uci.slice(0,2), to: records[records.length - 1].uci.slice(2,4) } : null,
          gameResult: chess.isCheckmate() ? (chess.turn() === 'w' ? '0-1' : '1-0') :
                      chess.isDraw() ? '1/2-1/2' : null,
        });
      },

      askCoach: async (question) => {
        const state = get();
        const currentMove = state.moveHistory[state.currentPly];
        // Build a context payload and ask the LLM
        try {
          const payload = currentMove
            ? buildPayload({
                fenBefore: currentMove.fenBefore,
                moveUci: currentMove.uci,
                moveSan: currentMove.san,
                playerColor: currentMove.turn,
                targetElo: state.coachElo,
              })
            : buildPayload({
                fenBefore: state.fen,
                moveUci: 'e2e4', // placeholder
                moveSan: 'e4',
                playerColor: 'white',
                targetElo: state.coachElo,
              });
          // Append the user question
          const contextualPayload = {
            ...payload,
            user_question: question,
          };
          const providerState = useProviderStore.getState();
          const activeProvider = providerState.activeProvider;
          const providerConfig = providerState.providers[activeProvider];
          const result = await generateNarrative(contextualPayload as any, {
            provider: providerConfig?.apiKey ? activeProvider : undefined,
            apiKey: providerConfig?.apiKey,
            model: providerConfig?.selectedModel,
          });
          return result.commentary;
        } catch {
          return 'I am not able to analyze this position right now. Try rephrasing your question.';
        }
      },

      setArrows: (arrows) => set({ activeArrows: arrows }),
      clearArrows: () => set({ activeArrows: [] }),

      // ─── Dual-View tile-hover actions (spec §4) ─────────────────────────
      // When the user hovers a rule tile, set temporary board overlays that
      // take precedence over `activeArrows`.  Cleared on mouse-leave.
      setTileHover: (tileId, arrows, highlights) => set({
        hoveredTileId: tileId,
        temporaryArrows: arrows,
        temporaryHighlights: highlights,
      }),
      clearTileHover: () => set({
        hoveredTileId: null,
        temporaryArrows: [],
        temporaryHighlights: [],
      }),
    }),
    {
      name: 'caissaxai-game',
      partialize: (s) => ({
        mode: s.mode,
        playerColor: s.playerColor,
        aiPlayElo: s.aiPlayElo,
        coachElo: s.coachElo,
        autoPlaySpeedMs: s.autoPlaySpeedMs,
        moveHistory: s.moveHistory,
        currentPly: s.currentPly,
        fen: s.fen,
        gameResult: s.gameResult,
      }),
    }
  )
);
