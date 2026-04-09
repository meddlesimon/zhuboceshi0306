import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import crypto from 'crypto';
import WebSocket from 'ws';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据目录（提前定义，callGemini 需要）
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = path.join(DATA_DIR, 'db.json');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 模型配置现在从 db.json 动态读取，这里只保留兜底默认值
const DEFAULT_GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
const DEFAULT_GEMINI_URL = process.env.GEMINI_URL || 'https://cn2us02.opapi.win/v1/chat/completions';

const ADMIN_USER = process.env.ADMIN_USER || '18611979493';
const ADMIN_PWD = process.env.ADMIN_PWD || '230101';

// 初始化管理员账号
function ensureAdminAccounts() {
  const db = loadDB();
  if (!db.admin_accounts) db.admin_accounts = [];
  // 确保超级管理员存在
  const superAdmin = db.admin_accounts.find(a => a.username === '18611979493');
  if (!superAdmin) {
    db.admin_accounts.push({
      id: 'admin_super',
      username: '18611979493',
      password: '230101',
      display_name: '超级管理员',
      role: 'super_admin',
      created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    });
  }
  // 确保第一个普通管理员存在
  const firstAdmin = db.admin_accounts.find(a => a.username === 'zhanghaohui');
  if (!firstAdmin) {
    db.admin_accounts.push({
      id: 'admin_' + Date.now(),
      username: 'zhanghaohui',
      password: '888888',
      display_name: '张浩辉',
      role: 'admin',
      created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    });
  }
  saveDB(db);
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const db = loadDB();
  if (!db.admin_accounts) db.admin_accounts = [];
  const account = db.admin_accounts.find(a => a.username === username && a.password === password);
  if (account) {
    res.json({ success: true, role: account.role, display_name: account.display_name, username: account.username });
  } else {
    res.status(401).json({ success: false, error: '账号或密码错误' });
  }
});

// 管理员列表（仅超级管理员可用）
app.get('/api/admin/accounts', (req, res) => {
  const db = loadDB();
  const accounts = (db.admin_accounts || []).map(a => ({
    id: a.id, username: a.username, display_name: a.display_name, role: a.role, created_at: a.created_at
  }));
  res.json(accounts);
});

// 添加管理员
app.post('/api/admin/accounts', (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !password || !display_name) return res.status(400).json({ error: '账号、密码、显示名不能为空' });
  const db = loadDB();
  if (!db.admin_accounts) db.admin_accounts = [];
  if (db.admin_accounts.find(a => a.username === username)) return res.status(409).json({ error: '该账号已存在' });
  const account = {
    id: 'admin_' + Date.now(),
    username, password, display_name,
    role: 'admin',
    created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  };
  db.admin_accounts.push(account);
  saveDB(db);
  res.json({ success: true, id: account.id });
});

// 删除管理员（不能删超级管理员）
app.delete('/api/admin/accounts/:id', (req, res) => {
  const db = loadDB();
  if (!db.admin_accounts) return res.status(404).json({ error: '账号不存在' });
  const idx = db.admin_accounts.findIndex(a => a.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '账号不存在' });
  if (db.admin_accounts[idx].role === 'super_admin') return res.status(403).json({ error: '不能删除超级管理员' });
  db.admin_accounts.splice(idx, 1);
  saveDB(db);
  res.json({ success: true });
});

// 重置密码
app.put('/api/admin/accounts/:id/password', (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '密码不能为空' });
  const db = loadDB();
  const account = (db.admin_accounts || []).find(a => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: '账号不存在' });
  account.password = password;
  saveDB(db);
  res.json({ success: true });
});

// 辅助函数：安全解析 JSON（防止 AI 返回 Markdown 代码块）
function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.log('Detected non-strict JSON, attempting to extract...', text);
    
    // 1. 尝试匹配数组 [ ... ]
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch (e2) {}
    }

    // 2. 尝试匹配对象 { ... }
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch (e2) {}
    }
    
    console.error('Failed to parse AI output as JSON. Raw text:', text);
    throw new Error("AI 返回内容不包含有效的 JSON 格式，原始输出片段：" + text.slice(0, 100));
  }
}

// Helper: Call Gemini API (OpenAI Compatible via OhMyGPT)
// 每次调用时从 db.json 动态读取当前激活的模型配置
async function callGemini(promptText) {
  // 动态读取当前激活模型配置
  let apiKey = DEFAULT_GEMINI_API_KEY;
  let modelName = DEFAULT_GEMINI_MODEL;
  let apiUrl = DEFAULT_GEMINI_URL;
  
  try {
    if (existsSync(DB_PATH)) {
      const db = JSON.parse(readFileSync(DB_PATH, 'utf-8'));
      const activeId = db.model_config?.active_model_id;
      if (activeId && db.model_presets) {
        const preset = db.model_presets.find(p => p.id === activeId);
        if (preset) {
          if (preset.api_key) apiKey = preset.api_key;
          if (preset.model_name) modelName = preset.model_name;
          if (preset.api_url) apiUrl = preset.api_url;
        }
      }
    }
  } catch (e) {
    console.warn('[callGemini] Failed to read model config from DB, using defaults:', e.message);
  }

  try {
    const data = {
      model: modelName,
      messages: [
        {
          role: 'system',
          content: '你是一位极其严谨、专业的直播间质检专家，拥有超强的长文本检索和定位能力。你必须严格遵守输出格式要求，只返回 JSON 数据。'
        },
        {
          role: 'user',
          content: promptText
        }
      ],
      temperature: 0.1
    };
    
    console.log('--- Gemini API Call (via OhMyGPT) ---');
    console.log('Model:', modelName);
    console.log('URL:', apiUrl);
    console.log('Key (masked):', apiKey.slice(0, 8) + '...');

    const response = await axios.post(apiUrl, data, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 120000 
    });

    const content = response.data.choices[0].message.content;
    console.log('AI Response Success (Length):', content.length);
    return content;
  } catch (error) {
    let errorDetail = '';
    if (error.response) {
      errorDetail = `Status: ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`;
    } else {
      errorDetail = error.message;
    }
    console.error('!!! Gemini API Error Detail:', errorDetail);
    throw new Error(errorDetail);
  }
}

// 辅助函数：精准查找锚点位置（必须 100% 匹配 6 个字符）
function findStrictAnchorIndex(fullText, anchor) {
  if (!anchor || anchor.length < 6) return -1;
  const target = anchor.slice(0, 6);
  return fullText.indexOf(target);
}

// 辅助函数：在文本中模糊查找锚点位置（忽略标点、空格）
function findAnchorIndex(fullText, anchor, type = 'start') {
  if (!anchor || anchor.length < 2) return -1;
  
  // 1. 尝试精确匹配
  const exactIdx = fullText.indexOf(anchor);
  if (exactIdx !== -1) return exactIdx;
  
  // 2. 尝试去标点匹配
  const cleanStr = (s) => s.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const cleanFull = cleanStr(fullText);
  const cleanAnchor = cleanStr(anchor);
  
  if (cleanAnchor.length < 2) return -1;
  
  const cleanIdx = cleanFull.indexOf(cleanAnchor);
  if (cleanIdx !== -1) {
    // 使用正则匹配忽略非文字字符来找回物理坐标
    const regexSource = anchor.split('').map(char => {
      const escaped = char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 如果是汉字或数字字母，保持原样；否则设为可选匹配
      return /[a-zA-Z0-9\u4e00-\u9fa5]/.test(char) ? escaped : (escaped + '?');
    }).join('[^\\u4e00-\\u9fa5a-zA-Z0-9]*');
    
    try {
      const regex = new RegExp(regexSource, 'g');
      const match = regex.exec(fullText);
      if (match) return match.index;
    } catch (e) {}
  }

  // 3. 兜底方案：取前三个字匹配
  const shortAnchor = anchor.slice(0, 3);
  return fullText.indexOf(shortAnchor);
}

// 辅助函数：清洗话术文本中的特殊字符，避免 prompt 解析或 API 调用错误
function sanitizePromptText(text) {
  if (!text) return '';
  return text
    .replace(/[\u201C\u201D]/g, "'")
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/ {3,}/g, ' ')
    .trim();
}

