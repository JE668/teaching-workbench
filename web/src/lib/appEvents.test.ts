import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_COMMANDS, emitAppCommand, subscribeAppCommand, type AppCommand } from './appEvents';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = Object.keys(APP_COMMANDS) as AppCommand[];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e.name)) out.push(full);
    }
  };
  walk(SRC);
  return out;
}

const FILES = sourceFiles();
const readSource = (f: string) => fs.readFileSync(f, 'utf8');
const isBus = (f: string) => f.endsWith('appEvents.ts');
const isTest = (f: string) => /\.test\./.test(f);

describe('appEvents 命令总线', () => {
  it('派发后订阅者收到，取消订阅后不再收到', () => {
    const handler = vi.fn();
    const off = subscribeAppCommand('save', handler);
    emitAppCommand('save');
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    emitAppCommand('save');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('互不串台：派发一条命令不会触发别的订阅者', () => {
    const onSave = vi.fn();
    const onGenerate = vi.fn();
    const offA = subscribeAppCommand('save', onSave);
    const offB = subscribeAppCommand('generate', onGenerate);
    emitAppCommand('generate');
    expect(onGenerate).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    offA();
    offB();
  });

  it('命令名集中登记，不重复', () => {
    const values = Object.values(APP_COMMANDS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('命令接线守卫（防止再出现「点了没反应」）', () => {
  it('每条命令都在 App.tsx 里派发', () => {
    const app = readSource(path.join(SRC, 'App.tsx'));
    const missing = KEYS.filter((k) => !app.includes("emitAppCommand('" + k + "')"));
    expect(missing).toEqual([]);
  });

  it('每条命令都有页面订阅', () => {
    const pages = FILES.filter((f) => !isBus(f) && !isTest(f));
    const missing = KEYS.filter((k) => !pages.some((f) => readSource(f).includes("useAppCommand('" + k + "'")));
    expect(missing).toEqual([]);
  });

  it('源码里不再出现裸的 app: 命令字面量', () => {
    const offenders = FILES.filter((f) => !isBus(f) && /['"`]app:/.test(readSource(f)));
    expect(offenders).toEqual([]);
  });
});
