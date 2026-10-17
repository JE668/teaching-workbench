import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { VoiceButton } from './VoiceButton';
import { describeVoiceError } from '../../hooks/useVoiceInput';

/**
 * 语音输入：把浏览器错误"看得见"。
 *
 * 复现的是手机上的真实问题——点了「语音」按钮没有任何反应。
 * 原因是 SpeechRecognition 的错误（权限被拒 / 服务不可用 / start 抛异常）
 * 曾经被静默吞掉，用户无从得知发生了什么。
 */

type RecOpts = { startThrows?: unknown };

class FakeRec {
  static instances: FakeRec[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  onresult: any = null;
  onend: any = null;
  onerror: any = null;
  started = false;
  private opts: RecOpts = {};

  constructor(opts: RecOpts = {}) {
    this.opts = opts;
    FakeRec.instances.push(this);
  }

  start() {
    if (this.opts.startThrows) throw this.opts.startThrows;
    this.started = true;
  }

  stop() {
    this.started = false;
  }

  /** 模拟浏览器异步回调 */
  fireError(code: string) {
    act(() => {
      this.onerror?.({ error: code });
    });
  }

  fireFinal(text: string) {
    act(() => {
      this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
    });
  }
}

function setSpeechRecognition(ctor?: any) {
  if (ctor) (window as any).webkitSpeechRecognition = ctor;
  else delete (window as any).webkitSpeechRecognition;
}

function lastRec(): FakeRec {
  const rec = FakeRec.instances[FakeRec.instances.length - 1];
  expect(rec, '应该已创建 SpeechRecognition 实例').toBeTruthy();
  return rec!;
}

function mountVoice(): { onText: any } {
  const onText = vi.fn();
  render(<VoiceButton onText={onText} />);
  return { onText };
}

describe('describeVoiceError', () => {
  it('把错误码翻译成用户能照着做的提示', () => {
    expect(describeVoiceError('not-allowed')).toContain('麦克风权限');
    expect(describeVoiceError('no-speech')).toContain('没听清');
    expect(describeVoiceError('service-not-available')).toContain('Chrome');
    expect(describeVoiceError('network')).toContain('联网');
    expect(describeVoiceError('audio-capture')).toContain('麦克风');
    expect(describeVoiceError('aborted')).toContain('取消');
  });

  it('未知错误码也带出来，不留空', () => {
    expect(describeVoiceError('some-new-code')).toContain('some-new-code');
    expect(describeVoiceError()).toBe('语音输入失败');
  });
});

describe('VoiceButton', () => {
  beforeEach(() => {
    FakeRec.instances = [];
    setSpeechRecognition(FakeRec);
  });

  afterEach(() => {
    setSpeechRecognition(undefined);
  });

  it('浏览器不支持时整个按钮隐藏', () => {
    setSpeechRecognition(undefined);
    render(<VoiceButton onText={() => {}} />);
    expect(screen.queryByText('语音')).toBeNull();
  });

  it('点击后进入录音态，定稿文本写回', () => {
    const { onText } = mountVoice();
    fireEvent.click(screen.getByRole('button', { name: /语音/ }));
    expect(screen.getByRole('button', { name: /停止/ })).toBeTruthy();

    lastRec().fireFinal('本节课讲了分数加减法');
    expect(onText).toHaveBeenCalledWith('本节课讲了分数加减法');
  });

  it('权限被拒时把原因显示在按钮旁，并复位为未录音', () => {
    mountVoice();
    fireEvent.click(screen.getByRole('button', { name: /语音/ }));
    lastRec().fireError('not-allowed');

    expect(screen.getByText(/麦克风权限被拒绝/)).toBeTruthy();
    // 不再卡在"停止"态
    expect(screen.queryByRole('button', { name: /停止/ })).toBeNull();
  });

  it('浏览器不支持中文识别（service-not-available）时给出换 Chrome 的提示', () => {
    mountVoice();
    fireEvent.click(screen.getByRole('button', { name: /语音/ }));
    lastRec().fireError('service-not-available');

    expect(screen.getByText(/请改用 Chrome/)).toBeTruthy();
  });

  it('start() 同步抛异常时给出错误，且不会卡在"停止"态', () => {
    setSpeechRecognition(class extends FakeRec {
      constructor() {
        super({ startThrows: new DOMException('Internal error', 'InvalidStateError') });
      }
    });
    mountVoice();
    fireEvent.click(screen.getByRole('button', { name: /语音/ }));

    expect(screen.getByText(/语音无法启动/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /停止/ })).toBeNull();
    expect(screen.getByRole('button', { name: /语音/ })).toBeTruthy();
  });

  it('手动停止触发的 aborted 不算失败，不弹错', () => {
    mountVoice();
    fireEvent.click(screen.getByRole('button', { name: /语音/ }));
    const rec = lastRec();
    fireEvent.click(screen.getByRole('button', { name: /停止/ }));
    rec.fireError('aborted');

    expect(screen.queryByText(/麦克风权限|语音无法启动|语音输入失败/)).toBeNull();
  });

  it('再次点击语音会清掉上一次错误提示', () => {
    mountVoice();
    fireEvent.click(screen.getByRole('button', { name: /语音/ }));
    lastRec().fireError('no-speech');
    expect(screen.getByText(/没听清/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /语音/ }));
    expect(screen.queryByText(/没听清/)).toBeNull();
  });
});
