import { describe, it, expect } from 'vitest';
import { splitReport, buildReportFilename } from './observation';

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
