import type { ProviderInfo } from '../api/api';

interface ModelPickerProps {
  providers: ProviderInfo[];
  selectedProvider: string | null;
  selectedModel: string | null;
  onSelectProvider: (providerId: string) => void;
  onSelectModel: (model: string) => void;
}

/**
 * Compact two-dropdown control for choosing which LLM answers the next message.
 * The left dropdown picks the backend (Groq, OpenAI, Anthropic, a local model);
 * the right one picks a specific model within that backend. Whatever is selected
 * here is sent along with the next message, so different branches of the
 * conversation tree can be answered by different models.
 */
export function ModelPicker({
  providers,
  selectedProvider,
  selectedModel,
  onSelectProvider,
  onSelectModel
}: ModelPickerProps) {
  if (providers.length === 0) return null;

  const current = providers.find((p) => p.id === selectedProvider);
  const suggested = current?.suggestedModels ?? [];
  // Always include the currently-selected model in the list, even if it is not
  // one of the provider's suggestions (the backend accepts any model name).
  const modelOptions =
    selectedModel && !suggested.includes(selectedModel)
      ? [selectedModel, ...suggested]
      : suggested;

  const selectClass =
    'bg-gray-900 border border-gray-800 rounded-md px-2 py-1 text-[11px] text-gray-200 ' +
    'focus:outline-none focus:ring-1 focus:ring-emerald-600/50 hover:border-gray-700 ' +
    'cursor-pointer max-w-[180px] truncate';

  return (
    <div className="max-w-2xl mx-auto mb-2 flex items-center gap-2 text-[11px] text-gray-500">
      <span className="text-gray-600">Answer with</span>

      <select
        value={selectedProvider ?? ''}
        onChange={(e) => onSelectProvider(e.target.value)}
        className={selectClass}
        title="Choose which LLM backend answers"
      >
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.id}
            {p.configured ? '' : ' (no key)'}
          </option>
        ))}
      </select>

      <span className="text-gray-700">/</span>

      <select
        value={selectedModel ?? ''}
        onChange={(e) => onSelectModel(e.target.value)}
        className={selectClass}
        title="Choose the model within this backend"
      >
        {modelOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
