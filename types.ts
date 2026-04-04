
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
  elementStates?: Record<string, 'correct' | 'wrong'>; // 新增：核心要素的人工手检状态
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

// ============================================================
// 新增：主播管理系统相关类型
// ============================================================

export interface Anchor {
  id: number;
  name: string;
  created_at: string;
  enable_qc: boolean;              // 是否开启质检（内部主播=true，外部跟踪主播=false）
  douyin_profile_url: string;      // 抖音主页链接
  douyin_room_url: string;         // 直播间链接
}

export interface StandardsVersion {
  id: number;
  version_label: string;
  total_count: number;
  created_at: string;
  is_current: number;
  content?: Standard[]; // 详情接口返回时包含
}

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Task {
  id: string;
  anchor_id: number;
  anchor_name: string;
  standards_version_id: number | null;
  standards_version_label?: string;
  status: TaskStatus;
  transcript_filename: string;
  score_r1: number | null;
  score_r2: number | null;
  is_dual_mode: number; // 0 or 1
  progress_message: string | null;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
  result?: MultiRoundResult; // 仅在详情查询时返回
}

export type AppPage = 'login' | 'home' | 'workspace' | 'anchor-admin' | 'script-admin' | 'model-admin' | 'training-admin';

// ============================================================
// 主播培训模块相关类型
// ============================================================

export interface TrainingCourse {
  id: number;
  title: string;
  standards_version_id: number;
  standards_version_label: string;
  created_at: string;
}

export interface TrainingSlide {
  id: number;
  course_id: number;
  order: number;
  title: string;
  image_base64: string;
  standard_start: number; // 话术序号起始（1-based）
  standard_end: number;   // 话术序号结束（inclusive）
}

export interface TrainingAccount {
  id: number;
  username: string;
  password: string;
  display_name: string;
}

// ============================================================
// 模型配置相关类型
// ============================================================

export interface ModelPreset {
  id: string;
  name: string;
  model_name: string;
  api_url: string;
  api_key_masked: string; // 脱敏后的 key，用于展示
  is_builtin: boolean;
}

export interface ModelConfig {
  active_model_id: string;
  presets: ModelPreset[];
}
