/**
 * 草稿同步 hook 共享的纯函数。
 * W6: 从 useDraftSync.ts 与 useObservationDraftSync.ts 中提取的重复逻辑。
 */

/**
 * 键顺序无关的序列化。
 * 用于判断"本地状态是否真的变了"——直接 JSON.stringify 会因键顺序不同而误判。
 */
export function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
      .join(',') +
    '}'
  );
}

/** 读取某个 DOM 元素上标记的同步字段名 */
export function fieldOf(el: Element | null): string | null {
  if (!el) return null;
  return el.getAttribute?.('data-sync-field') || null;
}
