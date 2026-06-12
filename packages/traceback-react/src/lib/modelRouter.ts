// Which backend and model should answer a message -- as a plain object.
//
// Plain-English big picture:
// Normally the user's explicit pick wins. In "Auto" mode this router chooses
// deterministically: a message with a PDF goes to the first USABLE backend
// (server-configured or user-keyed) that reads documents -- preferring a
// model that also sees images when both are attached; a message with images
// goes to the first usable image-capable backend; plain text goes to the
// server's default. Auto never picks a backend that is not connected.
// Framework-free, so embedders can reuse the exact routing rules.

import type { ProviderInfo } from '@traceback/shared';

const PREFERENCE_ORDER = ['groq', 'openai', 'anthropic', 'local'];

export interface ModelChoice {
  provider?: string;
  model?: string;
}

export class ModelRouter {
  private readonly providers: ProviderInfo[];
  private readonly keyedProviders: Set<string>;
  private readonly serverDefault: string | null;

  constructor(providers: ProviderInfo[], keyedProviders: Set<string>, serverDefault: string | null) {
    this.providers = providers;
    this.keyedProviders = keyedProviders;
    this.serverDefault = serverDefault;
  }

  private usable(p: ProviderInfo): boolean {
    return p.configured || this.keyedProviders.has(p.id);
  }

  // Older servers may not advertise the capability fields yet; treat a
  // missing list as empty rather than crashing.
  private vision(p: ProviderInfo): string[] {
    return p.visionModels ?? [];
  }
  private docs(p: ProviderInfo): string[] {
    return p.documentModels ?? [];
  }

  resolve(
    selected: { provider: string | null; model: string | null },
    hasImages: boolean,
    hasFiles: boolean
  ): ModelChoice {
    if (selected.provider !== 'auto') {
      return { provider: selected.provider ?? undefined, model: selected.model ?? undefined };
    }
    if (hasFiles) {
      for (const id of PREFERENCE_ORDER) {
        const p = this.providers.find((x) => x.id === id);
        if (!p || !this.usable(p) || this.docs(p).length === 0) continue;
        const model = hasImages
          ? this.docs(p).find((m) => this.vision(p).includes(m)) ?? this.docs(p)[0]
          : this.docs(p)[0];
        return { provider: p.id, model };
      }
    }
    if (hasImages) {
      for (const id of PREFERENCE_ORDER) {
        const p = this.providers.find((x) => x.id === id);
        if (p && this.usable(p) && this.vision(p).length > 0) {
          return { provider: p.id, model: this.vision(p)[0] };
        }
      }
    }
    const def = this.providers.find((p) => p.id === this.serverDefault);
    if (def && this.usable(def)) return { provider: def.id, model: def.defaultModel };
    const first = this.providers.find((p) => this.usable(p));
    return first ? { provider: first.id, model: first.defaultModel } : {};
  }
}
