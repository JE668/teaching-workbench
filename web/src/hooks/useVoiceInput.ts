import { useRef, useState } from 'react';

export interface VoiceInput {
  /** 浏览器是否支持 Web Speech API（Chrome/Android 系支持，Safari 视版本） */
  supported: boolean;
  /** 正在录音 */
  listening: boolean;
  /** 未定稿的实时转写（用户还在说） */
  interim: string;
  /** 最近一次失败的提示文案（用户能看懂、能照着修）；无错误时为 null */
  error: string | null;
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
 * 语音识别错误码 → 用户看得懂的处理办法。
 *
 * 以前这些错误是静默吞掉的，手机上表现就是"点了没反应"，
 * 用户完全不知道是权限问题还是浏览器不支持。
 */
export function describeVoiceError(code?: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '麦克风权限被拒绝：请在浏览器「设置 → 麦克风」里允许后再试';
    case 'no-speech':
      return '没听清，请靠近麦克风再说一次';
    case 'service-not-available':
      return '当前浏览器没有可用的语音识别服务，请改用 Chrome';
    case 'network':
      return '语音识别需要联网，当前网络连不上服务';
    case 'audio-capture':
      return '没找到麦克风，请检查耳机 / 外接音频';
    case 'aborted':
      return '语音输入已取消';
    default:
      return code ? '语音输入失败：' + code : '语音输入失败';
  }
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
 * - 失败（权限被拒 / 服务不可用 / start 抛异常）会通过 `error` 冒出来，
 *   绝不静默——静默等于把按钮变成"点了没反应"。
 */
export function useVoiceInput(
  onFinal: (text: string) => void,
  onInterim: (text: string) => void,
  lang = 'zh-CN'
): VoiceInput {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  /** 手动 stop() 之后触发的 aborted 不算失败 */
  const userStopped = useRef(false);
  const supported = useRef(getCtor() !== null).current;

  const clearState = () => {
    setListening(false);
    setInterim('');
    onInterim('');
  };

  const start = () => {
    const Ctor = getCtor();
    if (!Ctor || listening) return;

    userStopped.current = false;
    setError(null);

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
      clearState();
      if (activeRecognition === rec) activeRecognition = null;
    };
    rec.onerror = (e: any) => {
      // 手动 stop() 会触发 aborted，那不是失败，别吓用户
      if (userStopped.current || e?.error === 'aborted') {
        clearState();
        if (activeRecognition === rec) activeRecognition = null;
        return;
      }
      setError(describeVoiceError(e?.error));
      clearState();
      if (activeRecognition === rec) activeRecognition = null;
    };

    recRef.current = rec;
    activeRecognition = rec;
    try {
      rec.start();
      // start() 成功才进入录音态：Edge 等浏览器可能同步抛异常，
      // 那时若已置 listening，按钮会卡在"停止"却根本没有在录音。
      setListening(true);
    } catch (err: any) {
      if (activeRecognition === rec) activeRecognition = null;
      setError(err?.name ? '语音无法启动：' + err.name : '语音无法启动，请换一个浏览器试试');
    }
  };

  const stop = () => {
    const rec = recRef.current;
    userStopped.current = true;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* 忽略 */
      }
    }
    clearState();
  };

  return { supported, listening, interim, error, start, stop };
}
