import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * 图片上传并发语义。
 *
 * 曾经的实现是「互斥丢弃」：第二批发起时 if (busy) return —— 用户拖完图
 * 立刻点上传，后一批的图凭空消失（无报错、无提示）。正确语义是「排队都成功」：
 * 两批都要落库，loading 只在队列彻底清空后熄灭。
 */

vi.mock('../lib/draft', () => ({ loadDraft: () => null }));

vi.mock('../lib/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/image')>();
  return {
    ...actual,
    prepareImageForUpload: vi.fn(async (f: File) => ({
      file: f,
      compressed: false,
      originalSize: 1,
      finalSize: 1,
    })),
  };
});

const uploadCalls: string[] = [];

// 每次上传故意延迟，保证两批在时间上真的重叠
const uploadMock = vi.fn(async (_path: string, fd: FormData) => {
  const name = String((fd.get('images') as File)?.name ?? '?');
  uploadCalls.push(name);
  await new Promise((r) => setTimeout(r, 30));
  return { paths: ['u/x/' + name] };
});

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>();
  const api = Object.create(actual.api);
  api.upload = uploadMock;
  return { ...actual, api };
});

vi.mock('../components/ui/Toast', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

function file(name: string): File {
  return new File(['x'], name, { type: 'image/png' });
}

describe('useImageUpload 并发上传', () => {
  beforeEach(() => {
    uploadCalls.length = 0;
    uploadMock.mockClear();
  });

  it('两批并发都上传成功，不丢任何一批', async () => {
    const { useImageUpload } = await import('./useImageUpload');
    const { result } = renderHook(() => useImageUpload(1));

    await act(async () => {
      await Promise.all([
        result.current.uploadFiles([file('a.png')], 'picker'),
        result.current.uploadFiles([file('b.png')], 'picker'),
      ]);
    });

    await waitFor(() => {
      expect(result.current.uploading).toBe(false);
    });

    // 关键：两张图都必须真的发出去并回到状态里
    expect([...uploadCalls].sort()).toEqual(['a.png', 'b.png']);
    expect([...result.current.images].sort()).toEqual(['u/x/a.png', 'u/x/b.png']);
  });

  it('首批失败不影响后续批次执行', async () => {
    const { useImageUpload } = await import('./useImageUpload');
    const { result } = renderHook(() => useImageUpload(1));

    // 让名字含 boom 的那次失败
    uploadMock.mockImplementationOnce(async () => {
      throw new Error('炸了');
    });

    await act(async () => {
      await Promise.all([
        result.current.uploadFiles([file('boom.png')], 'picker'),
        result.current.uploadFiles([file('ok.png')], 'picker'),
      ]);
    });

    await waitFor(() => expect(result.current.uploading).toBe(false));
    // 第二批仍然成功
    expect(result.current.images).toContain('u/x/ok.png');
  });
});
