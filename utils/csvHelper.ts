
import { Standard, StandardType, StandardImportance, StreamMetadata } from "../types";
import { v4 as uuidv4 } from 'uuid';

/**
 * Robust CSV/TSV Parser
 * Handles quoted strings (Excel style) and simple Tab/Comma separation.
 */
export const parseCSV = (text: string): string[][] => {
  // 1. Basic cleaning
  const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!cleanText.trim()) return [];

  // 2. Detect Separator
  // Prioritize Tab (\t) because copy-paste from Excel/Feishu usually uses Tabs.
  const firstLine = cleanText.split('\n')[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const separator = tabCount >= 1 ? '\t' : (commaCount >= 1 ? ',' : '\t');

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = '';
  let inQuotes = false;
  
  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];
    
    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Double quote inside quotes = literal quote
          currentVal += '"';
          i++; 
        } else {
          // End of quoted cell
          inQuotes = false;
        }
      } else {
        currentVal += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === separator) {
        currentRow.push(currentVal.trim());
        currentVal = '';
      } else if (char === '\n') {
        currentRow.push(currentVal.trim());
        rows.push(currentRow);
        currentRow = [];
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
  }
  
  // Push trailing data
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    rows.push(currentRow);
  }
  
  // Filter empty rows
  return rows.filter(r => r.length > 0 && r.some(c => c !== ''));
};

/**
 * Strict Type Detection based ONLY on Category Column
 * User Requirement: Look for "一定要讲" or "绝对不可以说"
 */
const determineType = (val: string): StandardType => {
  // Remove spaces and lowercase for robust matching
  const v = (val || '').replace(/\s+/g, '').toLowerCase();

  // 1. Forbidden Keywords (Matches "绝对不可以说", "不能", "禁止")
  if (
    v.includes('不') || 
    v.includes('禁') || 
    v.includes('违') || 
    v.includes('forbidden') || 
    v.includes('ban') ||
    v.includes('donotsay') ||
    v.includes('dontsay')
  ) {
    return 'forbidden';
  }

  // 2. Mandatory Keywords (Matches "一定要讲", "必须要", "要讲")
  if (
    v.includes('必') || 
    v.includes('需') || 
    v.includes('要') || // Covers "一定要讲"
    v.includes('应') ||
    v.includes('mandatory') || 
    v.includes('must') || 
    v.includes('correct')
  ) {
    return 'mandatory';
  }

  // 3. Fallback
  // If the category column is completely empty or ambiguous, default to Mandatory.
  // We prefer false positives (checking if they said it) over missing a forbidden rule check?
  // Actually, usually "Mandatory" is the safe default for lists of talking points.
  return 'mandatory'; 
};

/**
 * Importance Detection
 */
const determineImportance = (val: string): StandardImportance => {
  if (!val) return 'high'; // Default to HIGH (Today) if missing, to ensure visibility.
  const v = val.toLowerCase();
  
  if (v.includes('日常') || v.includes('daily') || v.includes('normal') || v.includes('常规') || v.includes('旧')) {
    return 'normal';
  }
  return 'high';
};

/**
 * Main Logic: Parse Standards from loose CSV/Table data
 */
