
import { Standard, StandardType, StandardImportance, StreamMetadata } from "../types";
import { v4 as uuidv4 } from 'uuid';

/**
 * 纯粹的 CSV/TSV 解析器
 */
export const parseCSV = (text: string): string[][] => {
  const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!cleanText.trim()) return [];

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
          // 双引号转义 → 输出一个引号
          currentVal += '"';
          i++; 
        } else if (nextChar === separator || nextChar === '\n' || nextChar === undefined) {
          // 引号后紧跟分隔符/换行/EOF → 真正的闭合引号
          inQuotes = false;
        } else {
          // 引号后跟其他字符 → 飞书未转义的内容中的引号，当作普通字符
          currentVal += '"';
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
  
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    rows.push(currentRow);
  }
  
  return rows.filter(r => r.length > 0 && r.some(c => c !== ''));
};

/**
 * 分类判定
 */
const determineType = (val: string): StandardType => {
  const v = (val || '').replace(/\s+/g, '').toLowerCase();
  if (v.includes('不') || v.includes('禁') || v.includes('违') || 
      v.includes('forbidden') || v.includes('ban') || v.includes('donotsay') || v.includes('dontsay')) {
    return 'forbidden';
  }
  if (v.includes('必') || v.includes('需') || v.includes('要') || v.includes('应') ||
      v.includes('mandatory') || v.includes('must') || v.includes('correct')) {
    return 'mandatory';
  }
  return 'mandatory'; 
};

/**
 * 重要性判定
 */
const determineImportance = (val: string): StandardImportance => {
  if (!val) return 'high';
  const v = val.toLowerCase();
  if (v.includes('日常') || v.includes('daily') || v.includes('normal') || v.includes('常规') || v.includes('旧')) {
    return 'normal';
  }
  return 'high';
};

/**
 * 主逻辑：从飞书/Excel 粘贴的表格数据中解析质检标准。
 * 
 * 飞书粘贴的特殊情况：
 * 1. 表头可能有 20 列（含大量空列），但数据行只有 4-5 列
 * 2. 飞书会把含换行的单元格用双引号包裹，导致"质检重点"和"标准话术"可能合并到一个字段
 * 3. 碎片行（因单元格内换行产生的额外行）需要合并到上一条标准中
 */
