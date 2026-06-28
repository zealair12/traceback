import { ChevronDown } from 'lucide-react';
import type { ProviderInfo } from '@traceback/shared';

interface ModelPickerProps {
  providers: ProviderInfo[];
  selectedProvider: string | null;
  selectedModel: string | null;
  keyedProviders?: Set<string>;
  onSelect: (providerId: string, model: string) => void;
}

const providerLabel: Record<string, string> = {
  groq: 'Groq',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  local: 'Local',
  auto: 'Auto'
};

export function ModelPicker({
  providers,
  selectedProvider,
  selectedModel,
  keyedProviders,
  onSelect
}: ModelPickerProps) {
  if (providers.length === 0) return null;

  const isAuto = !selectedProvider || selectedProvider === 'auto';
  const value = isAuto ? 'auto:auto' : `${selectedProvider}:${selectedModel}`;

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const [pid, ...rest] = e.target.value.split(':');
    onSelect(pid, rest.join(':'));
  };

  return (
    <div className="relative flex items-center">
      <select
        value={value}
        onChange={handleChange}
        className="appearance-none pl-2 pr-6 py-1 rounded-lg text-sm text-gray-400 hover:text-gray-100 bg-transparent hover:bg-gray-800/60 transition-colors cursor-pointer focus:outline-none max-w-[200px]"
      >
        <option value="auto:auto">Auto</option>
        {providers
          // Only list providers the user can actually use: the server's
          // configured backend (Groq) or one they added a key for. Hide "local"
          // (needs a local server that usually isn't running) and any
          // unconfigured backend, so the menu isn't full of dead options.
          .filter((p) => p.id !== 'local' && (p.configured || keyedProviders?.has(p.id)))
          .map((p) => {
            const label = providerLabel[p.id] ?? p.id;
            const models = p.suggestedModels ?? [];
            if (models.length === 0) return null;
            return models.map((model) => (
              <option key={`${p.id}:${model}`} value={`${p.id}:${model}`}>
                {label} · {model}
              </option>
            ));
          })}
      </select>
      <ChevronDown
        size={12}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-50 text-gray-400"
      />
    </div>
  );
}
