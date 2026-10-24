/**
 * 模拟 SenseNova（OpenAI 兼容接口），供端到端测试使用。
 *
 * 为什么需要它：流式生成涉及 SDK 解析 -> 后端 SSE -> 代理 -> 浏览器 整条链路，
 * 只测到接口层无法覆盖。用桩服务可以在不消耗真实额度、不依赖网络的前提下
 * 跑通完整链路。
 *
 * 启动：node e2e/mock-sensenova.cjs
 * 环境：MOCK_PORT（默认 3999）、MOCK_REPLY（强制固定某一份回复内容）
 *
 * 回复内容按提示词分发：后端有两条生成链路（课后回访、听评课报告），
 * 各自的输出格式完全不同——回访是多板块各一段 + 两段收尾，听评课报告是
 * 【课堂内容】三段。只给一份固定回复会同时喂给两边，断言必有一边崩，
 * 所以这里按提示词内容挑对应的一份。
 */
const http = require('http');

const PORT = parseInt(process.env.MOCK_PORT || '3999', 10);
// 分片间隔：E2E 里调大可稳定观察到"逐步出现"的过程
const CHUNK_DELAY_MS = parseInt(process.env.MOCK_CHUNK_DELAY_MS || '25', 10);

// —— 课后回访：默认勾选的 5 个板块各一段 + 学生收获 + 课后任务。
// 形态必须跟真实提示词一致，字数要落在 5 个板块的 200-300 区间内，
// 前端才算「字数合格」、保存按钮才走「保存并归档到学生档案」。
const FOLLOWUP_REPLY = [
  '【作业批改】批改了练习册第12页作业，错在异分母通分漏乘分子那两题，已逐题订正。',
  '【课堂内容总结】本节课讲了异分母分数加减法，重点是通分，进度到练习巩固。',
  '【课堂表现总结】小明听讲专注、主动举手，卡在通分那一步容易漏乘分子。',
  '【笔记/解题痕迹】笔记完整，在通分例题旁标注了步骤。',
  '【作业布置】布置练习册第15页1到8题，重点练通分，约20分钟。',
  '【学生收获】小明这次通分原理理解得比较到位，是收获最大的一点，独立计算速度还卡着。',
  '【课后任务】做练习册第15页1到8题，再每天10道口算，做完把错题照片发给我。',
].join('\n');

// —— 听评课报告：【课堂内容】三段式，导出到 Word 表与文本里
const OBSERVATION_REPLY = [
  '【课堂内容】本节课重点讲解异分母分数加减法的通分原理与步骤，通过数轴与图形直观演示，帮助学生理解分数单位统一的数学本质，并结合生活情境设计练习。',
  '【学生收获】李小明本节课专注度较高，能够主动举手回答问题，对通分方法的理解比较到位，独立完成基础题型时准确率良好，计算速度还有提升空间。',
  '【课后任务】完成练习册第12页第1到8题，重点巩固通分步骤；每天用5分钟做10道口算，提升计算速度与准确率。',
].join('\n');

/** 按提示词挑对应的一份回复；提示词里取不到内容时退回回访那份 */
function replyFor(payload) {
  const prompt = (payload.messages || [])
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n');

  if (prompt.includes('评课维度') || prompt.includes('被听课老师')) return OBSERVATION_REPLY;
  return FOLLOWUP_REPLY;
}

/** 纯文字字数（与后端口径一致：不含空白与标点） */
function countWords(text) {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').length;
}

const server = http.createServer((req, res) => {
  // 探活端点，供 Playwright webServer 等待就绪
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        followupWords: countWords(FOLLOWUP_REPLY),
        observationWords: countWords(OBSERVATION_REPLY),
      })
    );
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

    // MOCK_REPLY 优先级最高，方便单个用例钉死一份回复
    const REPLY = process.env.MOCK_REPLY || replyFor(payload);

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
    ' | 回访回复 ' + countWords(FOLLOWUP_REPLY) + ' 字 / 评课回复 ' + countWords(OBSERVATION_REPLY) + ' 字' +
    ' | 分片间隔 ' + CHUNK_DELAY_MS + 'ms'
  );
});
