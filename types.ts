
export type StandardType = 'forbidden' | 'mandatory';
export type StandardImportance = 'high' | 'normal' | 'yesterday_repeat'; // high = 今日(Today), normal = 日常(Daily), yesterday_repeat = 昨日复检

export interface Standard {
  id: string;
  type: StandardType;
  importance: StandardImportance; // 新增重要性字段
  qaFocus: string; // 对应“质检重点”
  content: string; // 对应“标准话术”
  theoretical_pos?: number; // 理论占比位置 (0-1)
}

export interface ForbiddenIssue {
  standard: string;
  detected_content: string;
  reason: string;
  suggestion: string;
  reviewStatus?: 'approved' | 'rejected' | 'pending'; // approved=保留, rejected=误诊
  operatorComment?: string; // 运营备注
}

export interface MandatoryCheck {
  standard: string;
  status: 'passed' | 'missed';
  detected_content?: string;
  comment: string;
  reviewStatus?: 'approved' | 'rejected' | 'pending'; // approved=保留, rejected=误诊
  operatorComment?: string; // 运营备注
  // --- 新增核对字段 ---
  performance_grade?: 'good' | 'fair' | 'poor'; // 表现评分
  standardContent?: string;  // 投喂给 AI 的标准话术原文
  windowSnippet?: string;    // 当时发给 AI 的 3000 字视野片段
  aiRawResponse?: string;    // AI 返回的原始 JSON 结果
  cursorPos?: number;        // 当时的游标起始位置
  theoreticalPercent?: string; // 理论占比位置 (e.g. 15.2%)
  searchRange?: string;      // 实际搜索的视窗范围坐标
  searchRound?: string;      // 搜索轮次 (初次 vs 扩容)
}

export interface AnalysisResult {
  forbidden_issues: ForbiddenIssue[];
  mandatory_checks: MandatoryCheck[];
}

// Support for dual rounds
export interface MultiRoundResult {
  round1: AnalysisResult;
  round2?: AnalysisResult;
  round1Text: string; // Saved raw transcript for context
  round2Text?: string; // Saved raw transcript for context
  fullRawText: string; // 100% original untransformed transcript
  isDualMode: boolean;
  // --- 新增：存储切割锚点话术及精准坐标 ---
  splitAnchors?: {
    r1StartPhrase: string;
    r1StartPos?: number;
    r1EndPhrase: string;
    r1EndPos?: number;
    r2StartPhrase: string;
    r2StartPos?: number;
    r2EndPhrase: string;
    r2EndPos?: number;
  };
}

export interface StreamMetadata {
  fileName: string;
  anchorName: string;
  date: string;
  round: string;
}

export enum AppStep {
  LOGIN = 'LOGIN',
  UPLOAD_STANDARDS = 'UPLOAD_STANDARDS',
  UPLOAD_TRANSCRIPT = 'UPLOAD_TRANSCRIPT',
  VERIFY_ANCHORS = 'VERIFY_ANCHORS', // 新增：锚点核对步骤
  ANALYZING = 'ANALYZING',
  REPORT = 'REPORT'
}

export interface AnchorResult {
  r1StartPhrase: string;
  r1StartPos: number;
  r1EndPhrase: string;
  r1EndPos: number;
  r2StartPhrase: string;
  r2StartPos: number;
  r2EndPhrase: string;
  r2EndPos: number;
  found: boolean;
}
