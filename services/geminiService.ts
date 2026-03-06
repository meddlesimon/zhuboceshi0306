
import { GoogleGenAI, Type, SchemaType } from "@google/genai";
import { Standard, AnalysisResult, ForbiddenIssue, MandatoryCheck } from "../types";

// Initialize AI Client
const getAIClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Clean up string results to avoid JSON parsing issues
 */
const cleanJSON = (text: string) => {
  return text.replace(/```json/g, '').replace(/```/g, '').trim();
};

/**
 * Helper: Delay execution
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper: Retry mechanism with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>, 
  retries = 3, 
  baseDelay = 1000
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries <= 0) throw error;
    await delay(baseDelay);
    return retryWithBackoff(fn, retries - 1, baseDelay * 1.5);
  }
}

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
 * Helper: Find a safe mechanical split point near the middle (50%) of the text.
 * Priority: Newline > Period/Exclamation > Mathematical Center
 */
const findMechanicalMiddleSplit = (text: string): number => {
  const len = text.length;
  const mid = Math.floor(len / 2);
  
  // Search window: look +/- 10% around the center
  const searchRange = Math.floor(len * 0.1); 
  const startSearch = Math.max(0, mid - searchRange);
  const endSearch = Math.min(len, mid + searchRange);
  
  // 1. Try to find a newline (\n) close to center
  const leftNewline = text.lastIndexOf('\n', mid);
  const rightNewline = text.indexOf('\n', mid);

  let bestSplitIdx = -1;
  let minDistance = Infinity;

  // Check newlines
  [leftNewline, rightNewline].forEach(idx => {
    if (idx !== -1 && idx >= startSearch && idx <= endSearch) {
      const dist = Math.abs(idx - mid);
      if (dist < minDistance) {
        minDistance = dist;
        bestSplitIdx = idx + 1; // Split AFTER the newline
      }
    }
  });

  if (bestSplitIdx !== -1) return bestSplitIdx;

  // 2. If no newline near center, look for sentence terminators
  const puncRegex = /[.。!！?？]/g;
  puncRegex.lastIndex = startSearch;
  
  let match;
  while ((match = puncRegex.exec(text)) !== null) {
      if (match.index > endSearch) break;
      const dist = Math.abs(match.index - mid);
      if (dist < minDistance) {
          minDistance = dist;
          bestSplitIdx = match.index + 1; // Split AFTER punctuation
      }
  }

  // 3. Absolute fallback: Just cut in the middle
  return bestSplitIdx !== -1 ? bestSplitIdx : mid;
};

/**
 * Intelligent Split: Detect where Round 2 starts.
 * Strategy: 
 * 1. Ask AI to find the split phrase.
 * 2. If AI fails or returns empty, FORCE a 50/50 mechanical split.
 */
export const splitTranscript = async (fullText: string): Promise<{ part1: string, part2: string }> => {
  const ai = getAIClient();
  const totalLen = fullText.length;
  
  // Optimization: If text is too short, don't split.
  if (totalLen < 200) return { part1: fullText, part2: '' };

  let splitIndex = -1;

  // --- Attempt 1: AI Intelligent Detection ---
  try {
    const prompt = `
      You are an editor analyzing a livestream transcript.
      
      CONTEXT:
      The transcript likely contains TWO consecutive rounds of the SAME script.
      Round 2 usually starts roughly halfway through the text.

      TASK:
      Identify the exact STARTING sentence or phrase where Round 2 begins.
      
      TRANSCRIPT (Truncated):
      ${fullText.slice(0, 45000)} ... 

      OUTPUT JSON ONLY:
      {
        "split_phrase": "The first 10-20 characters of the sentence where Round 2 begins",
        "found": boolean
      }
    `;

    const response = await retryWithBackoff(async () => {
        return await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                split_phrase: { type: Type.STRING },
                found: { type: Type.BOOLEAN },
              },
              required: ["split_phrase", "found"],
            },
          },
        });
    });

    if (response.text) {
      const result = JSON.parse(cleanJSON(response.text));
      
      if (result.found && result.split_phrase) {
        // Fuzzy Match
        const cleanFull = cleanStr(fullText);
        const cleanPhrase = cleanStr(result.split_phrase);
        const searchStartOffsetClean = Math.floor(cleanFull.length * 0.15); // Look after first 15%
        
        const matchIndexClean = cleanFull.indexOf(cleanPhrase, searchStartOffsetClean);
        
        if (matchIndexClean !== -1) {
          const originalIdx = getOriginalIndex(fullText, matchIndexClean);
          if (originalIdx !== -1) {
             console.log("AI Split found at index:", originalIdx);
             splitIndex = originalIdx;
          }
        }
      }
    }
  } catch (error) {
    console.warn("AI Split detection failed, falling back to mechanical split.", error);
  }

  // --- Attempt 2: Mechanical Fallback (Force 50/50) ---
  if (splitIndex === -1) {
      console.log("Forcing Mechanical 50% Split");
      splitIndex = findMechanicalMiddleSplit(fullText);
  }

  return {
    part1: fullText.substring(0, splitIndex).trim(),
    part2: fullText.substring(splitIndex).trim()
  };
};

/**
 * Analyze a SINGLE standard against the transcript.
 */
