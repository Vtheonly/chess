// CoachChatDrawer — sliding drawer for "Ask the Coach" follow-up questions.

'use client';

import { useState } from 'react';
import { useGameStore } from '@/store/useGameStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageCircle, Send, Loader2 } from 'lucide-react';

interface Message {
  role: 'user' | 'coach';
  content: string;
}

export function CoachChatDrawer() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const askCoach = useGameStore((s) => s.askCoach);
  const fen = useGameStore((s) => s.fen);

  const handleAsk = async () => {
    if (!input.trim() || isLoading) return;
    const question = input.trim();
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setInput('');
    setIsLoading(true);
    try {
      const answer = await askCoach(question);
      setMessages(prev => [...prev, { role: 'coach', content: answer }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'coach', content: 'Sorry, I could not analyze that. Please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <MessageCircle className="h-4 w-4 mr-1" />
          Ask Coach
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col bg-slate-900 border-slate-700">
        <SheetHeader>
          <SheetTitle className="text-slate-100">Coach Chat</SheetTitle>
        </SheetHeader>

        <div className="px-4 pb-2 text-xs text-slate-500 font-mono border-b border-slate-800">
          FEN: {fen.slice(0, 60)}...
        </div>

        <ScrollArea className="flex-1 px-4">
          <div className="space-y-3 py-4">
            {messages.length === 0 && (
              <div className="text-center text-slate-500 text-sm py-8">
                Ask me anything about the current position.
                <br />
                e.g. "Why can't I take on d5?" or "What's the plan?"
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-100'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-800 rounded-lg px-3 py-2 text-sm text-slate-400 flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking...
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-slate-800 flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
            placeholder="Ask a question..."
            disabled={isLoading}
            className="bg-slate-800 border-slate-700"
          />
          <Button onClick={handleAsk} disabled={isLoading || !input.trim()} size="icon">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
