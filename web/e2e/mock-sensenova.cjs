/**
 * 模拟 SenseNova（OpenAI 兼容接口），供端到端测试使用。
 *
 * 为什么需要它：流式生成涉及 SDK 解析 -> 后端 SSE -> 代理 -> 浏览器 整条链路，
 * 只测到接口层无法覆盖。用桩服务可以在不消耗真实额度、不依赖网络的前提下
 * 跑通完整链路。
 *
 * 启动：node e2e/mock-sensenova.cjs
 * 环境：MOCK_PORT（默认 3999）、MOCK_REPLY（自定义回复内容）
 */
const http = require('http');

const PORT = parseInt(process.env.MOCK_PORT || '3999', 10);
// 分片间隔：E2E 里调大可稳定观察到"逐步出现"的过程
const CHUNK_DELAY_MS = parseInt(process.env.MOCK_CHUNK_DELAY_MS || '25', 10);

const DEFAULT_REPLY = [
  '【课堂内容】本节课重点讲解异分母分数加减法的通分原理与步骤，通过数轴与图形直观演示，帮助学生理解分数单位统一的数学本质，并结合生活情境设计练习。',
  '【学生收获】李小明本节课专注度较高，能够主动举手回答问题，对通分方法的理解比较到位，独立完成基础题型时准确率良好，计算速度还有提升空间。',
  '【课后任务】完成练习册第12页第1到8题，重点巩固通分步骤；每天用5分钟做10道口算，提升计算速度与准确率。',
].join('');

const REPLY = process.env.MOCK_REPLY || DEFAULT_REPLY;

/** 纯文字字数（与后端口径一致：不含空白与标点） */
function countWords(text) {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').length;
}

const server = http.createServer((req, res) => {
  // 探活端点，供 Playwright webServer 等待就绪
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', words: countWords(REPLY) }));
    return;
  }

  if (!req.url.includes('/chat/completions')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let payload = {};
    try {
      payload = JSON.parse(body);
    } catch {
      /* 忽略解析失败 */
    }

    // ===== 流式 =====
    if (payload.stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const SIZE = 12;
      const chunks = [];
      for (let i = 0; i < REPLY.length; i += SIZE) chunks.push(REPLY.slice(i, i + SIZE));

      let i = 0;
      const timer = setInterval(() => {
        if (i >= chunks.length) {
          clearInterval(timer);
          res.write(
            'data: ' + JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n'
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.write(
          'data: ' + JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: chunks[i] }, finish_reason: null }] }) + '\n\n'
        );
        i++;
      }, CHUNK_DELAY_MS);

      // 注意：必须监听 res 而非 req —— req 的 close 在请求体读完时就会触发，
      // 会把定时器提前清掉（这个坑前后踩了两次）。
      res.on('close', () => clearInterval(timer));
      return;
    }

    // ===== 非流式 =====
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'mock',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: payload.model || 'mock',
        choices: [
          { index: 0, message: { role: 'assistant', content: REPLY }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      })
    );
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(
    '[mock-sensenova] listening on 127.0.0.1:' + PORT +
    ' | 回复 ' + countWords(REPLY) + ' 字 | 分片间隔 ' + CHUNK_DELAY_MS + 'ms'
  );
});
