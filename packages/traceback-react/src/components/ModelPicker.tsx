import type { ProviderInfo } from '@traceback/shared';

interface ModelPickerProps {
  providers: ProviderInfo[];
  selectedProvider: string | null;
  selectedModel: string | null;
  // Backends the user has supplied their own key for (so they count as usable
  // even if the server has no key for them).
  keyedProviders?: Set<string>;
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
  keyedProviders,
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

  // A compact pill that sits inside the input frame's controls row (the
  // editor-style placement). Shows just the model; the menu stays grouped by
  // backend.
  return (
    <select
      value={currentValue}
      onChange={(e) => {
        const [providerId, model] = e.target.value.split(SEP);
        onSelect(providerId, model);
      }}
      className="bg-gray-900/70 border border-gray-800 rounded-full px-2.5 py-1 text-[11px] text-gray-300 focus:outline-none focus:ring-1 focus:ring-emerald-600/50 hover:border-gray-600 hover:text-gray-100 cursor-pointer max-w-[220px] truncate transition-colors"
      title="Choose which model answers the next message"
    >
        {providers.map((p) => {
          const models = [...p.suggestedModels];
          if (extraForCurrent && p.id === selectedProvider && !models.includes(selectedModel!)) {
            models.unshift(selectedModel!);
          }
          const usable = p.configured || keyedProviders?.has(p.id);
          return (
            <optgroup key={p.id} label={usable ? p.id : `${p.id} (no key)`}>
              {models.map((m) => (
                <option key={`${p.id}${SEP}${m}`} value={encode(p.id, m)}>
                  {p.id} / {m}
                </option>
              ))}
            </optgroup>
          );
        })}
    </select>
  );
}
