import { Standard, AnalysisResult, ForbiddenIssue, MandatoryCheck } from "../types";

/**
 * Helper: Delay execution
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper: Clean string for fuzzy matching (remove punctuation/spaces)
 */
const cleanStr = (str: string) => str.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');

/**
 * Helper: Map index from clean string back to original string
 */
const getOriginalIndex = (original: string, cleanIndex: number): number => {
  let cIdx = 0;
  for (let i = 0; i < original.length; i++) {
    if (/[^\u4e00-\u9fa5a-zA-Z0-9]/.test(original[i])) continue;
    if (cIdx === cleanIndex) return i;
    cIdx++;
  }
  return -1;
};

/**
 * Helper: Precise or Three-point matching for anchor positioning
 */
export const findAnchorPosition = (haystack: string, phrase: string | null): { pos: number, length: number } | null => {
  if (!phrase || phrase.trim().length < 2) return null;

  // 1. 精确匹配
  const exactIdx = haystack.indexOf(phrase);
  if (exactIdx !== -1) {
    return { pos: exactIdx, length: phrase.length };
  }

  // 2. 模糊匹配 (去标点)
  const fuzzyIdx = fuzzyIndexOf(haystack, phrase);
  if (fuzzyIdx !== -1) {
    return { pos: fuzzyIdx, length: phrase.length };
  }

  // 3. 三点式定位法 (至少10字以上才启用)
  if (phrase.length >= 10) {
    const sPoint = phrase.slice(0, 5);
    const ePoint = phrase.slice(-5);
    const mPoint = phrase.slice(Math.floor(phrase.length / 2) - 2, Math.floor(phrase.length / 2) + 3);

    const sIdx = haystack.indexOf(sPoint);
    const mIdx = haystack.indexOf(mPoint);
    const eIdx = haystack.indexOf(ePoint);

    // 组合判断：如果至少命中两点且间距合理 (1.5倍原短语长度内)
    if (sIdx !== -1 && eIdx !== -1 && eIdx > sIdx && (eIdx - sIdx) < phrase.length * 1.5) {
      return { pos: sIdx, length: eIdx - sIdx + 5 };
    }
    
    // 单点命中兜底
    if (sIdx !== -1) return { pos: sIdx, length: phrase.length };
    if (mIdx !== -1) return { pos: Math.max(0, mIdx - Math.floor(phrase.length / 2)), length: phrase.length };
    if (eIdx !== -1) return { pos: Math.max(0, eIdx - phrase.length + 5), length: phrase.length };
  }

  return null;
};

/**
 * Helper: Fuzzy index lookup (Exported for UI selection)
 */
export const fuzzyIndexOf = (haystack: string, needle: string): number => {
  const cleanHaystack = cleanStr(haystack);
  const cleanNeedle = cleanStr(needle);
  if (!cleanNeedle) return -1;
  const cleanIdx = cleanHaystack.indexOf(cleanNeedle);
  if (cleanIdx === -1) return -1;
  return getOriginalIndex(haystack, cleanIdx);
};

/**
 * findCandidateAnchors: Pre-scan for anchors in 4 windows.
 */
export const findCandidateAnchors = async (fullText: string): Promise<any> => {
  const totalLen = fullText.length;
  if (totalLen < 500) throw new Error("文本长度不足，无法进行双轮拆分（至少需要500字以上）");

  // 1. 按照固定百分比区间生成视窗
  const getWin = (startP: number, endP: number) => 
    fullText.substring(Math.floor(totalLen * startP), Math.floor(totalLen * endP));

  const windows = [
    getWin(0, 0.15),   // R1 Start: 0-15%
    getWin(0.35, 0.60), // R1 End: 35-60%
    getWin(0.50, 0.65), // R2 Start: 50-65%
    getWin(0.70, 1.0)   // R2 End: 70-100%
  ];

  console.log("[FindAnchors] Sending 4-window pre-scan request...");

  const response = await fetch('/api/find-candidate-anchors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ windows })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error || "后端预找锚点失败");
  }

  const result = await response.json();

  // 2. 将相对视窗的偏移转换为全局偏移
  const globalPos = (phrase: string | null, winIdx: number) => {
    if (!phrase) return -1;
    const winStartPercent = [0, 0.35, 0.50, 0.70][winIdx];
    const winStartOffset = Math.floor(totalLen * winStartPercent);
    const winText = windows[winIdx];
    const localIdx = fuzzyIndexOf(winText, phrase);
    if (localIdx === -1) return -1;
    return winStartOffset + localIdx;
  };

  return {
    r1StartPhrase: result.r1_start,
    r1StartPos: globalPos(result.r1_start, 0),
    r1EndPhrase: result.r1_end,
    r1EndPos: globalPos(result.r1_end, 1),
    r2StartPhrase: result.r2_start,
    r2StartPos: globalPos(result.r2_start, 2),
    r2EndPhrase: result.r2_end,
    r2EndPos: globalPos(result.r2_end, 3),
    found: !!(result.r1_start && result.r1_end && result.r2_start && result.r2_end)
  };
};

