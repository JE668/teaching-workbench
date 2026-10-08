/**
 * 从拖拽事件中尽可能健壮地提取图片。
 *
 * 为什么需要这个：
 * 不同应用（尤其是 macOS 微信）拖拽图片时提供数据的方式并不一致：
 *   - 标准应用：dataTransfer.files 直接给出 File
 *   - 部分应用：只在 dataTransfer.items 里以 getAsFile() 暴露
 *   - 部分应用：既没有 MIME 类型也没有扩展名
 *   - 少数应用：只给 text/html，内嵌 data: URL 的 <img>
 *
 * 只读 files 且按 MIME 过滤，会在微信场景下静默丢图 —— 因此这里层层兜底，
 * 并且把「什么都没提取到」的情况如实汇报给调用方以便提示用户。
 */

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i;

export interface DropExtractResult {
  /** 可直接上传的图片文件 */
  files: File[];
  /** 从 HTML 中解析出的内联 data: 图片 */
  inlineDataUrls: string[];
  /** 诊断信息：拖拽里到底有什么 */
  debug: {
    types: string[];
    fileCount: number;
    itemCount: number;
    sawHtml: boolean;
  };
}

/** 明显不是图片的类型，直接跳过以免白白请求服务端 */
const OBVIOUSLY_NOT_IMAGE = /^(text\/plain|text\/csv|application\/pdf|application\/json|application\/zip)/i;

function isUsableFile(f: File | null): f is File {
  if (!f) return false;
  // 明确是图片 → 收
  if (f.type && f.type.startsWith('image/')) return true;
  // 有图片扩展名 → 收（覆盖 MIME 缺失的情况）
  if (f.name && IMAGE_EXT.test(f.name)) return true;
  // 无 MIME 无扩展名 → 也收，交给服务端校验（微信常见）
  if (!f.type && !f.name) return true;
  // 其它：排除明确不是图片的类型，其余放行交给服务端
  if (f.type && OBVIOUSLY_NOT_IMAGE.test(f.type)) return false;
  return true;
}

/** 从一段 HTML 里提取 data: 开头的 img src */
export function extractInlineImageDataUrls(html: string): string[] {
  if (!html) return [];
  const out: string[] = [];
  const re = /<img[^>]+src=["'](data:image\/[^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    out.push(m[1]);
  }
  return out;
}

/** data: URL → File（便于复用同一个上传通道） */
export function dataUrlToFile(dataUrl: string, name = 'dropped-image.png'): File | null {
  const m = /^data:(image\/[^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;

  try {
    const binary = atob(m[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const ext = m[1].split('/')[1].replace('jpeg', 'jpg');
    return new File([bytes], name.replace(/\.\w+$/, '') + '.' + ext, { type: m[1] });
  } catch {
    return null;
  }
}

/**
 * 主入口：从 DataTransfer 中尽最大努力提取图片。
 * 注意：必须在 drop 事件处理器里【同步】调用，
 * 事件结束后 dataTransfer 会被浏览器清空。
 */
export function extractDroppedImages(dt: DataTransfer | null | undefined): DropExtractResult {
  const result: DropExtractResult = {
    files: [],
    inlineDataUrls: [],
    debug: { types: [], fileCount: 0, itemCount: 0, sawHtml: false },
  };

  if (!dt) return result;

  result.debug.types = dt.types ? Array.from(dt.types as ArrayLike<string>) : [];
  result.debug.fileCount = dt.files ? dt.files.length : 0;
  result.debug.itemCount = dt.items ? dt.items.length : 0;

  // 1) 标准路径
  if (dt.files && dt.files.length > 0) {
    for (const f of Array.from(dt.files)) {
      if (isUsableFile(f)) result.files.push(f);
    }
  }

  // 2) items 路径（部分应用只在这里暴露）
  if (dt.items && dt.items.length > 0) {
    for (const item of Array.from(dt.items)) {
      if (item.kind !== 'file') continue;
      const f = item.getAsFile();
      if (isUsableFile(f) && !result.files.includes(f)) {
        result.files.push(f);
      }
    }
  }

  // 3) HTML 内联图片兜底
  try {
    const html = dt.getData('text/html');
    if (html) {
      result.debug.sawHtml = true;
      const urls = extractInlineImageDataUrls(html);
      if (urls.length) {
        result.inlineDataUrls.push(...urls);
        if (result.files.length === 0) {
          urls.forEach((u, i) => {
            const f = dataUrlToFile(u, 'inline-' + (i + 1) + '.png');
            if (f) result.files.push(f);
          });
        }
      }
    }
  } catch {
    // getData 在某些情况下会抛错，忽略即可
  }

  return result;
}
