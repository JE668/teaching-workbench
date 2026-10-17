import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import { OBSERVATION_DIMENSIONS } from '../services/observation.js';

/**
 * 听评课 Word 导出。
 *
 * 采用 docxtemplater 精确套用用户提供的「星火个性化教学听评课表」模板
 * （server/templates/observation-template.docx，已在其各填值格预埋 {{tag}} 占位符），
 * 把 AI 评课报告解析成 8 项 + 综合评价四块 + 等级 + 签名 后填充，保留模板原样字体/边框。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let cachedTemplate: Buffer | null = null;

function loadTemplateBuffer(): Buffer {
  if (!cachedTemplate) {
    const p = path.resolve(__dirname, '../../templates/observation-template.docx');
    cachedTemplate = fs.readFileSync(p);
  }
  return cachedTemplate;
}

/** 压缩空白/换行为单行，便于填入 Word 表格单元格 */
function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

export interface ParsedObservationReport {
  /** 8 项，顺序同 OBSERVATION_DIMENSIONS */
  items: string[];
  highlight: string;
  optimize: string;
  suggest: string;
  /** 解析出的中文等级（优秀/良好/合格/有待提高），解析不出为 '' */
  grade: string;
}

/** 把 AI 纯文本评课报告解析为可填模板的结构化字段（容错：缺项留空，不抛错） */
export function parseObservationReport(report: string): ParsedObservationReport {
  const text = report || '';
  const tailIdx = text.indexOf('【综合评价与建议】');
  const head = tailIdx >= 0 ? text.slice(0, tailIdx) : text;
  const tail = tailIdx >= 0 ? text.slice(tailIdx) : '';

  // 8 项：按维度名切片（值从该维度名后的冒号，到下一个维度名之前）
  const dims = OBSERVATION_DIMENSIONS as readonly string[];
  const items: string[] = dims.map((dim, i) => {
    const start = head.indexOf(dim);
    if (start < 0) return '';
    const afterName = start + dim.length;
    const cFull = head.indexOf('：', afterName);
    const cHalf = head.indexOf(':', afterName);
    const colon =
      cFull < 0 ? cHalf : cHalf < 0 ? cFull : Math.min(cFull, cHalf);
    const valueStart = colon >= 0 ? colon + 1 : afterName;
    const nextDim = i + 1 < dims.length ? head.indexOf(dims[i + 1]) : -1;
    const valueEnd = nextDim >= 0 ? nextDim : head.length;
    return norm(head.slice(valueStart, valueEnd));
  });

  // 综合四块：在尾段按标签名切片（值 = 本标签到下一标签之间，去掉尾部下一项的编号）
  const stripTailNum = (s: string) => s.replace(/\s*[一二三四1-9]\s*[、.]\s*$/, '').trim();
  const between = (a: string, b: string | null): string => {
    const ia = tail.indexOf(a);
    if (ia < 0) return '';
    const after = ia + a.length;
    let vstart = after;
    const cFull = tail.indexOf('：', after);
    const cHalf = tail.indexOf(':', after);
    const colon = cFull < 0 ? cHalf : cHalf < 0 ? cFull : Math.min(cFull, cHalf);
    if (colon >= 0) vstart = colon + 1;
    const ib = b ? tail.indexOf(b, after) : -1;
    const vend = ib >= 0 ? ib : tail.length;
    return stripTailNum(norm(tail.slice(vstart, vend)));
  };

  const highlight = between('本节课亮点', '有待优化');
  const optimize = between('有待优化', '教学建议');
  const suggest = between('教学建议', '总体评价等级');

  const gmatch = tail.match(/总体评价等级[：:]\s*(优秀|良好|合格|有待提高)/);
  const grade = gmatch ? gmatch[1] : '';

  return { items, highlight, optimize, suggest, grade };
}

export interface ObservationDocxData {
  teacher: string;
  time: string;
  topic: string;
  type: string;
  evals: string[];
  highlight: string;
  optimize: string;
  suggest: string;
  grade: string;
  signature: string;
}

/** 渲染带占位符模板，返回已填充的 .docx（Node Buffer）。 */
export async function buildObservationDocx(d: ObservationDocxData): Promise<Buffer> {
  const zip = await new PizZip().load(loadTemplateBuffer());
  // 所有 {{tag}} 都集中在 word/document.xml；做字符串替换即可，保留模板全部格式
  let xml = zip.file('word/document.xml').asText();
  const values: Record<string, string> = {
    teacher: d.teacher || '',
    time: d.time || '',
    topic: d.topic || '',
    type: d.type || '',
    highlight: d.highlight || '',
    optimize: d.optimize || '',
    suggest: d.suggest || '',
    grade: d.grade || '',
    signature: d.signature || '',
  };
  (d.evals || []).forEach((v, i) => {
    values['eval' + (i + 1)] = v || '';
  });
  for (const [k, v] of Object.entries(values)) {
    xml = xml.split('{{' + k + '}}').join(v);
  }
  zip.file('word/document.xml', xml);
  return zip.generate({ type: 'nodebuffer' });
}
