import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { prepareImageForUpload, formatBytes, MAX_UPLOAD_BYTES } from '../lib/image';
import { extractDroppedImages } from '../lib/dropFiles';
import { loadDraft } from '../lib/draft';

/** 支持的图片 MIME 白名单 */
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

/** 按扩展名兜底（微信拖拽常给空 MIME） */
const IMAGE_EXTENSIONS = /\.(jpe?g|png|webp|gif|heic|heif)$/i;

/** 判断文件是否为可上传的图片类型。
 *  MIME 存在时优先按 MIME 判断；为空时按扩展名兜底。 */
function isImageFile(file: File): boolean {
  if (file.type) return IMAGE_MIME_TYPES.has(file.type.toLowerCase());
  return IMAGE_EXTENSIONS.test(file.name || '');
}

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
export function useImageUpload(ownerId: number | null): UseImageUploadResult {
  const toast = useToast();
  // 首帧从本地草稿恢复图片（切到微信再回来不会白填一场），与主组件同一数据源。
  // 必须带 ownerId：恢复出来的是【上一个账号学生的课堂照片】，换账号后绝不能带过来。
  const [images, setImages] = useState<string[]>(() => loadDraft(ownerId)?.images || []);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  /** 串行队列：拖拽与点击并发时排队执行，两批都要上传成功。
   *  不能直接并发——两批会共享 uploading，先完成的一方提前熄灭 loading，
   *  用户会以为没传完的图丢了；也不能丢弃后到的一批（那就是丢图）。
   *  排队 = 都成功 + loading 直到队列清空才熄灭。 */
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  /** 在跑/排队中的批次数。loading 只在归零时熄灭——
   *  若每批各自熄灭，Promise.all 在第一批返回时就 resolve，
   *  此时第二批还在排队，loading 会提前消失。 */
  const inflightRef = useRef(0);
  /** 卸载守卫：卸载后不再 setImages / setUploading（React 18 无害，但属无谓状态写） */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

    // 串行排队：本批接在上一批之后跑，两批的图都会上传成功。
    // 返回的 Promise 在【本批】结束时 resolve —— 调用方 await uploadFiles 仍然等的是自己这批。
    inflightRef.current++;
    setUploading(true);

    const run = async () => {
      let added = 0;
      let compressedCount = 0;
      let savedBytes = 0;
      /** 超过单张上限的文件：直接跳过并一次性提示，不发起注定 413 的请求 */
      const oversized: string[] = [];
      /** 非图片类型的文件：本地拦截，避免发起注定失败的请求 */
      const rejected: string[] = [];

      try {
        for (const file of list) {
          // W3：先做类型校验。微信拖拽会给出空 MIME，此时按扩展名兜底。
          if (!isImageFile(file)) {
            rejected.push(file.name || '未命名文件');
            continue;
          }

          // 压缩兜不住的情况（HEIC 在 Chrome 解不开、超大 TIFF 等）会走 passthrough，
          // 这里先按原始体积拦一刀，避免用户等完上传才看到 413。
          if (file.size > MAX_UPLOAD_BYTES) {
            oversized.push(file.name || '未命名图片');
            continue;
          }

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
            if (mountedRef.current) setImages((prev) => [...prev, ...res.paths]);
            added += res.paths.length;
          }
        }

        if (oversized.length) {
          toast.error(
            '有 ' + oversized.length + ' 张图片超过 ' + formatBytes(MAX_UPLOAD_BYTES) +
            '，已跳过：' + oversized.join('、') + '。请先裁剪或压缩后再上传。'
          );
        }

        if (rejected.length) {
          toast.error(
            '有 ' + rejected.length + ' 个文件不是支持的图片格式（JPG/PNG/WebP/GIF/HEIC），已跳过：' +
            rejected.join('、')
          );
        }

        if (added) {
          const suffix = compressedCount > 0 ? '（已压缩 ' + formatBytes(savedBytes) + '）' : '';
          toast.success('已上传 ' + added + ' 张图片' + suffix);
        }
      } catch (err: any) {
        toast.error('图片上传失败：' + (err instanceof Error ? err.message : String(err)));
      } finally {
        inflightRef.current--;
        // 只有队列中【所有】批次都跑完才熄灭 loading：
        // 若每批各自熄灭，Promise.all 在第一批返回时就 resolve，
        // 此时第二批还在排队，loading 会提前消失。
        if (inflightRef.current === 0 && mountedRef.current) setUploading(false);
      }
    };

    const task = queueRef.current.then(run, run);
    // 队列尾巴用 catch 兜住，防止某一批异常拖累后续批次不执行
    queueRef.current = task.catch(() => undefined);
    return task;
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