const checkSingleStandard = async (
  transcript: string,
  standard: Standard
): Promise<ForbiddenIssue | MandatoryCheck | null> => {
  const ai = getAIClient();
  const isForbidden = standard.type === 'forbidden';

  const ruleName = standard.qaFocus;
  const contextScript = standard.content;

  const specificInstruction = isForbidden
    ? `
      TASK: Check if the streamer violated the FORBIDDEN rule: "${ruleName}".
      CONTEXT/EXAMPLES OF VIOLATION: "${contextScript}"
      
      - If found: Return "detected": true.
      - **CRITICAL FOR QUOTE**: You MUST extract a **long context window** (approx. 3-4 sentences). Include the sentence *before* and *after* the violation to provide full context.
      - If NOT found: Return "detected": false.
      `
    : `
      TASK: Check if the streamer mentioned the MANDATORY point: "${ruleName}".
      STANDARD SCRIPT REFERENCE (Meaning should match): "${contextScript}"
      
      - If found (conceptually similar): Return "detected": true.
      - If NOT found: Return "detected": false.
      
      **CRITICAL FOR "QUOTE" (Expand Context)**: 
      - Whether "detected" is true or false, if the streamer is talking about this specific product/topic, **capture 3-4 full sentences** around that moment. 
      - We need enough context to understand the flow. 
      - **IF MISSED**: If they missed the specific keyword but were talking about the *general topic*, copy that entire discussion segment into "quote" so we can see what they said instead.
      - Only leave "quote" empty if the topic was COMPLETELY ignored throughout the text.
      `;

  const prompt = `
    You are a strict livestream Quality Assurance Auditor.
    Read the TRANSCRIPT carefully. It is spoken Chinese text.
    
    ### TRANSCRIPT START
    ${transcript.slice(0, 25000)} 
    ### TRANSCRIPT END
    (Note: If transcript is cut off, analyze what is available)

    ### RULE TO CHECK (${isForbidden ? 'ABSOLUTELY FORBIDDEN' : 'MUST BE MENTIONED'}):
    "${ruleName}"

    ${specificInstruction}

    ### OUTPUT FORMAT (JSON ONLY):
    {
      "detected": boolean,
      "quote": "THE EXTRACTED CONTEXT (3-4 sentences). Do NOT truncate.",
      "reason_or_comment": "Explanation in Chinese. If forbidden: why it's bad. If mandatory: how they said it or what is missing."
    }
  `;

  try {
    const response = await retryWithBackoff(async () => {
      return await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detected: { type: Type.BOOLEAN },
              quote: { type: Type.STRING },
              reason_or_comment: { type: Type.STRING },
            },
            required: ["detected", "quote", "reason_or_comment"],
          },
        },
      });
    }, 3, 1000);

    if (!response.text) return null;
    
    let result;
    try {
      result = JSON.parse(cleanJSON(response.text));
    } catch (e) {
      console.warn("JSON Parse Error for standard:", standard.qaFocus);
      throw new Error("Invalid JSON response");
    }

    if (isForbidden) {
      if (result.detected) {
        return {
          standard: standard.qaFocus,
          detected_content: result.quote || "（未提取到原话，但检测到语义违规）",
          reason: result.reason_or_comment || "检测到违规内容",
          suggestion: `建议参考话术：${standard.content}`
        } as ForbiddenIssue;
      }
      return null;
    } else {
      return {
        standard: standard.qaFocus,
        status: result.detected ? 'passed' : 'missed',
        detected_content: result.quote || '', 
        comment: result.reason_or_comment || (result.detected ? "已覆盖" : `未提及。标准话术：${standard.content}`)
      } as MandatoryCheck;
    }

  } catch (error) {
    console.warn(`Failed to check standard after retries: ${standard.qaFocus}`, error);
    
    if (!isForbidden) {
       return {
         standard: standard.qaFocus,
         status: 'missed',
         detected_content: '',
         comment: '网络繁忙，无法确认是否已讲（建议人工复核）'
       } as MandatoryCheck;
    }
    return null;
  }
};

/**
 * Main Analysis Entry Point
 */
export const analyzeScript = async (
  transcript: string,
  standards: Standard[]
): Promise<AnalysisResult> => {
  
  // 1. Process Forbidden Rules
  const forbiddenStandards = standards.filter(s => s.type === 'forbidden');
  const forbiddenIssues: ForbiddenIssue[] = [];

  const BATCH_SIZE = 3;

  for (let i = 0; i < forbiddenStandards.length; i += BATCH_SIZE) {
    const chunk = forbiddenStandards.slice(i, i + BATCH_SIZE);
    if (i > 0) await delay(500);

    const results = await Promise.all(
      chunk.map(s => checkSingleStandard(transcript, s))
    );
    const issues = results.filter(r => r !== null) as ForbiddenIssue[];
    forbiddenIssues.push(...issues);
  }

  // 2. Process Mandatory Rules
  const mandatoryStandards = standards.filter(s => s.type === 'mandatory');
  const mandatoryChecks: MandatoryCheck[] = [];

  for (let i = 0; i < mandatoryStandards.length; i += BATCH_SIZE) {
    const chunk = mandatoryStandards.slice(i, i + BATCH_SIZE);
    if (i > 0) await delay(500);

    const results = await Promise.all(
      chunk.map(s => checkSingleStandard(transcript, s))
    );
    const checks = results.filter(r => r !== null) as MandatoryCheck[];
    mandatoryChecks.push(...checks);
  }

  return {
    forbidden_issues: forbiddenIssues,
    mandatory_checks: mandatoryChecks
  };
};
