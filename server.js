import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'sk-3TO0OtML740DE4C47351T3BLBKFJc576476F8D79476ba371';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
const GEMINI_URL = process.env.GEMINI_URL || 'https://cn2us02.opapi.win/v1/chat/completions';

const ADMIN_USER = process.env.ADMIN_USER || '18611979493';
const ADMIN_PWD = process.env.ADMIN_PWD || '20250901';

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PWD) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: '账号或密码错误' });
  }
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
async function callGemini(promptText) {
  try {
    const data = {
      model: GEMINI_MODEL,
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
    console.log('Model:', GEMINI_MODEL);
    console.log('URL:', GEMINI_URL);
    console.log('Key (masked):', GEMINI_API_KEY.slice(0, 8) + '...');

    const response = await axios.post(GEMINI_URL, data, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GEMINI_API_KEY}`
      },
      timeout: 120000 
    });

    const content = response.data.choices[0].message.content;
    console.log('AI Response Success (Length):', content.length);
    return content;
  } catch (error) {
    let errorDetail = '';
    if (error.response) {
      // 提取 OhMyGPT 返回的详细错误 JSON，包含 Status Code
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

// 1. API Endpoint: Check Single Window (Mandatory with Toxicity)
app.post('/api/check-single-window', async (req, res) => {
  const { windowText, standardContent, ruleName } = req.body;
  
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
    4. 允许 ASR 误差：考虑到语音转文字可能有同音错别字（如“学而思”变“学而死”），只要语义逻辑对齐即可。

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
    
    const prompt2_score = `
      你是一位极其专业、严谨且富有同理心的直播运营专家，擅长通过话术拆解提升主播的转化能力。
      
      【匹配标准（满分答案）】
      - 质检重点: "${ruleName}"
      - 标准话术: "${standardContent}"
      
      【主播原话片段（已从直播中提取的核心证据）】
      ${coreEvidence}


      【任务指令 (V6.2 均分对标版)】
      请根据【标准话术】和【主播原话片段】进行极其细致的拆解与比对打分。

      第一步：标准深度拆解 (Standard Breakdown)
      结合【质检重点】和【标准话术】，将其拆解为 2-7 个核心要素。
      【权重计算】：该模块总分 100 分。请用 100 除以要素数量，得出每个要素的权重（请取整，确保总和为 100）。
      
      第二步：评分准则 (三档计分)
      针对每个要素，你只能从以下三个分值中选择一个：
      1. 完全达标：给该项【权重】的 100% 分值。
      2. 部分达标：给该项【权重】的 50% 分值（取整）。
      3. 完全缺失：给 0 分。

      红线判定：总分 < 60 为 "poor"， 60-85 为 "fair"， > 85 为 "good"。

      【输出 JSON 格式（严禁返回其他多余内容）】
      必须输出一段结构化的评语，放到 reason_or_comment 字段中。
      注意：每个要素必须严格遵守单行格式：
      "要素 [序号] [标准参考动作]：[得分/权重] —— [实操复盘评语]"

      {
        "detected": boolean, 
        "performance_grade": "good" | "fair" | "poor",
        "score": number, 
        "reason_or_comment": "综合得分：[X 分]\\n\\n【核心要素对标明细】\\n\\n要素 1 [动作示范]：[得分/权重] —— [复盘评语]\\n要素 2 [动作示范]：[得分/权重] —— [复盘评语]\\n...\\n\\n【专家诊断建议】\\n1、全局评价：(总结主播)\\n2、改进动作：(建议)"
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
    res.status(500).json({ error: error.message });
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
      任务：从直播转写文本中，精准提取“第一轮”和“第二轮”业务演练的边界原话。

      【核心边界判定准则（这是唯一且必须遵守的标准）】

      1. 每一轮的【开启时刻】 (Start Anchor)：
         - 业务逻辑：主播发起品牌互动，引导家长“扣数字”来选择想听的品牌。
         - 模式一（品牌直呼）：包含或高度接近“想听作业帮的扣一，想听小猿的扣二，想听学而思的扣三，想听科大的扣四，想听步步高扣五”。
         - 模式二（模糊代指）：主播可能不直接说品牌名，但会说“想听这个的扣一，想听这个的扣二，想听这个的扣三，想听那个的扣四，想听最后一个扣五”。
         - 判定标准：只要出现连续的“扣一”到“扣五”的互动引导动作，即判定为该轮正式开始。

      2. 每一轮的【结束时刻】 (End Anchor)：
         - 业务逻辑：主播完成“上链接”动作，并对直播间挂载的链接产品进行最后的引导说明。
         - 核心步骤：
           A. 喊出口令：“321上链接”（或相似语义如：链接已上、快去抢、已经上车了）。
           B. 介绍序列：主播按顺序报出 1号、2号 或 3号链接的产品（例如：1号是学而思P4焕新升级，2号是科大讯飞S30T，3号是步步高X6）。
         - 判定标准：你不需要死磕每一个产品型号的字面一致，只要主播完成了对 1或2或3 号链接的顺序介绍动作，就判定为该轮结束。
         - 抓取目标：请抓取【介绍完 上链接及产品序列】时的最后一句原话。

      【输出原话提取要求】
      - 必须从原文中提取 15-20 字的连续原话。
      - 你必须保证提取的文字在原文中是连续且完全一致的（允许微小标点差异）。
      - 严禁进行任何概括、缩写或修饰，必须是“案发现场”的真实原话。

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

// 新增：候选锚点检索接口 (4-视窗严格扫描)
app.post('/api/find-candidate-anchors', async (req, res) => {
  const { windows } = req.body;
  if (!windows || windows.length !== 4) {
    return res.status(400).json({ error: '请提供完整的 4 个文本视窗数据' });
  }

  const prompt = `
    你是一位极其精密、严谨的直播质检专家。任务是分别从 4 个指定的文本视窗中，提取对应的业务锚点原话。

    【扫描及判定准则】
    1. 每一轮的 [开始时刻] (Start Anchor)：
       - 必须包含：主播引导家长“扣数字”选择品牌（如：想听作业帮扣1，小猿扣2... 或 想听这个扣1，那个扣2...）。
       - 核心标志：出现连续的“扣一”到“扣五”的互动指令。
    2. 每一轮的 [结束时刻] (End Anchor)：
       - 必须包含：主播完成“321上链接”并按顺序报出“1号、2号、3号链接”的产品名称。
       - 核心标志：完成对 1/2/3 号链接序列的最后介绍动作。

    【提取要求】
    - 必须从提供的视窗中提取 15-20 字的连续原话。
    - 严禁概括，严禁修改，必须是原文。
    - 如果该视窗内完全没有符合上述准则的内容，对应的字段必须返回 null。

    【待分析视窗】
    视窗一 (第一轮开始, 范围 0-15%): """${windows[0]}"""
    视窗二 (第一轮结束, 范围 35-60%): """${windows[1]}"""
    视窗三 (第二轮开始, 范围 50-65%): """${windows[2]}"""
    视窗四 (第二轮结束, 范围 70-100%): """${windows[3]}"""

    【输出 JSON 格式（严禁多余文字）】
    {
      "r1_start": "视窗一中的原话或 null",
      "r1_end": "视窗二中的原话或 null",
      "r2_start": "视窗三中的原话或 null",
      "r2_end": "视窗四中的原话或 null"
    }
  `;

  try {
    const resultText = await callGemini(prompt);
    const result = safeJsonParse(resultText);
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
    ${transcript.slice(0, 100000)}

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
    const results = await Promise.all(
      standards.map(s => checkSingleForbidden(transcript, s))
    );
    res.json(results);
  } catch (error) {
    console.error('<<< [API/check-batch] Error:', error.message);
    res.status(500).json({ error: '质检失败: ' + error.message });
  }
});

const PORT = process.env.PORT || 3001;

// 3. Health Check: Test Gemini Connection and Network
app.get('/api/health-check', async (req, res) => {
  console.log('>>> [API/health-check] Starting diagnostic...');
  const startTime = Date.now();
  const diagnostics = {
    env: {
      model: GEMINI_MODEL,
      api_endpoint: GEMINI_URL,
      key_mask: GEMINI_API_KEY.slice(0, 8) + '***' + GEMINI_API_KEY.slice(-4)
    },
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
// 以下为新增：SQLite 数据库 + 主播/话术/任务管理接口
// 原有接口一字未动
// ============================================================

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { existsSync, mkdirSync } from 'fs';

// 数据目录（Docker volume 挂载点）
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}
const DB_PATH = path.join(DATA_DIR, 'zhuboceshi.db');

let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  initDatabase(db);
  console.log('[DB] SQLite initialized at', DB_PATH);
} catch (e) {
  console.error('[DB] better-sqlite3 load failed:', e.message);
  db = null;
}

function initDatabase(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anchors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS standards_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version_label TEXT NOT NULL,
      content_json TEXT NOT NULL,
      total_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      is_current INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      anchor_id INTEGER NOT NULL,
      anchor_name TEXT NOT NULL,
      standards_version_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      transcript_filename TEXT NOT NULL DEFAULT '',
      transcript_text TEXT NOT NULL DEFAULT '',
      result_json TEXT,
      progress_message TEXT,
      score_r1 REAL,
      score_r2 REAL,
      is_dual_mode INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      completed_at TEXT,
      error_message TEXT
    );
  `);

  // 初始化默认主播（王老师、小陈老师、可乐老师）
  const defaultAnchors = ['王老师', '小陈老师', '可乐老师'];
  const insertAnchor = db.prepare(`INSERT OR IGNORE INTO anchors (name) VALUES (?)`);
  for (const name of defaultAnchors) {
    insertAnchor.run(name);
  }
}

// ---- 辅助：生成 task id ----
function genTaskId() {
  return 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ---- 辅助：计算综合得分 ----
function calcScore(analysisResult) {
  if (!analysisResult) return null;
  const mandatory = analysisResult.mandatory_checks || [];
  if (mandatory.length === 0) return null;
  const total = mandatory.reduce((sum, c) => sum + (c.score || 0), 0);
  return Math.round(total / mandatory.length);
}

// ============================================================
// API：主播管理
// ============================================================

// 获取所有主播
app.get('/api/anchors', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  try {
    const anchors = db.prepare('SELECT * FROM anchors ORDER BY id ASC').all();
    res.json(anchors);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 新增主播
app.post('/api/anchors', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '主播名不能为空' });
  try {
    const stmt = db.prepare('INSERT INTO anchors (name) VALUES (?)');
    const result = stmt.run(name.trim());
    const anchor = db.prepare('SELECT * FROM anchors WHERE id = ?').get(result.lastInsertRowid);
    res.json(anchor);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: '该主播已存在' });
    res.status(500).json({ error: e.message });
  }
});

// 删除主播
app.delete('/api/anchors/:id', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  const { id } = req.params;
  try {
    db.prepare('DELETE FROM tasks WHERE anchor_id = ?').run(id);
    const result = db.prepare('DELETE FROM anchors WHERE id = ?').run(id);
    if (result.changes === 0) return res.status(404).json({ error: '主播不存在' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API：话术版本管理（全局共用）
// ============================================================

// 获取所有话术版本列表
app.get('/api/standards', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  try {
    const versions = db.prepare(
      'SELECT id, version_label, total_count, created_at, is_current FROM standards_versions ORDER BY id DESC'
    ).all();
    res.json(versions);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取某个版本的完整话术内容
app.get('/api/standards/:id', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  try {
    const ver = db.prepare('SELECT * FROM standards_versions WHERE id = ?').get(req.params.id);
    if (!ver) return res.status(404).json({ error: '版本不存在' });
    res.json({ ...ver, content: JSON.parse(ver.content_json) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取当前使用的话术版本
app.get('/api/standards/current/detail', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  try {
    const ver = db.prepare('SELECT * FROM standards_versions WHERE is_current = 1 ORDER BY id DESC LIMIT 1').get();
    if (!ver) return res.status(404).json({ error: '尚未上传话术' });
    res.json({ ...ver, content: JSON.parse(ver.content_json) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 上传新版本话术（自动设为当前版本）
app.post('/api/standards', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  const { content_json } = req.body;
  if (!content_json || !Array.isArray(content_json) || content_json.length === 0) {
    return res.status(400).json({ error: '话术内容不能为空' });
  }
  try {
    // 将旧版本全部设为非当前
    db.prepare('UPDATE standards_versions SET is_current = 0').run();
    // 自动生成版本号
    const count = db.prepare('SELECT COUNT(*) as c FROM standards_versions').get().c;
    const version_label = `v${count + 1}`;
    const stmt = db.prepare(
      'INSERT INTO standards_versions (version_label, content_json, total_count, is_current) VALUES (?, ?, ?, 1)'
    );
    const result = stmt.run(version_label, JSON.stringify(content_json), content_json.length);
    const ver = db.prepare('SELECT * FROM standards_versions WHERE id = ?').get(result.lastInsertRowid);
    res.json({ ...ver, content: content_json });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API：质检任务管理
// ============================================================

// 提交质检任务（后台异步执行）
app.post('/api/tasks', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  const { anchor_id, transcript_text, transcript_filename, is_dual_mode } = req.body;
  if (!anchor_id || !transcript_text) {
    return res.status(400).json({ error: 'anchor_id 和 transcript_text 为必填项' });
  }

  // 获取主播信息
  const anchor = db.prepare('SELECT * FROM anchors WHERE id = ?').get(anchor_id);
  if (!anchor) return res.status(404).json({ error: '主播不存在' });

  // 获取当前话术版本
  const stdVer = db.prepare('SELECT * FROM standards_versions WHERE is_current = 1 ORDER BY id DESC LIMIT 1').get();
  if (!stdVer) return res.status(400).json({ error: '尚未配置话术，请先在话术管理页上传话术' });

  const taskId = genTaskId();
  const isDual = is_dual_mode === true || is_dual_mode === 1;

  // 写入数据库
  db.prepare(`
    INSERT INTO tasks (id, anchor_id, anchor_name, standards_version_id, status, transcript_filename, transcript_text, is_dual_mode)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(taskId, anchor_id, anchor.name, stdVer.id, transcript_filename || '未命名', transcript_text, isDual ? 1 : 0);

  // 立即返回 task_id，后台开始执行
  res.json({ task_id: taskId, status: 'pending' });

  // 后台异步执行（不 await，不阻塞响应）
  runTaskInBackground(taskId, stdVer, transcript_text, isDual).catch(e => {
    console.error('[Task Background Error]', taskId, e.message);
  });
});

// 后台任务执行函数
async function runTaskInBackground(taskId, stdVer, transcriptText, isDual) {
  const updateStatus = (status, progress) => {
    if (!db) return;
    db.prepare('UPDATE tasks SET status = ?, progress_message = ? WHERE id = ?')
      .run(status, progress || null, taskId);
  };

  try {
    updateStatus('running', '正在准备质检...');
    const standards = JSON.parse(stdVer.content_json);

    // 复用现有质检逻辑（从 doubaoService 移植到后端）
    let result;

    if (isDual) {
      updateStatus('running', '正在扫描双轮锚点...');
      // 调用内部 split 逻辑
      const splitResult = await callInternalSplit(transcriptText);
      
      if (!splitResult.found || !splitResult.r1_end_phrase) {
        updateStatus('running', '未检测到双轮，降级为单轮质检...');
        const r1 = await runSingleRoundAnalysis(transcriptText, standards, taskId, 'r1');
        result = { round1: r1, round1Text: transcriptText, fullRawText: transcriptText, isDualMode: false };
      } else {
        updateStatus('running', '双轮结构确认，并行分析中...');
        // 按锚点切分
        const r1EndIdx = transcriptText.indexOf(splitResult.r1_end_phrase.slice(0, 6));
        const r2StartIdx = transcriptText.indexOf(splitResult.r2_start_phrase.slice(0, 6));
        const part1 = r1EndIdx > 0 ? transcriptText.slice(0, r1EndIdx + splitResult.r1_end_phrase.length) : transcriptText;
        const part2 = r2StartIdx > 0 ? transcriptText.slice(r2StartIdx) : '';

        if (!part2 || part2.length < 50) {
          const r1 = await runSingleRoundAnalysis(transcriptText, standards, taskId, 'r1');
          result = { round1: r1, round1Text: transcriptText, fullRawText: transcriptText, isDualMode: false };
        } else {
          const [r1, r2] = await Promise.all([
            runSingleRoundAnalysis(part1, standards, taskId, 'r1'),
            runSingleRoundAnalysis(part2, standards, taskId, 'r2')
          ]);
          result = {
            round1: r1, round2: r2,
            round1Text: part1, round2Text: part2,
            fullRawText: transcriptText, isDualMode: true,
            splitAnchors: {
              r1StartPhrase: splitResult.r1_start_phrase || '',
              r1EndPhrase: splitResult.r1_end_phrase || '',
              r2StartPhrase: splitResult.r2_start_phrase || '',
              r2EndPhrase: splitResult.r2_end_phrase || ''
            }
          };
        }
      }
    } else {
      updateStatus('running', '单轮质检中...');
      const r1 = await runSingleRoundAnalysis(transcriptText, standards, taskId, 'r1');
      result = { round1: r1, round1Text: transcriptText, fullRawText: transcriptText, isDualMode: false };
    }

    // 计算得分
    const scoreR1 = calcScoreFromResult(result.round1);
    const scoreR2 = result.round2 ? calcScoreFromResult(result.round2) : null;

    // 写入结果
    db.prepare(`
      UPDATE tasks SET status = 'completed', result_json = ?, score_r1 = ?, score_r2 = ?,
        is_dual_mode = ?, progress_message = '质检完成', completed_at = datetime('now','localtime')
      WHERE id = ?
    `).run(JSON.stringify(result), scoreR1, scoreR2, result.isDualMode ? 1 : 0, taskId);

    console.log('[Task Completed]', taskId, 'r1:', scoreR1, 'r2:', scoreR2);
  } catch (e) {
    console.error('[Task Failed]', taskId, e.message);
    if (db) {
      db.prepare(`UPDATE tasks SET status = 'failed', error_message = ?, progress_message = '质检失败' WHERE id = ?`)
        .run(e.message, taskId);
    }
  }
}

// 内部 split 调用（复用已有 prompt 逻辑）
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

// 单轮分析（逐条调用 check-single-window，但在后台执行）
async function runSingleRoundAnalysis(transcriptText, standards, taskId, roundLabel) {
  const mandatory = standards.filter(s => s.type === 'mandatory');
  const forbidden = standards.filter(s => s.type === 'forbidden');

  // 并行处理 mandatory
  const mandatoryResults = await Promise.all(
    mandatory.map(async (std) => {
      const WINDOW_SIZE = 6000;
      const pos = std.theoretical_pos || 0.5;
      const textLen = transcriptText.length;
      const center = Math.floor(pos * textLen);
      const start = Math.max(0, center - WINDOW_SIZE / 2);
      const windowText = transcriptText.slice(start, start + WINDOW_SIZE);

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
        return {
          standard: std.qaFocus, status: 'missed', score: 0,
          comment: '分析出错: ' + e.message, standardContent: std.content, windowSnippet: windowText
        };
      }
    })
  );

  // 并行处理 forbidden
  let forbiddenResults = [];
  if (forbidden.length > 0) {
    try {
      const resp = await axios.post(`http://127.0.0.1:${PORT}/api/check-standards-batch`, {
        transcript: transcriptText, standards: forbidden
      }, { timeout: 120000 });
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
  if (!db) return res.status(503).json({ error: 'Database not available' });
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    const result = {
      ...task,
      result: task.result_json ? JSON.parse(task.result_json) : null,
      result_json: undefined
    };
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 获取某主播的历史任务列表
app.get('/api/anchors/:id/tasks', (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not available' });
  try {
    const tasks = db.prepare(`
      SELECT t.id, t.anchor_id, t.anchor_name, t.status, t.transcript_filename,
             t.score_r1, t.score_r2, t.is_dual_mode, t.progress_message,
             t.created_at, t.completed_at, t.error_message,
             sv.version_label as standards_version_label
      FROM tasks t
      LEFT JOIN standards_versions sv ON t.standards_version_id = sv.id
      WHERE t.anchor_id = ?
      ORDER BY t.created_at DESC
    `).all(req.params.id);
    res.json(tasks);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// Serve static files from the React app
// ============================================================
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://0.0.0.0:${PORT}`);
});
