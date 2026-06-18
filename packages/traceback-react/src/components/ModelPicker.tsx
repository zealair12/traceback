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
      ?.suggestedModels?.includes(selectedModel);

  // A small quiet control at the left of the input frame's bottom row, sized
  // to match the message text. No chrome of its own; the menu stays grouped by
  // backend.
  return (
    <select
      value={currentValue}
      onChange={(e) => {
        const [providerId, model] = e.target.value.split(SEP);
        onSelect(providerId, model);
      }}
      className="bg-transparent text-sm text-gray-400 hover:text-gray-100 focus:outline-none cursor-pointer max-w-[150px] truncate px-1.5 py-0.5 rounded-md hover:bg-gray-800/60 transition-colors"
      title="Choose which model answers the next message"
    >
        {/* Auto picks the model for each message: image messages go to a
            connected image-capable model, text to the default backend. */}
        <option value={encode('auto', 'auto')}>Auto</option>
        {providers.map((p) => {
          const models = [...(p.suggestedModels ?? [])];
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
