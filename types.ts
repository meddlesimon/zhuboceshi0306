
export type StandardType = 'forbidden' | 'mandatory';
export type StandardImportance = 'high' | 'normal' | 'yesterday_repeat'; // high = 今日(Today), normal = 日常(Daily), yesterday_repeat = 昨日复检

export interface Standard {
  id: string;
  type: StandardType;
  importance: StandardImportance; // 新增重要性字段
  qaFocus: string; // 对应“质检重点”
  content: string; // 对应“标准话术”
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
  isDualMode: boolean;
}

export interface StreamMetadata {
  fileName: string;
  anchorName: string;
  date: string;
  round: string;
}

export enum AppStep {
  UPLOAD_STANDARDS = 'UPLOAD_STANDARDS',
  UPLOAD_TRANSCRIPT = 'UPLOAD_TRANSCRIPT',
  ANALYZING = 'ANALYZING',
  REPORT = 'REPORT'
}
