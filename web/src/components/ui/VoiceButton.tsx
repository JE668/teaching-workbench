import React, { useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { cn } from '../../lib/utils';

interface VoiceButtonProps {
  /** 定稿文本写回（追加到目标字段） */
  onText: (text: string) => void;
  /** 传给 SpeechRecognition 的语言，默认 zh-CN */
  lang?: string;
}

/**
 * 语音输入按钮（放进字段右侧 hint 插槽）。
 * 手机上点一下说"本节课讲了分数加减法"，松开即写入，免去敲字。
 * 浏览器不支持时自动隐藏（返回 null）。
 */
export function VoiceButton({ onText, lang = 'zh-CN' }: VoiceButtonProps) {
  const [interim, setInterim] = useState('');
  const voice = useVoiceInput(onText, (t) => setInterim(t), lang);

  if (!voice.supported) return null;

  const active = voice.listening;
  return (
    <span className="inline-flex items-center gap-1.5">
      {active && interim ? (
        <span className="max-w-[160px] truncate text-[11px] italic text-slate-400">{interim}…</span>
      ) : null}
      <button
        type="button"
        onClick={() => (active ? voice.stop() : voice.start())}
        className={cn(
          'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium ring-1 transition-colors',
          active
            ? 'bg-red-50 text-red-600 ring-red-200'
            : 'bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100'
        )}
        aria-pressed={active}
      >
        {active ? <Square className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
        {active ? '停止' : '语音'}
      </button>
    </span>
  );
}
