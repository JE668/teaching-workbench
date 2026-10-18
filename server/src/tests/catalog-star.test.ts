import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAR_BATCH_SIZE,
  STAR_LABELS,
  STAR_MAX,
  STAR_MIN,
  buildRubric,
  buildStarPrompt,
  chunk,
  isValidStar,
  parseStarResponse,
  scoreCeiling,
  starCount,
  type StarCourseInput,
} from '../utils/catalogStar.js';

const ids = new Set([1, 2, 3, 4, 5]);

function mkCourses(n: number): StarCourseInput[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    content: '课程' + (i + 1),
    type: '专题',
    score: '7~10',
    difficulty: '★★★★',
    impact: '★★★★',
  }));
}

describe('scoreCeiling / starCount', () => {
  test('分值占比按上限取值', () => {
    assert.equal(scoreCeiling('7~10'), 10);
    assert.equal(scoreCeiling('3 ~ 6'), 6);
    assert.equal(scoreCeiling('12-14'), 14);
    assert.equal(scoreCeiling('20-30'), 30);
    assert.equal(scoreCeiling('8'), 8);
    assert.equal(scoreCeiling('7-10分'), 10);
  });

  test('未标分值返回 0', () => {
    assert.equal(scoreCeiling('/'), 0);
    assert.equal(scoreCeiling('—'), 0);
    assert.equal(scoreCeiling(''), 0);
  });

  test('学习难度数星', () => {
    assert.equal(starCount('★★★★'), 4);
    assert.equal(starCount('★★★★★'), 5);
    assert.equal(starCount('★'), 1);
    assert.equal(starCount('/'), 0);
    assert.equal(starCount(''), 0);
  });
});

describe('isValidStar', () => {
  test('1-5 的整数才有效', () => {
    for (let n = STAR_MIN; n <= STAR_MAX; n++) assert.ok(isValidStar(n), n + ' 应有效');
    assert.equal(isValidStar(0), false);
    assert.equal(isValidStar(6), false);
    assert.equal(isValidStar(2.5), false);
    assert.equal(isValidStar('3'), false);
    assert.equal(isValidStar(null), false);
    assert.equal(isValidStar(undefined), false);
  });
});

describe('chunk', () => {
  test('均分批次，尾部不满原样保留', () => {
    assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  });

  test('空数组与非法批次大小（回退成 1，不抛错）', () => {
    assert.deepEqual(chunk([], 100), []);
    assert.deepEqual(chunk([1, 2], 0), [[1], [2]]);
    assert.deepEqual(chunk([1, 2], -3), [[1], [2]]);
  });

  test('批次大小常量是 100', () => {
    assert.equal(STAR_BATCH_SIZE, 100);
  });
});

describe('buildRubric', () => {
  test('5 档都有标准', () => {
    const rubric = buildRubric();
    for (let n = 1; n <= 5; n++) {
      assert.ok(rubric.includes(n + ' '), '缺少第 ' + n + ' 档');
      assert.ok(rubric.includes(STAR_LABELS[n]), '缺少「' + STAR_LABELS[n] + '」');
    }
  });
});

