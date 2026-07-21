// The message composer: one rounded frame holding the textarea, the pending
// attachment chips, and a slim controls row (model picker left; paperclip,
// mic, send right).
//
// Attachment handling, each kind the way models can actually use it:
// - images and PDFs become attachments (max 4 per message)
// - audio (recorded or a file) is transcribed into the input
// - text-like files are inlined into the message as a named block, which
//   works with EVERY model.

import { useEffect, useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react';
import type { ProviderInfo, ImageAttachment } from '@traceback/shared';
import { ArrowUp, Bot, FileText, Mic, Paperclip, X } from 'lucide-react';
import { ModelPicker } from './ModelPicker';

interface ComposerProps {
  sending: boolean;
  // Branch context: when the user picks "Ask" on a passage, it lands here.
  branchingFromMessageId: string | null;
  branchingFromText: string | null;
  // The passage to show in the quote preview (the highlight, or a message preview).
  branchingFromPreview: string | null;
  // Dismiss the quote preview (cancels the pending branch).
  onCancelBranch: () => void;
  onSendMessage: (content: string, attachments?: ImageAttachment[]) => void;
  onTranscribeAudio: (audioDataUrl: string, mediaType: string) => Promise<string>;
  // Model picker.
  providers: ProviderInfo[];
  selectedProvider: string | null;
  selectedModel: string | null;
  keyedProviders: Set<string>;
  onSelectModel: (providerId: string, model: string) => void;
  // Agent mode: multi-step tasks. Shown only to signed-in users.
  agentMode: boolean;
  agentAvailable: boolean;
  onToggleAgent: () => void;
}

// Looks like text we can read in the browser (code, notes, data files).
const isTextLike = (file: File) =>
  file.type.startsWith('text/') ||
  ['application/json', 'application/xml'].includes(file.type) ||
  /\.(md|txt|csv|json|xml|ya?ml|log|py|js|ts|tsx|java|c|cpp|rs|go|rb|sh|sql|html|css)$/i.test(file.name);

export function Composer({
  sending,
  branchingFromMessageId,
  branchingFromText,
  branchingFromPreview,
  onCancelBranch,
  onSendMessage,
  onTranscribeAudio,
  providers,
  selectedProvider,
  selectedModel,
  keyedProviders,
  onSelectModel,
  agentMode,
  agentAvailable,
  onToggleAgent
}: ComposerProps) {
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<ImageAttachment[]>([]);
  const [micState, setMicState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  // Live (not-yet-final) speech, shown greyed while speaking, then committed.
  const [interim, setInterim] = useState('');

  // Warn when the selected model can't process the pending attachments.
  const attachmentWarning = (() => {
    if (pending.length === 0 || !selectedProvider || selectedProvider === 'auto') return null;
    const p = providers.find((x) => x.id === selectedProvider);
    if (!p) return null;
    const hasImages = pending.some((a) => a.type === 'image');
    const hasFiles = pending.some((a) => a.type === 'file');
    const canImage = selectedModel ? (p.visionModels ?? []).includes(selectedModel) : false;
    const canFile = selectedModel ? (p.documentModels ?? []).includes(selectedModel) : false;
    if (hasImages && !canImage) return `This model can't analyse images. Switch to Auto or a vision-capable model.`;
    if (hasFiles && !canFile) return `This model can't read documents. Switch to Auto or a model that supports file uploads.`;
    return null;
  })();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recognitionRef = useRef<any>(null);
  const finalTranscriptRef = useRef('');
  const baseInputRef = useRef('');

  // Branching shows the passage as a quote preview above the input (not injected
  // into the textarea), and focuses the input so the user can type their question.
  useEffect(() => {
    if (branchingFromMessageId) inputRef.current?.focus();
  }, [branchingFromMessageId]);

  const transcribeAndInsert = async (dataUrl: string, mediaType: string) => {
    setMicState('transcribing');
    setMicError(null);
    try {
      const text = await onTranscribeAudio(dataUrl, mediaType);
      if (text.trim()) {
        setInput((prev) => (prev.trim() ? prev + ' ' + text.trim() : text.trim()));
        inputRef.current?.focus();
      }
    } catch (err: any) {
      setMicError(err?.response?.data?.error ?? err?.message ?? 'Transcription failed.');
    } finally {
      setMicState('idle');
    }
  };

  // Mic: real-time speech-to-text via the Web Speech API (no audio upload needed).
  const toggleRecording = () => {
    if (micState === 'recording') {
      recognitionRef.current?.stop();
      return;
    }

    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setMicError('Speech recognition not supported. Try Chrome or Edge.');
      return;
    }

    finalTranscriptRef.current = '';
    baseInputRef.current = input;

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    rec.onresult = (e: any) => {
      let finals = '';
      let interimText = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) finals += e.results[i][0].transcript;
        else interimText += e.results[i][0].transcript;
      }
      finalTranscriptRef.current = finals;
      // Committed (finalized) speech goes into the editable input; the live,
      // not-yet-final part shows greyed alongside until it settles.
      const base = baseInputRef.current;
      const f = finals.trim();
      setInput(base + (base.trim() && f ? ' ' : '') + f);
      setInterim(interimText.trim());
    };

    rec.onerror = (e: any) => {
      setMicError(e.error === 'not-allowed' ? 'Microphone access denied.' : `Recognition error: ${e.error}`);
      setInterim('');
      setMicState('idle');
    };

    rec.onend = () => {
      const base = baseInputRef.current;
      const finals = finalTranscriptRef.current.trim();
      setInput(base + (base.trim() && finals ? ' ' : '') + finals);
      setInterim('');
      setMicState('idle');
      inputRef.current?.focus();
    };

    recognitionRef.current = rec;
    rec.start();
    setMicState('recording');
    setMicError(null);
  };

  // Compress images before attaching — keeps base64 payloads small enough for the server.
  const compressImage = (file: File): Promise<string> =>
    new Promise((resolve) => {
      const MAX = 1120;
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = url;
    });

  const addFiles = (files: Iterable<File>) => {
    for (const file of files) {
      if (file.type.startsWith('audio/')) {
        const reader = new FileReader();
        reader.onload = () => transcribeAndInsert(String(reader.result ?? ''), file.type);
        reader.readAsDataURL(file);
        continue;
      }
      if (file.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result ?? '');
          if (!dataUrl.startsWith('data:application/pdf')) return;
          setPending((prev) =>
            prev.length >= 4 ? prev : [...prev, { type: 'file', mediaType: file.type, dataUrl, name: file.name }]
          );
        };
        reader.readAsDataURL(file);
        continue;
      }
      if (isTextLike(file)) {
        file.text().then((text) => {
          setInput((prev) => prev + '\n\n```' + file.name + '\n' + text.slice(0, 60_000) + '\n```\n');
          inputRef.current?.focus();
        });
        continue;
      }
      if (!file.type.startsWith('image/')) continue;
      compressImage(file).then((dataUrl) => {
        setPending((prev) =>
          prev.length >= 4 ? prev : [...prev, { type: 'image', mediaType: 'image/jpeg', dataUrl }]
        );
      });
    }
  };

  // Pasting an image (e.g. a screenshot) attaches it.
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (images.length > 0) {
      e.preventDefault();
      addFiles(images);
    }
  };

  const submit = () => {
    if ((!input.trim() && pending.length === 0) || sending) return;
    // The quoted passage rides along as a blockquote so the model (and the
    // saved thread) still see what the question is about, even though the
    // composer shows it as a tidy preview rather than raw text in the box.
    const quoted = branchingFromText ? `> "${branchingFromText}"\n\n` : '';
    onSendMessage((quoted + input.trim()).trim(), pending.length > 0 ? pending : undefined);
    setInput('');
    setPending([]);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <>
      {attachmentWarning && (
        <div className="mb-2 text-xs text-amber-400 bg-amber-400/10 rounded-md px-3 py-1.5">
          {attachmentWarning}
        </div>
      )}
      {micError && (
        <div className="mb-2 text-xs text-amber-400 bg-amber-400/10 rounded-md px-3 py-1.5">
          {micError}
        </div>
      )}
      <div className="w-full rounded-2xl bg-inputBg/75 backdrop-blur-md border border-gray-800 focus-within:ring-1 focus-within:ring-gray-600">
        {/* Quote preview: the passage being asked about, shown as a compact
            reply chip (accent bar + text + dismiss) instead of raw markdown. */}
        {branchingFromPreview && (
          <div className="mx-2.5 mt-2.5 flex items-start gap-2 rounded-lg bg-gray-800/40 py-1.5 pl-2 pr-1.5">
            <div className="w-[3px] self-stretch rounded-full bg-blue-400 flex-shrink-0" />
            <p className="flex-1 min-w-0 text-xs text-gray-300 line-clamp-2 break-words py-0.5">
              {branchingFromPreview}
            </p>
            <button
              type="button"
              onClick={onCancelBranch}
              title="Remove quote"
              aria-label="Remove quote"
              className="h-5 w-5 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-100 hover:bg-gray-700 flex-shrink-0"
            >
              <X size={13} />
            </button>
          </div>
        )}
        {pending.length > 0 && (
          <div className="flex gap-2 px-3 pt-3 flex-wrap">
            {pending.map((att, i) => (
              <div key={i} className="relative">
                {att.type === 'image' ? (
                  <img
                    src={att.dataUrl}
                    alt={`attachment ${i + 1}`}
                    className="h-14 w-14 object-cover rounded-lg border border-gray-700"
                  />
                ) : (
                  <div className="h-14 px-3 rounded-lg border border-gray-700 bg-gray-900/70 flex items-center gap-2 max-w-[180px]">
                    <FileText size={16} className="text-gray-400 flex-shrink-0" />
                    <span className="text-[11px] text-gray-300 truncate">{att.name ?? 'document.pdf'}</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-gray-700 text-gray-200 flex items-center justify-center hover:bg-gray-600"
                  title="Remove attachment"
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="relative">
          {/* Live speech preview: reserves the committed text's space (invisible)
              so the not-yet-final words appear greyed right where they'll land. */}
          {micState === 'recording' && interim && (
            <div
              aria-hidden="true"
              className="absolute inset-0 px-4 pt-3 pb-1 text-sm leading-[inherit] whitespace-pre-wrap break-words pointer-events-none select-none"
            >
              <span className="invisible">
                {input}
                {input && !input.endsWith(' ') ? ' ' : ''}
              </span>
              <span className="text-gray-500">{interim}</span>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={input.includes('\n') ? 3 : 1}
            placeholder={agentMode ? 'Give the agent a task…' : 'Ask…'}
            disabled={sending}
            className="block w-full resize-none bg-transparent text-sm text-gray-100 px-4 pt-3 pb-1 focus:outline-none disabled:opacity-50"
          />
        </div>
        <div className="flex items-center px-2 pb-2 gap-2">
          {/* Agent toggle — robot icon, blue when on (a toggle by feel). */}
          {agentAvailable && (
            <button
              type="button"
              onClick={onToggleAgent}
              disabled={sending}
              className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors flex-shrink-0 disabled:opacity-40 ${
                agentMode
                  ? 'text-blue-400 bg-blue-400/10'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
              }`}
              title={agentMode ? 'Agent mode is on' : 'Agent mode'}
              aria-pressed={agentMode}
              aria-label="Toggle agent mode"
            >
              <Bot size={15} />
            </button>
          )}
          {/* min-w-0 so picker shrinks before buttons are pushed off-screen */}
          <div className="flex-1 min-w-0 overflow-hidden">
            <ModelPicker
              providers={providers}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              keyedProviders={keyedProviders}
              onSelect={onSelectModel}
            />
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <input
              ref={fileRef}
              type="file"
              accept="image/*,audio/*,.pdf,.txt,.md,.csv,.json,.xml,.yaml,.yml,.log,text/*,application/pdf,application/json"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={sending || pending.length >= 4}
              className="h-7 w-7 rounded-full text-gray-400 hover:text-gray-100 hover:bg-gray-800 flex items-center justify-center transition-colors disabled:opacity-30"
              title="Attach images, PDFs, documents, or audio (or paste)"
            >
              <Paperclip size={15} />
            </button>
            <button
              type="button"
              onClick={toggleRecording}
              disabled={sending}
              className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 ${
                micState === 'recording'
                  ? 'text-red-400 bg-red-400/10 animate-pulse'
                  : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
              }`}
              title={micState === 'recording' ? 'Stop' : 'Dictate'}
            >
              <Mic size={15} />
            </button>
            <button
              type="button"
              disabled={sending || (!input.trim() && pending.length === 0)}
              onClick={submit}
              className="h-7 w-7 rounded-full bg-white text-black flex items-center justify-center hover:bg-gray-200 transition-colors disabled:opacity-30"
              title="Send"
              aria-label="Send"
            >
              <ArrowUp size={14} strokeWidth={2.4} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
