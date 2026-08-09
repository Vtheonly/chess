// ProviderSettingsModal — multi-LLM gateway settings, key vault, test connection.

'use client';

import { useState } from 'react';
import { useProviderStore } from '@/store/useProviderStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Eye, EyeOff, Zap, Loader2, CheckCircle2, XCircle, Settings2, FlaskConical } from 'lucide-react';
import { PROVIDER_META, type ProviderID } from '@/types/chess';
import { toast } from 'sonner';

const PROVIDER_IDS: ProviderID[] = ['groq', 'openrouter', 'google_gemini', 'openai', 'anthropic'];

export function ProviderSettingsModal() {
  const [open, setOpen] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<Set<ProviderID>>(new Set());
  const activeProvider = useProviderStore((s) => s.activeProvider);
  const providers = useProviderStore((s) => s.providers);
  const setActiveProvider = useProviderStore((s) => s.setActiveProvider);
  const setProviderKey = useProviderStore((s) => s.setProviderKey);
  const setProviderModel = useProviderStore((s) => s.setProviderModel);
  const testProviderConnection = useProviderStore((s) => s.testProviderConnection);
  const testAllProviders = useProviderStore((s) => s.testAllProviders);

  const toggleKeyVisibility = (id: ProviderID) => {
    setVisibleKeys(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleTest = async (id: ProviderID) => {
    const ok = await testProviderConnection(id);
    if (ok) toast.success(`${PROVIDER_META[id].label} connection verified`);
    else toast.error(`${PROVIDER_META[id].label} test failed`);
  };

  const handleTestAll = async () => {
    toast.info('Testing all configured providers...');
    await testAllProviders();
    toast.success('All tests complete');
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 className="h-4 w-4 mr-1" />
          AI Providers
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-3xl bg-slate-900 border-slate-700 max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-slate-100 flex items-center gap-2">
            <Zap className="h-5 w-5 text-amber-400" />
            AI Provider Settings & Key Vault
          </DialogTitle>
        </DialogHeader>

        <div className="px-1 pb-2">
          <Label className="text-xs uppercase tracking-wider text-slate-500">
            Active Provider for Commentary
          </Label>
          <Select value={activeProvider} onValueChange={(v) => setActiveProvider(v as ProviderID)}>
            <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              {PROVIDER_IDS.map(id => (
                <SelectItem key={id} value={id}>
                  {PROVIDER_META[id].emoji} {PROVIDER_META[id].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ScrollArea className="flex-1 pr-1">
          <div className="space-y-3">
            {PROVIDER_IDS.map(id => {
              const meta = PROVIDER_META[id];
              const cfg = providers[id];
              const isActive = activeProvider === id;
              const isVisible = visibleKeys.has(id);
              return (
                <div
                  key={id}
                  className={`rounded-lg border p-4 transition-colors ${
                    isActive
                      ? 'border-amber-500/50 bg-amber-500/5'
                      : 'border-slate-700 bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{meta.emoji}</span>
                      <div>
                        <div className="text-sm font-medium text-slate-100">{meta.label}</div>
                        <div className="text-xs text-slate-500">
                          {cfg.selectedModel}
                        </div>
                      </div>
                    </div>
                    <StatusBadge status={cfg.status} latencyMs={cfg.latencyMs} />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-slate-500">API Key</Label>
                      <div className="flex gap-1 mt-1">
                        <Input
                          type={isVisible ? 'text' : 'password'}
                          value={cfg.apiKey}
                          onChange={(e) => setProviderKey(id, e.target.value)}
                          placeholder={meta.placeholder}
                          className="bg-slate-800 border-slate-700 font-mono text-xs"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => toggleKeyVisibility(id)}
                          className="shrink-0"
                        >
                          {isVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-500">Model</Label>
                      <Select value={cfg.selectedModel} onValueChange={(v) => setProviderModel(id, v)}>
                        <SelectTrigger className="mt-1 bg-slate-800 border-slate-700">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-700">
                          {meta.models.map(m => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between">
                    {cfg.errorMessage && (
                      <span className="text-xs text-red-400">{cfg.errorMessage}</span>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTest(id)}
                      disabled={!cfg.apiKey || cfg.status === 'TESTING'}
                      className="ml-auto"
                    >
                      {cfg.status === 'TESTING' ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                      ) : (
                        <FlaskConical className="h-3.5 w-3.5 mr-1" />
                      )}
                      Test Connection
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="mt-3">
          <Button variant="outline" onClick={handleTestAll}>
            <FlaskConical className="h-4 w-4 mr-1" />
            Test All Integrations
          </Button>
          <Button onClick={() => setOpen(false)}>Save & Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusBadge({ status, latencyMs }: { status: string; latencyMs?: number }) {
  if (status === 'HEALTHY') {
    return (
      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/50 hover:bg-emerald-500/30">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        {latencyMs ? `${Math.round(latencyMs)}ms` : 'Healthy'}
      </Badge>
    );
  }
  if (status === 'ERROR') {
    return (
      <Badge variant="destructive" className="bg-red-500/20 text-red-300 border-red-500/50">
        <XCircle className="h-3 w-3 mr-1" />
        Error
      </Badge>
    );
  }
  if (status === 'TESTING') {
    return (
      <Badge variant="outline" className="bg-amber-500/20 text-amber-300 border-amber-500/50">
        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        Testing
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="bg-slate-700/50 text-slate-400 border-slate-600">
      Untested
    </Badge>
  );
}
