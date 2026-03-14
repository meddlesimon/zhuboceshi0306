import express from 'express';
import cors from 'cors';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

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
const DEFAULT_GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'sk-3TO0OtML740DE4C47351T3BLBKFJc576476F8D79476ba371';
const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
const DEFAULT_GEMINI_URL = process.env.GEMINI_URL || 'https://cn2us02.opapi.win/v1/chat/completions';

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
      api_key: 'sk-3TO0OtML740DE4C47351T3BLBKFJc576476F8D79476ba371',
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

function loadDB() {
  try {
    if (existsSync(DB_PATH)) {
      return JSON.parse(readFileSync(DB_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('[DB] Load error:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DB));
}

function saveDB(data) {
  try {
    writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('[DB] Save error:', e.message);
  }
}

// 初始化：如果不存在就写入默认数据
if (!existsSync(DB_PATH)) {
  saveDB(DEFAULT_DB);
  console.log('[DB] JSON database initialized at', DB_PATH);
} else {
  console.log('[DB] JSON database loaded from', DB_PATH);
}

// ---- 辅助：生成 task id ----
function genTaskId() {
  return 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

// ============================================================
// API：主播管理
// ============================================================

// 获取所有主播
app.get('/api/anchors', (req, res) => {
  try {
    const db = loadDB();
    res.json(db.anchors.sort((a, b) => a.id - b.id));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 新增主播
app.post('/api/anchors', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '主播名不能为空' });
  try {
    const db = loadDB();
    const trimmed = name.trim();
    if (db.anchors.find(a => a.name === trimmed)) return res.status(409).json({ error: '该主播已存在' });
    const anchor = { id: db._next_anchor_id++, name: trimmed, created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) };
    db.anchors.push(anchor);
    saveDB(db);
    res.json(anchor);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除主播
app.delete('/api/anchors/:id', (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const db = loadDB();
    const idx = db.anchors.findIndex(a => a.id === id);
    if (idx === -1) return res.status(404).json({ error: '主播不存在' });
    db.anchors.splice(idx, 1);
    db.tasks = db.tasks.filter(t => t.anchor_id !== id);
    saveDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// API：话术版本管理（全局共用）
// ============================================================

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

// 更新任务状态的辅助函数
function updateTaskInDB(taskId, updates) {
  const db = loadDB();
  const idx = db.tasks.findIndex(t => t.id === taskId);
  if (idx !== -1) {
    Object.assign(db.tasks[idx], updates);
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
      updateTaskInDB(taskId, { progress_message: '单轮质检中...' });
      const r1 = await runSingleRoundAnalysis(transcriptText, standards);
      result = { round1: r1, round1Text: transcriptText, fullRawText: transcriptText, isDualMode: false };
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

// 单轮分析
async function runSingleRoundAnalysis(transcriptText, standards) {
  const mandatory = standards.filter(s => s.type === 'mandatory');
  const forbidden = standards.filter(s => s.type === 'forbidden');

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
// Serve static files from the React app
// ============================================================
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://0.0.0.0:${PORT}`);
});
