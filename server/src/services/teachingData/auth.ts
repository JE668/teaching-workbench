import { publicEncrypt, randomUUID, constants as cryptoConstants } from 'node:crypto';
import {
  MAX_REDIRECTS, SSO_2STEP_SEND, SSO_2STEP_VERIFY, SSO_BASE, SSO_RSA_PUBLIC_KEY, SSO_SIGNIN,
  TWO_STEP_MAX, TWO_STEP_TTL_MS,
} from './constants.js';
import { TeachingDataError, TokenInvalidError } from './errors.js';
import {
  CookieJar, createCookieJar, exchangeTeachingCode, externalRequest, followForCode,
  isAuthenticate, isRedirect, parseObject, assertAllowedUrl,
} from './http.js';
import { TtlLruStore } from './store.js';
import type { TwoStepMethod } from './types.js';

interface TwoStepSession {
  ownerId: number;
  username: string;
  jar: CookieJar;
}

const twoStepSessions = new TtlLruStore<TwoStepSession>(TWO_STEP_MAX, TWO_STEP_TTL_MS);

function encryptPassword(password: string): string {
  return publicEncrypt({
    key: SSO_RSA_PUBLIC_KEY,
    padding: cryptoConstants.RSA_PKCS1_PADDING,
  }, Buffer.from(password, 'utf8')).toString('base64');
}

function ownedSession(id: string, ownerId: number): TwoStepSession {
  const result = twoStepSessions.getOwned(id, ownerId);
  if (result.status === 'forbidden') {
    throw new TeachingDataError(403, '无权访问该二次验证会话。', 'forbidden');
  }
  if (result.status === 'missing') {
    throw new TeachingDataError(410, '二次验证会话已过期，请重新登录。', 'two_step_expired');
  }
  return result.value;
}

function signinError(body: Record<string, unknown>): never {
  const captcha = body.should_pass_captcha === true;
  throw new TeachingDataError(
    422,
    captcha ? 'SSO 要求完成验证码，请稍后重试。' : 'SSO 登录失败，请检查用户名和密码。',
    'login_failed',
  );
}

export async function login(username: string, password: string, ownerId: number): Promise<
  { token: string } | { needTwoStep: true; twoStepId: string; methods: ['sms', 'wx']; message: string }
> {
  const jar = createCookieJar();
  const response = await externalRequest(SSO_SIGNIN, {
    method: 'POST',
    body: { username, password: encryptPassword(password), should_pass_captcha: false },
    jar,
  });
  if (response.status === 401 || response.status === 403) {
    throw new TeachingDataError(422, 'SSO 登录失败，请检查用户名和密码。', 'login_failed');
  }
  if (!response.ok) throw new TeachingDataError(502, 'SSO 暂时不可用，请稍后重试。', 'upstream_error');
  const body = await parseObject(response);
  if (body.success !== true || typeof body.next !== 'string') signinError(body);
  const initial = assertAllowedUrl(new URL(body.next, SSO_BASE + '/'));

  // 显式处理第一段，以便在 authenticate 响应中保留会话 Cookie。
  let current = initial;
  let outcome: { kind: 'code'; code: string } | { kind: 'twoStep' } | undefined;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const step = await externalRequest(current, { jar });
    if (isRedirect(step)) {
      const location = step.headers.get('location');
      if (!location) throw new TeachingDataError(502, 'SSO 返回了无效的重定向。', 'upstream_error');
      let next: URL;
      try {
        next = assertAllowedUrl(new URL(location, current));
      } catch {
        throw new TeachingDataError(502, 'SSO 返回了无效的重定向。', 'upstream_error');
      }
      if (isAuthenticate(next)) {
        outcome = { kind: 'twoStep' };
        break;
      }
      current = next;
      continue;
    }
    if (!step.ok) throw new TeachingDataError(502, 'SSO 登录流程未完成，请稍后重试。', 'upstream_error');
    const code = current.searchParams.get('code');
    if (!code) throw new TeachingDataError(502, 'SSO 登录流程未返回授权码。', 'upstream_error');
    outcome = { kind: 'code', code };
    break;
  }
  if (!outcome) throw new TeachingDataError(502, 'SSO 重定向次数过多。', 'upstream_error');
  if (outcome.kind === 'code') return { token: await exchangeTeachingCode(jar, outcome.code) };

  const twoStepId = randomUUID();
  twoStepSessions.set(twoStepId, { ownerId, username, jar });
  return {
    needTwoStep: true,
    twoStepId,
    methods: ['sms', 'wx'],
    message: '请选择短信或企业微信完成二次验证。',
  };
}

export async function sendTwoStepCode(
  twoStepId: string,
  method: TwoStepMethod,
  phone: string | undefined,
  ownerId: number,
): Promise<{ sent: true; message: string }> {
  const session = ownedSession(twoStepId, ownerId);
  const body: Record<string, unknown> = { username: session.username };
  if (method === 'sms') body.phone = phone;
  const response = await externalRequest(SSO_2STEP_SEND[method], { method: 'POST', body, jar: session.jar });
  if (!response.ok) throw new TeachingDataError(502, '验证码发送失败，请稍后重试。', 'two_step_send_failed');
  const result = await parseObject(response);
  if (result.success !== true) {
    throw new TeachingDataError(422, '验证码发送失败，请检查手机号或稍后重试。', 'two_step_send_failed');
  }
  return { sent: true, message: '验证码已发送，请查收。' };
}

export async function verifyTwoStepCode(
  twoStepId: string,
  method: TwoStepMethod,
  code: string,
  ownerId: number,
): Promise<{ token: string }> {
  const session = ownedSession(twoStepId, ownerId);
  const response = await externalRequest(SSO_2STEP_VERIFY[method], {
    method: 'POST', body: { username: session.username, code }, jar: session.jar,
  });
  if (response.status === 401 || response.status === 403) {
    throw new TeachingDataError(422, '验证码错误或已过期，请重新输入。', 'two_step_verify_failed');
  }
  if (!response.ok) throw new TeachingDataError(502, '二次验证暂时不可用，请稍后重试。', 'upstream_error');
  const result = await parseObject(response);
  if (result.success !== true || typeof result.redirect_uri !== 'string') {
    throw new TeachingDataError(422, '验证码错误或已过期，请重新输入。', 'two_step_verify_failed');
  }
  try {
    const outcome = await followForCode(session.jar, new URL(result.redirect_uri, SSO_BASE + '/'));
    if (outcome.kind === 'twoStep') throw new Error('Unexpected second factor loop');
    const token = await exchangeTeachingCode(session.jar, outcome.code);
    twoStepSessions.deleteOwned(twoStepId, ownerId);
    return { token };
  } catch (error) {
    if (error instanceof TokenInvalidError) throw error;
    if (error instanceof TeachingDataError) throw error;
    throw new TeachingDataError(502, '二次验证后的登录流程未完成，请重试。', 'upstream_error');
  }
}
