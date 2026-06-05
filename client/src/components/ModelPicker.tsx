import type { ProviderInfo } from '../api/api';

interface ModelPickerProps {
  providers: ProviderInfo[];
  selectedProvider: string | null;
  selectedModel: string | null;
  // Called with the backend id and model name when the user picks one.
  onSelect: (providerId: string, model: string) => void;
}

// Encode a provider+model pair into a single <option> value, and back again.
// Providers and models never contain this separator.
const SEP = '::';
const encode = (providerId: string, model: string) => `${providerId}${SEP}${model}`;

/**
 * A single dropdown for choosing which LLM answers the next message. Every model
 * across every backend is listed in one menu, grouped by backend (Groq, OpenAI,
 * Anthropic, local). Picking one sets both the backend and the model at once, so
 * different branches of the conversation tree can be answered by different models.
 */
export function ModelPicker({
  providers,
  selectedProvider,
  selectedModel,
  onSelect
}: ModelPickerProps) {
  if (providers.length === 0) return null;

  const currentValue =
    selectedProvider && selectedModel ? encode(selectedProvider, selectedModel) : '';

  // If the current model is not among a provider's suggestions, still show it so
  // the dropdown can reflect the active choice.
  const extraForCurrent =
    selectedProvider &&
    selectedModel &&
    !providers
      .find((p) => p.id === selectedProvider)
      ?.suggestedModels.includes(selectedModel);

  return (
    <div className="max-w-2xl mx-auto mb-2 flex items-center gap-2 text-[11px] text-gray-500">
      <span className="text-gray-600">Answer with</span>
      <select
        value={currentValue}
        onChange={(e) => {
          const [providerId, model] = e.target.value.split(SEP);
          onSelect(providerId, model);
        }}
        className="bg-gray-900 border border-gray-800 rounded-md px-2 py-1 text-[11px] text-gray-200 focus:outline-none focus:ring-1 focus:ring-emerald-600/50 hover:border-gray-700 cursor-pointer max-w-[260px] truncate"
        title="Choose which model answers the next message"
      >
        {providers.map((p) => {
          const models = [...p.suggestedModels];
          if (extraForCurrent && p.id === selectedProvider && !models.includes(selectedModel!)) {
            models.unshift(selectedModel!);
          }
          return (
            <optgroup key={p.id} label={p.configured ? p.id : `${p.id} (no key)`}>
              {models.map((m) => (
                <option key={`${p.id}${SEP}${m}`} value={encode(p.id, m)}>
                  {p.id} / {m}
                </option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </div>
  );
}