export const parseStandardsCSV = (text: string): Standard[] => {
  const rows = parseCSV(text);
  if (rows.length === 0) return [];

  // A. 表头识别
  const headers = rows[0].map(h => h.trim());
  
  const categoryKeys = ['分类', 'Category', '类型', 'Type', '判定', '性质', 'class'];
  const importanceKeys = ['重要性', '级别', 'Priority', 'Tag', '标签', '频次', 'level'];
  const focusKeys = ['质检重点', '重点', 'Focus', 'Point', 'Rule', 'Check', '名称', 'name', '标题', 'subject'];
  const scriptKeys = ['话术', 'Script', 'Content', 'Text', 'Example', '参考', '内容', '示例', '案例', 'detail'];

  let catIdx = headers.findIndex(h => categoryKeys.some(k => h.toLowerCase().includes(k.toLowerCase())));
  let impIdx = headers.findIndex(h => importanceKeys.some(k => h.toLowerCase().includes(k.toLowerCase())));
  let focusIdx = headers.findIndex(h => focusKeys.some(k => h.toLowerCase().includes(k.toLowerCase())));
  let scriptIdx = headers.findIndex(h => scriptKeys.some(k => h.toLowerCase().includes(k.toLowerCase())));

  // B. 【关键修复】检查数据行实际列数，修正列索引
  // 飞书粘贴时表头可能有 20 列（含空列），但数据行只有 4 列
  // 如果 scriptIdx 或 focusIdx 超出了数据行的列数，需要重新映射
  if (rows.length > 1) {
    // 找到前几个数据行的最大列数作为实际列数
    let dataColCount = 0;
    for (let i = 1; i < Math.min(rows.length, 10); i++) {
      if (rows[i].length > dataColCount) dataColCount = rows[i].length;
    }
    
    // 如果表头列数 > 数据列数，说明飞书粘贴带了额外空列
    if (headers.length > dataColCount && dataColCount >= 2) {
      // 重新计算：只在数据列范围内的表头中查找
      const validHeaders = headers.slice(0, dataColCount);
      
      // 如果 scriptIdx 超出了数据列范围
      if (scriptIdx >= dataColCount) {
        // 话术列不可用，质检重点和话术可能合并在 focusIdx 中
        // 寻找数据范围内的最后一个有效列作为 focus+script 合并列
        scriptIdx = -1; // 标记为不可用
      }
      
      // 如果 focusIdx 也超出范围，在数据列范围内重新查找
      if (focusIdx >= dataColCount) {
        focusIdx = dataColCount - 1; // 用最后一列
      }
    }
  }

  // C. 兜底策略
  if (rows.length > 1 && (focusIdx === -1 || scriptIdx === -1)) {
     const sampleRow = rows[1];
     if (scriptIdx === -1) {
        let maxLen = 0;
        sampleRow.forEach((cell, idx) => {
           if (cell.length > maxLen && idx !== catIdx && idx !== impIdx) {
              maxLen = cell.length;
              scriptIdx = idx;
           }
        });
     }
     if (focusIdx === -1) {
        focusIdx = sampleRow.findIndex((_, idx) => idx !== catIdx && idx !== impIdx && idx !== scriptIdx);
     }
  }
  if (focusIdx === -1 && scriptIdx === -1 && rows[0].length >= 2) {
      if (catIdx === -1) catIdx = 0;
      focusIdx = 1;
      scriptIdx = 2;
  }

  // 如果 focusIdx 和 scriptIdx 相同（质检重点和话术合并在一个列），需要拆分
  const isMergedColumn = focusIdx === scriptIdx;

  // D. 遍历行，提取数据
  const isNewDataRow = (row: string[]): boolean => {
    if (catIdx !== -1 && catIdx < row.length && row[catIdx] && row[catIdx].trim().length > 0) return true;
    if (impIdx !== -1 && impIdx < row.length && row[impIdx] && row[impIdx].trim().length > 0) return true;
    if (catIdx === -1 && impIdx === -1) {
      const hasFocus = focusIdx !== -1 && focusIdx < row.length && row[focusIdx] && row[focusIdx].trim().length > 0;
      const hasScript = scriptIdx !== -1 && scriptIdx < row.length && row[scriptIdx] && row[scriptIdx].trim().length > 0;
      if (hasFocus || hasScript) return true;
    }
    return false;
  };

  const rawStandards: any[] = [];
  let totalContentLength = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every(c => !c || c.trim().length === 0)) continue;

    if (isNewDataRow(row)) {
      const rawCat = (catIdx !== -1 && catIdx < row.length) ? (row[catIdx] || '') : '';
      const rawImp = (impIdx !== -1 && impIdx < row.length) ? (row[impIdx] || '') : '';
      let rawFocus = (focusIdx !== -1 && focusIdx < row.length) ? (row[focusIdx] || '') : '';
      let rawScript = (scriptIdx !== -1 && scriptIdx < row.length) ? (row[scriptIdx] || '') : '';

      if (!rawFocus && !rawScript && !rawCat) continue;

      // 如果 focus 和 script 合并在一个字段中，尝试拆分
      // 飞书合并格式：质检重点内容（多行）后面跟着话术内容（多行）
      // 通常质检重点是要点列表（1. xxx\n2. xxx），话术是长篇文本
      if (isMergedColumn || (!rawScript && rawFocus.length > 50)) {
        const mergedText = rawFocus;
        // 尝试按段落拆分：找到第一个不以数字/序号开头的长段落作为话术
        const paragraphs = mergedText.split('\n');
        const focusParts: string[] = [];
        const scriptParts: string[] = [];
        let foundScript = false;
        
        for (const p of paragraphs) {
          const trimmed = p.trim();
          if (!trimmed) continue;
          
          if (!foundScript && /^[\d１２３４５６７８９０]+[.、．]/.test(trimmed)) {
            // 以数字+点开头的行 → 质检重点
            focusParts.push(trimmed);
          } else if (focusParts.length > 0) {
            // 质检重点之后的内容 → 话术
            foundScript = true;
            scriptParts.push(trimmed);
          } else {
            // 第一行就不是数字开头 → 全部当作 focus
            focusParts.push(trimmed);
          }
        }
        
        if (focusParts.length > 0 && scriptParts.length > 0) {
          rawFocus = focusParts.join('\n');
          rawScript = scriptParts.join('\n');
        }
      }

      const finalContent = rawScript || rawFocus;
      const finalFocus = rawFocus || (rawScript.length > 20 ? rawScript.substring(0, 20) + '...' : rawScript);
      const type = determineType(rawCat);
      const importance = determineImportance(rawImp);

      if (type === 'mandatory') {
        totalContentLength += finalContent.length;
      }

      rawStandards.push({
        id: uuidv4(),
        type,
        importance,
        qaFocus: finalFocus,
        content: finalContent
      });
    } else if (rawStandards.length > 0) {
      // 碎片行：追加到上一条标准的 content
      const fragment = row.filter(c => c && c.trim().length > 0).join('\n').trim();
      if (fragment) {
        const prev = rawStandards[rawStandards.length - 1];
        prev.content = (prev.content + '\n' + fragment).trim();
        if (prev.type === 'mandatory') {
          totalContentLength += fragment.length + 1;
        }
      }
    }
  }

  // E. 计算 theoretical_pos
  const standards: Standard[] = [];
  let accumulatedContentLength = 0;
  for (const s of rawStandards) {
    let theoretical_pos = 0.5;
    if (s.type === 'mandatory' && totalContentLength > 0) {
      theoretical_pos = (accumulatedContentLength + s.content.length / 2) / totalContentLength;
      accumulatedContentLength += s.content.length;
    }
    standards.push({ ...s, theoretical_pos });
  }

  return standards;
};

/**
 * Parse Transcript
 */
export const parseTranscript = (text: string): string => {
  const rows = parseCSV(text);
  if (rows.length === 0) return text;
  
  if (rows.every(r => r.length <= 1)) {
    return rows.map(r => r[0]).join('\n');
  }

  const headers = rows[0].map(h => h.toLowerCase());
  const contentKeywords = ['text', 'content', '内容', '字幕', '原话', '文本'];
  let textIdx = headers.findIndex(h => contentKeywords.some(k => h.includes(k)));

  if (textIdx === -1) {
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
    
    if (maxAvg > 10) textIdx = bestIdx;
  }

  if (textIdx !== -1) {
    return rows.slice(1).map(r => r[textIdx]).join('\n');
  }

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
