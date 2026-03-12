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
      你是一位极其专业、严谨且富有同理心的直播运营专家。
      
      【匹配标准（满分答案）】
      - 质检重点: "${ruleName}"
      - 标准话术: "${standardContent}"
      
      【主播原话片段（已从直播中提取的核心证据，仅数百字）】
      ${coreEvidence}


      【任务指令 (V3.0 柔性模型)】
      根据【标准话术】和【主播原话片段】进行比对打分。
      
      4.1 动态要素拆解 (Dynamic Element Decomposition)
      裁判员首先不会直接看原话，而是先“解构”你的标准话术。AI 会根据话术的字数和逻辑结构，自动将其拆解为 N 个不可缺失的核心要素：
      拆解规则（按量级分配）：
      短话术 (≤100字)：拆解为 2 个 核心点（每项 50 分）。例如：品牌名 + 1个核心利益点。
      中话术 (100-300字)：拆解为 4 个 核心点（每项 25 分）。通常包含：痛点引入、产品名称、核心功能、互动指令。
      长话术 (300-700字)：拆解为 5 个 核心点（每项 20 分）。
      深度话术 (>700字)：拆解为 7 个 核心点（每项 14.3 分）。包含底层基因逻辑、实操避坑、多重对比等。
      要素类型识别：
      关键词/名词：如“学而思P4”、“科大讯飞S30T”、“中考真题库”。
      利益点/功能：如“精准找弱项”、“省掉几万块补课费”、“真人老师连线”。
      互动/动作：如“下方小黄车1号链接”、“点点关注”、“左上角领券”。
      底层逻辑：如“错题本不是目的，分析原因才是”、“用降维打击的方式做题”。
      
      4.2 语义对标与柔性判分 (Semantic Alignment)
      裁判员将“原话片段”与上述“拆解要素”进行逐一比对。这里采用的是柔性判分，而非死板的字面匹配：
      完全达标 (100% 权重分)：
      主播表达了该要素的完整逻辑。
      ASR 豁免：允许同音错别字（如“学而思”识别成“学而死”），只要语义对上即给满分。
      部分达标 (50% 权重分)：
      主播提到了该要素，但表述模糊、漏掉关键修饰语。
      或者主播虽然漏掉了次要细节，但有极高质量的原创发挥（逻辑一致）。
      完全缺失 (0分)：
      该核心要素在原话片段中完全没有痕迹。
      
      4.3 汇总评分与专家诊断 (Diagnostic Feedback)
      裁判员将所有要素得分汇总，并生成最终结果：
      红线判定：
      总分 < 70 分：直接判定为 "poor" (漏讲)。
      总分 70-85 分：判定为 "fair" (尚可)。
      总分 > 85 分：判定为 "good" (优秀)。

      【输出 JSON 格式（严禁返回其他多余内容）】
      必须输出一段结构化的评语，放到 reason_or_comment 字段中。
      {
        "detected": boolean, 
        "performance_grade": "good" | "fair" | "poor",
        "score": number, 
        "reason_or_comment": "综合得分：[X 分]\\\\n\\\\n核心要素对标明细：\\\\n要素 1 [名称]：[权重/得分] —— [评语]\\\\n...\\\\n\\\\n专家诊断建议：\\\\n1、(分点换行说明主播表现)\\\\n2、(指出缺失等)"
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

// Serve static files from the React app
app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running at http://0.0.0.0:${PORT}`);
});