// 1. API Endpoint: Check Single Window (Mandatory with Toxicity)
app.post('/api/check-single-window', async (req, res) => {
  let { windowText, standardContent, ruleName } = req.body;
  // 清洗话术文本，避免特殊引号/零宽字符导致 API 500 错误
  ruleName = sanitizePromptText(ruleName);
  standardContent = sanitizePromptText(standardContent);
  
  // 1.3倍长度提示词计算
  const targetLength = Math.floor(standardContent.length * 1.3);

  // 第一阶段：狗仔队（纯粹寻找证据）直接提取物理原文
  const prompt1_broad = `
    【任务：物理证据提取】
    你是一个极其敏锐的话术匹配员。
    你的目标是：在【待检索视窗（6000字）】中，对比【质检重点】和【标准话术】，找出意思比较相近的一个或多个段落。
    
    【执行原则】
    1. 语义匹配：只要大概意思相似就行了，不需要完全一致。
    2. 长度不限：无论主播说得长还是短，只要有关联就完整抠出来。
    3. 100%原话：你必须从【待检索视窗】中搬运原话，严禁润色、严禁总结、严禁自己造句。
    4. 允许 ASR 误差：考虑到语音转文字可能有同音错别字（如"学而思"变"学而死"），只要语义逻辑对齐即可。

    【输入信息】
    - 质检重点：${ruleName}
    - 标准话术："${standardContent}"
    - 待检索视窗：${windowText}

    【输出 JSON 格式（严禁返回其他内容）】
    {
      "physical_evidence": "此处为您从视窗中提取的原始片段"
    }
  `;

  try {
    console.log(`>>> [API/check-single-window] Step 1: Extracting physical evidence for [${ruleName}]...`);
    const result1Text = await callGemini(prompt1_broad);
    const result1 = safeJsonParse(result1Text);

    // 直接使用 AI 提取出来的物理证据，不再进行 800 字兜底
    const topicScene = result1.physical_evidence || "";
    
    console.log(`>>> [API/check-single-window] Physical evidence extracted. Length: ${topicScene.length}`);

    // 核心证据：作为后续评分的唯一依据
    const coreEvidence = topicScene;

    // 第二阶段：裁判员（根据提取的纯净物理证据进行打分）
    console.log(`>>> [API/check-single-window] Step 2: Scoring physical evidence for [${ruleName}]...`);

    // ---- 将 qaFocus 按换行符拆分为预设核心要素数组 ----
    const rawElements = ruleName
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // 要素数量与均分权重（确保总和严格=100）
    const N = rawElements.length || 1;
    const baseWeight = Math.floor(100 / N);
    const weights = rawElements.map((_, i) =>
      i < N - 1 ? baseWeight : 100 - baseWeight * (N - 1)
    );

    // 构造要素清单供 AI 阅读
    const elementsListText = rawElements
      .map((el, i) => `要素 ${i + 1} [${el}]：权重 ${weights[i]} 分`)
      .join('\n');

    const prompt2_score = `
      你是一位极其专业、严谨的直播运营专家，负责对主播话术进行逐项打分。
      
      【质检重点】
      "${ruleName}"
      
      【标准参考话术（满分答案）】
      "${standardContent}"
      
      【主播原话片段（已从直播中提取的核心证据）】
      ${coreEvidence}

      【任务指令】
      重要：以下核心要素已由运营人员预先拆解完毕，你无需自行拆解，只需逐条判断主播是否达标并打分。

      【预设核心要素清单（共 ${N} 项，总分 100 分）】
      ${elementsListText}

      【评分规则（三档计分，严格执行）】
      - 完全达标：给该项权重的 100%（即满分）。
      - 部分达标：给该项权重的 50%（向下取整）。
      - 完全缺失：给 0 分。
      
      红线判定：总分 < 60 为 "poor"，60-85 为 "fair"，> 85 为 "good"。

      【输出 JSON 格式（严禁返回其他任何内容）】
      reason_or_comment 字段中，每个要素必须严格遵守以下单行格式：
      "要素 [序号] [要素名称]：[得分/权重] —— [实操复盘评语]"

      {
        "detected": boolean,
        "performance_grade": "good" | "fair" | "poor",
        "score": number,
        "reason_or_comment": "综合得分：[X 分]\\n\\n【核心要素对标明细】\\n\\n要素 1 [${rawElements[0] || '要素1'}]：[得分/权重] —— [评语]\\n...\\n\\n【专家诊断建议】\\n1、全局评价：\\n2、改进动作："
      }
    `;

    const result2Text = await callGemini(prompt2_score);
    const result2 = safeJsonParse(result2Text);

    // 合并结果
    res.json({
      ...result2,
      topic_scene: topicScene,
      core_evidence: coreEvidence
    });

  } catch (error) {
    console.error('<<< [API/check-single-window] Error:', error.message);
    // 降级兜底：如果第一阶段（物理证据提取）已完成，打分解析失败时返回降级结果而非 500
    if (typeof topicScene !== 'undefined' && topicScene) {
      console.warn('<<< [API/check-single-window] Falling back to degraded result with evidence.');
      res.json({
        detected: false,
        performance_grade: 'fair',
        score: 0,
        reason_or_comment: 'AI 评分解析失败，请人工复核',
        topic_scene: topicScene,
        core_evidence: typeof coreEvidence !== 'undefined' ? coreEvidence : topicScene
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// 2. API Endpoint: Split Transcript
app.post('/api/split', async (req, res) => {
  const { fullText } = req.body;
  console.log('>>> [API/split] Received request. Text length:', fullText?.length);
  
  if (!fullText) {
    console.error('<<< [API/split] Error: Missing fullText');
    return res.status(400).json({ error: 'Missing fullText' });
  }

  try {
    // 扩大搜索视野至前 10 万字，确保覆盖两轮内容
    const analysisText = fullText.slice(0, 100000);

    const prompt = `
      你是一位极其精密、严谨的直播质检专家。
      任务：从直播转写文本中，精准提取"第一轮"和"第二轮"业务演练的边界原话。

      【核心边界判定准则（这是唯一且必须遵守的标准）】

      1. 每一轮的【开启时刻】 (Start Anchor)：
         - 业务逻辑：主播发起品牌互动，引导家长"扣数字"来选择想听的品牌。
         - 模式一（品牌直呼）：包含或高度接近"想听作业帮的扣一，想听小猿的扣二，想听学而思的扣三，想听科大的扣四，想听步步高扣五"。
         - 模式二（模糊代指）：主播可能不直接说品牌名，但会说"想听这个的扣一，想听这个的扣二，想听这个的扣三，想听那个的扣四，想听最后一个扣五"。
         - 判定标准：只要出现连续的"扣一"到"扣五"的互动引导动作，即判定为该轮正式开始。

      2. 每一轮的【结束时刻】 (End Anchor)：
         - 业务逻辑：主播完成"上链接"动作，并对直播间挂载的链接产品进行最后的引导说明。
         - 核心步骤：
           A. 喊出口令："321上链接"（或相似语义如：链接已上、快去抢、已经上车了）。
           B. 介绍序列：主播按顺序报出 1号、2号 或 3号链接的产品（例如：1号是学而思P4焕新升级，2号是科大讯飞S30T，3号是步步高X6）。
         - 判定标准：你不需要死磕每一个产品型号的字面一致，只要主播完成了对 1或2或3 号链接的顺序介绍动作，就判定为该轮结束。
         - 抓取目标：请抓取【介绍完 上链接及产品序列】时的最后一句原话。

      【输出原话提取要求】
      - 必须从原文中提取 15-20 字的连续原话。
      - 你必须保证提取的文字在原文中是连续且完全一致的（允许微小标点差异）。
      - 严禁进行任何概括、缩写或修饰，必须是"案发现场"的真实原话。

      【输出 JSON 格式（严禁返回任何多余文字）】
      {
        "found": boolean,
        "r1_start_phrase": "第一轮互动扣1-5时的第一句原话",
        "r1_end_phrase": "第一轮讲完3号链接介绍时的最后一句原话",
        "r2_start_phrase": "第二轮互动扣1-5时的第一句原话",
        "r2_end_phrase": "第二轮讲完3号链接介绍时的最后一句原话"
      }

      【待分析文本（全文前 10 万字）】
      ${analysisText}
    `;

    console.log('>>> [API/split] Calling AI for multi-anchor splitting...');
    const resultText = await callGemini(prompt);
    console.log('>>> [API/split] AI Raw Response:', resultText);
    const result = safeJsonParse(resultText);
    console.log('<<< [API/split] Success. Found:', result.found);
    res.json(result);
  } catch (error) {
    console.error('<<< [API/split] Failed:', error.message);
    res.status(500).json({ error: 'Failed to split transcript: ' + error.message });
  }
});

// 候选锚点检索接口：全文扫描，找"开始关键词"和"结束关键词"各一条典型原话
app.post('/api/find-candidate-anchors', async (req, res) => {
  const { fullText } = req.body;
  if (!fullText || fullText.length < 500) {
    return res.status(400).json({ error: '文本过短，无法提取锚点' });
  }

  const analysisText = fullText.slice(0, 80000);

  const prompt = `
    你是一位极其精密、严谨的直播质检专家。任务：从文本中找出每轮"开始"和"结束"最典型特征句各一条。

    【开始特征句定义】：主播引导家长扣数字选品牌的那段话。
    - 模式一：包含"想听作业帮扣1，想听小猿扣2..."等品牌直呼+扣数字组合。
    - 模式二：包含"想听这个扣1，想听那个扣2..."等模糊代指+扣数字组合。
    - 核心标志：连续出现"扣一"到"扣五"的互动引导动作。

    【结束特征句定义】：主播完成上链接，介绍完1号/2号/3号链接产品序列时的最后一句话。
    - 核心标志：主播按序报出"1号是XXX，2号是XXX，3号是XXX"形式的产品介绍。

    【提取要求】
    - 每类各找一条最典型的（不需要区分第几轮），15-20字，必须是原文原话，不得概括或修改。
    - 两轮的句式相同，系统会自动找第1次和第2次出现来区分第一轮和第二轮，你只需返回最典型的那条。
    - 找不到则返回 null。

    【输出 JSON（严禁返回任何多余文字）】
    {
      "start_phrase": "最典型的扣品牌数字那段原话，或 null",
      "end_phrase": "最典型的上链接报产品序列那段原话，或 null"
    }

    【待分析文本】
    ${analysisText}
  `;

  try {
    const resultText = await callGemini(prompt);
    const result = safeJsonParse(resultText);
    console.log('<<< [API/find-candidate-anchors] start_phrase:', result.start_phrase, '| end_phrase:', result.end_phrase);
    res.json(result);
  } catch (error) {
    console.error('<<< [API/find-candidate-anchors] Error:', error.message);
    res.status(500).json({ error: 'AI 锚点预找失败: ' + error.message });
  }
});

// 2. API Endpoint: Check Standards Batch (Forbidden Only)
app.post('/api/check-standards-batch', async (req, res) => {
  const { transcript, standards } = req.body;
  console.log(`>>> [API/check-batch] Received ${standards?.length} forbidden standards. Text length: ${transcript?.length}`);

  if (!transcript || !standards || !Array.isArray(standards)) {
    console.error('<<< [API/check-batch] Error: Missing data or invalid standards format');
    return res.status(400).json({ error: 'Missing data or invalid standards format' });
  }

  const checkSingleForbidden = async (transcript, standard) => {
    const ruleName = standard.qaFocus;
    const contextScript = standard.content;

    const prompt = `
    你是一位严谨的直播质检专家。
    任务：检查主播是否提到了以下【禁令内容】。
    
    【禁令内容】
    - 名称: "${ruleName}"
    - 详细描述: "${contextScript}"

    【待质检文本】
    ${transcript.slice(0, 50000)}

    【输出 JSON 格式】
    {
      "detected": boolean,
      "quote": "违规原话片段",
      "reason_or_comment": "违规原因剖析"
    }
    `;

    try {
      const resultText = await callGemini(prompt);
      const result = safeJsonParse(resultText);
      return {
        detected: result.detected,
        quote: result.quote || "",
        reason_or_comment: result.reason_or_comment || (result.detected ? "违规" : "未违规")
      };
    } catch (e) {
      console.warn("AI forbidden check failed for standard:", ruleName, e.message);
      return { detected: false, quote: "", reason_or_comment: "分析出错: " + e.message };
    }
  };

  try {
    // 完全串行：一条跑完再跑下一条，彻底避免并发打爆 API
    const results = [];
    for (const s of standards) {
      const r = await checkSingleForbidden(transcript, s);
      results.push(r);
    }
    res.json(results);
  } catch (error) {
    console.error('<<< [API/check-batch] Error:', error.message);
    res.status(500).json({ error: '质检失败: ' + error.message });
  }
});

const PORT = process.env.PORT || 3001;

// ============================================================
// 直播监控系统代理 API（转发到 Python FastAPI 后端 8089）
// ============================================================

const MONITOR_API = process.env.MONITOR_API || 'http://127.0.0.1:8089';

// 为监控后端生成内部访问 token（共享密钥，无需密码）
const MONITOR_JWT_SECRET = 'zhibojiankong-secret-key-2026';
function getMonitorToken() {
  // 手动构造一个简单的 JWT（HS256），有效期 24 小时
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: '18611979493',
    role: 'super_admin',
    exp: now + 86400
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', MONITOR_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

// 代理工具函数：转发请求到监控后端（自动携带 token）
async function proxyMonitor(path, res, method = 'get') {
  try {
    const token = getMonitorToken();
    const sep = path.includes('?') ? '&' : '?';
    const url = `${MONITOR_API}${path}${sep}token=${token}`;
    const resp = method === 'post'
      ? await axios.post(url, {}, { timeout: 15000 })
      : await axios.get(url, { timeout: 15000 });
    res.json(resp.data);
  } catch (e) {
    const status = e.response?.status || 502;
    const msg = e.response?.data?.detail || e.message || '监控服务连接失败';
    res.status(status).json({ error: msg });
  }
}
// ============================================================
// COS 相关配置（用于自动清理旧录制）
// ============================================================
const COS_SECRET_ID = process.env.COS_SECRET_ID || '';
const COS_SECRET_KEY = process.env.COS_SECRET_KEY || '';
const COS_BUCKET = 'zhubojiankong-1408371319';
const COS_REGION = 'ap-shanghai';

// COS 签名（用于删除对象）— 腾讯云 COS XML API 签名算法
function cosSign(method, cosKey) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 600; // 10分钟有效
  const keyTime = `${now};${exp}`;
  // 步骤1: SignKey = HMAC-SHA1(SecretKey, KeyTime)
  const signKey = crypto.createHmac('sha1', COS_SECRET_KEY).update(keyTime).digest('hex');
  // 步骤2: HttpString
  const httpString = `${method}\n/${cosKey}\n\nhost=${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com\n`;
  // 步骤3: SHA1(HttpString)
  const sha1HttpString = crypto.createHash('sha1').update(httpString).digest('hex');
  // 步骤4: StringToSign
  const stringToSign = `sha1\n${keyTime}\n${sha1HttpString}\n`;
  // 步骤5: Signature = HMAC-SHA1(SignKey, StringToSign)
  const signature = crypto.createHmac('sha1', signKey).update(stringToSign).digest('hex');
  return `q-sign-algorithm=sha1&q-ak=${COS_SECRET_ID}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=host&q-url-param-list=&q-signature=${signature}`;
}

// 删除 COS 对象
async function deleteCosObject(cosKey) {
  try {
    const url = `https://${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com/${cosKey}`;
    await axios.delete(url, {
      headers: {
        'Host': `${COS_BUCKET}.cos.${COS_REGION}.myqcloud.com`,
        'Authorization': cosSign('delete', cosKey)
      },
      timeout: 15000
    });
    console.log(`[COS清理] ✅ 已删除: ${cosKey}`);
    return true;
  } catch (e) {
    // 404 说明已经不存在了，不用报错
    if (e.response && e.response.status === 404) {
      console.log(`[COS清理] 文件不存在(已删): ${cosKey}`);
      return true;
    }
    console.error(`[COS清理] ❌ 删除失败 ${cosKey}:`, e.message);
    return false;
  }
}

// 每个主播最多保留的场次数量
const MAX_SESSIONS_PER_ANCHOR = 10;

// 后台异步清理超出 10 场的旧录制
async function cleanupOldSessions(anchorName, allSessions, token) {
  // 按创建时间排序（最新在前）
  const sorted = [...allSessions].sort((a, b) => {
    const ta = new Date(a.created_at || a.live_date).getTime();
    const tb = new Date(b.created_at || b.live_date).getTime();
    return tb - ta;
  });

  if (sorted.length <= MAX_SESSIONS_PER_ANCHOR) return;

  const toDelete = sorted.slice(MAX_SESSIONS_PER_ANCHOR);
  console.log(`[自动清理] ${anchorName}: 共${sorted.length}场, 将清理${toDelete.length}场旧录制`);

  for (const session of toDelete) {
    // 1. 删除 COS 视频文件
    if (session.video_cos_url) {
      // 从 URL 提取 cos key，格式: https://bucket.cos.region.myqcloud.com/videos/session_74.mp4
      const match = session.video_cos_url.match(/myqcloud\.com\/(.+)$/);
      if (match) {
        await deleteCosObject(match[1]);
      }
    }
    // 也删除可能存在的标准 key
    await deleteCosObject(`videos/session_${session.id}.mp4`);

    // 2. 从监控后端删除记录
    try {
      await axios.delete(`${MONITOR_API}/api/session/${session.id}?token=${token}`, { timeout: 10000 });
      console.log(`[自动清理] ✅ 已删除场次记录 id=${session.id}`);
    } catch (e) {
      console.warn(`[自动清理] 删除场次记录 id=${session.id} 失败:`, e.message);
    }

    // 3. 记录到本地已删除列表
    const db = loadDB();
    if (!db.deleted_sessions) db.deleted_sessions = [];
    if (!db.deleted_sessions.includes(session.id)) {
      db.deleted_sessions.push(session.id);
      saveDB(db);
    }
  }
  console.log(`[自动清理] ${anchorName}: 清理完成`);
}

// 获取某个主播的所有直播场次（从监控系统的 anchor 表关联查询）
app.get('/api/monitor/sessions/:anchorName', async (req, res) => {
  const anchorName = decodeURIComponent(req.params.anchorName);
  try {
    const token = getMonitorToken();
    // 先从监控系统查找匹配的主播
    const anchorsResp = await axios.get(`${MONITOR_API}/api/anchors?token=${token}`, { timeout: 10000 });
    const monitorAnchor = anchorsResp.data.find(
      (a) => a.name === anchorName || a.name.includes(anchorName) || anchorName.includes(a.name)
    );
    if (!monitorAnchor) {
      return res.json([]);  // 监控系统中没有这个主播，返回空数组
    }
    // 拉取该主播的场次列表
    const sessionsResp = await axios.get(`${MONITOR_API}/api/sessions/${monitorAnchor.id}?token=${token}`, { timeout: 10000 });
    // 过滤掉本地已删除的场次
    const db = loadDB();
    const deletedIds = new Set(db.deleted_sessions || []);
    const filtered = (sessionsResp.data || []).filter(s => !deletedIds.has(s.id));

    // 只返回最新 10 场
    const sorted = [...filtered].sort((a, b) => {
      const ta = new Date(a.created_at || a.live_date).getTime();
      const tb = new Date(b.created_at || b.live_date).getTime();
      return tb - ta;
    });
    const result = sorted.slice(0, MAX_SESSIONS_PER_ANCHOR);

    // 后台异步清理超出的旧场次（不阻塞响应）
    if (filtered.length > MAX_SESSIONS_PER_ANCHOR) {
      cleanupOldSessions(anchorName, filtered, token).catch(e =>
        console.error('[自动清理] 错误:', e.message)
      );
    }

    res.json(result);
  } catch (e) {
    if (e.code === 'ECONNREFUSED') {
      return res.json([]);  // 监控服务未启动时静默返回空
    }
    res.status(502).json({ error: '监控服务连接失败: ' + e.message });
  }
});

// 获取某个场次的详情（含 video_cos_url + timestamped_text）
app.get('/api/monitor/session/:sessionId', async (req, res) => {
  await proxyMonitor(`/api/session/${req.params.sessionId}`, res);
});

// ========== 视频代理 — 服务器中转 COS 视频，避免用户直连 COS 慢 ==========
app.get('/api/video-proxy/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  try {
    // 1. 从 8089 获取 COS URL
    const token = getMonitorToken();
    const sRes = await axios.get(`${MONITOR_API}/api/session/${sessionId}?token=${token}`, { timeout: 10000 });
    const cosUrl = sRes.data?.video_cos_url;
    if (!cosUrl) return res.status(404).json({ error: '无视频' });

    // 2. 代理请求 COS（支持 Range 请求）
    const headers = {};
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const cosResp = await axios.get(cosUrl, {
      headers,
      responseType: 'stream',
      timeout: 30000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    // 3. 转发响应头
    res.status(cosResp.status);
    if (cosResp.headers['content-type']) res.set('Content-Type', cosResp.headers['content-type']);
    if (cosResp.headers['content-length']) res.set('Content-Length', cosResp.headers['content-length']);
    if (cosResp.headers['content-range']) res.set('Content-Range', cosResp.headers['content-range']);
    if (cosResp.headers['accept-ranges']) res.set('Accept-Ranges', cosResp.headers['accept-ranges']);

    // 4. 流式传输
    cosResp.data.pipe(res);
  } catch (e) {
    console.error('[视频代理] 失败:', e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// 手工切片录制（停当前段，后台继续录新段）
app.post('/api/monitor/session/:sessionId/stop', async (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  // 先本地保存弹幕数据
  flushDanmakuData(sessionId);
  await proxyMonitor(`/api/session/${sessionId}/stop`, res, 'post');
});

// 彻底停止录制和监控（停当前段，并在后台挂起主播直到手动恢复）
app.post('/api/monitor/session/:sessionId/stop-anchor', async (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  // 先本地保存弹幕数据
  flushDanmakuData(sessionId);
  await proxyMonitor(`/api/session/${sessionId}/stop-anchor`, res, 'post');
});

// 删除某个场次
app.delete('/api/monitor/session/:sessionId', async (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  // 记录到本地数据库
  const db = loadDB();
  if (!db.deleted_sessions) db.deleted_sessions = [];
  if (!db.deleted_sessions.includes(sessionId)) {
    db.deleted_sessions.push(sessionId);
    saveDB(db);
  }
  // 同步删除 COS 视频文件
  try {
    const token = getMonitorToken();
    // 先获取 session 详情拿到 video_cos_url
    const detailResp = await axios.get(`${MONITOR_API}/api/session/${sessionId}?token=${token}`, { timeout: 10000 });
    const videoUrl = detailResp.data?.video_cos_url;
    if (videoUrl) {
      const match = videoUrl.match(/myqcloud\.com\/(.+)$/);
      if (match) await deleteCosObject(match[1]);
    }
    // 兜底也删标准 key
    await deleteCosObject(`videos/session_${sessionId}.mp4`);
  } catch (e) {
    console.warn('[DELETE COS] 删除视频:', e.message);
  }
  // 尝试也从监控服务删除记录
  try {
    const token = getMonitorToken();
    await axios.delete(`${MONITOR_API}/api/session/${sessionId}?token=${token}`, { timeout: 10000 });
  } catch (e) {
    console.warn('[DELETE session] 监控服务返回:', e.message);
  }
  res.json({ success: true });
});

// 获取某个场次的评论
app.get('/api/monitor/comments/:sessionId', async (req, res) => {
  const { start, end } = req.query;
  await proxyMonitor(`/api/comments/${req.params.sessionId}?start=${start || 0}&end=${end || 99999}`, res);
});

// 获取某个场次的在线人数
app.get('/api/monitor/online-count/:sessionId', async (req, res) => {
  await proxyMonitor(`/api/online-count/${req.params.sessionId}`, res);
});

// 监控系统健康检查
app.get('/api/monitor/health', async (req, res) => {
  try {
    const token = getMonitorToken();
    await axios.get(`${MONITOR_API}/api/anchors?token=${token}`, { timeout: 5000 });
    res.json({ status: 'connected', monitor_api: MONITOR_API });
  } catch (e) {
    res.json({ status: 'disconnected', error: e.message, monitor_api: MONITOR_API });
  }
});

// ============================================================
// API：Cookie 管理（代理到 8089）
// ============================================================
app.get('/api/monitor/cookie-status', async (req, res) => {
  await proxyMonitor('/api/douyin/cookie-status', res);
});
app.post('/api/monitor/save-cookie', async (req, res) => {
  try {
    const token = getMonitorToken();
    const resp = await axios.post(`${MONITOR_API}/api/douyin/save-cookie?token=${token}`, req.body, { timeout: 15000 });
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API：提示词模板管理（代理到 8089）
// ============================================================
app.get('/api/monitor/prompts', async (req, res) => {
  await proxyMonitor('/api/prompts', res);
});
app.post('/api/monitor/prompts', async (req, res) => {
  try {
    const token = getMonitorToken();
    const resp = await axios.post(`${MONITOR_API}/api/prompts?token=${token}`, req.body, { timeout: 10000 });
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put('/api/monitor/prompts/:id', async (req, res) => {
  try {
    const token = getMonitorToken();
    const resp = await axios.put(`${MONITOR_API}/api/prompts/${req.params.id}?token=${token}`, req.body, { timeout: 10000 });
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/monitor/prompts/:id', async (req, res) => {
  try {
    const token = getMonitorToken();
    const resp = await axios.delete(`${MONITOR_API}/api/prompts/${req.params.id}?token=${token}`, { timeout: 10000 });
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API：员工账号管理（代理到 8089）
// ============================================================
app.get('/api/monitor/staff', async (req, res) => {
  await proxyMonitor('/api/staff', res);
});
app.post('/api/monitor/staff', async (req, res) => {
  try {
    const token = getMonitorToken();
    const resp = await axios.post(`${MONITOR_API}/api/staff?token=${token}`, req.body, { timeout: 10000 });
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put('/api/monitor/staff/:id/password', async (req, res) => {
  try {
    const token = getMonitorToken();
    const resp = await axios.put(`${MONITOR_API}/api/staff/${req.params.id}/password?token=${token}`, req.body, { timeout: 10000 });
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.delete('/api/monitor/staff/:id', async (req, res) => {
  try {
    const token = getMonitorToken();
    const resp = await axios.delete(`${MONITOR_API}/api/staff/${req.params.id}?token=${token}`, { timeout: 10000 });
    res.json(resp.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API：重处理/分析等操作（代理到 8089）
// ============================================================
app.post('/api/monitor/reprocess/:sessionId', async (req, res) => {
  await proxyMonitor(`/api/reprocess/${req.params.sessionId}`, res, 'post');
});
app.get('/api/monitor/transcript/:sessionId', async (req, res) => {
  await proxyMonitor(`/api/transcript/${req.params.sessionId}`, res);
});
app.get('/api/monitor/analysis/:sessionId', async (req, res) => {
  await proxyMonitor(`/api/analysis/${req.params.sessionId}`, res);
});

// ============================================================
// API：模型配置管理
// ============================================================

// 获取模型配置（key 脱敏）
app.get('/api/model-config', (req, res) => {
  try {
    const db = loadDB();
    // 确保旧数据库有这两个字段
    const modelConfig = db.model_config || { active_model_id: 'gemini-flash-lite' };
    const presets = (db.model_presets || DEFAULT_DB.model_presets).map(p => ({
      ...p,
      api_key_masked: p.api_key ? (p.api_key.slice(0, 8) + '****' + p.api_key.slice(-4)) : '',
      api_key: undefined // 不返回明文 key
    }));
    res.json({ active_model_id: modelConfig.active_model_id, presets });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 切换当前激活模型
app.post('/api/model-config/active', (req, res) => {
  const { model_id } = req.body;
  if (!model_id) return res.status(400).json({ error: 'model_id 不能为空' });
  try {
    const db = loadDB();
    if (!db.model_config) db.model_config = {};
    const presets = db.model_presets || DEFAULT_DB.model_presets;
    if (!presets.find(p => p.id === model_id)) {
      return res.status(404).json({ error: '模型预设不存在' });
    }
    db.model_config.active_model_id = model_id;
    saveDB(db);
    res.json({ success: true, active_model_id: model_id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新某个预设的 API Key（及可选字段）
app.put('/api/model-config/presets/:id', (req, res) => {
  const { id } = req.params;
  const { api_key, api_url, name, model_name } = req.body;
  try {
    const db = loadDB();
    if (!db.model_presets) db.model_presets = JSON.parse(JSON.stringify(DEFAULT_DB.model_presets));
    const idx = db.model_presets.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ error: '模型预设不存在' });
    if (api_key !== undefined) db.model_presets[idx].api_key = api_key;
    if (api_url !== undefined) db.model_presets[idx].api_url = api_url;
    if (name !== undefined) db.model_presets[idx].name = name;
    if (model_name !== undefined) db.model_presets[idx].model_name = model_name;
    saveDB(db);
    const p = db.model_presets[idx];
    res.json({ ...p, api_key: undefined, api_key_masked: p.api_key ? (p.api_key.slice(0, 8) + '****' + p.api_key.slice(-4)) : '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 新增自定义模型预设
app.post('/api/model-config/presets', (req, res) => {
  const { name, model_name, api_url, api_key } = req.body;
  if (!name || !model_name) return res.status(400).json({ error: 'name 和 model_name 不能为空' });
  try {
    const db = loadDB();
    if (!db.model_presets) db.model_presets = JSON.parse(JSON.stringify(DEFAULT_DB.model_presets));
    const id = 'custom_' + Date.now();
    const preset = {
      id, name, model_name,
      api_url: api_url || 'https://cn2us02.opapi.win/v1/chat/completions',
      api_key: api_key || '',
      is_builtin: false
    };
    db.model_presets.push(preset);
    saveDB(db);
    res.json({ ...preset, api_key: undefined, api_key_masked: preset.api_key ? (preset.api_key.slice(0, 8) + '****' + preset.api_key.slice(-4)) : '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除自定义模型预设（内置预设不允许删除）
app.delete('/api/model-config/presets/:id', (req, res) => {
  const { id } = req.params;
  try {
    const db = loadDB();
    if (!db.model_presets) return res.status(404).json({ error: '预设不存在' });
    const preset = db.model_presets.find(p => p.id === id);
    if (!preset) return res.status(404).json({ error: '预设不存在' });
    if (preset.is_builtin) return res.status(403).json({ error: '内置预设不允许删除' });
    db.model_presets = db.model_presets.filter(p => p.id !== id);
    if (db.model_config?.active_model_id === id) {
      db.model_config.active_model_id = 'gemini-flash-lite';
    }
    saveDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 测试模型连接
app.post('/api/model-config/test', async (req, res) => {
  const { model_id } = req.body;
  try {
    const db = loadDB();
    const presets = db.model_presets || DEFAULT_DB.model_presets;
    const preset = presets.find(p => p.id === model_id);
    if (!preset) return res.status(404).json({ error: '模型预设不存在' });
    if (!preset.api_key) return res.status(400).json({ error: '该模型尚未配置 API Key' });

    const startTime = Date.now();
    const response = await axios.post(preset.api_url, {
      model: preset.model_name,
      messages: [{ role: 'user', content: '你好，请回复 "连接成功"。' }],
      temperature: 0,
      max_tokens: 20
    }, {
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${preset.api_key}` },
      timeout: 30000
    });
    const reply = response.data.choices[0].message.content;
    res.json({ success: true, reply, latency: `${Date.now() - startTime}ms` });
  } catch (e) {
    const detail = e.response ? `Status: ${e.response.status}, ${JSON.stringify(e.response.data)}` : e.message;
    res.status(500).json({ success: false, error: detail });
  }
});
// 3. Health Check: Test Gemini Connection and Network
app.get('/api/health-check', async (req, res) => {
  console.log('>>> [API/health-check] Starting diagnostic...');
  const startTime = Date.now();

  let activeModel = DEFAULT_GEMINI_MODEL;
  let activeUrl = DEFAULT_GEMINI_URL;
  let activeKeyMask = DEFAULT_GEMINI_API_KEY.slice(0, 8) + '***' + DEFAULT_GEMINI_API_KEY.slice(-4);
  try {
    if (existsSync(DB_PATH)) {
      const dbSnap = JSON.parse(readFileSync(DB_PATH, 'utf-8'));
      const activeId = dbSnap.model_config?.active_model_id;
      const preset = dbSnap.model_presets?.find(p => p.id === activeId);
      if (preset) {
        activeModel = preset.model_name;
        activeUrl = preset.api_url;
        activeKeyMask = preset.api_key ? preset.api_key.slice(0, 8) + '***' + preset.api_key.slice(-4) : '(未配置)';
      }
    }
  } catch (e) {}

  const diagnostics = {
    env: { model: activeModel, api_endpoint: activeUrl, key_mask: activeKeyMask },
    api_test: null
  };

  try {
    // 向新模型发送一个极简测试
    const testPrompt = "System connection test. Respond with 'Gemini-3.1-OK'.";
    const response = await callGemini(testPrompt);
    diagnostics.api_test = { status: 'success', response };
    
    res.json({
      status: 'success',
      message: 'All systems operational',
      latency: `${Date.now() - startTime}ms`,
      diagnostics
    });
  } catch (error) {
    console.error('<<< [API/health-check] Diagnostic failed:', error.message);
    res.status(500).json({
      status: 'error',
      message: 'Diagnostic failed',
      error_detail: error.message,
      diagnostics
    });
  }
});

// 新增：专用测试通路接口
app.post('/api/test-ai', async (req, res) => {
  const { prompt } = req.body;
  try {
    console.log('>>> [API/test-ai] Testing with prompt:', prompt);
    const result = await callGemini(prompt || "你好，请自我介绍并确认你的模型版本。");
    res.json({ success: true, result });
  } catch (error) {
    console.error('<<< [API/test-ai] Error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 以下为新增：JSON文件数据库 + 主播/话术/任务管理接口
// 原有接口一字未动
// ============================================================


// ---- 纯 JSON 文件数据库 ----
const DEFAULT_DB = {
  anchors: [
    { id: 1, name: '王老师', created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) },
    { id: 2, name: '小陈老师', created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) },
    { id: 3, name: '可乐老师', created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }
  ],
  standards_versions: [],
  tasks: [],
  _next_anchor_id: 4,
  _next_version_id: 1,
  model_config: {
    active_model_id: 'gemini-flash-lite'
  },
  model_presets: [
    {
      id: 'gemini-flash-lite',
      name: 'Gemini 3.1 Flash Lite ⭐',
      model_name: 'gemini-3.1-flash-lite-preview',
      api_url: 'https://cn2us02.opapi.win/v1/chat/completions',
      api_key: process.env.GEMINI_API_KEY || '',
      is_builtin: true
    },
    {
      id: 'gemini-2-flash',
      name: 'Gemini 2.0 Flash',
      model_name: 'gemini-2.0-flash',
      api_url: 'https://cn2us02.opapi.win/v1/chat/completions',
      api_key: '',
      is_builtin: true
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      model_name: 'gpt-4o-mini',
      api_url: 'https://cn2us02.opapi.win/v1/chat/completions',
      api_key: '',
      is_builtin: true
    },
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      model_name: 'gpt-4o',
      api_url: 'https://cn2us02.opapi.win/v1/chat/completions',
      api_key: '',
      is_builtin: true
    },
    {
      id: 'claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet',
      model_name: 'claude-3-5-sonnet-20241022',
      api_url: 'https://cn2us02.opapi.win/v1/chat/completions',
      api_key: '',
      is_builtin: true
    }
  ]
};

// ---- 内存缓存数据库（避免每次 API 调用都读取 85MB+ 的 JSON 文件） ----
let _dbCache = null;
let _dbSaveTimer = null;

function loadDB() {
  if (_dbCache) return _dbCache;
  try {
    if (existsSync(DB_PATH)) {
      _dbCache = JSON.parse(readFileSync(DB_PATH, 'utf-8'));
      return _dbCache;
    }
  } catch (e) {
    console.error('[DB] Load error:', e.message);
  }
  _dbCache = JSON.parse(JSON.stringify(DEFAULT_DB));
  return _dbCache;
}

function saveDB(data) {
  _dbCache = data; // 立即更新内存缓存
  // 防抖写入磁盘：500ms 内多次调用只写一次
  if (_dbSaveTimer) clearTimeout(_dbSaveTimer);
  _dbSaveTimer = setTimeout(() => {
    try {
      writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[DB] Save error:', e.message);
    }
  }, 500);
}

// 辅助函数：清理任务结果中的冗余大字段，大幅减小存储体积
function cleanupTaskResult(task) {
  if (task.result_json) {
    ['round1', 'round2'].forEach(round => {
      const r = task.result_json[round];
      if (r && r.mandatory_checks) {
        r.mandatory_checks.forEach(check => {
          delete check.windowSnippet;    // 6000字/条，81条 = ~500KB
          delete check.standardContent;  // 重复存储的话术原文
        });
      }
    });
    // 清理保存的完整转录文本（可能几万字）
    delete task.result_json.fullRawText;
  }
  return task;
}

// 初始化：加载数据库并执行一次性清理
if (!existsSync(DB_PATH)) {
  saveDB(DEFAULT_DB);
  console.log('[DB] JSON database initialized at', DB_PATH);
} else {
  const db = loadDB();
  // 一次性清理已有任务中的冗余字段
  let cleaned = 0;
  (db.tasks || []).forEach(t => {
    if (t.result_json) {
      ['round1', 'round2'].forEach(round => {
        const r = t.result_json[round];
        if (r && r.mandatory_checks) {
          r.mandatory_checks.forEach(check => {
            if (check.windowSnippet) { delete check.windowSnippet; cleaned++; }
            if (check.standardContent) { delete check.standardContent; cleaned++; }
          });
        }
      });
      if (t.result_json.fullRawText) { delete t.result_json.fullRawText; cleaned++; }
    }
  });
  if (cleaned > 0) {
    console.log(`[DB] 清理了 ${cleaned} 个冗余字段，正在保存...`);
    // 直接同步写入（不用防抖）
    try {
      writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8');
      console.log('[DB] 清理完成，数据库已压缩');
    } catch (e) {
      console.error('[DB] 清理保存失败:', e.message);
    }
  }
  console.log('[DB] JSON database loaded from', DB_PATH);
}

// ---- 辅助：生成 task id ----
function genTaskId() {
  return 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ============================================================
// API：主播管理
// ============================================================

// 获取所有主播（全部从 8089 后台读取，不再合并本地 JSON）
app.get('/api/anchors', async (req, res) => {
  try {
    const token = getMonitorToken();
    const resp = await axios.get(`${MONITOR_API}/api/anchors?token=${token}`, { timeout: 8000 });
    res.json(resp.data);
  } catch (e) {
    console.warn('从监控服务获取主播失败:', e.message);
    res.status(500).json({ error: '后台服务不可用: ' + e.message });
  }
});

// 同步直播间URL到监控后端（自动执行，不阻塞主流程）
async function syncRoomToMonitor(anchorName, roomUrl) {
  if (!roomUrl) return;
  try {
    const token = getMonitorToken();
    // 1. 在监控后端查找或创建主播
    const anchorsResp = await axios.get(`${MONITOR_API}/api/anchors?token=${token}`, { timeout: 10000 });
    let monitorAnchor = anchorsResp.data.find(a => a.name === anchorName);
    if (!monitorAnchor) {
      // 监控后端没有这个主播，尝试创建
      try {
        const createResp = await axios.post(`${MONITOR_API}/api/anchors?token=${token}`, { name: anchorName }, { timeout: 10000 });
        monitorAnchor = createResp.data;
        console.log(`[同步] 在监控后端创建主播: ${anchorName} id=${monitorAnchor.id}`);
      } catch (e) {
        console.warn(`[同步] 创建主播失败（可能已存在）:`, e.message);
        // 重新查找
        const retry = await axios.get(`${MONITOR_API}/api/anchors?token=${token}`, { timeout: 10000 });
        monitorAnchor = retry.data.find(a => a.name === anchorName || a.name.includes(anchorName));
      }
    }
    if (!monitorAnchor) {
      console.warn(`[同步] 无法找到/创建监控主播: ${anchorName}`);
      return;
    }
    // 2. 添加/更新直播间
    const roomUrlEncoded = encodeURIComponent(roomUrl);
    await axios.post(
      `${MONITOR_API}/api/douyin/room?anchor_id=${monitorAnchor.id}&room_url=${roomUrlEncoded}&token=${token}`,
      {},
      { timeout: 10000 }
    );
    console.log(`[同步] ✅ 已同步直播间: ${anchorName} → ${roomUrl}`);
  } catch (e) {
    console.warn(`[同步] 直播间同步失败 (${anchorName}):`, e.response?.data || e.message);
  }
}

// ========== 主播管理（8090 db.json 为主数据源，再同步给 8089 执行端） ==========

// 新增主播 → 先写 db.json，再同步 8089
app.post('/api/anchors', async (req, res) => {
  const { name, enable_qc, douyin_profile_url, douyin_room_url, segment_duration } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '主播名不能为空' });
  try {
    // 第一步：先同步到 8089 获取自增 ID（8089 是 SQLite 自增主键）
    const token = getMonitorToken();
    const payload8089 = {
      name: name.trim(),
      douyin_profile_url: (douyin_profile_url || '').trim(),
      douyin_room_url: (douyin_room_url || '').trim(),
      enable_qc: enable_qc !== false ? 1 : 0,
      segment_duration: segment_duration || 5400
    };
    const resp = await axios.post(`${MONITOR_API}/api/anchors?token=${token}`, payload8089, { timeout: 10000 });
    const anchorFrom8089 = resp.data;

    // 第二步：写入 db.json（主数据落盘），使用 8089 返回的 ID 保持一致
    try {
      const db = loadDB();
      if (!db.anchors) db.anchors = [];
      // 去重：如果已有同 ID 或同名的，先移除
      db.anchors = db.anchors.filter(a => a.id !== anchorFrom8089.id && a.name !== name.trim());
      db.anchors.push({
        id: anchorFrom8089.id,
        name: name.trim(),
        enable_qc: enable_qc !== false,
        douyin_profile_url: (douyin_profile_url || '').trim(),
        douyin_room_url: (douyin_room_url || '').trim(),
        segment_duration: segment_duration || 5400,
        status: anchorFrom8089.status || 'active',
        created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      });
      saveDB(db);
      console.log(`[主播管理] ✅ 新增主播 "${name}" → db.json(id=${anchorFrom8089.id}) + 8089 同步完成`);
    } catch (dbErr) {
      console.error(`[主播管理] ⚠️ db.json 写入失败（8089 已创建）:`, dbErr.message);
    }

    res.json(anchorFrom8089);
  } catch (e) {
    console.error('新增主播失败:', e.response?.data || e.message);
    res.status(500).json({ error: e.response?.data?.detail || e.message });
  }
});

// 编辑主播 → 先更新 db.json，再同步 8089
app.put('/api/anchors/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, enable_qc, douyin_profile_url, douyin_room_url, status, segment_duration } = req.body;
  try {
    // 第一步：更新 db.json（主数据落盘）
    const db = loadDB();
    if (!db.anchors) db.anchors = [];
    let localAnchor = db.anchors.find(a => a.id === id);
    if (!localAnchor) {
      // db.json 里没有（老数据），补创建
      localAnchor = { id, name: name || '', created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) };
      db.anchors.push(localAnchor);
    }
    if (name !== undefined) localAnchor.name = name;
    if (enable_qc !== undefined) localAnchor.enable_qc = !!enable_qc;
    if (douyin_profile_url !== undefined) localAnchor.douyin_profile_url = douyin_profile_url;
    if (douyin_room_url !== undefined) localAnchor.douyin_room_url = douyin_room_url;
    if (status !== undefined) localAnchor.status = status;
    if (segment_duration !== undefined) localAnchor.segment_duration = segment_duration;
    saveDB(db);
    console.log(`[主播管理] ✅ 更新主播 #${id} "${name}" → db.json 已落盘`);

    // 第二步：同步给 8089（执行端）
    const token = getMonitorToken();
    const payload = { name, douyin_profile_url, douyin_room_url };
    if (status !== undefined) payload.status = status;
    if (enable_qc !== undefined) payload.enable_qc = enable_qc ? 1 : 0;
    if (segment_duration !== undefined) payload.segment_duration = segment_duration;
    try {
      const resp = await axios.put(`${MONITOR_API}/api/anchors/${id}?token=${token}`, payload, { timeout: 10000 });
      console.log(`[主播管理] ✅ 8089 同步完成 #${id}`);
      res.json(resp.data);
    } catch (syncErr) {
      console.warn(`[主播管理] ⚠️ 8089 同步失败（db.json 已更新）:`, syncErr.message);
      // 即使 8089 同步失败，也返回成功（db.json 已落盘）
      res.json(localAnchor);
    }
  } catch (e) {
    console.error(`更新主播 ${id} 失败:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// 删除主播 → 先从 db.json 删除，再同步 8089
app.delete('/api/anchors/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    // 第一步：从 db.json 删除（主数据落盘）
    const db = loadDB();
    if (db.anchors) {
      db.anchors = db.anchors.filter(a => a.id !== id);
      saveDB(db);
      console.log(`[主播管理] ✅ 已从 db.json 删除主播 #${id}`);
    }

    // 第二步：同步给 8089（执行端）
    try {
      const token = getMonitorToken();
      await axios.delete(`${MONITOR_API}/api/anchors/${id}?token=${token}`, { timeout: 10000 });
      console.log(`[主播管理] ✅ 8089 同步删除完成 #${id}`);
    } catch (syncErr) {
      console.warn(`[主播管理] ⚠️ 8089 同步删除失败:`, syncErr.message);
    }

    res.json({ ok: true, message: `主播 #${id} 已删除` });
  } catch (e) {
    console.error(`删除主播 ${id} 失败:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API：话术版本管理（全局共用）
// ============================================================

// 调试接口：分析粘贴文本的 CSV 解析结果
app.post('/api/debug-parse', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: '缺少 text' });
  
  const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const firstLine = cleanText.split('\n')[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const separator = tabCount >= 1 ? '\t' : ',';
  
  const lines = cleanText.split('\n');
  const rows = lines.map(line => line.split(separator));
  
  const headerCols = rows[0] ? rows[0].length : 0;
  
  // 输出到服务器日志
  console.log('[DEBUG-PARSE] ===========================');
  console.log('[DEBUG-PARSE] 总行数:', lines.length, '| 表头列数:', headerCols, '| 分隔符:', separator === '\t' ? 'TAB' : 'COMMA');
  console.log('[DEBUG-PARSE] 表头:', rows[0] ? rows[0].map((h, i) => `[${i}]="${h.trim().substring(0, 20)}"`).join(' | ') : '无');
  
  // 逐行输出前 30 行的关键信息
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    const nonEmpty = row.filter(c => c.trim().length > 0).length;
    const preview = row.map((c, j) => `[${j}]=${c.trim().substring(0, 35)}`).join(' | ');
    console.log(`[DEBUG-PARSE] 行${i}: ${row.length}列(${nonEmpty}非空) ${preview}`);
  }
  
  if (rows.length > 30) {
    console.log('[DEBUG-PARSE] ...省略后续 ' + (rows.length - 30) + ' 行');
  }
  console.log('[DEBUG-PARSE] ===========================');
  
  const analysis = {
    totalLines: lines.length,
    totalRows: rows.length,
    headerCols,
    headers: rows[0] ? rows[0].map((h, i) => `[${i}]="${h.trim().substring(0, 30)}"`).join(' | ') : '',
    separator: separator === '\t' ? 'TAB' : 'COMMA',
    rows: rows.slice(0, 200).map((row, i) => ({
      rowIdx: i,
      colCount: row.length,
      nonEmpty: row.filter(c => c.trim().length > 0).length,
      preview: row.map((c, j) => `[${j}]=${c.trim().substring(0, 40)}`).join(' | ')
    }))
  };
  
  res.json(analysis);
});

// 获取所有话术版本列表（不含content_json，节省带宽）
app.get('/api/standards', (req, res) => {
  try {
    const db = loadDB();
    const versions = db.standards_versions
      .map(v => ({ id: v.id, version_label: v.version_label, total_count: v.total_count, created_at: v.created_at, is_current: v.is_current }))
      .sort((a, b) => b.id - a.id);
    res.json(versions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取某个版本的完整话术内容
app.get('/api/standards/:id', (req, res) => {
  const id = req.params.id;
  // 注意：current/detail 路由需要在 :id 之前，这里用字符串判断
  if (id === 'current') return res.status(400).json({ error: '请使用 /api/standards/current/detail' });
  try {
    const db = loadDB();
    const ver = db.standards_versions.find(v => v.id === parseInt(id));
    if (!ver) return res.status(404).json({ error: '版本不存在' });
    res.json({ ...ver, content: ver.content_json });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取当前使用的话术版本
app.get('/api/standards/current/detail', (req, res) => {
  try {
    const db = loadDB();
    const ver = db.standards_versions.filter(v => v.is_current === 1).sort((a, b) => b.id - a.id)[0];
    if (!ver) return res.status(404).json({ error: '尚未上传话术' });
    res.json({ ...ver, content: ver.content_json });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 上传新版本话术（自动设为当前版本）
app.post('/api/standards', (req, res) => {
  const { content_json } = req.body;
  if (!content_json || !Array.isArray(content_json) || content_json.length === 0) {
    return res.status(400).json({ error: '话术内容不能为空' });
  }
  try {
    const db = loadDB();
    // 将旧版本全部设为非当前
    db.standards_versions.forEach(v => { v.is_current = 0; });
    const version_label = `v${db._next_version_id++}`;
    const ver = {
      id: db._next_version_id - 1,
      version_label,
      content_json,
      total_count: content_json.length,
      created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      is_current: 1
    };
    db.standards_versions.push(ver);
    saveDB(db);
    res.json({ ...ver, content: content_json });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除话术版本（不能删除当前使用中的版本）
app.delete('/api/standards/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const db = loadDB();
    const idx = db.standards_versions.findIndex(v => v.id === id);
    if (idx === -1) return res.status(404).json({ error: '版本不存在' });
    if (db.standards_versions[idx].is_current === 1) {
      return res.status(400).json({ error: '不能删除当前使用中的版本' });
    }
    db.standards_versions.splice(idx, 1);
    saveDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API：质检任务管理
// ============================================================

// 提交质检任务（后台异步执行）
app.post('/api/tasks', async (req, res) => {
  const { anchor_id, transcript_text, transcript_filename, is_dual_mode, manual_anchors } = req.body;
  if (!anchor_id || !transcript_text) {
    return res.status(400).json({ error: 'anchor_id 和 transcript_text 为必填项' });
  }

  const db = loadDB();
  const anchor = db.anchors.find(a => a.id === parseInt(anchor_id));
  if (!anchor) return res.status(404).json({ error: '主播不存在' });

  const stdVer = db.standards_versions.filter(v => v.is_current === 1).sort((a, b) => b.id - a.id)[0];
  if (!stdVer) return res.status(400).json({ error: '尚未配置话术，请先在话术管理页上传话术' });

  const taskId = genTaskId();
  const isDual = is_dual_mode === true || is_dual_mode === 1;

  const task = {
    id: taskId,
    anchor_id: anchor.id,
    anchor_name: anchor.name,
    standards_version_id: stdVer.id,
    standards_version_label: stdVer.version_label,
    status: 'pending',
    transcript_filename: transcript_filename || '未命名',
    score_r1: null,
    score_r2: null,
    is_dual_mode: isDual ? 1 : 0,
    progress_message: '任务已提交...',
    created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    completed_at: null,
    error_message: null
  };
  db.tasks.push(task);
  saveDB(db);

  res.json({ task_id: taskId, status: 'pending' });

  runTaskInBackground(taskId, stdVer, transcript_text, isDual, manual_anchors || null).catch(e => {
    console.error('[Task Background Error]', taskId, e.message);
  });
});

// ============================================================
// Webhook：监控系统 ASR 完成后自动触发质检
// Python 端在 ASR 完成后 POST 到此接口
// ============================================================
app.post('/api/webhook/asr-complete', async (req, res) => {
  const { anchor_name, session_id, transcript_text, session_title, duration_seconds } = req.body;
  console.log(`[Webhook/ASR] 收到 ASR 完成通知: anchor=${anchor_name}, session=${session_id}, text_len=${(transcript_text||'').length}, duration=${duration_seconds}s`);

  if (!anchor_name || !transcript_text || transcript_text.length < 50) {
    return res.status(400).json({ error: '缺少必要字段或转录文本过短' });
  }

  try {
    const db = loadDB();

    // 1. 查找质检系统中匹配的主播
    const anchor = db.anchors.find(a =>
      a.name === anchor_name || a.name.includes(anchor_name) || anchor_name.includes(a.name)
    );
    if (!anchor) {
      console.log(`[Webhook/ASR] 未找到匹配主播: ${anchor_name}, 跳过质检`);
      return res.json({ skipped: true, reason: '质检系统中无此主播' });
    }

    // 2. 检查主播是否开启质检
    if (anchor.enable_qc === false) {
      console.log(`[Webhook/ASR] 主播 ${anchor.name} 未开启质检，跳过`);
      return res.json({ skipped: true, reason: '主播未开启质检' });
    }

    // 3. 获取当前话术版本
    const stdVer = db.standards_versions.filter(v => v.is_current === 1).sort((a, b) => b.id - a.id)[0];
    if (!stdVer) {
      console.log('[Webhook/ASR] 尚未配置话术，跳过质检');
      return res.json({ skipped: true, reason: '尚未配置话术' });
    }

    // 4. 检查是否已有针对此 session 的任务（避免重复）
    const existingTask = db.tasks.find(t =>
      t.anchor_id === anchor.id &&
      (t.monitor_session_id === session_id || t.monitor_session_id === parseInt(session_id) ||
       t.transcript_filename === `直播自动录制-${session_id}`)
    );
    if (existingTask) {
      console.log(`[Webhook/ASR] session ${session_id} 已存在质检任务 ${existingTask.id}，跳过`);
      return res.json({ skipped: true, reason: '已存在对应质检任务', task_id: existingTask.id });
    }

    // 5. 根据直播时长判断单轮/双轮
    //    ≤2.5小时(9000秒) = 单轮，>2.5小时 = 双轮
    const dur = parseInt(duration_seconds) || 0;
    const isDual = dur > 9000;
    console.log(`[Webhook/ASR] 时长=${dur}s, 模式=${isDual ? '双轮' : '单轮'}`);

    const taskId = genTaskId();
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    // 从监控系统获取开播时间
    let liveStartTime = now;
    let transcriptFilename = `${anchor_name}`;
    try {
      const token = getMonitorToken();
      const sRes = await axios.get(`${MONITOR_API}/api/session/${session_id}?token=${token}`, { timeout: 10000 });
      const sCreated = sRes.data.created_at; // 8089 存的是北京时间，如 '2026-04-07 13:45:57'
      if (sCreated) {
        // 直接解析为本地时间（不加 Z，因为 8089 存的已经是北京时间）
        const localDate = new Date(sCreated.trim().replace(' ', 'T'));
        const m = `${localDate.getMonth()+1}/${localDate.getDate()}`;
        const t = `${String(localDate.getHours()).padStart(2,'0')}:${String(localDate.getMinutes()).padStart(2,'0')}`;
        liveStartTime = `${m} ${t}`;
        transcriptFilename = `${m} ${t} ${anchor_name}`;
      }
    } catch (e) { console.log('[Webhook] 获取开播时间失败:', e.message); }

    const task = {
      id: taskId,
      anchor_id: anchor.id,
      anchor_name: anchor.name,
      standards_version_id: stdVer.id,
      standards_version_label: stdVer.version_label,
      status: 'pending',
      transcript_filename: transcriptFilename,
      score_r1: null,
      score_r2: null,
      is_dual_mode: isDual ? 1 : 0,
      progress_message: '由直播监控自动触发...',
      created_at: now,
      completed_at: null,
      error_message: null,
      source: 'auto_asr',
      monitor_session_id: session_id,
      live_start_time: liveStartTime
    };
    db.tasks.push(task);
    saveDB(db);

    console.log(`[Webhook/ASR] ✅ 自动创建质检任务: ${taskId}, 主播=${anchor.name}, session=${session_id}, ${isDual ? '双轮' : '单轮'}`);

    // 7. 后台运行质检
    runTaskInBackground(taskId, stdVer, transcript_text, isDual, null).catch(e => {
      console.error('[Webhook/ASR] 后台质检出错:', taskId, e.message);
    });

    res.json({ success: true, task_id: taskId, anchor_name: anchor.name, is_dual: isDual });
  } catch (e) {
    console.error('[Webhook/ASR] 错误:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// 手动触发质检：从监控系统拉取指定场次的完整转录，重新质检
// 前端调用此接口为历史场次补做质检
// ============================================================
app.post('/api/webhook/trigger-qc', async (req, res) => {
  const { anchor_id, session_id } = req.body;
  if (!anchor_id || !session_id) {
    return res.status(400).json({ error: 'anchor_id 和 session_id 为必填项' });
  }

  try {
    const db = loadDB();
    const anchor = db.anchors.find(a => a.id === parseInt(anchor_id));
    if (!anchor) return res.status(404).json({ error: '主播不存在' });

    const stdVer = db.standards_versions.filter(v => v.is_current === 1).sort((a, b) => b.id - a.id)[0];
    if (!stdVer) return res.status(400).json({ error: '尚未配置话术' });

    // 从监控系统拉取场次详情（含完整转录文本）
    const token = getMonitorToken();
    const sessionRes = await axios.get(`${MONITOR_API}/api/session/${session_id}?token=${token}`, { timeout: 30000 });
    const sessionData = sessionRes.data;

    const transcriptText = sessionData.transcript?.full_text || '';
    if (transcriptText.length < 50) {
      return res.status(400).json({ error: '该场次的转录文本过短或不可用' });
    }

    // 删除旧的同 session 任务（如果有）
    const oldIdx = db.tasks.findIndex(t =>
      t.anchor_id === anchor.id &&
      t.transcript_filename === `直播自动录制-${session_id}`
    );
    if (oldIdx >= 0) {
      console.log(`[Trigger-QC] 删除旧任务: ${db.tasks[oldIdx].id}`);
      db.tasks.splice(oldIdx, 1);
    }

    // 根据时长判断单/双轮
    const dur = sessionData.duration_seconds || 0;
    const isDual = dur > 9000;

    const taskId = genTaskId();
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    // 从监控数据获取开播时间
    let liveStartTime = now;
    let transcriptFilename = `${anchor.name}`;
    const sCreated = sessionData.created_at;
    if (sCreated) {
      try {
        // 直接解析为本地时间（8089 存的已经是北京时间）
        const localDate = new Date(sCreated.trim().replace(' ', 'T'));
        const m = `${localDate.getMonth()+1}/${localDate.getDate()}`;
        const t = `${String(localDate.getHours()).padStart(2,'0')}:${String(localDate.getMinutes()).padStart(2,'0')}`;
        liveStartTime = `${m} ${t}`;
        transcriptFilename = `${m} ${t} ${anchor.name}`;
      } catch (e) { console.log('[Trigger-QC] 解析开播时间失败:', e.message); }
    }

    const task = {
      id: taskId,
      anchor_id: anchor.id,
      anchor_name: anchor.name,
      standards_version_id: stdVer.id,
      standards_version_label: stdVer.version_label,
      status: 'pending',
      transcript_filename: transcriptFilename,
      score_r1: null,
      score_r2: null,
      is_dual_mode: isDual ? 1 : 0,
      progress_message: '手动触发质检...',
      created_at: now,
      completed_at: null,
      error_message: null,
      source: 'auto_asr',
      monitor_session_id: parseInt(session_id),
      live_start_time: liveStartTime
    };
    db.tasks.push(task);
    saveDB(db);

    console.log(`[Trigger-QC] ✅ 创建质检: ${taskId}, 主播=${anchor.name}, session=${session_id}, ${isDual ? '双轮' : '单轮'}, text=${transcriptText.length}字`);

    runTaskInBackground(taskId, stdVer, transcriptText, isDual, null).catch(e => {
      console.error('[Trigger-QC] 后台质检出错:', taskId, e.message);
    });

    res.json({ success: true, task_id: taskId, text_length: transcriptText.length, is_dual: isDual });
  } catch (e) {
    console.error('[Trigger-QC] 错误:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ========== 从全场回看发起重新质检（不删旧任务，新建一条） ==========
app.post('/api/session/:sessionId/retry-qc', async (req, res) => {
  const sessionId = parseInt(req.params.sessionId);
  const { anchor_id } = req.body;
  console.log(`[重新质检] session=${sessionId}, anchor_id=${anchor_id}`);

  if (!sessionId || !anchor_id) {
    return res.status(400).json({ error: 'session_id 和 anchor_id 为必填项' });
  }

  try {
    const db = loadDB();
    const anchor = db.anchors.find(a => a.id === parseInt(anchor_id));
    if (!anchor) return res.status(404).json({ error: '主播不存在' });

    const stdVer = db.standards_versions.filter(v => v.is_current === 1).sort((a, b) => b.id - a.id)[0];
    if (!stdVer) return res.status(400).json({ error: '尚未配置话术标准' });

    // 从 8089 获取逐字稿
    const token = getMonitorToken();
    const sessionRes = await axios.get(`${MONITOR_API}/api/session/${sessionId}?token=${token}`, { timeout: 30000 });
    const sessionData = sessionRes.data;

    const transcriptText = sessionData.transcript?.full_text || '';
    if (transcriptText.length < 50) {
      return res.status(400).json({ error: '该场次无转录文本或文本过短，无法质检' });
    }

    // 时长 & 单双轮
    const dur = sessionData.duration_seconds || 0;
    const isDual = dur > 9000;

    const taskId = genTaskId();
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    // 解析开播时间
    let liveStartTime = now;
    let transcriptFilename = `${anchor.name} (重新质检)`;
    const sCreated = sessionData.created_at;
    if (sCreated) {
      try {
        const localDate = new Date(sCreated.trim().replace(' ', 'T'));
        const m = `${localDate.getMonth()+1}/${localDate.getDate()}`;
        const t = `${String(localDate.getHours()).padStart(2,'0')}:${String(localDate.getMinutes()).padStart(2,'0')}`;
        liveStartTime = `${m} ${t}`;
        transcriptFilename = `${m} ${t} ${anchor.name} (重新质检)`;
      } catch (e) { /* ignore */ }
    }

    const task = {
      id: taskId,
      anchor_id: anchor.id,
      anchor_name: anchor.name,
      standards_version_id: stdVer.id,
      standards_version_label: stdVer.version_label,
      status: 'pending',
      transcript_filename: transcriptFilename,
      score_r1: null,
      score_r2: null,
      is_dual_mode: isDual ? 1 : 0,
      progress_message: '重新质检中...',
      created_at: now,
      completed_at: null,
      error_message: null,
      source: 'retry_qc',
      is_retry: true,
      monitor_session_id: sessionId,
      live_start_time: liveStartTime
    };
    db.tasks.push(task);
    saveDB(db);

    console.log(`[重新质检] ✅ 创建任务: ${taskId}, 主播=${anchor.name}, session=${sessionId}, text=${transcriptText.length}字`);

    // 后台运行质检
    runTaskInBackground(taskId, stdVer, transcriptText, isDual, null).catch(e => {
      console.error('[重新质检] 后台出错:', taskId, e.message);
    });

    res.json({ success: true, task_id: taskId, text_length: transcriptText.length, is_dual: isDual });
  } catch (e) {
    console.error('[重新质检] 错误:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ========== 人工手检 CRUD ==========
// 获取任务的所有人工手检
app.get('/api/tasks/:id/manual-checks', (req, res) => {
  const db = loadDB();
  const task = db.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json(task.manual_checks || []);
});

// 添加人工手检
app.post('/api/tasks/:id/manual-checks', (req, res) => {
  const { selected_text, time_range, comment } = req.body;
  if (!selected_text) return res.status(400).json({ error: '缺少选中文本' });
  const db = loadDB();
  const task = db.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  if (!task.manual_checks) task.manual_checks = [];
  const item = {
    id: `mc_${Date.now()}`,
    selected_text,
    time_range: time_range || '',
    comment: comment || '',
    created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  };
  task.manual_checks.push(item);
  saveDB(db);
  console.log(`[人工手检] 新增: task=${req.params.id}, text=${selected_text.slice(0, 30)}...`);
  res.json(item);
});

// 更新人工手检备注
app.put('/api/tasks/:id/manual-checks/:mcId', (req, res) => {
  const { comment } = req.body;
  const db = loadDB();
  const task = db.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  const mc = (task.manual_checks || []).find(m => m.id === req.params.mcId);
  if (!mc) return res.status(404).json({ error: '手检项不存在' });
  mc.comment = comment || '';
  saveDB(db);
  res.json(mc);
});

// 删除人工手检
app.delete('/api/tasks/:id/manual-checks/:mcId', (req, res) => {
  const db = loadDB();
  const task = db.tasks.find(t => t.id === req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  task.manual_checks = (task.manual_checks || []).filter(m => m.id !== req.params.mcId);
  saveDB(db);
  res.json({ success: true });
});

// ========== 重新质检（失败任务重试） ==========
app.post('/api/tasks/:id/retry', async (req, res) => {
  const taskId = req.params.id;
  try {
    const db = loadDB();
    const oldTask = db.tasks.find(t => t.id === taskId);
    if (!oldTask) return res.status(404).json({ error: '任务不存在' });
    if (oldTask.status === 'running' || oldTask.status === 'pending') {
      return res.status(400).json({ error: '任务正在运行中' });
    }

    const sessionId = oldTask.monitor_session_id;
    if (!sessionId) return res.status(400).json({ error: '无关联直播场次，无法重试' });

    // 1. 从 8089 获取逐字稿
    const token = getMonitorToken();
    const sRes = await axios.get(`${MONITOR_API}/api/session/${sessionId}?token=${token}`, { timeout: 15000 });
    const detail = sRes.data;

    let transcriptText = '';
    if (detail.transcript?.full_text) {
      transcriptText = detail.transcript.full_text;
    } else if (detail.transcript?.timestamped_text) {
      try {
        const parsed = JSON.parse(detail.transcript.timestamped_text);
        transcriptText = parsed.map(s => s.text || s.content || '').join('');
      } catch {}
    }

    if (!transcriptText || transcriptText.length < 50) {
      return res.status(400).json({ error: `逐字稿过短(${transcriptText.length}字)，无法质检` });
    }

    // 2. 获取话术版本
    const stdVer = db.standards_versions.filter(v => v.is_current === 1).sort((a, b) => b.id - a.id)[0];
    if (!stdVer) return res.status(400).json({ error: '尚未配置话术' });

    // 3. 判断单轮/双轮
    const dur = parseInt(detail.duration_seconds) || 0;
    const isDual = dur > 9000;

    // 4. 创建新任务
    const newTaskId = genTaskId();
    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const newTask = {
      id: newTaskId,
      anchor_id: oldTask.anchor_id,
      anchor_name: oldTask.anchor_name,
      standards_version_id: stdVer.id,
      standards_version_label: stdVer.label || stdVer.name || `v${stdVer.id}`,
      status: 'pending',
      transcript_text: '',
      transcript_filename: oldTask.transcript_filename || oldTask.anchor_name,
      score_r1: null,
      score_r2: null,
      is_dual_mode: isDual ? 1 : 0,
      progress_message: '重新质检中...',
      created_at: now,
      completed_at: null,
      error_message: null,
      source: 'retry',
      monitor_session_id: sessionId,
      live_start_time: oldTask.live_start_time || ''
    };
    db.tasks.push(newTask);

    // 5. 把老任务标记为已被重试（可选，避免重复触发）
    oldTask.retried_by = newTaskId;

    saveDB(db);
    console.log(`[重试质检] ${oldTask.anchor_name} 旧任务=${taskId} → 新任务=${newTaskId} 文字=${transcriptText.length}字`);

    // 6. 后台执行质检
    runTaskInBackground(newTaskId, stdVer, transcriptText, isDual, null).catch(e => {
      console.error('[重试质检] 后台出错:', newTaskId, e.message);
    });

    res.json({ success: true, new_task_id: newTaskId, text_length: transcriptText.length });
  } catch (e) {
    console.error('[重试质检] 失败:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// 更新任务状态的辅助函数
function updateTaskInDB(taskId, updates) {
  const db = loadDB();
  const idx = db.tasks.findIndex(t => t.id === taskId);
  if (idx !== -1) {
    Object.assign(db.tasks[idx], updates);
    // 如果更新包含 result_json，清理冗余字段后再保存
    if (updates.result_json) {
      cleanupTaskResult(db.tasks[idx]);
    }
    saveDB(db);
  }
}

// 后台任务执行函数
async function runTaskInBackground(taskId, stdVer, transcriptText, isDual, manualAnchors) {
  try {
    updateTaskInDB(taskId, { status: 'running', progress_message: '正在准备质检...' });
    const standards = stdVer.content_json;

    let result;

    if (isDual) {
      let part1, part2, splitAnchorsForResult;

      // 优先路径：有手动确认的锚点，直接按 pos 切割，跳过 AI 扫描
      if (manualAnchors && manualAnchors.r1EndPos !== undefined && manualAnchors.r1EndPos !== -1 && manualAnchors.r1EndPos !== null) {
        updateTaskInDB(taskId, { progress_message: '使用手动确认锚点切割...' });
        const r1Start = (manualAnchors.r1StartPos === -1 || manualAnchors.r1StartPos == null) ? 0 : manualAnchors.r1StartPos;
        const r1End   = manualAnchors.r1EndPos + (manualAnchors.r1EndPhrase ? manualAnchors.r1EndPhrase.length : 0);
        const r2Start = (manualAnchors.r2StartPos === -1 || manualAnchors.r2StartPos == null) ? 0 : manualAnchors.r2StartPos;
        const r2End   = (manualAnchors.r2EndPos === -1 || manualAnchors.r2EndPos == null)
                        ? transcriptText.length
                        : manualAnchors.r2EndPos + (manualAnchors.r2EndPhrase ? manualAnchors.r2EndPhrase.length : 0);

        part1 = transcriptText.substring(r1Start, r1End).trim();
        part2 = transcriptText.substring(r2Start, r2End).trim();
        splitAnchorsForResult = {
          r1StartPhrase: manualAnchors.r1StartPhrase || '',
          r1EndPhrase:   manualAnchors.r1EndPhrase || '',
          r2StartPhrase: manualAnchors.r2StartPhrase || '',
          r2EndPhrase:   manualAnchors.r2EndPhrase || ''
        };
      } else {
        // 兜底路径：无手动锚点，AI 自动扫描
        updateTaskInDB(taskId, { progress_message: '正在扫描双轮锚点...' });
        const splitResult = await callInternalSplit(transcriptText);

        if (!splitResult.found || !splitResult.r1_end_phrase) {
          updateTaskInDB(taskId, { progress_message: '未检测到双轮，降级为单轮质检...' });
          const r1 = await runSingleRoundAnalysis(transcriptText, standards);
          result = { round1: r1, round1Text: transcriptText, fullRawText: transcriptText, isDualMode: false };
        } else {
          const r1EndIdx   = transcriptText.indexOf(splitResult.r1_end_phrase.slice(0, 6));
          const r2StartIdx = transcriptText.indexOf(splitResult.r2_start_phrase.slice(0, 6));
          part1 = r1EndIdx > 0 ? transcriptText.slice(0, r1EndIdx + splitResult.r1_end_phrase.length) : transcriptText;
          part2 = r2StartIdx > 0 ? transcriptText.slice(r2StartIdx) : '';
          splitAnchorsForResult = {
            r1StartPhrase: splitResult.r1_start_phrase || '',
            r1EndPhrase:   splitResult.r1_end_phrase || '',
            r2StartPhrase: splitResult.r2_start_phrase || '',
            r2EndPhrase:   splitResult.r2_end_phrase || ''
          };
        }
      }

      // 公共出口：part1/part2 已就绪，执行并行分析
      if (result === undefined && part1 !== undefined && part2 !== undefined) {
        updateTaskInDB(taskId, { progress_message: '双轮结构确认，并行分析中...' });
        if (!part2 || part2.length < 50) {
          updateTaskInDB(taskId, { progress_message: '第二轮内容过短，降级为单轮...' });
          const r1 = await runSingleRoundAnalysis(transcriptText, standards);
          result = { round1: r1, round1Text: transcriptText, fullRawText: transcriptText, isDualMode: false };
        } else {
          const [r1, r2] = await Promise.all([
            runSingleRoundAnalysis(part1, standards),
            runSingleRoundAnalysis(part2, standards)
          ]);
          result = {
            round1: r1, round2: r2,
            round1Text: part1, round2Text: part2,
            fullRawText: transcriptText, isDualMode: true,
            splitAnchors: splitAnchorsForResult
          };
        }
      }
    } else {
      // 单轮模式：如果有手动锚点，截取有效区间后质检
      let effectiveText = transcriptText;
      if (manualAnchors && manualAnchors.r1StartPos !== undefined) {
        const effectiveStart = (manualAnchors.r1StartPos === -1 || manualAnchors.r1StartPos == null) ? 0 : manualAnchors.r1StartPos;
        const effectiveEnd = (manualAnchors.r1EndPos === -1 || manualAnchors.r1EndPos == null)
          ? transcriptText.length
          : manualAnchors.r1EndPos + (manualAnchors.r1EndPhrase ? manualAnchors.r1EndPhrase.length : 0);
        effectiveText = transcriptText.substring(effectiveStart, effectiveEnd).trim();
        console.log(`[单轮锚点截取] 从 ${effectiveStart} 到 ${effectiveEnd}，有效文本长度: ${effectiveText.length}`);
      }
      updateTaskInDB(taskId, { progress_message: '单轮质检中...' });
      const r1 = await runSingleRoundAnalysis(effectiveText, standards);
      result = { round1: r1, round1Text: effectiveText, fullRawText: transcriptText, isDualMode: false };
    }

    const scoreR1 = calcScoreFromResult(result.round1);
    const scoreR2 = result.round2 ? calcScoreFromResult(result.round2) : null;

    updateTaskInDB(taskId, {
      status: 'completed',
      result_json: result,
      score_r1: scoreR1,
      score_r2: scoreR2,
      is_dual_mode: result.isDualMode ? 1 : 0,
      progress_message: '质检完成',
      completed_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    });

    console.log('[Task Completed]', taskId, 'r1:', scoreR1, 'r2:', scoreR2);
  } catch (e) {
    console.error('[Task Failed]', taskId, e.message);
    updateTaskInDB(taskId, { status: 'failed', error_message: e.message, progress_message: '质检失败' });
  }
}

// 内部 split 调用
async function callInternalSplit(fullText) {
  const analysisText = fullText.slice(0, 100000);
  const prompt = `
    你是一位极其精密、严谨的直播质检专家。
    任务：从直播转写文本中，精准提取"第一轮"和"第二轮"业务演练的边界原话。

    【核心边界判定准则】
    1. 每一轮的【开启时刻】：主播发起品牌互动，引导家长"扣数字"，出现连续"扣一"到"扣五"。
    2. 每一轮的【结束时刻】：主播完成"321上链接"并按顺序报出1/2/3号链接产品名称。

    【输出原话提取要求】必须从原文提取15-20字连续原话，严禁概括修饰。

    【输出 JSON 格式（严禁多余文字）】
    {
      "found": boolean,
      "r1_start_phrase": "...",
      "r1_end_phrase": "...",
      "r2_start_phrase": "...",
      "r2_end_phrase": "..."
    }

    【待分析文本】${analysisText}
  `;
  const resultText = await callGemini(prompt);
  return safeJsonParse(resultText);
}

// 单条 mandatory 检查 + 超时自动重试（最多重试 maxRetries 次）
async function checkSingleMandatoryWithRetry(std, transcriptText, maxRetries = 1) {
  const WINDOW_SIZE = 6000;
  const pos = std.theoretical_pos || 0.5;
  const textLen = transcriptText.length;
  const center = Math.floor(pos * textLen);
  const start = Math.max(0, center - WINDOW_SIZE / 2);
  const windowText = transcriptText.slice(start, start + WINDOW_SIZE);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await axios.post(`http://127.0.0.1:${PORT}/api/check-single-window`, {
        windowText, standardContent: std.content, ruleName: std.qaFocus
      }, { timeout: 120000 });
      return {
        standard: std.qaFocus,
        status: resp.data.detected ? 'passed' : 'missed',
        score: resp.data.score || 0,
        performance_grade: resp.data.performance_grade,
        detected_content: resp.data.core_evidence || '',
        comment: resp.data.reason_or_comment || '',
        standardContent: std.content,
        windowSnippet: windowText,
        topic_scene: resp.data.topic_scene || ''
      };
    } catch (e) {
      if (attempt < maxRetries) {
        console.warn(`[重试] 第${attempt + 1}次失败 (${e.message.substring(0, 50)})，3秒后重试: ${std.qaFocus.substring(0, 30)}...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      console.error(`[最终失败] ${std.qaFocus.substring(0, 30)}... 错误: ${e.message.substring(0, 60)}`);
      return {
        standard: std.qaFocus, status: 'missed', score: 0,
        comment: '分析出错: ' + e.message, standardContent: std.content, windowSnippet: windowText
      };
    }
  }
}

// 单轮分析（分批并发 + 超时重试，避免 API 限流）
async function runSingleRoundAnalysis(transcriptText, standards) {
  const mandatory = standards.filter(s => s.type === 'mandatory');
  const forbidden = standards.filter(s => s.type === 'forbidden');

  // 分批并发：每批 BATCH_SIZE 条并行，批间串行，避免 81 条全并发打爆 API
  const BATCH_SIZE = 5;
  const mandatoryResults = [];

  for (let batchStart = 0; batchStart < mandatory.length; batchStart += BATCH_SIZE) {
    const batch = mandatory.slice(batchStart, batchStart + BATCH_SIZE);
    console.log(`[质检进度] 处理第 ${batchStart + 1}-${batchStart + batch.length} 条 / 共 ${mandatory.length} 条`);
    const batchResults = await Promise.all(
      batch.map(std => checkSingleMandatoryWithRetry(std, transcriptText))
    );
    mandatoryResults.push(...batchResults);
  }

  let forbiddenResults = [];
  if (forbidden.length > 0) {
    try {
      const resp = await axios.post(`http://127.0.0.1:${PORT}/api/check-standards-batch`, {
        transcript: transcriptText, standards: forbidden
      }, { timeout: 300000 });
      forbiddenResults = forbidden.map((std, idx) => ({
        standard: std.qaFocus,
        detected_content: resp.data[idx]?.quote || '',
        reason: resp.data[idx]?.reason_or_comment || '',
        suggestion: ''
      })).filter((_, idx) => resp.data[idx]?.detected);
    } catch (e) {
      console.warn('[runSingleRoundAnalysis] forbidden check failed:', e.message);
    }
  }

  return {
    mandatory_checks: mandatoryResults,
    forbidden_issues: forbiddenResults
  };
}

// 计算平均得分
function calcScoreFromResult(analysisResult) {
  if (!analysisResult) return null;
  const checks = analysisResult.mandatory_checks || [];
  if (checks.length === 0) return null;
  const total = checks.reduce((sum, c) => sum + (Number(c.score) || 0), 0);
  return Math.round(total / checks.length);
}

// 查询任务状态
app.get('/api/tasks/:id', (req, res) => {
  try {
    const db = loadDB();
    const task = db.tasks.find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json({ ...task, result: task.result_json || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取某主播的历史任务列表
app.get('/api/anchors/:id/tasks', (req, res) => {
  const anchorId = parseInt(req.params.id);
  try {
    const db = loadDB();
    const tasks = db.tasks
      .filter(t => t.anchor_id === anchorId)
      .map(t => {
        const { result_json, ...rest } = t;
        return rest;
      })
      .sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
    res.json(tasks);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API：主播培训模块（全部追加，不动现有接口）
// ============================================================

// --- 主播登录（独立账号体系）---
app.post('/api/training/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '账号和密码不能为空' });
  try {
    const db = loadDB();
    const accounts = db.training_accounts || [];
    const account = accounts.find(a => a.username === username && a.password === password);
    if (!account) return res.status(401).json({ error: '账号或密码错误' });
    res.json({ success: true, display_name: account.display_name, username: account.username });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 课程管理 ---
app.get('/api/training/courses', (req, res) => {
  try {
    const db = loadDB();
    res.json((db.training_courses || []).sort((a, b) => b.id - a.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/training/courses', (req, res) => {
  const { title, standards_version_id } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: '课程名不能为空' });
  if (!standards_version_id) return res.status(400).json({ error: '请选择话术版本' });
  try {
    const db = loadDB();
    if (!db.training_courses) db.training_courses = [];
    if (!db._next_training_course_id) db._next_training_course_id = 1;
    const ver = db.standards_versions.find(v => v.id === parseInt(standards_version_id));
    const course = {
      id: db._next_training_course_id++,
      title: title.trim(),
      standards_version_id: parseInt(standards_version_id),
      standards_version_label: ver ? ver.version_label : '未知版本',
      created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    };
    db.training_courses.push(course);
    saveDB(db);
    res.json(course);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/training/courses/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const db = loadDB();
    if (!db.training_courses) return res.status(404).json({ error: '课程不存在' });
    db.training_courses = db.training_courses.filter(c => c.id !== id);
    if (db.training_slides) db.training_slides = db.training_slides.filter(s => s.course_id !== id);
    saveDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/training/courses/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { title, standards_version_id } = req.body;
  try {
    const db = loadDB();
    if (!db.training_courses) return res.status(404).json({ error: '课程不存在' });
    const course = db.training_courses.find(c => c.id === id);
    if (!course) return res.status(404).json({ error: '课程不存在' });
    
    if (title) course.title = title;
    if (standards_version_id) {
      const ver = db.standards_versions.find(v => v.id === parseInt(standards_version_id));
      if (!ver) return res.status(400).json({ error: '所选话术版本不存在' });
      course.standards_version_id = parseInt(standards_version_id);
      course.standards_version_label = ver.version_label;
    }
    
    saveDB(db);
    res.json({ success: true, course });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 幻灯片管理 ---
app.get('/api/training/courses/:id/slides', (req, res) => {
  const courseId = parseInt(req.params.id);
  try {
    const db = loadDB();
    const slides = (db.training_slides || [])
      .filter(s => s.course_id === courseId)
      .sort((a, b) => a.order - b.order);
    res.json(slides);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/training/slides', (req, res) => {
  const { course_id, order, title, image_base64, standard_start, standard_end } = req.body;
  if (!course_id) return res.status(400).json({ error: 'course_id 不能为空' });
  try {
    const db = loadDB();
    if (!db.training_slides) db.training_slides = [];
    if (!db._next_training_slide_id) db._next_training_slide_id = 1;
    const slide = {
      id: db._next_training_slide_id++,
      course_id: parseInt(course_id),
      order: order || 1,
      title: title || '',
      image_base64: image_base64 || '',
      standard_start: parseInt(standard_start) || 1,
      standard_end: parseInt(standard_end) || 1
    };
    db.training_slides.push(slide);
    saveDB(db);
    res.json(slide);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/training/slides/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const db = loadDB();
    if (!db.training_slides) return res.status(404).json({ error: '幻灯片不存在' });
    const idx = db.training_slides.findIndex(s => s.id === id);
    if (idx === -1) return res.status(404).json({ error: '幻灯片不存在' });
    const { title, standard_start, standard_end, order, image_base64 } = req.body;
    if (title !== undefined) db.training_slides[idx].title = title;
    if (standard_start !== undefined) db.training_slides[idx].standard_start = parseInt(standard_start);
    if (standard_end !== undefined) db.training_slides[idx].standard_end = parseInt(standard_end);
    if (order !== undefined) db.training_slides[idx].order = order;
    if (image_base64 !== undefined) db.training_slides[idx].image_base64 = image_base64;
    saveDB(db);
    res.json(db.training_slides[idx]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/training/slides/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const db = loadDB();
    if (!db.training_slides) return res.status(404).json({ error: '幻灯片不存在' });
    db.training_slides = db.training_slides.filter(s => s.id !== id);
    saveDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 批量保存某课程的幻灯片（包括顺序和起止条数）
app.put('/api/training/courses/:id/slides/bulk-update', (req, res) => {
  const courseId = parseInt(req.params.id);
  const { slides } = req.body; // 包含 {id, order, standard_start, standard_end} 的数组
  if (!Array.isArray(slides)) return res.status(400).json({ error: 'slides 必须是数组' });
  try {
    const db = loadDB();
    if (!db.training_slides) return res.json({ success: true });
    slides.forEach(upd => {
      const s = db.training_slides.find(s => s.id === upd.id && s.course_id === courseId);
      if (s) {
        if (upd.order !== undefined) s.order = upd.order;
        if (upd.standard_start !== undefined) s.standard_start = upd.standard_start;
        if (upd.standard_end !== undefined) s.standard_end = upd.standard_end;
      }
    });
    saveDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取某课程幻灯片的【元数据列表】（不含 image_base64，加速首屏加载）
app.get('/api/training/courses/:id/slides/meta', (req, res) => {
  const courseId = parseInt(req.params.id);
  try {
    const db = loadDB();
    const slides = (db.training_slides || [])
      .filter(s => s.course_id === courseId)
      .sort((a, b) => a.order - b.order)
      .map(({ image_base64, ...rest }) => rest); // 去掉图片字段
    res.json(slides);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取单张幻灯片的图片（懒加载专用）
app.get('/api/training/slides/:id/image', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const db = loadDB();
    const slide = (db.training_slides || []).find(s => s.id === id);
    if (!slide) return res.status(404).json({ error: '幻灯片不存在' });
    res.json({ id: slide.id, image_base64: slide.image_base64 || '' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- 账号管理 ---
app.get('/api/training/accounts', (req, res) => {
  try {
    const db = loadDB();
    const accounts = (db.training_accounts || []).map(a => ({
      id: a.id, username: a.username, display_name: a.display_name
      // 不返回 password
    }));
    res.json(accounts);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/training/accounts', (req, res) => {
  const { username, password, display_name } = req.body;
  if (!username || !password || !display_name) return res.status(400).json({ error: '账号、密码、显示名均不能为空' });
  try {
    const db = loadDB();
    if (!db.training_accounts) db.training_accounts = [];
    if (!db._next_training_account_id) db._next_training_account_id = 1;
    if (db.training_accounts.find(a => a.username === username.trim())) {
      return res.status(409).json({ error: '该账号已存在' });
    }
    const account = {
      id: db._next_training_account_id++,
      username: username.trim(),
      password: password,
      display_name: display_name.trim()
    };
    db.training_accounts.push(account);
    saveDB(db);
    res.json({ id: account.id, username: account.username, display_name: account.display_name });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/training/accounts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const db = loadDB();
    if (!db.training_accounts) return res.status(404).json({ error: '账号不存在' });
    db.training_accounts = db.training_accounts.filter(a => a.id !== id);
    saveDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// Serve static files from the React app
// ============================================================
app.use(express.static(path.join(__dirname, 'dist')));

// 主播培训前台独立路由（需在 * 通配之前）
app.get('/zhubopeixun', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ============================================================
// AI 话术分析（Claude）— 全自动触发
// ============================================================
const CLAUDE_API_URL = "https://cn2us02.opapi.win/v1/chat/completions";
const CLAUDE_API_KEY = "sk-VLMfCJOS590C21872eDcT3BlBkFJf3501EA9e9C34532943E";
const CLAUDE_MODEL = "claude-sonnet-4-6";

const ANALYSIS_PROMPT = `你是一位直播话术结构分析专家，专注于学习机类目。请对以下直播逐字稿进行深度分析。

## 分析要求（严格执行）
1. 每个阶段必须标注【话术耗时估算】。
2. 优缺点采用"核心总结 + 原话摘录"模式：先用简洁语言总结点，再紧跟主播具象的原话。
3. 重点拆解"排除逻辑"：挖掘主播如何通过话术、对比或演示，让家长放弃竞品。
4. 全程扫描：特别留意对作业帮、小猿等品牌的隐晦负面评价及排除话术。

---

# {anchor_name} 话术结构分析报告

## 一、开场互动与认知建设
### 1. 互动热场
- **预计时长**：
- **互动方式与策略**：
- **【原话摘录】**：


### 2. 第三方品牌排除（作业帮、小猿、步步高、希沃等）
- **排除方式**：(如：功能缺失、资源问题、隐晦拉踩)
- **关于小猿/作业帮的缺点/暗讽**：(如有，请务必扫描出来)
- **【原话摘录】**：

## 二、科大讯飞深度讲解（对比/排除环节）
### ✅ 优点（总结 + 原话）
1. 优点总结：...
   - **【原话】**：
### ❌ 缺点与排除话术（总结 + 原话）
1. 缺点总结：...
   - **【原话】**：
2. **排除策略拆解**：(主播是如何引导家长觉得"科大讯飞不适合小学初中"或"不值得买"的？)

## 三、学而思深度讲解
### ✅ 优点（总结 + 原话）
1. 优点总结：...
   - **【原话】**：
### ❌ 缺点/说明（总结 + 原话）
1. 缺点总结：(主播如何通过自揭短板来换取信任)
   - **【原话】**：

## 四、学而思机型对比（以 P4 为核心的排除法）
### 1. 其他型号排除逻辑
- **型号名称**：(如 T4/X5等)
- **如何排除**：(主播如何说服家长不要买其他款，而买 P4)
- **【原话】**：

### 2. P4 缺陷话术处理
- **课程少/硬件缺陷**：(针对这些不足，主播是如何说服家长"够用/不需要"的？)
- **【话术逻辑】**：

## 五、上链接与成交策略
### 1. 赠品与权益拆解
- **伴学APP/1对1规划**：(具体描述与原话)
- **赠送课程清单**：
- **稀缺性渲染**：(为什么只有这里有？别人为什么没有？如何制造权益独特性？)
- **【原话摘录】**：

### 2. 促成下单/出单话术
- **确定性建立**：(主播如何让家长觉得"今天必须下单"？)
- **【原话摘录】**：
- **催单话术要点**：`;

// 正在分析中的 session ID 集合（防止重复触发）
const analyzingSet = new Set();

// 调用 Claude API 进行分析
async function callClaudeAnalysis(anchorName, transcript) {
  const prompt = ANALYSIS_PROMPT.replace('{anchor_name}', anchorName);
  // 截断过长的逐字稿（每场约4万字，保留5万字上限）
  const MAX_CHARS = 50000;
  let trimmedTranscript = transcript;
  if (transcript.length > MAX_CHARS) {
    trimmedTranscript = transcript.slice(0, MAX_CHARS) + '\n\n[... 逐字稿已截断，以上为前' + MAX_CHARS + '字 ...]';
    console.log(`[AI分析] 逐字稿被截断: ${transcript.length} -> ${MAX_CHARS}`);
  }
  const resp = await axios.post(CLAUDE_API_URL, {
    model: CLAUDE_MODEL,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: `以下是 ${anchorName} 的直播逐字稿全文，请按照分析框架进行深度、详尽的分析。每个章节都必须充分展开，原话摘录尽可能多地引用主播原文（至少2-3段），排除策略拆解要具体到话术逻辑链条。不要省略任何章节，不要简短带过。\n\n${trimmedTranscript}` }
    ],
    max_tokens: 16384,
    temperature: 0.3
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CLAUDE_API_KEY}`
    },
    timeout: 300000 // 5分钟超时
  });
  return resp.data.choices?.[0]?.message?.content || '';
}

// 分析队列（串行执行，一次只分析一场）
const analysisQueue = [];
let analysisRunning = false;

async function processAnalysisQueue() {
  if (analysisRunning || analysisQueue.length === 0) return;
  analysisRunning = true;
  const { sessionId, anchorName } = analysisQueue.shift();
  console.log(`[AI分析] 开始处理队列: session=${sessionId}, 队列剩余=${analysisQueue.length}`);
  try {
    const token = getMonitorToken();
    const detailRes = await axios.get(`${MONITOR_API}/api/session/${sessionId}?token=${token}`, { timeout: 15000 });
    const detail = detailRes.data;
    let transcript = '';
    if (detail.transcript?.timestamped_text) {
      transcript = detail.transcript.timestamped_text
        .split('\n')
        .map(line => line.replace(/^\d+:\d+:\d+\s*[-–]\s*\d+:\d+:\d+\s*/, '').trim())
        .filter(Boolean)
        .join('\n');
    } else if (detail.transcript?.full_text) {
      transcript = detail.transcript.full_text;
    }
    if (!transcript || transcript.length < 100) {
      console.log(`[AI分析] session=${sessionId} 逐字稿太短(${transcript.length})，跳过`);
      analysisRunning = false;
      analyzingSet.delete(sessionId);
      processAnalysisQueue();
      return;
    }
    console.log(`[AI分析] 调用Claude: session=${sessionId}, 逐字稿=${transcript.length}字`);
    const db = loadDB();
    if (!db.analysis_cache) db.analysis_cache = {};
    db.analysis_cache[sessionId] = { status: 'analyzing', created_at: new Date().toISOString() };
    saveDB(db);

    const result = await callClaudeAnalysis(anchorName, transcript);

    const db2 = loadDB();
    if (!db2.analysis_cache) db2.analysis_cache = {};
    db2.analysis_cache[sessionId] = {
      status: 'done',
      result: result,
      anchor_name: anchorName,
      created_at: new Date().toISOString()
    };
    saveDB(db2);
    console.log(`[AI分析] ✅ 完成: session=${sessionId}, 结果=${result.length}字`);
  } catch (e) {
    console.error(`[AI分析] ❌ 失败: session=${sessionId}`, e.message);
    const db = loadDB();
    if (!db.analysis_cache) db.analysis_cache = {};
    db.analysis_cache[sessionId] = {
      status: 'failed',
      error: e.message,
      created_at: new Date().toISOString()
    };
    saveDB(db);
  } finally {
    analyzingSet.delete(sessionId);
    analysisRunning = false;
    // 处理队列中的下一个
    if (analysisQueue.length > 0) {
      setTimeout(processAnalysisQueue, 1000); // 间隔1秒避免并发
    }
  }
}

// 后台自动触发分析（加入队列，串行处理）
function triggerAutoAnalysis(sessionId, anchorName) {
  if (analyzingSet.has(sessionId)) return;
  analyzingSet.add(sessionId);
  console.log(`[AI分析] 加入队列: session=${sessionId}, anchor=${anchorName}`);
  // 先标记状态为 analyzing
  const db = loadDB();
  if (!db.analysis_cache) db.analysis_cache = {};
  db.analysis_cache[sessionId] = { status: 'analyzing', created_at: new Date().toISOString() };
  saveDB(db);
  // 加入队列
  analysisQueue.push({ sessionId, anchorName });
  processAnalysisQueue();
}

// 获取分析状态/结果
app.get('/api/analysis/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId;
  const db = loadDB();
  const cached = db.analysis_cache?.[sessionId];
  if (cached) {
    res.json(cached);
  } else {
    res.json({ status: 'none' });
  }
});

// 手动触发分析
app.post('/api/analysis/trigger', async (req, res) => {
  const { session_id, anchor_name } = req.body;
  if (!session_id || !anchor_name) {
    return res.status(400).json({ error: '缺少 session_id 或 anchor_name' });
  }
  const db = loadDB();
  const cached = db.analysis_cache?.[session_id];
  if (cached?.status === 'done') {
    return res.json({ status: 'done', message: '已有分析结果' });
  }
  triggerAutoAnalysis(session_id, anchor_name);
  res.json({ status: 'analyzing', message: '已开始分析' });
});

// 批量获取分析状态（前端用）
app.post('/api/analysis/batch-status', (req, res) => {
  const { session_ids } = req.body;
  if (!Array.isArray(session_ids)) return res.json({});
  const db = loadDB();
  const result = {};
  for (const id of session_ids) {
    result[id] = db.analysis_cache?.[id]?.status || 'none';
  }
  res.json(result);
});

// 加载跟踪主播场次时自动触发分析
// ⚠️ auto-trigger 已禁用（防止自动批量消耗 Claude API 余额）
app.post('/api/analysis/auto-trigger', async (req, res) => {
  res.json({ triggered: 0, disabled: true, message: '自动分析已禁用，请手动点击AI分析按钮' });
});

// AI 话术对话问答（基于逐字稿的多轮对话）
app.post('/api/analysis/chat', async (req, res) => {
  const { session_id, anchor_name, question, history } = req.body;
  if (!session_id || !question) {
    return res.status(400).json({ error: '缺少 session_id 或 question' });
  }
  try {
    // 获取该场次的逐字稿
    const token = getMonitorToken();
    const detailRes = await axios.get(`${MONITOR_API}/api/session/${session_id}?token=${token}`, { timeout: 30000 });
    const session = detailRes.data;
    let transcript = '';
    if (session.timestamped_text && Array.isArray(session.timestamped_text)) {
      transcript = session.timestamped_text.map(seg => `[${seg.ts || ''}] ${seg.text}`).join('\n');
    } else if (session.transcript) {
      // transcript 可能是 {full_text: "..."} 格式
      if (typeof session.transcript === 'object' && session.transcript.full_text) {
        transcript = session.transcript.full_text;
      } else if (typeof session.transcript === 'string') {
        transcript = session.transcript;
      } else {
        transcript = JSON.stringify(session.transcript);
      }
    }
    if (!transcript) {
      return res.json({ answer: '该场次暂无逐字稿数据，无法回答问题。' });
    }
    // 截断
    const MAX_CHARS = 50000;
    if (transcript.length > MAX_CHARS) {
      transcript = transcript.slice(0, MAX_CHARS) + '\n[... 逐字稿已截断 ...]';
    }
    // 构造消息
    const messages = [
      {
        role: 'system',
        content: `你是一位直播话术分析专家。以下是主播「${anchor_name || '未知'}」某场直播的完整逐字稿。用户会针对这场直播的话术提问，请根据逐字稿内容准确回答。

回答要求：
1. 回答要具体、有理有据，尽量引用主播的原话来佐证
2. 如果逐字稿中没有相关内容，如实说明
3. 回答简洁清晰，用中文回答

=== 逐字稿全文 ===
${transcript}`
      }
    ];
    // 加入历史对话
    if (Array.isArray(history)) {
      for (const h of history.slice(-10)) { // 最多保留最近10轮
        messages.push({ role: h.role, content: h.content });
      }
    }
    // 加入当前问题
    messages.push({ role: 'user', content: question });

    const resp = await axios.post(CLAUDE_API_URL, {
      model: CLAUDE_MODEL,
      messages,
      max_tokens: 4096,
      temperature: 0.3
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CLAUDE_API_KEY}`
      },
      timeout: 120000
    });
    const answer = resp.data.choices?.[0]?.message?.content || '未能获取回答';
    res.json({ answer });
  } catch (e) {
    console.error('[AI Chat] 错误:', e.response?.data || e.message);
    res.status(500).json({ error: 'AI 回答失败: ' + (e.response?.data?.error?.message || e.message) });
  }
});

// ============================================================
// 弹幕采集系统（douyinLive 集成）
// ============================================================

const DANMAKU_DIR = path.join(DATA_DIR, 'danmaku');
if (!existsSync(DANMAKU_DIR)) mkdirSync(DANMAKU_DIR, { recursive: true });

const DOUYINLIVE_WS = process.env.DOUYINLIVE_WS || 'ws://172.17.0.1:1088';

// 活跃的弹幕采集连接 { roomId: { ws, sessionId, comments: [], viewers: [], flushTimer } }
const danmakuCollectors = {};

// 从 douyin_room_url 提取房间 ID
function extractRoomId(url) {
  if (!url) return null;
  const m = url.match(/live\.douyin\.com\/(\d+)/);
  return m ? m[1] : null;
}

// 保存弹幕数据到文件
function flushDanmakuData(sessionId) {
  const collector = Object.values(danmakuCollectors).find(c => c.sessionId === sessionId);
  if (!collector) return;
  try {
    const commentsPath = path.join(DANMAKU_DIR, `session_${sessionId}_comments.json`);
    const viewersPath = path.join(DANMAKU_DIR, `session_${sessionId}_viewers.json`);
    writeFileSync(commentsPath, JSON.stringify(collector.comments));
    writeFileSync(viewersPath, JSON.stringify(collector.viewers));
  } catch (e) {
    console.error(`[弹幕] 写入文件失败 session=${sessionId}:`, e.message);
  }
}

// 加载已有的弹幕数据
function loadDanmakuData(sessionId) {
  try {
    const commentsPath = path.join(DANMAKU_DIR, `session_${sessionId}_comments.json`);
    const viewersPath = path.join(DANMAKU_DIR, `session_${sessionId}_viewers.json`);
    const comments = existsSync(commentsPath) ? JSON.parse(readFileSync(commentsPath, 'utf8')) : [];
    const viewers = existsSync(viewersPath) ? JSON.parse(readFileSync(viewersPath, 'utf8')) : [];
    return { comments, viewers };
  } catch {
    return { comments: [], viewers: [] };
  }
}

// 连接弹幕 WebSocket
function connectDanmaku(roomId, sessionId, anchorName) {
  if (danmakuCollectors[roomId]) {
    console.log(`[弹幕] 已在采集 roomId=${roomId}`);
    return;
  }

  // 加载可能已有的数据（断线重连场景）
  const existing = loadDanmakuData(sessionId);

  const collector = {
    sessionId,
    anchorName,
    comments: existing.comments,
    viewers: existing.viewers,
    ws: null,
    flushTimer: null,
    lastViewerTime: 0, // 上次记录在线人数的时间戳
  };

  try {
    const wsUrl = `${DOUYINLIVE_WS}/ws/${roomId}`;
    console.log(`[弹幕] 连接 ${anchorName} roomId=${roomId} sessionId=${sessionId}`);
    const ws = new WebSocket(wsUrl);
    collector.ws = ws;

    ws.on('open', () => {
      console.log(`[弹幕] ✅ 已连接 ${anchorName} 弹幕流`);
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        const method = (data.common && data.common.method) || data.method || '';
        const ts = data.common?.createTime ? parseInt(data.common.createTime) : Date.now();

        // 弹幕
        if (method === 'WebcastChatMessage' && data.content && data.user?.nickname) {
          collector.comments.push({
            t: ts,
            n: data.user.nickname,
            c: data.content,
          });
        }

        // 在线人数（每5秒记录一次，尽量保留抖音推送的每条数据）
        if (method === 'WebcastRoomStatsMessage' && data.total) {
          const now = Date.now();
          if (now - collector.lastViewerTime >= 5000) {
            collector.viewers.push({
              t: ts,
              c: parseInt(data.total) || 0,
            });
            collector.lastViewerTime = now;
          }
        }
      } catch (e) { }
    });

    ws.on('close', () => {
      console.log(`[弹幕] 连接关闭 ${anchorName} roomId=${roomId}`);
      flushDanmakuData(sessionId);
      if (collector.flushTimer) clearInterval(collector.flushTimer);
      delete danmakuCollectors[roomId];
    });

    ws.on('error', (e) => {
      console.error(`[弹幕] WebSocket 错误 ${anchorName}:`, e.message);
    });

    // 每60秒刷盘
    collector.flushTimer = setInterval(() => flushDanmakuData(sessionId), 60000);

    danmakuCollectors[roomId] = collector;
  } catch (e) {
    console.error(`[弹幕] 连接失败 ${anchorName}:`, e.message);
  }
}

// 断开弹幕连接
function disconnectDanmaku(roomId) {
  const collector = danmakuCollectors[roomId];
  if (!collector) return;
  console.log(`[弹幕] 断开 ${collector.anchorName} roomId=${roomId}`);
  flushDanmakuData(collector.sessionId);
  if (collector.flushTimer) clearInterval(collector.flushTimer);
  try { collector.ws?.close(); } catch {}
  delete danmakuCollectors[roomId];
}

// 定时检查录制状态，自动连接/断开弹幕采集
async function checkDanmakuCollectors() {
  try {
    const token = getMonitorToken();
    // 从 8089 读取主播列表（不再读本地 JSON）
    const anchorsResp = await axios.get(`${MONITOR_API}/api/anchors?token=${token}`, { timeout: 8000 });
    const anchors = anchorsResp.data || [];

    for (const anchor of anchors) {
      const roomId = extractRoomId(anchor.douyin_room_url);
      if (!roomId) continue;

      // 查询该主播是否有录制中的场次
      try {
        const sessionsResp = await axios.get(`${MONITOR_API}/api/sessions/${anchor.id}?token=${token}`, { timeout: 5000 });
        const sessions = sessionsResp.data || [];
        const recordingSession = sessions.find(s => s.status === 'recording');

        if (recordingSession) {
          // 有录制中的场次 → 确保弹幕采集运行中
          if (!danmakuCollectors[roomId]) {
            connectDanmaku(roomId, recordingSession.id, anchor.name);
          }
        } else {
          // 没有录制中的场次 → 断开
          if (danmakuCollectors[roomId]) {
            disconnectDanmaku(roomId);
          }
        }
      } catch {}
    }
  } catch (e) {
    console.error('[弹幕] 检查采集状态失败:', e.message);
  }
}

// 每30秒检查一次
setInterval(checkDanmakuCollectors, 30000);
// 启动后5秒执行第一次
setTimeout(checkDanmakuCollectors, 5000);

// ====== 弹幕 API ======

// 获取某场次的弹幕和在线人数

// ===== Q&A 历史持久化 =====

// 获取场次的所有历史问答
app.get('/api/qa/:sessionId', (req, res) => {
  const sid = req.params.sessionId;
  const qaDir = path.join(DATA_DIR, 'qa');
  const qaFile = path.join(qaDir, 'session_' + sid + '.json');
  try {
    if (!fs.existsSync(qaFile)) return res.json([]);
    const data = JSON.parse(fs.readFileSync(qaFile, 'utf8'));
    res.json(data);
  } catch (e) {
    console.error('[QA] 读取失败:', e.message);
    res.json([]);
  }
});

// 保存一条新的问答记录
app.post('/api/qa/:sessionId', (req, res) => {
  const sid = req.params.sessionId;
  const { question, answer, asked_by } = req.body;
  if (!question || !answer) return res.status(400).json({ error: '缺少问题或答案' });
  const qaDir = path.join(DATA_DIR, 'qa');
  if (!fs.existsSync(qaDir)) fs.mkdirSync(qaDir, { recursive: true });
  const qaFile = path.join(qaDir, 'session_' + sid + '.json');
  let records = [];
  try {
    if (fs.existsSync(qaFile)) records = JSON.parse(fs.readFileSync(qaFile, 'utf8'));
  } catch {}
  const newRecord = {
    id: 'qa_' + Date.now(),
    question,
    answer,
    asked_by: asked_by || '未知用户',
    asked_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  };
  records.push(newRecord);
  fs.writeFileSync(qaFile, JSON.stringify(records, null, 2));
  res.json(newRecord);
});


app.get('/api/monitor/session/:id/danmaku', (req, res) => {
  const sessionId = parseInt(req.params.id);
  // 先检查内存中是否有活跃采集
  const activeCollector = Object.values(danmakuCollectors).find(c => c.sessionId === sessionId);
  if (activeCollector) {
    return res.json({
      comments: activeCollector.comments,
      viewers: activeCollector.viewers,
      live: true
    });
  }
  // 否则从文件加载
  const data = loadDanmakuData(sessionId);
  res.json({ ...data, live: false });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  ensureAdminAccounts();

  // 启动时自动清理卡住的质检任务（容器重启后 running/pending 的任务不会自动恢复）
  try {
    const db = loadDB();
    let fixed = 0;
    (db.tasks || []).forEach(t => {
      if (t.status === 'running' || t.status === 'pending') {
        t.status = 'failed';
        t.error_message = '服务重启导致任务中断，请重新触发质检';
        t.completed_at = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
        fixed++;
      }
    });
    if (fixed > 0) {
      saveDB(db);
      console.log(`[启动清理] 已重置 ${fixed} 个卡住的质检任务`);
    }
  } catch (e) {
    console.warn('[启动清理] 清理卡住任务失败:', e.message);
  }

  console.log(`Server is running at http://0.0.0.0:${PORT}`);
});