/**
 * 阶段一：文本安全预处理（一刀切）
 * 在 50% 中间点前后 500 字内寻找换行符或句号
 */
const findMechanicalMiddleSplit = (text: string): number => {
  const len = text.length;
  const mid = Math.floor(len / 2);
  const range = 500; // 500字安全窗口
  
  const start = Math.max(0, mid - range);
  const end = Math.min(len, mid + range);
  const windowText = text.substring(start, end);

  // 优先级：换行符 > 句号
  let bestIdx = -1;
  let minDistance = Infinity;

  const markers = ['\n', '。', '！', '？'];
  for (const marker of markers) {
    let pos = windowText.indexOf(marker);
    while (pos !== -1) {
      const absolutePos = start + pos + 1; // +1 包含该标点
      const dist = Math.abs(absolutePos - mid);
      if (dist < minDistance) {
        minDistance = dist;
        bestIdx = absolutePos;
      }
      pos = windowText.indexOf(marker, pos + 1);
    }
    // 如果找到了换行符，就不必看后面的标点了
    if (marker === '\n' && bestIdx !== -1) break;
  }

  return bestIdx !== -1 ? bestIdx : mid;
};

/**
 * Intelligent Split: Detect where Round 2 starts via backend.
 */
export const splitTranscript = async (fullText: string, manualAnchors?: any): Promise<{ 
  part1: string, 
  part2: string,
  anchors?: { 
    r1StartPhrase: string, r1StartPos: number,
    r1EndPhrase: string, r1EndPos: number,
    r2StartPhrase: string, r2StartPos: number,
    r2EndPhrase: string, r2EndPos: number
  } 
}> => {
  const totalLen = fullText.length;
  if (totalLen < 200) return { part1: fullText, part2: '' };

  // 如果有手动确定的锚点，直接使用
  if (manualAnchors) {
    const { r1StartPos, r1EndPos, r1EndPhrase, r2StartPos, r2EndPos, r2EndPhrase } = manualAnchors;
    // 允许 r1EndPos 和 r2EndPos 为 -1 (即文本开头或结尾)
    const effectiveR1Start = r1StartPos === -1 ? 0 : r1StartPos;
    const effectiveR1End = r1EndPos === -1 ? fullText.length : r1EndPos + (r1EndPhrase?.length || 0);
    const effectiveR2Start = r2StartPos === -1 ? 0 : r2StartPos;
    const effectiveR2End = r2EndPos === -1 ? fullText.length : r2EndPos + (r2EndPhrase?.length || 0);

    return {
      part1: fullText.substring(effectiveR1Start, effectiveR1End).trim(),
      part2: fullText.substring(effectiveR2Start, effectiveR2End).trim(),
      anchors: manualAnchors
    };
  }

  try {
    const response = await fetch('/api/split', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullText })
    });

    if (response.ok) {
      const result = await response.json();
      if (result.found) {
        // 1. 定位第一轮开始
        const r1StartIdx = fuzzyIndexOf(fullText, result.r1_start_phrase);
        // 2. 定位第一轮末尾
        const r1EndIdx = fuzzyIndexOf(fullText, result.r1_end_phrase);
        // 3. 定位第二轮开始
        const r2StartIdx = fuzzyIndexOf(fullText, result.r2_start_phrase);
        // 4. 定位第二轮结束
        const r2EndIdx = fuzzyIndexOf(fullText, result.r2_end_phrase);

        let part1 = fullText;
        let part2 = '';

        if (r1StartIdx !== -1 && r1EndIdx !== -1) {
          // 第一轮：严格截取 [R1_Start, R1_End]
          part1 = fullText.substring(r1StartIdx, r1EndIdx + result.r1_end_phrase.length).trim();
        } else if (r1EndIdx !== -1) {
          // 兜底：如果没找到第一轮开头，则从 0 开始
          part1 = fullText.substring(0, r1EndIdx + result.r1_end_phrase.length).trim();
        }
        
        if (r2StartIdx !== -1) {
          // 第二轮：从 第二轮开始语 到 (如果有的话) 第二轮结束语
          const endPos = r2EndIdx !== -1 
            ? r2EndIdx + result.r2_end_phrase.length 
            : fullText.length;
          part2 = fullText.substring(r2StartIdx, endPos).trim();
        }

        if (part2) {
          console.log("[Split] Success using precision anchors.");
          return { 
            part1, 
            part2,
            anchors: {
              r1StartPhrase: result.r1_start_phrase,
              r1StartPos: r1StartIdx,
              r1EndPhrase: result.r1_end_phrase,
              r1EndPos: r1EndIdx,
              r2StartPhrase: result.r2_start_phrase,
              r2StartPos: r2StartIdx,
              r2EndPhrase: result.r2_end_phrase,
              r2EndPos: r2EndIdx
            }
          };
        }
      }
    }
  } catch (error) {
    console.warn("Precision split failed, falling back to mechanical split.", error);
  }

  // 兜底逻辑：机械平分
  const splitIndex = findMechanicalMiddleSplit(fullText);
  
  // 生成虚拟锚点，确保前端卡片始终显示
  const fallbackStart = Math.max(0, splitIndex - 20);
  const fallbackEnd = Math.min(fullText.length, splitIndex + 20);
  const fallbackPhrase = fullText.substring(fallbackStart, fallbackEnd);

  return {
    part1: fullText.substring(0, splitIndex).trim(),
    part2: fullText.substring(Math.max(0, splitIndex - 1000)).trim(), // 减少重叠
    anchors: {
      r1StartPhrase: "（文本开头）",
      r1StartPos: 0,
      r1EndPhrase: fallbackPhrase + " (系统定位点)",
      r1EndPos: splitIndex,
      r2StartPhrase: fallbackPhrase + " (系统定位点)",
      r2StartPos: splitIndex,
      r2EndPhrase: "（文本末尾）",
      r2EndPos: fullText.length
    }
  };
};

