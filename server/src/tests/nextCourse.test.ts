import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { suggestNextCourses, type CatalogCourseForNext } from '../utils/nextCourse.js';

const catalog: CatalogCourseForNext[] = [
  { id: 1, track: '力学', seq: 1, content: '力的基本概念', type: '同步', difficulty: '★' },
  { id: 2, track: '力学', seq: 2, content: '牛顿第一定律', type: '同步', difficulty: '★★' },
  { id: 3, track: '力学', seq: 3, content: '牛顿第二定律', type: '同步', difficulty: '★★★' },
  { id: 4, track: '光学', seq: 1, content: '光的反射', type: '同步', difficulty: '★' },
  { id: 5, track: '光学', seq: 2, content: '凸透镜成像', type: '同步', difficulty: '★★★★' },
  { id: 6, track: '', seq: 1, content: '没分轨道的课', type: '专题', difficulty: '★' },
];

describe('目录智能排课 · 推荐下月该上什么', () => {
  test('完全没上过时，每条轨道推荐 seq 最小的第一门', () => {
    const suggestions = suggestNextCourses(catalog, []);
    const mechanics = suggestions.find((s) => s.track === '力学')!;
    assert.equal(mechanics.course!.id, 1);
    assert.equal(mechanics.takenCount, 0);
    assert.equal(mechanics.totalCount, 3);
    assert.equal(mechanics.finished, false);
  });

  test('力学上了第 1、2 门 → 推荐第 3 门', () => {
    const suggestions = suggestNextCourses(catalog, [1, 2]);
    const mechanics = suggestions.find((s) => s.track === '力学')!;
    assert.equal(mechanics.course!.id, 3);
    assert.equal(mechanics.takenCount, 2);
    assert.equal(mechanics.finished, false);
  });

  test('力学全上完 → finished=true，course=null，不再推荐', () => {
    const suggestions = suggestNextCourses(catalog, [1, 2, 3]);
    const mechanics = suggestions.find((s) => s.track === '力学')!;
    assert.equal(mechanics.finished, true);
    assert.equal(mechanics.course, null);
    assert.equal(mechanics.takenCount, 3);
  });

  test('各轨道独立推荐，互不影响', () => {
    // 力学上了 1，光学上了 4
    const suggestions = suggestNextCourses(catalog, [1, 4]);
    const mechanics = suggestions.find((s) => s.track === '力学')!;
    const optics = suggestions.find((s) => s.track === '光学')!;
    assert.equal(mechanics.course!.id, 2);
    assert.equal(optics.course!.id, 5);
  });

  test('没分轨道的课归到空串轨道，也能兜底推荐', () => {
    const suggestions = suggestNextCourses(catalog, []);
    const noTrack = suggestions.find((s) => s.track === '')!;
    assert.equal(noTrack.course!.id, 6);
  });

  test('结果排序：有轨道名的按轨道名排，没 track 的兜底组排最后', () => {
    const suggestions = suggestNextCourses(catalog, []);
    const tracks = suggestions.map((s) => s.track);
    assert.equal(tracks[tracks.length - 1], '');
    assert.deepEqual(tracks.slice(0, -1), ['力学', '光学'].sort((a, b) => a.localeCompare(b, 'zh')));
  });

  test('seq 相同时按 id 稳定排序，避免顺序抖动', () => {
    const tied: CatalogCourseForNext[] = [
      { id: 10, track: 'T', seq: 1, content: '第二门', type: '', difficulty: '' },
      { id: 9, track: 'T', seq: 1, content: '第一门', type: '', difficulty: '' },
    ];
    const suggestions = suggestNextCourses(tied, []);
    assert.equal(suggestions[0].course!.id, 9);
  });

  test('目录为空 → 返回空数组', () => {
    assert.deepEqual(suggestNextCourses([], []), []);
  });
});
