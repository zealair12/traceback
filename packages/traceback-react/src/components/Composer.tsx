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
import { ArrowUp, FileText, Mic, Paperclip, X } from 'lucide-react';
import { ModelPicker } from './ModelPicker';

interface ComposerProps {
  sending: boolean;
  // Prefill trigger: when the user branches from a passage, it lands here.
  branchingFromMessageId: string | null;
  branchingFromText: string | null;
  onSendMessage: (content: string, attachments?: ImageAttachment[]) => void;
  onTranscribeAudio: (audioDataUrl: string, mediaType: string) => Promise<string>;
  // Model picker.
  providers: ProviderInfo[];
  selectedProvider: string | null;
  selectedModel: string | null;
  keyedProviders: Set<string>;
  onSelectModel: (providerId: string, model: string) => void;
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
  onSendMessage,
  onTranscribeAudio,
  providers,
  selectedProvider,
  selectedModel,
  keyedProviders,
  onSelectModel
}: ComposerProps) {
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<ImageAttachment[]>([]);
  const [micState, setMicState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Branching pre-fills the input with the chosen passage and focuses it.
  useEffect(() => {
    if (branchingFromText) setInput(`> "${branchingFromText}"\n\n`);
    if (branchingFromMessageId) inputRef.current?.focus();
  }, [branchingFromMessageId, branchingFromText]);

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

  // Mic: first click starts recording, second click stops and transcribes.
  const toggleRecording = async () => {
    if (micState === 'transcribing') return;
    if (micState === 'recording') {
      recorderRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => transcribeAndInsert(String(reader.result ?? ''), blob.type);
        reader.readAsDataURL(blob);
      };
      recorderRef.current = recorder;
      recorder.start();
      setMicState('recording');
      setMicError(null);
    } catch (err: any) {
      setMicError(err?.message ?? 'Microphone unavailable.');
    }
  };

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
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '');
        if (!dataUrl.startsWith('data:image/')) return;
        setPending((prev) =>
          prev.length >= 4 ? prev : [...prev, { type: 'image', mediaType: file.type, dataUrl }]
        );
      };
      reader.readAsDataURL(file);
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
    onSendMessage(input.trim(), pending.length > 0 ? pending : undefined);
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
      {micError && (
        <div className="mb-2 text-xs text-amber-400 bg-amber-400/10 rounded-md px-3 py-1.5">
          {micError}
        </div>
      )}
      <div className="w-full rounded-2xl bg-inputBg/75 backdrop-blur-md border border-gray-800 focus-within:ring-1 focus-within:ring-gray-600">
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
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={input.includes('\n') ? 3 : 1}
          placeholder="Message TraceBack..."
          disabled={sending}
          className="block w-full resize-none bg-transparent text-sm text-gray-100 px-4 pt-3 pb-1 focus:outline-none disabled:opacity-50"
        />
        <div className="flex items-center justify-between px-2 pb-2">
          <ModelPicker
            providers={providers}
            selectedProvider={selectedProvider}
            selectedModel={selectedModel}
            keyedProviders={keyedProviders}
            onSelect={onSelectModel}
          />
          <div className="flex items-center gap-1.5">
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
                  : micState === 'transcribing'
                    ? 'text-emerald-400 animate-pulse'
                    : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800'
              }`}
              title={
                micState === 'recording'
                  ? 'Stop recording'
                  : micState === 'transcribing'
                    ? 'Transcribing...'
                    : 'Dictate a message'
              }
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
