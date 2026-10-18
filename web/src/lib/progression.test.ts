import { describe, it, expect } from 'vitest';
import { buildProgression, MASTERY_SCORE, TREND_META } from './progression';

function fu(daysAgo: number, mastery: string, topic = 'T'): { createdAt: string; topic: string; mastery: string } {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return {
    createdAt: d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' 10:00:00',
    topic,
    mastery,
  };
}

describe('掌握程度分值', () => {
  it('四个等级从高到低 4/3/2/1', () => {
    expect(MASTERY_SCORE.excellent).toBe(4);
    expect(MASTERY_SCORE.good).toBe(3);
    expect(MASTERY_SCORE.average).toBe(2);
    expect(MASTERY_SCORE.needs_improvement).toBe(1);
  });

  it('未识别的值不进映射，比较时会被跳过', () => {
    expect(MASTERY_SCORE['随便写的文字']).toBeUndefined();
    expect(MASTERY_SCORE['']).toBeUndefined();
  });
});

describe('纵向趋势判定', () => {
  it('逐次上升 → 明显提升', () => {
    const p = buildProgression([fu(60, 'needs_improvement'), fu(40, 'average'), fu(20, 'good'), fu(5, 'excellent')]);
    expect(p.firstAvg).toBeCloseTo(1.5);
    expect(p.lastAvg).toBeCloseTo(3.5);
    expect(p.delta).toBeCloseTo(2);
    expect(p.trend).toBe('up_strong');
  });

  it('小幅上升（跨过一档内）→ 稳步提升', () => {
    const p = buildProgression([fu(30, 'needs_improvement'), fu(5, 'average')]);
    expect(p.delta).toBeCloseTo(1);
    expect(p.trend).toBe('up');
  });

  it('前后一致 → 基本持平', () => {
    const p = buildProgression([fu(30, 'good'), fu(20, 'average'), fu(10, 'good'), fu(2, 'average')]);
    expect(p.delta).toBeCloseTo(0);
    expect(p.trend).toBe('flat');
  });

  it('逐次下降 → 明显下滑', () => {
    const p = buildProgression([fu(40, 'excellent'), fu(20, 'good'), fu(5, 'needs_improvement')]);
    expect(p.delta).toBeLessThan(-1);
    expect(p.trend).toBe('down_strong');
  });

  it('小幅下降 → 略有下滑', () => {
    const p = buildProgression([fu(20, 'excellent'), fu(5, 'good')]);
    expect(p.trend).toBe('down');
  });

  it('用前后两段的均值，而不是被单点带偏', () => {
    // 第一条是偶然的高分，但整体在进步 —— 不应判成下滑
    const p = buildProgression([fu(40, 'excellent'), fu(20, 'average'), fu(10, 'good'), fu(2, 'excellent')]);
    expect(p.trend).not.toBe('down_strong');
    expect(p.firstAvg).toBeCloseTo(3);
    expect(p.lastAvg).toBeCloseTo(3.5);
  });

  it('按时间升序排列，哪怕传入的顺序是乱的', () => {
    const p = buildProgression([fu(5, 'good'), fu(60, 'needs_improvement'), fu(30, 'average')]);
    expect(p.points.map((x) => x.mastery)).toEqual(['needs_improvement', 'average', 'good']);
    expect(p.points.map((x) => x.topic)).toEqual(['T', 'T', 'T']);
    expect(p.firstAvg).toBeCloseTo(1.5);
    expect(p.lastAvg).toBe(3);
    expect(p.trend).toBe('up_strong');
  });

  it('同一时刻的多条记录用 id 兜底，先录的算更早一次', () => {
    const same = '2026-10-08 10:00:00';
    const p = buildProgression([
      { id: 2, createdAt: same, topic: 'B', mastery: 'excellent' },
      { id: 1, createdAt: same, topic: 'A', mastery: 'needs_improvement' },
    ]);
    expect(p.points.map((x) => x.topic)).toEqual(['A', 'B']);
    expect(p.delta).toBeCloseTo(3);
    expect(p.trend).toBe('up_strong');
  });
});

describe('数据不足与脏数据', () => {
  it('只有一条回访时给"数据不足"，不硬凑趋势', () => {
    const p = buildProgression([fu(5, 'good')]);
    expect(p.trend).toBe('insufficient');
    expect(p.firstAvg).toBeNull();
    expect(p.delta).toBe(0);
  });

  it('零条回访时给"数据不足"且不报错', () => {
    expect(buildProgression([]).trend).toBe('insufficient');
  });

  it('mastery 全是脏值时跳过不计，判为数据不足', () => {
    const p = buildProgression([fu(20, '写得很好'), fu(5, '还可以')]);
    expect(p.points).toHaveLength(2);
    expect(p.points.every((x) => x.score === null)).toBe(true);
    expect(p.trend).toBe('insufficient');
  });

  it('脏值夹杂在中间不影响其余分值的计算', () => {
    const p = buildProgression([fu(30, 'needs_improvement'), fu(15, '脏值'), fu(5, 'excellent')]);
    expect(p.scored).toBe(3);
    expect(p.firstAvg).toBe(1);
    expect(p.lastAvg).toBe(4);
    expect(p.trend).toBe('up_strong');
  });
});

describe('趋势文案与配色齐备', () => {
  it('五种判定都有文案和色调，不会出现空状态', () => {
    for (const t of ['up_strong', 'up', 'flat', 'down', 'down_strong'] as const) {
      expect(TREND_META[t].label.length).toBeGreaterThan(0);
      expect(TREND_META[t].tone).toBeTruthy();
    }
  });
});