export const parseStandardsCSV = (text: string): Standard[] => {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];

  // A. Header Strategy
  const headers = rows[0].map(h => h.trim());
  
  // Keywords definition
  const categoryKeys = ['分类', 'Category', '类型', 'Type', '判定', '性质', 'class'];
  const importanceKeys = ['重要性', '级别', 'Priority', 'Tag', '标签', '频次', 'level'];
  const focusKeys = ['质检重点', '重点', 'Focus', 'Point', 'Rule', 'Check', '名称', 'name', '标题', 'subject'];
  const scriptKeys = ['话术', 'Script', 'Content', 'Text', 'Example', '参考', '内容', '示例', '案例', 'detail'];

  // Identify Columns by Header
  let catIdx = headers.findIndex(h => categoryKeys.some(k => h.toLowerCase().includes(k.toLowerCase())));
  let impIdx = headers.findIndex(h => importanceKeys.some(k => h.toLowerCase().includes(k.toLowerCase())));
  let focusIdx = headers.findIndex(h => focusKeys.some(k => h.toLowerCase().includes(k.toLowerCase())));
  let scriptIdx = headers.findIndex(h => scriptKeys.some(k => h.toLowerCase().includes(k.toLowerCase())));

  // B. Fallback Strategy: Content Analysis (if headers are missing or ambiguous)
  if (rows.length > 1 && (focusIdx === -1 || scriptIdx === -1)) {
     const sampleRow = rows[1];
     
     // Find the longest column -> Likely the Script/Content
     if (scriptIdx === -1) {
        let maxLen = 0;
        sampleRow.forEach((cell, idx) => {
           if (cell.length > maxLen && idx !== catIdx && idx !== impIdx) {
              maxLen = cell.length;
              scriptIdx = idx;
           }
        });
     }

     // Find a column that is not script, not cat, not imp -> Likely the Focus/Name
     if (focusIdx === -1) {
        focusIdx = sampleRow.findIndex((_, idx) => idx !== catIdx && idx !== impIdx && idx !== scriptIdx);
     }
  }

  // If still failed, default mapping (0=Cat, 1=Focus, 2=Script)
  if (focusIdx === -1 && scriptIdx === -1 && rows[0].length >= 2) {
      // Assuming typical format: [Category, Name, Script]
      if (catIdx === -1) catIdx = 0;
      focusIdx = 1;
      scriptIdx = 2;
  }

  const standards: Standard[] = [];

  // Iterate rows (skip header if we are confident it is a header)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    
    // Extract raw values
    const rawCat = catIdx !== -1 ? row[catIdx] : '';
    const rawImp = impIdx !== -1 ? row[impIdx] : '';
    const rawFocus = focusIdx !== -1 ? row[focusIdx] : '';
    const rawScript = scriptIdx !== -1 ? row[scriptIdx] : '';

    // Guard: Empty row
    if (!rawFocus && !rawScript && !rawCat) continue;

    // Intelligent Filling
    const finalContent = rawScript || rawFocus;
    const finalFocus = rawFocus || (rawScript.length > 20 ? rawScript.substring(0, 20) + '...' : rawScript);

    // Strict Type Determination: ONLY look at rawCat
    // We do NOT use content text to guess anymore, as per user request.
    const type = determineType(rawCat);
    
    const importance = determineImportance(rawImp);

    standards.push({
      id: uuidv4(),
      type,
      importance,
      qaFocus: finalFocus,
      content: finalContent
    });
  }

  return standards;
};

/**
 * Parse Transcript (Simple text extraction from CSV/Text)
 */
export const parseTranscript = (text: string): string => {
  const rows = parseCSV(text);
  if (rows.length === 0) return text;
  
  // If it's just one column or plain text, return as is (joined)
  if (rows.every(r => r.length <= 1)) {
    return rows.map(r => r[0]).join('\n');
  }

  // If it looks like a transcript table (Time, Speaker, Content)
  // Try to find the Content column
  const headers = rows[0].map(h => h.toLowerCase());
  const contentKeywords = ['text', 'content', '内容', '字幕', '原话', '文本'];
  let textIdx = headers.findIndex(h => contentKeywords.some(k => h.includes(k)));

  if (textIdx === -1) {
    // Guess: Column with longest average length
    let maxAvg = 0;
    let bestIdx = -1;
    const numCols = rows[0].length;
    
    for (let c = 0; c < numCols; c++) {
      let totalLen = 0;
      let count = 0;
      for (let r = 1; r < Math.min(rows.length, 10); r++) {
         if (rows[r][c]) {
            totalLen += rows[r][c].length;
            count++;
         }
      }
      const avg = count > 0 ? totalLen / count : 0;
      if (avg > maxAvg) {
        maxAvg = avg;
        bestIdx = c;
      }
    }
    
    // If average length > 10 chars, assume it's the transcript
    if (maxAvg > 10) textIdx = bestIdx;
  }

  if (textIdx !== -1) {
    // Return only that column, skipping header
    return rows.slice(1).map(r => r[textIdx]).join('\n');
  }

  // Fallback: Join all columns
  return rows.map(r => r.join(' ')).join('\n');
};

export const parseMetadataFromFilename = (fileName: string): StreamMetadata => {
  const nameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;
  const parts = nameWithoutExt.split(/[-_\s]+/);
  
  let anchorName = '未知主播';
  let date = new Date().toLocaleDateString();
  let round = '第1轮';

  if (parts.length >= 3) {
    anchorName = parts[0];
    date = parts[1];
    round = parts[2];
  } else if (parts.length === 2) {
    anchorName = parts[0];
    date = parts[1];
  } else {
    anchorName = nameWithoutExt;
  }

  if (date.match(/^\d{8}$/)) {
    date = `${date.substring(0,4)}年${date.substring(4,6)}月${date.substring(6,8)}日`;
  }

  return { fileName, anchorName, date, round };
};