/**
 * Analyze standards in BATCH against the transcript via backend (FOR FORBIDDEN ONLY)
 */
const checkForbiddenBatch = async (
  transcript: string,
  standards: Standard[]
): Promise<(ForbiddenIssue | null)[]> => {
  if (standards.length === 0) return [];

  console.log(`[doubaoService] Sending batch request for ${standards.length} forbidden standards.`);

  try {
    const response = await fetch('/api/check-standards-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, standards })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Batch request failed with status ${response.status}`);
    }
    
    const results = await response.json();

    return standards.map((standard, idx) => {
      const result = results[idx];
      if (!result) return null;

      if (result.detected) {
        return {
          standard: standard.qaFocus,
          detected_content: result.quote || "（未提取到原话，但检测到语义违规）",
          reason: result.reason_or_comment || "检测到违规内容"
        } as ForbiddenIssue;
      }
      return null;
    });

  } catch (error: any) {
    console.error(`[ForbiddenBatch] failed:`, error);
    return standards.map(() => null);
  }
};

/**
 * 核心逻辑：对单个标准进行精准视窗搜索
 */
const analyzeSingleStandard = async (
  transcript: string,
  transcriptLen: number,
  standard: any,
  batchId: string,
  onBatchUpdate?: (id: string, status: any) => void
): Promise<MandatoryCheck> => {
  if (onBatchUpdate) onBatchUpdate(batchId, 'loading');

  // 1. Calculate the center position in the transcript based on theoretical ratio
  const centerPos = Math.floor(standard.theoretical_pos * transcriptLen);
  
  // 2. Window: ±3000 characters (total 6000)
  const windowRange = 3000;
  const start = Math.max(0, centerPos - windowRange);
  const end = Math.min(transcriptLen, centerPos + windowRange);
  const windowText = transcript.substring(start, end);

  console.log(`[Algorithm] ${standard.qaFocus} - Precision Window (Ratio: ${standard.theoretical_pos.toFixed(4)}, Pos: ${start}-${end})`);

  try {
    const response = await fetch('/api/check-single-window', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        windowText, 
        standardContent: standard.content,
        ruleName: standard.qaFocus 
      })
    });

    if (!response.ok) throw new Error("API request failed");

    const result = await response.json();
    
    if (onBatchUpdate) onBatchUpdate(batchId, 'completed');

    return {
      standard: standard.qaFocus,
      status: result.detected ? 'passed' : 'missed',
      performance_grade: result.performance_grade || (result.detected ? 'good' : 'poor'),
      detected_content: result.topic_scene || "", // Compatible field
      topic_scene: result.topic_scene || "",
      core_evidence: result.core_evidence || "",
      comment: result.reason_or_comment || (result.detected ? "已覆盖" : "未提及"),
      standardContent: standard.content,
      windowSnippet: windowText,
      theoreticalPercent: `${(standard.theoretical_pos * 100).toFixed(1)}%`,
      searchRange: `${start}-${end}`
    } as MandatoryCheck;

  } catch (error: any) {
    console.error(`[ERROR] ${standard.qaFocus} window check failed:`, error);
    if (onBatchUpdate) onBatchUpdate(batchId, 'error');
    return {
      standard: standard.qaFocus,
      status: 'missed',
      detected_content: '',
      comment: `系统错误: ${error.message}`
    } as MandatoryCheck;
  }
};

