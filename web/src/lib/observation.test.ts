import { describe, it, expect } from 'vitest';
import {
  splitReport,
  buildReportFilename,
  parseObservationBlocks,
  OBSERVATION_DIMENSIONS,
} from './observation';

describe('splitReport', () => {
  it('按【综合评价与建议】切成两块', () => {
    const r = '【听课人评价】\n一、教学目标：清晰\n【综合评价与建议】\n· 亮点：节奏好';
    const { head, tail } = splitReport(r);
    expect(head).toBe('一、教学目标：清晰');
    expect(tail).toBe('【综合评价与建议】\n· 亮点：节奏好');
  });

  it('无综合标记时整体归入 head', () => {
    const { head, tail } = splitReport('【听课人评价】\n一、a\n二、b');
    expect(head).toBe('一、a\n二、b');
    expect(tail).toBe('');
  });

  it('空报告安全返回空块', () => {
    const { head, tail } = splitReport('');
    expect(head).toBe('');
    expect(tail).toBe('');
  });
});

describe('buildReportFilename', () => {
  it('生成 老师_课题 文件名并清洗非法字符', () => {
    expect(buildReportFilename('王丽', '分数/加减?')).toBe('听评课_王丽_分数加减.txt');
  });

  it('缺省字段回退占位词', () => {
    expect(buildReportFilename('', '')).toBe('听评课_老师_报告.txt');
  });
});

/* ─────────── 评课报告图片卡片：切块 ─────────── */

const REPORT = [
  '【听课人评价】',
  '一、教学目标：目标清晰，聚焦通分能力。',
  '二、教学内容：容量适中，例题典型。',
  '三、教学方法：讲授与提问结合。',
  '四、学生参与度与学习状态：多数学生能跟上节奏。',
  '五、教学过程：环节完整，过渡自然。',
  '六、教师素养：板书工整，语言清晰。',
  '七、教学效果：当堂练习正确率较高。',
  '八、特色与创新：引入小组互查。',
  '【综合评价与建议】',
  '一、本节课亮点：节奏把控好。',
  '二、有待优化的部分：留白时间不足。',
  '三、教学建议：增加一题变式。',
  '四、总体评价等级：良好',
].join('\n');

describe('parseObservationBlocks', () => {
  it('标准报告切成两大块：8 项 + 综合四块，值不含编号尾巴', () => {
    const blocks = parseObservationBlocks(REPORT);
    expect(blocks.map((b) => b.heading)).toEqual(['听课人评价', '综合评价与建议']);
    expect(blocks[0].items.map((i) => i.label)).toEqual([...OBSERVATION_DIMENSIONS]);
    expect(blocks[1].items.map((i) => i.label)).toEqual([
      '本节课亮点',
      '有待优化',
      '教学建议',
      '总体评价等级',
    ]);

    const valueOf = (heading: string, label: string) =>
      blocks.find((b) => b.heading === heading)?.items.find((i) => i.label === label)?.value;
    expect(valueOf('听课人评价', '教学目标')).toBe('目标清晰，聚焦通分能力。');
    // "增加一题变式。 四、" 的编号尾巴要被去掉
    expect(valueOf('综合评价与建议', '教学建议')).toBe('增加一题变式。');
    expect(valueOf('综合评价与建议', '本节课亮点')).toBe('节奏把控好。');
    expect(valueOf('综合评价与建议', '总体评价等级')).toBe('良好');
  });

  it('缺项跳过、留空项不计入，不抛错', () => {
    const r = '【听课人评价】\n一、教学目标：清晰\n三、教学方法：\n【综合评价与建议】\n一、本节课亮点：好';
    const blocks = parseObservationBlocks(r);
    const items = blocks.find((b) => b.heading === '听课人评价')!.items;
    expect(items.map((i) => i.label)).toEqual(['教学目标']);
  });

  it('跳过缺失的标签时，不把下一块的正文吞进上一块', () => {
    const r =
      '【听课人评价】\n一、教学目标：清晰\n三、教学方法：讲授结合提问\n【综合评价与建议】\n' +
      '一、本节课亮点：节奏好\n二、总体评价等级：良好';
    const blocks = parseObservationBlocks(r);
    const head = blocks.find((b) => b.heading === '听课人评价')!;
    expect(head.items).toEqual([
      { label: '教学目标', value: '清晰' },
      { label: '教学方法', value: '讲授结合提问' },
    ]);
    const tail = blocks.find((b) => b.heading === '综合评价与建议')!;
    expect(tail.items.map((i) => i.value)).toEqual(['节奏好', '良好']);
  });

  it('维度切不出来时退化为整块原文，内容不丢', () => {
    const blocks = parseObservationBlocks('【听课人评价】\n这堂课整体不错，节奏明快。');
    expect(blocks).toEqual([
      { heading: '听课人评价', items: [{ label: '听课人评价', value: '这堂课整体不错，节奏明快。' }] },
    ]);
  });

  it('综合块没有标准标签时退化为整块原文', () => {
    const r = '【听课人评价】\n一、教学目标：清晰\n【综合评价与建议】\n亮点是节奏好，建议多留练习时间。';
    const tail = parseObservationBlocks(r).find((b) => b.heading === '综合评价与建议')!;
    expect(tail.items).toEqual([{ label: '综合评价', value: '亮点是节奏好，建议多留练习时间。' }]);
  });

  it('完全没有结构标记时退化为"听课人评价"一块', () => {
    expect(parseObservationBlocks('今天听了一节课，讲得不错。')).toEqual([
      { heading: '听课人评价', items: [{ label: '听课人评价', value: '今天听了一节课，讲得不错。' }] },
    ]);
  });

  it('只剩一个空标记时也退化，不产出空块', () => {
    expect(parseObservationBlocks('【综合评价与建议】')).toEqual([
      { heading: '评课报告', items: [{ label: '报告内容', value: '【综合评价与建议】' }] },
    ]);
  });

  it('空报告返回空数组', () => {
    expect(parseObservationBlocks('')).toEqual([]);
    expect(parseObservationBlocks('   \n  ')).toEqual([]);
  });

  it('兼容半角冒号', () => {
    const blocks = parseObservationBlocks('【听课人评价】\n一、教学目标:清晰\n【综合评价与建议】\n一、本节课亮点:节奏好');
    expect(blocks[0].items[0].value).toBe('清晰');
    expect(blocks[1].items[0].value).toBe('节奏好');
  });
});
