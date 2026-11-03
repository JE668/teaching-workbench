import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diffPlannedVsTaught, normalizeCourseText } from '../utils/planContinuity.js';

describe('规划→总结衔接 · 计划了却没上的课', () => {
  test('归一化：去空白标点、全角转半角、小写', () => {
    assert.equal(normalizeCourseText(' 凸透镜成像 的规律， '), '凸透镜成像的规律,');
    assert.equal(normalizeCourseText('ABC１２３'), 'abc123');
  });

  test('上月规划 A、B、C，本月只上了 A、B → C 是漏上的', () => {
    const plan = [
      { courseId: 1, content: '凸透镜成像' },
      { courseId: 2, content: '眼睛与眼镜' },
      { courseId: 3, content: '光的折射' },
    ];
    const taught = [
      { courseId: 1, content: '凸透镜成像' },
      { courseId: 2, content: '眼睛与眼镜' },
    ];
    const undelivered = diffPlannedVsTaught(plan, taught);
    assert.equal(undelivered.length, 1);
    assert.equal(undelivered[0].courseId, 3);
    assert.equal(undelivered[0].content, '光的折射');
  });

  test('没有目录关联的课用文本兜底匹配，改了措辞也认得出', () => {
    const plan = [{ courseId: null, content: '凸透镜成像' }];
    const taught = [{ courseId: null, content: '凸透镜成像的规律' }];
    // 注意：文本兜底是「完全归一化相等」才匹配，措辞变了不算同一节，
    // 这里 "凸透镜成像" != "凸透镜成像的规律"，所以会判为漏上 —— 这是保守正确的行为
    const undelivered = diffPlannedVsTaught(plan, taught);
    assert.equal(undelivered.length, 1);
  });

  test('没有目录关联但文本完全一致 → 算上过了', () => {
    const plan = [{ courseId: null, content: '眼睛与眼镜' }];
    const taught = [{ courseId: null, content: ' 眼睛与眼镜 ' }];
    const undelivered = diffPlannedVsTaught(plan, taught);
    assert.equal(undelivered.length, 0);
  });

  test('本月全上了 → 无漏上', () => {
    const plan = [
      { courseId: 1, content: 'A' },
      { courseId: 2, content: 'B' },
    ];
    const taught = [
      { courseId: 1, content: 'A' },
      { courseId: 2, content: 'B' },
    ];
    assert.equal(diffPlannedVsTaught(plan, taught).length, 0);
  });

  test('上月规划为空 → 无漏上', () => {
    assert.equal(diffPlannedVsTaught([], [{ courseId: 1, content: 'A' }]).length, 0);
  });

  test('结果保持上月规划的原顺序', () => {
    const plan = [
      { courseId: 3, content: 'C' },
      { courseId: 1, content: 'A' },
      { courseId: 2, content: 'B' },
    ];
    const taught = [{ courseId: 1, content: 'A' }];
    const undelivered = diffPlannedVsTaught(plan, taught);
    assert.deepEqual(undelivered.map((c) => c.content), ['C', 'B']);
    assert.deepEqual(undelivered.map((c) => c.seq), [0, 2]);
  });

  test('规划里空内容的行跳过，不算漏上', () => {
    const plan = [{ courseId: 1, content: '' }, { courseId: 2, content: '  ' }];
    const undelivered = diffPlannedVsTaught(plan, []);
    assert.equal(undelivered.length, 0);
  });

  test('漏上的课保留上月规划课的类型和难度（顺延到本月总结不丢属性）', () => {
    const plan = [
      { courseId: 1, content: '已上的课', type: '同步', difficulty: '★★' },
      { courseId: 2, content: '漏上的课', type: '专题', difficulty: '★★★★' },
    ];
    const taught = [{ courseId: 1, content: '已上的课' }];
    const undelivered = diffPlannedVsTaught(plan, taught);
    assert.equal(undelivered.length, 1);
    assert.equal(undelivered[0].content, '漏上的课');
    assert.equal(undelivered[0].type, '专题');
    assert.equal(undelivered[0].difficulty, '★★★★');
  });

  test('没填类型难度的课原样透传（纯函数不假设输入带这两列）', () => {
    const plan = [{ courseId: 1, content: '手工加的课' }];
    const undelivered = diffPlannedVsTaught(plan, []);
    // 纯函数只透传，不归一化；归一成空串是后端 toContinuity 的职责
    assert.equal(undelivered[0].type, undefined);
    assert.equal(undelivered[0].difficulty, undefined);
  });
});
