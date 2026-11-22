import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import AiMetrics from './AiMetrics';
import { api } from '../api/client';
import { renderWithProviders } from '../test/test-utils';

vi.mock('../api/client', () => ({ api: { request: vi.fn() } }));
const request = api.request as Mock;

const summary = [
  {
    group: 'followup_stream', calls: 8, success_count: 8, error_count: 0, retry_count: 1,
    avg_latency_ms: 1200, min_latency_ms: 900, max_latency_ms: 1500,
    total_tokens: 8000, prompt_tokens: 5000, completion_tokens: 3000,
    avg_word_count: 420, last_call: '2026-11-22T10:00:00',
    successRate: 100, errorRate: 0, retryRate: 12.5,
  },
  {
    group: 'followup_once', calls: 4, success_count: 3, error_count: 1, retry_count: 0,
    avg_latency_ms: 1800, min_latency_ms: 1300, max_latency_ms: 2300,
    total_tokens: 4000, prompt_tokens: 2500, completion_tokens: 1500,
    avg_word_count: 460, last_call: '2026-11-22T11:00:00',
    successRate: 75, errorRate: 25, retryRate: 0,
  },
];

const endpoints = [
  {
    endpoint: 'followup_stream', calls: 8, successRate: 100, errorRate: 0,
    avgLatencyMs: 1200, totalTokens: 8000, promptTokens: 5000, completionTokens: 3000,
    avgWordCount: 420, lastCall: '2026-11-22T10:00:00',
  },
  {
    endpoint: 'followup_once', calls: 4, successRate: 75, errorRate: 25,
    avgLatencyMs: 1800, totalTokens: 4000, promptTokens: 2500, completionTokens: 1500,
    avgWordCount: 460, lastCall: '2026-11-22T11:00:00',
  },
];

const errors = [
  {
    provider: 'fixture', model: 'model-a', endpoint: 'followup_stream',
    error_message: 'fixture stream error', retry_count: 1, latency_ms: 1200,
    created_at: '2026-11-22T10:00:00',
  },
  {
    provider: 'fixture', model: 'model-b', endpoint: 'followup_once',
    error_message: 'fixture once error', retry_count: 0, latency_ms: 1800,
    created_at: '2026-11-22T11:00:00',
  },
];

function expectBusinessNamesOnly() {
  expect(screen.getByText('课后回访（逐段生成）')).toBeInTheDocument();
  expect(screen.getByText('课后回访（整篇生成）')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('followup_stream');
  expect(document.body.textContent).not.toContain('followup_once');
}

describe('AiMetrics business names', () => {
  beforeEach(() => {
    request.mockReset();
    request.mockImplementation(async (path: string) => {
      if (path.startsWith('/ai-metrics/summary')) return { summary };
      if (path.startsWith('/ai-metrics/timeseries')) return { data: [] };
      if (path.startsWith('/ai-metrics/endpoints')) return { endpoints };
      if (path.startsWith('/ai-metrics/errors')) return { errors };
      throw new Error('unexpected request: ' + path);
    });
  });

  it('uses follow-up business names in overview, comparison and error views', async () => {
    renderWithProviders(<AiMetrics />);

    expect(await screen.findByText('课后回访（逐段生成）')).toBeInTheDocument();
    expectBusinessNamesOnly();

    fireEvent.click(screen.getByRole('button', { name: '业务对比' }));
    expect(await screen.findByText('边生成边展示回访内容')).toBeInTheDocument();
    expect(screen.getByText('生成完成后一次返回完整回访')).toBeInTheDocument();
    expectBusinessNamesOnly();

    fireEvent.click(screen.getByRole('button', { name: '错误记录' }));
    expect(await screen.findByText('fixture stream error')).toBeInTheDocument();
    expectBusinessNamesOnly();
  });
});
