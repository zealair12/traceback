import { useEffect, useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react';
import type { ChatMessage } from '../types';
import type { ProviderInfo, ImageAttachment } from '@traceback/shared';
import { MessageBubble } from './MessageBubble';
import { ModelPicker } from './ModelPicker';
import { NodeNavBar } from './NodeNavBar';
import { BrandIcon } from './BrandIcon';
import { stripMarkdown } from '../utils/text';

interface SiblingInfo {
  parentId: string | null;
  currentIndex: number;
  total: number;
}

interface ChatPanelProps {
  threadPath: ChatMessage[];
  onSendMessage: (content: string, attachments?: ImageAttachment[]) => void;
  // Turn recorded audio (base64 data URL) into text for the input box.
  onTranscribeAudio: (audioDataUrl: string, mediaType: string) => Promise<string>;
  onBranchFromMessage: (messageId: string, selectedText: string, action: 'dig' | 'ask') => void;
  branchingFromMessageId: string | null;
  branchingFromPreview: string | null;
  branchingFromText: string | null;
  sending: boolean;
  error: string | null;
  siblingInfo: SiblingInfo | null;
  onNavigateToParent: () => void;
  onNavigateToSibling: (offset: number) => void;
  onNavigateToNode: (nodeId: string) => void;
  // Model picker.
  providers: ProviderInfo[];
  selectedProvider: string | null;
  selectedModel: string | null;
  keyedProviders: Set<string>;
  onSelectModel: (providerId: string, model: string) => void;
}

export function ChatPanel({
  threadPath,
  onSendMessage,
  onTranscribeAudio,
  onBranchFromMessage,
  branchingFromMessageId,
  branchingFromPreview,
  branchingFromText,
  sending,
  error,
  siblingInfo,
  onNavigateToParent,
  onNavigateToSibling,
  onNavigateToNode,
  providers,
  selectedProvider,
  selectedModel,
  keyedProviders,
  onSelectModel
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  // Images waiting to be sent with the next message (shown as chips).
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Speech input: idle -> recording (mic on) -> transcribing -> idle.
  const [micState, setMicState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [micError, setMicError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Send audio (a recording or a dropped file) for transcription and append
  // the recognized text to the input, where the user can edit it.
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

  // Mic button: first click starts recording, second click stops and
  // transcribes. Recording uses the browser's own recorder; nothing is stored.
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

  // Attach picked/pasted files: images become attachments (max 4 per
  // message); audio files are transcribed into the input instead.
  const addImageFiles = (files: Iterable<File>) => {
    for (const file of files) {
      if (file.type.startsWith('audio/')) {
        const reader = new FileReader();
        reader.onload = () => transcribeAndInsert(String(reader.result ?? ''), file.type);
        reader.readAsDataURL(file);
        continue;
      }
      if (!file.type.startsWith('image/')) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result ?? '');
        if (!dataUrl.startsWith('data:image/')) return;
        setPendingImages((prev) =>
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
      addImageFiles(images);
    }
  };

  const submit = () => {
    if ((!input.trim() && pendingImages.length === 0) || sending) return;
    onSendMessage(input.trim(), pendingImages.length > 0 ? pendingImages : undefined);
    setInput('');
    setPendingImages([]);
  };

  // Auto-scroll to bottom when new messages arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [threadPath.length]);

  // When branching text is set, pre-fill the input with a quoted snippet.
  useEffect(() => {
    if (branchingFromText) {
      setInput(`> "${branchingFromText}"\n\n`);
      inputRef.current?.focus();
    }
  }, [branchingFromText]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const handleBranchFromMessage = (messageId: string, selectedText: string, action: 'dig' | 'ask') => {
    onBranchFromMessage(messageId, selectedText, action);
    if (action === 'ask') {
      inputRef.current?.focus();
    }
  };

  return (
    <main className="flex-1 flex flex-col bg-chat text-gray-100 min-w-0">
      {/* Clickable breadcrumb trail */}
      <header className="px-6 py-2.5 border-b border-gray-800 flex-shrink-0 overflow-x-auto">
        <div className="flex items-center gap-1 text-[11px] min-w-0">
          {threadPath.length === 0 ? (
            <span className="text-gray-600">No messages yet</span>
          ) : (
            threadPath.map((msg, i) => {
              const isLast = i === threadPath.length - 1;
              const clean = stripMarkdown(msg.content);
              const label = clean.length > 20 ? clean.slice(0, 20) + '…' : clean;

              return (
                <span key={msg.id} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <span className="text-gray-700 flex-shrink-0">›</span>}
                  <button
                    type="button"
                    onClick={() => onNavigateToNode(msg.id)}
                    className={`truncate max-w-[140px] transition-colors ${
                      isLast
                        ? 'text-gray-200 font-medium'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {label}
                  </button>
                </span>
              );
            })
          )}
        </div>
      </header>

      {/* Parent/sibling navigation bar */}
      <NodeNavBar
        siblingInfo={siblingInfo}
        onNavigateToParent={onNavigateToParent}
        onNavigateToSibling={onNavigateToSibling}
      />

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 h-0 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 pt-4 pb-2 space-y-5">
          {threadPath.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onBranchFromMessage={handleBranchFromMessage}
            />
          ))}
          {sending && (
            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-full bg-gray-800 flex items-center justify-center text-emerald-500 mt-1 flex-shrink-0">
                <BrandIcon size={15} />
              </div>
              <div className="text-sm text-gray-500 animate-pulse">Thinking…</div>
            </div>
          )}
          {threadPath.length === 0 && !sending && (
            <p className="text-sm text-gray-500 text-center pt-24">
              Start a new conversation by sending a message below.
            </p>
          )}
        </div>
      </div>

      {/* Input bar */}
      <footer className="border-t border-gray-800 px-4 py-3 flex-shrink-0">
        {error && (
          <div className="max-w-2xl mx-auto mb-2 text-xs text-red-400 bg-red-400/10 rounded-md px-3 py-1.5">
            {error}
          </div>
        )}
        {micError && (
          <div className="max-w-2xl mx-auto mb-2 text-xs text-amber-400 bg-amber-400/10 rounded-md px-3 py-1.5">
            {micError}
          </div>
        )}
        {branchingFromMessageId && branchingFromPreview && (
          <div className="max-w-2xl mx-auto mb-2 text-xs text-emerald-400 flex items-center gap-1.5">
            <span>⎇</span>
            <span>Branching from:</span>
            <span className="text-gray-300 truncate max-w-[300px]">"{branchingFromPreview}"</span>
          </div>
        )}
        {/* One rounded frame holding the textarea with a slim controls row
            inside its bottom edge: model pill on the left, send on the right
            (the layout used by modern editors). */}
        <div className="max-w-2xl mx-auto rounded-2xl bg-inputBg border border-gray-800 focus-within:ring-1 focus-within:ring-gray-600">
          {pendingImages.length > 0 && (
            <div className="flex gap-2 px-3 pt-3 flex-wrap">
              {pendingImages.map((img, i) => (
                <div key={i} className="relative">
                  <img
                    src={img.dataUrl}
                    alt={`attachment ${i + 1}`}
                    className="h-14 w-14 object-cover rounded-lg border border-gray-700"
                  />
                  <button
                    type="button"
                    onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-gray-700 text-gray-200 text-[9px] flex items-center justify-center hover:bg-gray-600"
                    title="Remove image"
                  >
                    x
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
                accept="image/*,audio/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) addImageFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={sending || pendingImages.length >= 4}
                className="h-7 w-7 rounded-full text-gray-400 hover:text-gray-100 hover:bg-gray-800 flex items-center justify-center transition-colors disabled:opacity-30"
                title="Attach images (or paste them)"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M20 11.5 L11.5 20 a5.3 5.3 0 0 1 -7.5 -7.5 L13 3.5 a3.6 3.6 0 0 1 5 5 L9.5 17 a1.8 1.8 0 0 1 -2.5 -2.5 L15 6.5"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
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
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.7" />
                  <path
                    d="M5.5 11.5a6.5 6.5 0 0 0 13 0 M12 18v3"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                disabled={sending || (!input.trim() && pendingImages.length === 0)}
                onClick={submit}
                className="h-7 w-7 rounded-full bg-white text-black flex items-center justify-center text-xs hover:bg-gray-200 transition-colors disabled:opacity-30"
              >
                ↑
              </button>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
