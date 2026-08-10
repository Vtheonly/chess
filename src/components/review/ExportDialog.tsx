// ExportDialog — exports the analyzed game as annotated PGN with NAG symbols.

'use client';

import { useState } from 'react';
import { Chess } from 'chess.js';
import { useGameStore } from '@/store/useGameStore';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Download, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { CLASSIFICATION_META, type MoveClassification } from '@/types/chess';

const NAG_CODES: Partial<Record<MoveClassification, string>> = {
  BRILLIANT: '$3',
  GREAT: '$4',
  BEST: '$1',
  INACCURACY: '$6',
  MISTAKE: '$2',
  BLUNDER: '$4',
};

export function ExportDialog() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const moveHistory = useGameStore((s) => s.moveHistory);
  const gameResult = useGameStore((s) => s.gameResult);

  const annotatedPgn = buildAnnotatedPgn(moveHistory, gameResult);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(annotatedPgn);
      setCopied(true);
      toast.success('PGN copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([annotatedPgn], { type: 'application/x-chess-pgn' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'caissaxai_annotated.pgn';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('PGN downloaded');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-1" />
          Export PGN
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Annotated PGN Export</DialogTitle>
        </DialogHeader>
        <Textarea
          readOnly
          value={annotatedPgn}
          className="min-h-[400px] font-mono text-xs bg-slate-800 border-slate-700"
        />
        <DialogFooter>
          <Button variant="outline" onClick={handleCopy}>
            {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            Copy
          </Button>
          <Button onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildAnnotatedPgn(
  moves: ReturnType<typeof useGameStore.getState>['moveHistory'],
  result: string | null,
): string {
  const headers = [
    '[Event "CaissaXAI Analysis"]',
    '[Site "caissaxai"]',
    `[Date "${new Date().toISOString().slice(0, 10).replace(/-/g, '.')}"]`,
    '[Round "?"]',
    '[White "?"]',
    '[Black "?"]',
    `[Result "${result || '*'}"]`,
    '[Annotator "CaissaXAI"]',
  ];

  const validationBoard = new Chess();
  const tokens: string[] = [];

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    // Replay move on validation board to guarantee move legality
    let executedMove;
    try {
      executedMove = validationBoard.move(m.uci);
    } catch {
      // If move.uci fails, try san
      try {
        executedMove = validationBoard.move(m.san);
      } catch {
        // Illegal move encountered in history record - halt PGN here to maintain PGN validity
        break;
      }
    }
    if (!executedMove) break;

    const san = executedMove.san;
    const moveNum = Math.floor(i / 2) + 1;
    const isWhite = i % 2 === 0;

    let token = isWhite ? `${moveNum}. ${san}` : `${san}`;
    const nag = m.classification ? NAG_CODES[m.classification] : '';
    const comment = m.commentary ? ` { [CaissaXAI]: ${m.commentary.replace(/[{}]/g, '').trim()} }` : '';

    if (nag) token += ` ${nag}`;
    if (comment) token += comment;

    tokens.push(token);
  }

  const body = formatMovesIntoPairs(tokens);
  return `${headers.join('\n')}\n\n${body} ${result || '*'}`;
}

function formatMovesIntoPairs(tokens: string[]): string {
  const out: string[] = [];
  let line = '';
  for (let i = 0; i < tokens.length; i++) {
    if (line) line += ' ';
    line += tokens[i];
    if (line.length > 70) {
      out.push(line);
      line = '';
    }
  }
  if (line) out.push(line);
  return out.join('\n');
}
