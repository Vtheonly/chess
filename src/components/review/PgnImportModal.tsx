// PgnImportModal — modal for pasting PGN text or uploading a .pgn file.

'use client';

import { useState, useRef } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Upload, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const SAMPLE_PGN = `[Event "Italian Game"]
[Site "CaissaXAI Demo"]
[Date "2026.08.10"]
[White "Gambit"]
[Black "Defense"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 Bc5 5. Nxf7 *`;

export function PgnImportModal() {
  const [open, setOpen] = useState(false);
  const [pgnText, setPgnText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importPgn = useGameStore((s) => s.importPgn);
  const resetGame = useGameStore((s) => s.resetGame);

  const handleImport = async () => {
    if (!pgnText.trim()) {
      toast.error('Please paste a PGN first');
      return;
    }
    setIsLoading(true);
    try {
      resetGame();
      await importPgn(pgnText);
      toast.success('Game imported successfully');
      setOpen(false);
      setPgnText('');
    } catch (err: any) {
      toast.error(`Import failed: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setPgnText(text);
    };
    reader.readAsText(file);
  };

  const handleLoadSample = () => {
    setPgnText(SAMPLE_PGN);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Upload className="h-4 w-4 mr-1" />
          Import PGN
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl bg-slate-900 border-slate-700">
        <DialogHeader>
          <DialogTitle className="text-slate-100 flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Import PGN Game
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5 mr-1" />
              Upload .pgn file
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pgn,.txt"
              className="hidden"
              onChange={handleFileUpload}
            />
            <Button size="sm" variant="ghost" onClick={handleLoadSample}>
              Load Sample
            </Button>
          </div>

          <Textarea
            value={pgnText}
            onChange={(e) => setPgnText(e.target.value)}
            placeholder="Paste PGN text here..."
            className="min-h-[300px] font-mono text-xs bg-slate-800 border-slate-700"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={isLoading || !pgnText.trim()}>
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Analyzing...
              </>
            ) : (
              'Analyze Game'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