/**
 * 阶段二：全量质检逻辑 (视窗模式 - 并行加速 + 动态密度)
 */
export const analyzeScript = async (
  transcript: string,
  standards: Standard[],
  onBatchesInit?: (batches: any[]) => void,
  onBatchUpdate?: (id: string, status: any) => void
): Promise<AnalysisResult> => {
  const mandatoryStandards = [...standards.filter(s => s.type === 'mandatory')];
  const forbiddenStandards = standards.filter(s => s.type === 'forbidden');
  
  // --- Step 2: 动态密度标点 (Density Mapping) ---
  // 1. 计算该轮所有标准话术的字数总和
  const totalChars = mandatoryStandards.reduce((sum, s) => sum + (s.content?.length || 0), 0);
  
  // 2. 依序计算每个片段的动态 Ratio
  let currentSum = 0;
  mandatoryStandards.forEach((s) => {
    const len = s.content?.length || 0;
    // Ratio = (前i-1项字数 + 0.5*当前项字数) / 总字数
    s.theoretical_pos = totalChars > 0 ? (currentSum + 0.5 * len) / totalChars : 0.5;
    currentSum += len;
  });

  if (onBatchesInit) {
    onBatchesInit(mandatoryStandards.map((s, i) => ({
      id: `m-${i}`,
      label: `必查: ${s.qaFocus}`,
      status: 'pending'
    })));
  }

  // --- Step 3: 狗仔队并行抓取 (Parallel Evidence Extraction) ---
  const transcriptLen = transcript.length;
  console.log(`[Parallel] Starting parallel analysis for ${mandatoryStandards.length} mandatory standards.`);
  
  // 使用 Promise.all 并行发起所有必查项质检请求
  const mandatoryPromises = mandatoryStandards.map((standard, i) => 
    analyzeSingleStandard(
      transcript,
      transcriptLen,
      standard,
      `m-${i}`,
      onBatchUpdate
    )
  );

  const [mandatoryResults, forbiddenResults] = await Promise.all([
    Promise.all(mandatoryPromises),
    checkForbiddenBatch(transcript, forbiddenStandards)
  ]);
  
  const forbiddenIssues: ForbiddenIssue[] = [];
  forbiddenResults.forEach(r => {
    if (r) forbiddenIssues.push(r as ForbiddenIssue);
  });

  return {
    forbidden_issues: forbiddenIssues,
    mandatory_checks: mandatoryResults
  };
};