describe('buildStarPrompt', () => {
  test('课程字段与档位标准都在提示词里', () => {
    const prompt = buildStarPrompt(
      [
        {
          id: 12,
          content: '阅读之句子理解',
          type: '专题',
          score: '7~10',
          difficulty: '★★★★',
          impact: '★★★★★',
          section: '现代文阅读',
        },
      ],
      { grade: '初二', subject: '语文', term: '秋季' }
    );

    assert.match(prompt, /id=12/);
    assert.match(prompt, /阅读之句子理解/);
    assert.match(prompt, /类型=专题/);
    assert.match(prompt, /分值占比=7~10/);
    assert.match(prompt, /学习难度=★★★★/);
    assert.match(prompt, /后续影响=★★★★★/);
    assert.match(prompt, /分区=现代文阅读/);
    assert.match(prompt, /年级=初二/);
    assert.match(prompt, /学科=语文/);
    assert.match(prompt, /学期=秋季/);
    assert.match(prompt, /只输出一个 JSON 对象/);
    assert.match(prompt, /"star"/);
  });

  test('缺字段不会输出空标签', () => {
    const prompt = buildStarPrompt([{ id: 3, content: 'x', type: '', score: '', difficulty: '', impact: '', section: '' }]);
    assert.match(prompt, /分值占比=\//);
    assert.match(prompt, /学习难度=\//);
    assert.doesNotMatch(prompt, /类型=$/);
    assert.doesNotMatch(prompt, /后续影响=$/);
    assert.doesNotMatch(prompt, /分区=$/);
  });

  test('批次大小控制在 100 门以内', () => {
    const prompt = buildStarPrompt(mkCourses(100));
    assert.ok(prompt.length > 0);
    const promptMany = buildStarPrompt(mkCourses(120));
    assert.ok(promptMany.length > prompt.length, '课程越多提示词越长');
  });
});

describe('parseStarResponse', () => {
  test('标准 JSON 输出', () => {
    const out = parseStarResponse('{"results":[{"id":1,"star":3},{"id":2,"star":5}]}', ids);
    assert.deepEqual(out, [
      { id: 1, star: 3 },
      { id: 2, star: 5 },
    ]);
  });

  test('带 Markdown 围栏也能解析', () => {
    const out = parseStarResponse('```json\n{"results":[{"id":1,"star":2}]}\n```', ids);
    assert.deepEqual(out, [{ id: 1, star: 2 }]);
  });

  test('前面带解释文字也能取到 JSON', () => {
    const out = parseStarResponse('好的，以下是定档结果：\n{"results":[{"id":1,"star":4}]}\n以上。', ids);
    assert.deepEqual(out, [{ id: 1, star: 4 }]);
  });

  test('直接给数组', () => {
    const out = parseStarResponse('[{"id":1,"star":1},{"id":2,"star":2}]', ids);
    assert.deepEqual(out, [
      { id: 1, star: 1 },
      { id: 2, star: 2 },
    ]);
  });

  test('支持 value 字段别名与嵌套包裹', () => {
    assert.deepEqual(parseStarResponse('{"results":[{"id":1,"value":5}]}', ids), [{ id: 1, star: 5 }]);
    assert.deepEqual(parseStarResponse('{"data":{"results":[{"id":2,"star":3}]}}', ids), [{ id: 2, star: 3 }]);
    assert.deepEqual(parseStarResponse('{"stars":[{"id":3,"star":2}]}', ids), [{ id: 3, star: 2 }]);
  });

  test('字符串型 star 也能转', () => {
    const out = parseStarResponse('{"results":[{"id":1,"star":"4"}]}', ids);
    assert.deepEqual(out, [{ id: 1, star: 4 }]);
  });

  test('越界与非法值丢弃，其余保留', () => {
    const out = parseStarResponse(
      '{"results":[{"id":1,"star":0},{"id":2,"star":6},{"id":3,"star":2.5},{"id":4,"star":"abc"},{"id":5,"star":3}]}',
      ids
    );
    assert.deepEqual(out, [{ id: 5, star: 3 }]);
  });

  test('不认识的 id 丢弃', () => {
    const out = parseStarResponse('{"results":[{"id":999,"star":3},{"id":1,"star":2}]}', ids);
    assert.deepEqual(out, [{ id: 1, star: 2 }]);
  });

  test('重复 id 取第一次的值', () => {
    const out = parseStarResponse('{"results":[{"id":1,"star":2},{"id":1,"star":5}]}', ids);
    assert.deepEqual(out, [{ id: 1, star: 2 }]);
  });

  test('纯乱码走正则抢救', () => {
    const out = parseStarResponse('定档如下：id=1 star=4，id=2 star=5，其余跳过', ids);
    assert.deepEqual(out, [
      { id: 1, star: 4 },
      { id: 2, star: 5 },
    ]);
  });

  test('完全无法解析时返回空数组，不抛错', () => {
    assert.deepEqual(parseStarResponse('抱歉我无法完成这个任务', ids), []);
    assert.deepEqual(parseStarResponse('', ids), []);
    assert.deepEqual(parseStarResponse('not json at all', ids), []);
  });
});
