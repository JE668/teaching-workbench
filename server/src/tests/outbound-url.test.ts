import './setup.js';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeUrlShape,
  assertSafeOutboundUrl,
  isBlockedIPv4,
  isBlockedIPv6,
  allowPrivateOutbound,
} from '../utils/outboundUrl.js';

/**
 * SSRF 防线单测。
 *
 * 这些用例的价值不在于覆盖 API 形状，而在于锁住"哪些地址绝不能被服务端访问"：
 * 以后有人放宽校验（比如为了支持某个内网网关），这里会先红。
 */
describe('出站地址校验 · 协议与形状', () => {
  test('拒绝非 http(s) 协议', () => {
    for (const bad of ['file:///etc/passwd', 'ftp://example.com', 'gopher://x', 'data:text/plain,x']) {
      assert.throws(() => assertSafeUrlShape(bad, { allowPrivate: true }), /http\(s\)|格式不正确/);
    }
  });

  test('拒绝 URL 内嵌用户名密码', () => {
    assert.throws(() => assertSafeUrlShape('https://user:pass@api.example.com/v1', { allowPrivate: true }), /用户名或密码/);
  });

  test('拒绝空地址与残缺地址', () => {
    assert.throws(() => assertSafeUrlShape('', { allowPrivate: true }), /不能为空/);
    assert.throws(() => assertSafeUrlShape('api.example.com/v1', { allowPrivate: true }), /格式不正确/);
  });

  test('公网 https 地址放行', () => {
    const url = assertSafeUrlShape('https://token.sensenova.cn/v1', { allowPrivate: false });
    assert.equal(url.hostname, 'token.sensenova.cn');
  });
});

describe('出站地址校验 · 内网与回环', () => {
  test('生产策略下拒绝回环、私网、链路本地、IPv6 本地', () => {
    const bad = [
      'http://127.0.0.1:3000/v1',
      'http://localhost:8080/v1',
      'http://10.1.2.3/v1',
      'http://192.168.1.10:11434/v1',
      'http://172.20.0.5/v1',
      'http://[::1]:3000/v1',
      'http://[fe80::1]/v1',
      'http://[fc00::1]/v1',
    ];
    for (const u of bad) {
      assert.throws(() => assertSafeUrlShape(u, { allowPrivate: false }), /内网|本机/, '应拒绝 ' + u);
    }
  });

  test('显式允许内网时，普通内网地址放行（自建 Ollama 场景）', () => {
    assert.doesNotThrow(() => assertSafeUrlShape('http://192.168.1.10:11434/v1', { allowPrivate: true }));
  });

  test('元数据地址即使允许内网也必须拒绝', () => {
    for (const u of [
      'http://169.254.169.254/latest/meta-data/',
      'http://100.100.100.200/latest/meta-data/',
      'http://metadata.google.internal/computeMetadata/v1/',
    ]) {
      assert.throws(() => assertSafeUrlShape(u, { allowPrivate: true }), /元数据|内网|本机/, '应拒绝 ' + u);
    }
  });

  test('IPv4 / IPv6 判定覆盖保留段', () => {
    for (const ip of ['0.0.0.0', '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '224.0.0.1', '255.255.255.255']) {
      assert.equal(isBlockedIPv4(ip), true, ip + ' 应被判为内网/保留');
    }
    assert.equal(isBlockedIPv4('8.8.8.8'), false);
    assert.equal(isBlockedIPv4('1.1.1.1'), false);

    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '2001:db8::1', '::ffff:127.0.0.1']) {
      assert.equal(isBlockedIPv6(ip), true, ip + ' 应被判为内网/保留');
    }
    assert.equal(isBlockedIPv6('2400:3200::1'), false, '公网 IPv6 不该被误杀');
  });
});

describe('出站地址校验 · DNS 解析', () => {
  test('解析到回环的域名在生产策略下被拒', async () => {
    // 直接用字面量走不到 DNS 分支，这里用 localhost 的别名形式触发解析。
    await assert.rejects(
      assertSafeOutboundUrl('http://localhost.localdomain:3000/v1', { allowPrivate: false }),
      /内网|本机|无法解析/
    );
  });

  test('测试环境默认放行回环（mock 上游依赖）', async () => {
    assert.equal(allowPrivateOutbound(), true, 'NODE_ENV=test 应默认放行私网');
    await assert.doesNotReject(assertSafeOutboundUrl('http://127.0.0.1:3999/v1'));
  });
});
