import { useRef, useState } from 'react';

export interface VoiceInput {
  /** 浏览器是否支持 Web Speech API（Chrome/Android 系支持，Safari 视版本） */
  supported: boolean;
  /** 正在录音 */
  listening: boolean;
  /** 未定稿的实时转写（用户还在说） */
  interim: string;
  /** 开始 / 停止 */
  start: () => void;
  stop: () => void;
}

type Ctor = new () => SpeechRecognitionLike;

/** 最小结构，绕开各浏览器/TS 版本的类型差异 */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

function getCtor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) || null;
}

/**
 * 模块级"当前活动识别器"。
 * 一个工作台里可能同时挂多个语音按钮（课程主题 + 课堂表现），
 * 麦克风同一时刻只能被一个识别器占用，故用这个单例做互斥：
 * 新开的会先关掉旧的，避免抢麦 / 双双挂起。
 */
let activeRecognition: SpeechRecognitionLike | null = null;

/**
 * Web Speech API 语音输入（中文）。
 *
 * - 主要面向 Android / Chrome 系（如小米 MIUI 自带浏览器与 Chrome），支持较好；
 *   不支持的浏览器 `supported` 为 false，UI 层据此隐藏按钮。
 * - 定稿（isFinal）即通过 `onFinal` 写回；未定稿的实时文本通过 `onInterim` 展示。
 * - 首次调用会触发浏览器麦克风权限弹窗，属正常现象。
 */
export function useVoiceInput(
  onFinal: (text: string) => void,
  onInterim: (text: string) => void,
  lang = 'zh-CN'
): VoiceInput {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = useRef(getCtor() !== null).current;

  const start = () => {
    const Ctor = getCtor();
    if (!Ctor || listening) return;

    // 关掉上一个活动的识别器（若有）
    if (activeRecognition && activeRecognition !== recRef.current) {
      try {
        activeRecognition.stop();
      } catch {
        /* 忽略停止旧实例的异常 */
      }
    }

    const rec = new Ctor();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text: string = res[0].transcript;
        if (res.isFinal) onFinal(text);
        else partial += text;
      }
      onInterim(partial);
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
      onInterim('');
      if (activeRecognition === rec) activeRecognition = null;
    };
    rec.onerror = () => {
      // 权限被拒 / 网络等：静默回到未录音状态，不弹错打扰
      setListening(false);
      setInterim('');
      onInterim('');
      if (activeRecognition === rec) activeRecognition = null;
    };

    recRef.current = rec;
    activeRecognition = rec;
    setListening(true);
    try {
      rec.start();
    } catch {
      // 连续重复 start() 会抛 InvalidStateError，忽略
      if (activeRecognition === rec) activeRecognition = null;
    }
  };

  const stop = () => {
    const rec = recRef.current;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* 忽略 */
      }
    }
    setListening(false);
    setInterim('');
    onInterim('');
  };

  return { supported, listening, interim, start, stop };
}
