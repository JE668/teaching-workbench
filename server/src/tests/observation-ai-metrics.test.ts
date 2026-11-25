import './setup.js';
import assert from 'node:assert/strict';
import { afterEach, before, beforeEach, describe, test } from 'node:test';
import { db, initDatabase } from '../config/database.js';
import { getAiConfig, setSetting } from '../config/settings.js';
import { countWords } from '../services/ai/index.js';
import {
  resetObservationGenerator,
  resetObservationStreamer,
  runObservationGeneration,
  runObservationStream,
  setObservationGenerator,
  setObservationStreamer,
  type ObservationReportParams,
} from '../services/observation.js';

const PARAMS: ObservationReportParams = {
  teacherName: '王老师',
  topic: '分数加减法',
  lessonTypeLabel: '新授课',
  classNotes: '学生主动参与课堂互动。',
};

let userId = 0;

interface MetricRow {
  user_id: number;
  provider: string;
  model: string;
  endpoint: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  latency_ms: number;
  status: 'success' | 'error';
  error_message: string | null;
  retry_count: number;
  word_count: number | null;
  word_range_min: number | null;
  word_range_max: number | null;
}

before(async () => {
  await initDatabase();
  userId = Number(
    db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('observation-ai-metrics', 'x').lastInsertRowid
  );
  setSetting('ai.provider', 'fixture-provider', userId);
  setSetting('ai.model', 'fixture-observation-model', userId);
});

beforeEach(() => {
  db.prepare('DELETE FROM ai_metrics').run();
  resetObservationGenerator();
  resetObservationStreamer();
});

afterEach(() => {
  resetObservationGenerator();
  resetObservationStreamer();
});

function metricCount(): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM ai_metrics').get() as { count: number }).count;
}

function onlyMetric(endpoint: 'observation_once' | 'observation_stream'): MetricRow {
  const rows = db.prepare(
    `SELECT user_id, provider, model, endpoint, prompt_tokens, completion_tokens, total_tokens,
            latency_ms, status, error_message, retry_count, word_count, word_range_min, word_range_max
       FROM ai_metrics
      WHERE endpoint = ?`
  ).all(endpoint) as MetricRow[];
  assert.equal(rows.length, 1, endpoint + ' 应只写入一条指标');
  return rows[0];
}

function assertCommonFields(row: MetricRow, endpoint: 'observation_once' | 'observation_stream'): void {
  const config = getAiConfig(userId);
  assert.equal(row.user_id, userId);
  assert.equal(row.provider, config.provider);
  assert.equal(row.model, config.model);
  assert.equal(row.endpoint, endpoint);
  assert.ok(Number.isInteger(row.latency_ms));
  assert.ok(row.latency_ms >= 0);
  assert.equal(row.prompt_tokens, 0, '没有 usage 时 prompt token 应保持默认零值');
  assert.equal(row.completion_tokens, 0, '没有 usage 时 completion token 应保持默认零值');
  assert.equal(row.total_tokens, 0, '没有 usage 时 total token 应保持默认零值');
  assert.equal(row.retry_count, 0);
  assert.equal(row.word_range_min, null);
  assert.equal(row.word_range_max, null);
}

describe('听评课公共入口 AI 指标', () => {
  test('一次性成功：保留报告并记录 observation_once 与完整报告字数', async () => {
    const report = '教学目标：目标明确，贴合课程标准。\n综合评价：学生积极参与，目标达成良好。';
    setObservationGenerator(async (seenUserId, seenParams) => {
      assert.equal(seenUserId, userId);
      assert.strictEqual(seenParams, PARAMS);
      return report;
    });

    const result = await runObservationGeneration(userId, PARAMS);

    assert.strictEqual(result, report);
    const metric = onlyMetric('observation_once');
    assertCommonFields(metric, 'observation_once');
    assert.equal(metric.status, 'success');
    assert.equal(metric.error_message, null);
    assert.equal(metric.word_count, countWords(report));
  });

  test('一次性失败：记录 observation_once 错误并原样抛出异常', async () => {
    const failure = new Error('once fixture failed');
    setObservationGenerator(async () => {
      throw failure;
    });

    await assert.rejects(runObservationGeneration(userId, PARAMS), (error) => {
      assert.strictEqual(error, failure);
      return true;
    });

    const metric = onlyMetric('observation_once');
    assertCommonFields(metric, 'observation_once');
    assert.equal(metric.status, 'error');
    assert.equal(metric.error_message, failure.message);
    assert.equal(metric.word_count, null);
  });

  test('流式成功：完整结束后记录 observation_stream 与拼接报告字数', async () => {
    const chunks = ['教学目标：目标明确。\n', '学生积极参与，', '课堂互动充分，目标达成良好。'];
    setObservationStreamer((seenUserId, seenParams) => {
      assert.equal(seenUserId, userId);
      assert.strictEqual(seenParams, PARAMS);
      return (async function* () {
        for (const chunk of chunks) yield chunk;
      })();
    });

    const stream = runObservationStream(userId, PARAMS);
    for (const chunk of chunks) {
      const step = await stream.next();
      assert.deepEqual(step, { value: chunk, done: false });
      assert.equal(metricCount(), 0, '生成器尚未完整结束时不应提前记 success');
    }
    const done = await stream.next();
    assert.equal(done.done, true);

    const metric = onlyMetric('observation_stream');
    assertCommonFields(metric, 'observation_stream');
    assert.equal(metric.status, 'success');
    assert.equal(metric.error_message, null);
    assert.equal(metric.word_count, countWords(chunks.join('')));
  });

  test('流式失败：中途抛错记录 observation_stream 错误并原样抛出', async () => {
    const failure = new Error('stream fixture failed');
    setObservationStreamer(() =>
      (async function* () {
        yield '已生成的前半段。';
        throw failure;
      })()
    );

    const stream = runObservationStream(userId, PARAMS);
    assert.deepEqual(await stream.next(), { value: '已生成的前半段。', done: false });
    assert.equal(metricCount(), 0);
    await assert.rejects(stream.next(), (error) => {
      assert.strictEqual(error, failure);
      return true;
    });

    const metric = onlyMetric('observation_stream');
    assertCommonFields(metric, 'observation_stream');
    assert.equal(metric.status, 'error');
    assert.equal(metric.error_message, failure.message);
    assert.equal(metric.word_count, null);
  });
});
