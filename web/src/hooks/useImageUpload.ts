import { useRef, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { prepareImageForUpload, formatBytes } from '../lib/image';
import { extractDroppedImages } from '../lib/dropFiles';
import { loadDraft } from '../lib/draft';

export interface UseImageUploadResult {
  images: string[];
  setImages: React.Dispatch<React.SetStateAction<string[]>>;
  uploading: boolean;
  dragging: boolean;
  setDragging: (v: boolean) => void;
  fileRef: React.MutableRefObject<HTMLInputElement | null>;
  cameraRef: React.MutableRefObject<HTMLInputElement | null>;
  uploadFiles: (files: FileList | File[], source?: 'drop' | 'paste' | 'picker') => Promise<void>;
  onPaste: (e: React.ClipboardEvent) => void;
}

/**
 * 图片管理：本地文件上传、拖拽 / 粘贴 / 拍照入口、缩略图网格、暂存清理。
 *
 * 单独抽出来的原因：
 *  - 主组件 1307 行 → 拆掉约 130 行上传相关逻辑
 *  - 图片上传本身是自闭合的：文件 → 压缩 → 上传 → 拿路径 → 显示 → 可删除
 *  - 服务端暂存图的生命周期（保存回访时才提交、删除时清理）都在这层完成
 *
 * 主组件仍需要：
 *  - `images` 用于拼 AI 生成请求
 *  - `clearImages()` 在保存成功后重置
 */
export function useImageUpload(): UseImageUploadResult {
  const toast = useToast();
  // 首帧从本地草稿恢复图片（切到微信再回来不会白填一场），与主组件同一数据源
  const [images, setImages] = useState<string[]>(() => loadDraft()?.images || []);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const uploadFiles = async (files: FileList | File[], source: 'drop' | 'paste' | 'picker' = 'picker') => {
    const list = Array.from(files);

    if (list.length === 0) {
      // 关键：不能静默失败。用户拖了图却什么都没发生，会以为是坏了。
      toast.error(
        source === 'drop'
          ? '没有从拖拽中识别到图片，请改用「点击上传」或直接粘贴（Ctrl/⌘+V）'
          : '没有识别到图片'
      );
      return;
    }

    setUploading(true);
    try {
      let added = 0;
      let compressedCount = 0;
      let savedBytes = 0;

      for (const file of list) {
        // 手机照片动辄 20-40MB：先在浏览器里缩到 2048px，
        // 上传更快、不撞体积限制，而 AI 看到的内容完全一样。
        const prepared = await prepareImageForUpload(file);
        if (prepared.compressed) {
          compressedCount++;
          savedBytes += prepared.originalSize - prepared.finalSize;
        }

        const fd = new FormData();
        fd.append('images', prepared.file);

        const res = await api.upload('/upload', fd);
        if (res.paths?.length) {
          setImages((prev) => [...prev, ...res.paths]);
          added += res.paths.length;
        }
      }

      if (added) {
        const suffix = compressedCount > 0 ? '（已压缩 ' + formatBytes(savedBytes) + '）' : '';
        toast.success('已上传 ' + added + ' 张图片' + suffix);
      }
    } catch (err: any) {
      toast.error('图片上传失败：' + err.message);
    } finally {
      setUploading(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items || []);

    // 先走标准路径（截图粘贴）
    const files = items
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);

    if (files.length) {
      e.preventDefault();
      uploadFiles(files, 'paste');
      return;
    }

    // 兜底：某些应用粘贴的是含 data: 图片的 HTML
    const dt = e.clipboardData as unknown as DataTransfer | undefined;
    if (dt) {
      const { files: fromHtml } = extractDroppedImages(dt);
      if (fromHtml.length) {
        e.preventDefault();
        uploadFiles(fromHtml, 'paste');
      }
    }
  };

  return {
    images,
    setImages,
    uploading,
    dragging,
    setDragging,
    fileRef,
    cameraRef,
    uploadFiles,
    onPaste,
  };
}
