import { describe, it, expect } from 'vitest';
import { parseSections, sectionsForCard } from './sections';

describe('sectionsForCard', () => {
  it('标准三段都能拆出', () => {
    const c = '【课堂内容】分数加减法\n【学生收获】掌握通分\n【课后任务】完成 3 题';
    const s = sectionsForCard(c);
    expect(s).toEqual([
      { heading: '课堂内容', body: '分数加减法' },
      { heading: '学生收获', body: '掌握通分' },
      { heading: '课后任务', body: '完成 3 题' },
    ]);
  });

  it('缺某段则跳过对应段', () => {
    const s = sectionsForCard('【课堂内容】abc\n【课后任务】做练习');
    expect(s.map((x) => x.heading)).toEqual(['课堂内容', '课后任务']);
  });

  it('解析不出任何段落 → 整段正文作为单一"回访内容"', () => {
    const s = sectionsForCard('今天讲了很多内容，没有用中括号标记。');
    expect(s).toEqual([{ heading: '回访内容', body: '今天讲了很多内容，没有用中括号标记。' }]);
  });

  it('空内容 → 空数组（卡片会显示空正文）', () => {
    expect(sectionsForCard('')).toEqual([]);
    expect(sectionsForCard('   ')).toEqual([]);
  });

  it('保留段内换行，去除段尾空白', () => {
    const c = '【课堂内容】第一行\n第二行   \n【学生收获】收获内容';
    const s = parseSections(c);
    expect(s.content).toBe('第一行\n第二行');
    expect(s.gains).toBe('收获内容');
  });
});
