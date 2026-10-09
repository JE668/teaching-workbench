import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prepareImageForUpload, formatBytes, MAX_EDGE, SMALL_BYTES } from './image';

/** 造一个指定字节数的假文件 */
function fakeFile(name: string, bytes: number, type = 'image/jpeg') {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** 让解码返回指定尺寸（不依赖真实图片） */
function mockDecode(width: number, height: number) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width, height }))
  );
}

function mockDecodeFailure() {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => {
      throw new Error('decode failed');
    })
  );
  // jsdom 既不加载图片也不触发事件，这里手动模拟"解码失败"
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
  );
}

/** 让 canvas 产出指定体积的 blob */
function mockCanvasOutput(bytes: number) {
  const ctx = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as any);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: any) => {
    cb(new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }));
  });
  return ctx;
}

beforeEach(() => {
  vi.restoreAllMocks();
  // jsdom 没有这些 API，但解码兜底路径会用到
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn(() => 'blob:mock'),
    revokeObjectURL: vi.fn(),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('图片压缩 · 不需要压缩的情况', () => {
  it('尺寸与体积都达标 → 原样返回', async () => {
    mockDecode(800, 600);
    const file = fakeFile('small.jpg', 300 * 1024);

    const r = await prepareImageForUpload(file);

    expect(r.compressed).toBe(false);
    expect(r.file).toBe(file);
  });

  it('体积大但尺寸不超标 → 仍会压缩（手机照片常见）', async () => {
    mockDecode(1600, 1200);
    mockCanvasOutput(400 * 1024);
    const file = fakeFile('heavy.jpg', 5 * 1024 * 1024);

    const r = await prepareImageForUpload(file);

    expect(r.compressed).toBe(true);
    expect(r.originalSize).toBe(5 * 1024 * 1024);
    expect(r.finalSize).toBe(400 * 1024);
  });

  it('压缩后反而更大 → 保留原文件（不做负优化）', async () => {
    mockDecode(3000, 3000);
    mockCanvasOutput(9 * 1024 * 1024); // 比原文件还大
    const file = fakeFile('already-good.jpg', 2 * 1024 * 1024);

    const r = await prepareImageForUpload(file);

    expect(r.compressed).toBe(false);
    expect(r.file).toBe(file);
  });
});

describe('图片压缩 · 5000 万像素场景', () => {
  it('8000x6000 的大图会缩到长边 2048', async () => {
    mockDecode(8000, 6000);
    const ctx = mockCanvasOutput(600 * 1024);

    const file = fakeFile('50mp.jpg', 30 * 1024 * 1024);
    const r = await prepareImageForUpload(file);

    expect(r.compressed).toBe(true);
    expect(r.originalEdge).toBe(8000);

    // 画布尺寸应为按长边等比缩放后的结果
    const canvas = ctx.drawImage.mock.calls[0];
    expect(canvas[3]).toBe(MAX_EDGE); // 目标宽 = 长边上限
    expect(canvas[4]).toBe(1536); // 6000 * (2048/8000) = 1536

    // 体积应大幅下降
    expect(r.finalSize).toBeLessThan(r.originalSize / 10);
  });

  it('竖拍照片按高度作为长边', async () => {
    mockDecode(6000, 8000);
    const ctx = mockCanvasOutput(500 * 1024);

    const r = await prepareImageForUpload(fakeFile('portrait.jpg', 25 * 1024 * 1024));

    expect(r.compressed).toBe(true);
    const call = ctx.drawImage.mock.calls[0];
    expect(call[3]).toBe(1536); // 宽
    expect(call[4]).toBe(MAX_EDGE); // 高 = 长边上限
  });

  it('输出为 JPEG，文件名替换扩展名', async () => {
    mockDecode(4000, 3000);
    mockCanvasOutput(300 * 1024);

    const r = await prepareImageForUpload(fakeFile('IMG_1234.PNG', 8 * 1024 * 1024));

    expect(r.file.type).toBe('image/jpeg');
    expect(r.file.name).toBe('IMG_1234.jpg');
  });

  it('透明图先铺白底，避免转 JPEG 后发黑', async () => {
    mockDecode(4000, 3000);
    const ctx = mockCanvasOutput(300 * 1024);

    await prepareImageForUpload(fakeFile('shot.png', 8 * 1024 * 1024));

    expect(ctx.fillRect).toHaveBeenCalled();
    expect(ctx.fillStyle).toBe('#ffffff');
  });
});

describe('图片压缩 · 失败降级', () => {
  it('浏览器解不开（如 Chrome 下的 HEIC）→ 原样上传', async () => {
    mockDecodeFailure();
    const file = fakeFile('photo.heic', 4 * 1024 * 1024, 'image/heic');

    const r = await prepareImageForUpload(file);

    expect(r.compressed).toBe(false);
    expect(r.file).toBe(file);
  });

  it('canvas 拿不到 2d 上下文 → 原样上传', async () => {
    mockDecode(8000, 6000);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const file = fakeFile('big.jpg', 20 * 1024 * 1024);

    const r = await prepareImageForUpload(file);

    expect(r.compressed).toBe(false);
    expect(r.file).toBe(file);
  });

  it('toBlob 返回 null → 原样上传', async () => {
    mockDecode(8000, 6000);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb: any) => cb(null));

    const file = fakeFile('big.jpg', 20 * 1024 * 1024);
    const r = await prepareImageForUpload(file);

    expect(r.compressed).toBe(false);
    expect(r.file).toBe(file);
  });
});

describe('formatBytes', () => {
  it('按量级给出可读体积', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('异常输入不崩', () => {
    expect(formatBytes(NaN)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
  });
});

describe('阈值常量', () => {
  it('长边上限与"小文件"阈值符合预期', () => {
    expect(MAX_EDGE).toBe(2048);
    expect(SMALL_BYTES).toBe(1.5 * 1024 * 1024);
  });
});
