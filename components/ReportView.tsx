
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { MultiRoundResult, AnalysisResult, Standard, StreamMetadata, MandatoryCheck, ForbiddenIssue } from '../types';
import { 
  CheckCircle2, 
  AlertTriangle, 
  RotateCcw, 
  AlertOctagon, 
  Sparkles, 
  ThumbsUp, 
  Check,
  Ban,
  ClipboardList,
  Loader2,
  Download,
  User,
  Search,
  ArrowDownCircle,
  FileText,
  ArrowUp,
  FileSpreadsheet,
  PenLine,
  XCircle,
  Save,
  Trash2,
  Undo2,
  Layout,
  Activity,
  Split,
  XCircle as XCircleIcon,
  FileSearch,
  ChevronUp,
  ChevronDown,
  MousePointer2
} from 'lucide-react';
import AdminAuditView from './AdminAuditView';

// Declare global html2pdf from the script tag
declare var html2pdf: any;

interface ReportViewProps {
  result: MultiRoundResult;
  standards: Standard[];
  metadata: StreamMetadata;
  onReset: () => void;
  onRegisterActions?: (actions: React.ReactNode) => void;
}



const parseDiagnosisLines = (text: string) => {
  if (!text) return { score: 0, elements: [] };
  const lines = text.split('\n');
  const elements: any[] = [];
  let overallScore = 0;

  lines.forEach(line => {
    // 1. 匹配综合得分：兼容 [50分]、50 分、[50]分 以及中英文冒号
    const scoreMatch = line.match(/综合得分[：:]?\s*[\[\(]?(\d+)[\]\)]?\s*分?/);
    if (scoreMatch) {
      overallScore = parseInt(scoreMatch[1]);
      return;
    }

    // 2. 增强版匹配：兼容 [名称]、(名称) 或直接 文本
    // 目标格式：要素 1 [标准动作]：[10/20] —— 实操评语
    const match = line.match(/要素\s*(\d+)\s*[\[\(\【]?(.*?)[\]\)\】]?[：:]\s*[\[\(\【]?(.*?)[\]\)\】]?\s*[——-]\s*(.*)/);
    if (match) {
      const [_, id, name, score, desc] = match;
      const scores = score.split('/').map(n => parseInt(n));
      elements.push({
        id,
        name: name.trim(), // 标准动作
        score,
        description: desc.trim(), // 实操复盘
        isFailed: (scores.length > 0 && scores[0] === 0) || score.includes('0分')
      });
    }
  });

  return { score: overallScore, elements };
};

/**
 * 根据分数获取等级
 */
const getGradeFromScore = (score: number) => {
  if (score < 60) return 'poor';
  if (score < 85) return 'fair';
  return 'good';
};

/**
 * 诊断结果结构化展示组件 - 高密度组件 (v3.0 Pixel Perfect)
 * 增加：人工手检交互
 */
const DiagnosisDisplay: React.FC<{ 
  score: number, 
  elements: any[], 
  isRejected?: boolean,
  elementStates?: Record<string, number>, // 改为存储具体数值
  onElementCheck?: (id: string, score: number) => void // 传递数值
}> = ({ elements, isRejected = false, elementStates = {}, onElementCheck }) => {
  if (!elements || elements.length === 0) return null;

  // 1. 计算实时总分
  const manualScore = elements.reduce((acc, el) => {
    const aiScore = parseInt(el.score.split('/')[0]) || 0;
    const currentScore = elementStates[el.id] !== undefined ? elementStates[el.id] : aiScore;
    return acc + currentScore;
  }, 0);

  const currentGrade = getGradeFromScore(manualScore);
  const gradeColors = {
    poor: 'text-red-600 bg-red-50 border-red-100',
    fair: 'text-orange-600 bg-orange-50 border-orange-100',
    good: 'text-emerald-600 bg-emerald-50 border-emerald-100'
  };

  return (
    <div className={`space-y-2 ${isRejected ? 'opacity-50 grayscale' : ''}`}>
      {/* 综合得分与等级 */}
      <div className="flex justify-between items-center bg-white px-3 py-2 rounded-xl border border-red-100/50 shadow-sm">
        <div className="flex items-center gap-2">
           <span className="text-[10px] font-black text-red-800 uppercase tracking-wider">核定得分</span>
           <div className={`px-2 py-0.5 rounded text-[9px] font-black border uppercase ${gradeColors[currentGrade]}`}>
             {currentGrade}
           </div>
        </div>
        <div className="flex items-baseline gap-1">
           <span className="text-xl font-black text-red-600" key={manualScore}>{manualScore}</span>
           <span className="text-[10px] font-bold text-red-400">/ 100</span>
        </div>
      </div>
      
      {/* 要素明细列表 */}
      <div className="divide-y divide-red-100/20 bg-white/80 rounded-xl px-2 py-0.5 shadow-sm border border-red-50/50">
        {elements.map((el, i) => {
          const aiScore = parseInt(el.score.split('/')[0]) || 0;
          const maxScore = parseInt(el.score.split('/')[1]) || 0;
          const halfScore = Math.floor(maxScore / 2);
          const currentScore = elementStates[el.id] !== undefined ? elementStates[el.id] : aiScore;
          
          // 三档分值选项
          const options = [0, halfScore, maxScore];

          return (
            <div key={i} className="py-2.5">
              <div className="flex justify-between items-start mb-1">
                <div className="flex gap-2 items-start flex-1">
                  <i className="mt-0.5 w-4 h-4 rounded-md flex items-center justify-center text-[10px] not-italic font-black shrink-0 bg-red-100 text-red-600">
                    {el.id}
                  </i>
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-0.5">
                       <span className="text-[11px] font-bold text-gray-800">
                        {el.name}
                       </span>
                    </div>
                    <p className="text-[10px] text-gray-500 leading-tight pr-2">{el.description}</p>
                  </div>
                </div>

                {/* 分值快速调整按钮 */}
                {onElementCheck && (
                  <div className="flex gap-1 ml-2 shrink-0 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                    {options.map((val) => (
                      <button 
                        key={val}
                        onClick={() => onElementCheck(el.id, val)}
                        className={`px-2 py-1 rounded-md text-[10px] font-black transition-all ${
                          currentScore === val 
                          ? 'bg-blue-600 text-white shadow-sm scale-105' 
                          : 'text-slate-400 hover:bg-white hover:text-blue-500'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};


/**
 * Expandable Text Component for long quotes or comments
 * 修改：直接显示全部内容，不再进行截断
 */
const ExpandableText: React.FC<{ text: string, maxLen?: number, className?: string, italic?: boolean }> = ({ text, className = "", italic = false }) => {
  return (
    <div className={className}>
      <p className={`text-sm leading-relaxed ${italic ? 'italic' : ''} whitespace-pre-wrap break-words`}>
        {text}
      </p>
    </div>
  );
};

const ReportView: React.FC<ReportViewProps> = ({ result, standards, metadata, onReset, onRegisterActions }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [activeRound, setActiveRound] = useState<'round1' | 'round2'>('round1');
  const [highlightQuote, setHighlightQuote] = useState<string>('');
  const [scrollToggle, setScrollToggle] = useState(0); // 新增：用于强制触发滚动定位
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [lastClickedId, setLastClickedId] = useState<string | null>(null); // 新增：记录跳转来源 ID
  const [showAdminAudit, setShowAdminAudit] = useState(false); // 控制右侧面板显示
  const [rightPanelTab, setRightPanelTab] = useState<'audit' | 'transcript'>('audit'); // 右侧面板模式切换

  // --- 主播全文搜索与进度状态 ---
  const [searchTerm, setSearchTerm] = useState('');
  const [searchMatches, setSearchMatches] = useState<number[]>([]); 
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [scrollPercent, setScrollPercent] = useState(0);
  
  // Local State for Reviews
  const [localResult, setLocalResult] = useState<MultiRoundResult>(result);

  const reportRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // 把 Header 区域的操作按钮注册给父组件（App），由父组件渲染到全局 Header 里
  useEffect(() => {
    if (!onRegisterActions) return;
    onRegisterActions(
      <>
        {/* 双轮模式：轮次切换直接嵌入导航栏 */}
        {result.isDualMode && (
          <>
            <div className="bg-slate-100 p-0.5 rounded-lg flex">
              <button
                onClick={() => { setActiveRound('round1'); setHighlightQuote(''); }}
                className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${activeRound === 'round1' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                第一轮
              </button>
              <button
                onClick={() => { setActiveRound('round2'); setHighlightQuote(''); }}
                className={`px-3 py-1 text-[11px] font-bold rounded-md transition-all ${activeRound === 'round2' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                第二轮
              </button>
            </div>
            <div className="h-4 w-px bg-slate-200" />
          </>
        )}
        <button
          onClick={onReset}
          className="border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition-all active:scale-95 text-xs shadow-sm"
        >
          <RotateCcw size={13} />
          <span>新一轮</span>
        </button>
        <div className="h-4 w-px bg-slate-200" />
        <button
          onClick={handleExportChecklist}
          className="bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 shadow-md transition-all active:scale-95 text-xs"
        >
          <FileSpreadsheet size={13} />
          <span>导出清单</span>
        </button>
        <button
          onClick={handleExportPDF}
          disabled={isExporting}
          className={`bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 shadow-md transition-all active:scale-95 text-xs ${isExporting ? 'opacity-75 cursor-wait' : ''}`}
        >
          {isExporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          <span>导出 PDF</span>
        </button>
      </>
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExporting, activeRound, result.isDualMode, onReset, onRegisterActions]);

  // Sync props to local state if props change (re-analysis)
  useEffect(() => {
    setLocalResult(result);
  }, [result]);

  // Scroll Listener
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 400);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const currentResult: AnalysisResult = activeRound === 'round1' 
    ? localResult.round1 
    : (localResult.round2 || localResult.round1); 

  const fullRawTranscript = localResult.fullRawText || (localResult.round1Text + (localResult.round2Text || ''));

  useEffect(() => {
    if (showAdminAudit && highlightQuote && transcriptRef.current) {
      // 增加延迟，确保面板展开后再执行定位
      const timer = setTimeout(() => {
        const highlightEl = transcriptRef.current?.querySelector('.highlight-active');
        if (highlightEl) {
          highlightEl.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
          });
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [highlightQuote, activeRound, scrollToggle, showAdminAudit]);

  const handleQuoteClick = (quote: string, id: string) => {
    if (!quote || quote.length < 2) return;
    
    // 强制打开右侧面板（先于定位逻辑）
    setShowAdminAudit(true);
    setRightPanelTab('transcript');

    // 自动判定轮次
    if (id.includes('anchor-r2') || id.includes('r2')) {
      setActiveRound('round2');
    } else if (id.includes('anchor-r1') || id.includes('r1')) {
      setActiveRound('round1');
    }

    setHighlightQuote(quote);
    setScrollToggle(prev => prev + 1); // 触发定位
    setLastClickedId(id); 
    
    // 清空搜索干扰
    setSearchTerm('');
    setSearchMatches([]);
    setCurrentMatchIndex(-1);
  };

  /**
   * Update Review Status
   */
  const updateReviewStatus = (
    type: 'mandatory' | 'forbidden',
    index: number,
    status: 'approved' | 'rejected' | 'pending',
    comment?: string
  ) => {
    setLocalResult(prev => {
      const next = { ...prev };
      const targetRound = activeRound === 'round1' ? next.round1 : (next.round2 || next.round1);
      
      const item = type === 'mandatory' 
        ? targetRound.mandatory_checks[index] 
        : targetRound.forbidden_issues[index];
      
      item.reviewStatus = status;
      if (comment !== undefined) {
        item.operatorComment = comment;
      }
      return next;
    });
  };

  /**
   * Update individual element state (Manual Review)
   */
  const updateElementState = (
    index: number,
    elementId: string,
    newScore: number // 改为接收数值
  ) => {
    setLocalResult(prev => {
      const next = { ...prev };
      const targetRound = activeRound === 'round1' ? next.round1 : (next.round2 || next.round1);
      const item = targetRound.mandatory_checks[index];
      
      const states = { ...(item.elementStates || {}) };
      states[elementId] = newScore; // 直接存储数值
      item.elementStates = states;

      // 重新计算总分并同步状态
      const { elements } = parseDiagnosisLines(item.comment);
      const manualTotal = elements.reduce((acc, el) => {
        const aiScore = parseInt(el.score.split('/')[0]) || 0;
        return acc + (states[el.id] !== undefined ? states[el.id] : aiScore);
      }, 0);

      item.performance_grade = getGradeFromScore(manualTotal);
      item.status = manualTotal >= 60 ? 'passed' : 'missed';

      return next;
    });
  };

  const waitForImages = async (element: HTMLElement) => {
    const images = Array.from(element.querySelectorAll('img'));
    if (images.length === 0) return;
    await Promise.all(images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.onload = resolve;
        img.onerror = resolve; 
      });
    }));
  };

  /**
   * PDF Export: Overlay Rendering Strategy (Fixes White Screen)
   * Creates a visible overlay with 390px width content, renders it, then removes it.
   */
  const handleExportPDF = async () => {
    if (!reportRef.current) return;
    if (typeof html2pdf === 'undefined') {
      alert('PDF组件加载中，请稍候...'); 
      return;
    }

    setIsExporting(true);
    
    // 1. Setup Overlay (VISIBLE to ensure rendering)
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(240, 240, 240, 0.9)'; // Slight dim backdrop
    overlay.style.zIndex = '99999';
    overlay.style.overflowY = 'auto'; // Allow scrolling so user sees what's happening
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'flex-start';
    overlay.style.paddingTop = '20px';
    overlay.style.paddingBottom = '20px';

    // The export target container (Strict Mobile Width)
    const MOBILE_WIDTH = 600; 
    const target = document.createElement('div');
    target.style.width = `${MOBILE_WIDTH}px`;
    target.style.minHeight = '100vh';
    target.style.backgroundColor = '#ffffff';
    target.style.boxShadow = '0 10px 25px rgba(0,0,0,0.2)'; // Drop shadow for visual separation
    
    overlay.appendChild(target);
    document.body.appendChild(overlay);

    try {
      const element = reportRef.current;
      const clone = element.cloneNode(true) as HTMLElement;
      
      // 2. Clean up & Mobile Styles on the Clone
      clone.style.width = '100%';
      clone.style.margin = '0'; 
      clone.style.padding = '16px'; 
      clone.style.boxSizing = 'border-box';
      clone.style.boxShadow = 'none';
      clone.style.backgroundColor = '#ffffff';
      
      // Remove unrelated sections
      const sectionsToRemove = [
        '#transcript-section',
        '#mandatory-passed-section',
        '#forbidden-passed-section',
        '.print\\:hidden'
      ];
      sectionsToRemove.forEach(sel => {
        clone.querySelectorAll(sel).forEach(el => el.remove());
      });

      // --- STRICT FILTERING LOGIC: ONLY EXCLUDE REJECTED ---
      const issueCards = clone.querySelectorAll('.issue-card');
      let approvedCount = 0;
      let visibleCount = 0;

      issueCards.forEach(card => {
        const el = card as HTMLElement;
        const status = el.dataset.reviewStatus; // 'approved' | 'rejected' | 'pending'

        // 1. 只有标记为“误诊”的才排除，其他（已确认、待定）都保留
        if (status === 'rejected') {
          el.remove();
          return;
        }

        visibleCount++;
        if (status === 'approved') approvedCount++;

        // Fix styling for card
        el.style.boxShadow = 'none';
        el.style.marginBottom = '16px';
        el.style.border = '1px solid #e2e8f0';

        // 2. 清理操作区域，保留诊断内容和原话
        const reviewModule = el.querySelector('.review-module') as HTMLElement;
        if (reviewModule) {
           if (status === 'approved') {
              const comment = el.dataset.comment || '';
              const staticNote = document.createElement('div');
              staticNote.className = "mt-0 p-3 bg-green-50 border-t border-green-100";
              staticNote.innerHTML = `
                <div class="flex items-center gap-1 mb-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-green-600"><path d="M20 6L9 17l-5-5"></path></svg>
                  <span class="text-xs font-bold text-green-700">人工已确认</span>
                </div>
                <p class="text-sm text-slate-900 font-medium leading-relaxed whitespace-pre-wrap">${comment || '（无附加备注）'}</p>
              `;
              reviewModule.replaceWith(staticNote);
           } else {
              // 对于“待定”项，直接移除按钮模块即可，上方诊断内容会自动上移保留
              reviewModule.remove();
           }
        }
      });

      // 3. Inject Mobile Header
      const header = document.createElement('div');
      header.className = "mb-6 pb-4 border-b border-slate-200";
      header.innerHTML = `
        <h1 class="text-xl font-black text-slate-900 mb-2">直播质检报告</h1>
        <div class="flex justify-between items-end text-xs text-slate-500">
          <div>
            <p>主播：<span class="font-bold text-slate-900">${metadata.anchorName || '-'}</span></p>
            <p>日期：${metadata.date || new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p>
          </div>
          <div class="flex flex-col items-end gap-1">
            <span class="bg-blue-50 text-blue-600 px-2 py-1 rounded font-bold">已确认 ${approvedCount} 项</span>
            <span class="text-[9px]">共包含 ${visibleCount} 处重点反馈</span>
          </div>
        </div>
      `;
      clone.prepend(header);

      // 4. 清理空容器（如果某个警报区过滤后没有任何“已确认”项，则移除整个红色背景区块）
      clone.querySelectorAll('.bg-red-50').forEach(container => {
        if (container.querySelectorAll('.issue-card').length === 0) {
          container.remove();
        }
      });

      // 5. Handle Empty State
      if (visibleCount === 0) {
        const msg = document.createElement('div');
        msg.className = "p-8 text-center border-2 border-dashed border-slate-200 rounded-xl mt-4";
        msg.innerHTML = `
          <p class="text-slate-400 font-bold mb-1">报告暂无可导出内容</p>
          <p class="text-xs text-slate-300">请检查是否所有项都已被标记为“误诊”</p>
        `;
        clone.appendChild(msg);
      } else {
        const footer = document.createElement('div');
        footer.className = "mt-6 pt-4 border-t border-slate-100 text-center text-[10px] text-slate-300 font-mono";
        footer.innerText = "StreamScript QA Verified Report";
        clone.appendChild(footer);
      }

      target.appendChild(clone);
      
      // Force wait for layout/images
      await waitForImages(target);
      await new Promise(resolve => setTimeout(resolve, 800));
      
      const contentHeight = target.scrollHeight;
      const scale = 2; // High quality for retina

      const roundName = result.isDualMode ? (activeRound === 'round1' ? '第一轮' : '第二轮') : '全量';
      const filename = `${metadata.anchorName || '主播'}_人工确认单_${roundName}.pdf`;

      const opt = {
        margin: 0,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 }, 
        html2canvas: { 
          scale: scale, 
          useCORS: true, 
          logging: false, 
          width: MOBILE_WIDTH,
          windowWidth: MOBILE_WIDTH,
          backgroundColor: '#ffffff',
          x: 0,
          y: 0,
          scrollY: 0
        },
        jsPDF: { 
          unit: 'px', 
          format: [MOBILE_WIDTH, contentHeight], 
          orientation: 'portrait',
          hotfixes: ['px_scaling']
        }
      };

      await html2pdf().set(opt).from(target).save();
      
    } catch (error) {
      console.error("Export failed:", error);
      alert("PDF导出失败，请重试。");
    } finally {
      // Clean up Overlay
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
      setIsExporting(false);
    }
  };

  /**
   * CSV Export: Filter out "Rejected"
   */
  const handleExportChecklist = () => {
    const csvHeader = ['序号', '重要性', '分类', '质检重点', '标准话术', '人工复核备注'];
    const getStandard = (text: string) => standards.find(s => s.qaFocus === text || s.content === text);
    const rows: string[][] = [];

    const processItem = (
      item: MandatoryCheck | ForbiddenIssue, 
      type: 'mandatory' | 'forbidden'
    ) => {
        // FILTER: Skip Rejected
        if (item.reviewStatus === 'rejected') return;

        const std = getStandard(item.standard);
        const isYesterdayRepeat = std?.importance === 'yesterday_repeat';

        let colImportance = '';
        let colCategory = '';
        let colFocus = item.standard;
        let colContent = std?.content || '';
        let colComment = item.operatorComment || '';

        // Add "Confirmed" label if approved
        if (item.reviewStatus === 'approved') {
            colComment = `[已确认] ${colComment}`;
        }

        if (colComment) {
            colContent = `${colContent}\n【人工备注】${colComment}`;
        }

        if (isYesterdayRepeat) {
            colImportance = '今日';
            colCategory = '昨日复检';
        } else {
            colImportance = std?.importance === 'high' ? '今日' : '日常';
            colCategory = type === 'mandatory' ? '一定要讲' : '一定不能讲';
        }

        rows.push([
            '', 
            colImportance,
            colCategory,
            colFocus,
            colContent,
            colComment
        ]);
    };

    missedMandatory.forEach(item => processItem(item, 'mandatory'));
    currentResult.forbidden_issues.forEach(item => processItem(item, 'forbidden'));

    const escapeCsv = (str: string) => {
        if (!str) return '';
        const needsQuotes = str.includes(',') || str.includes('\n') || str.includes('"');
        if (needsQuotes) {
            return `"${str.replace(/"/g, '""')}"`; 
        }
        return str;
    };

    const csvContent = [
        '\ufeff' + csvHeader.join(','), 
        ...rows.map(row => row.map(escapeCsv).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    const roundName = result.isDualMode ? (activeRound === 'round1' ? '第一轮' : '第二轮') : '全量';
    link.setAttribute('href', url);
    link.setAttribute('download', `${metadata.anchorName || '主播'}_人工确认清单_${roundName}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Data Calculations
  const passedForbiddenRules = useMemo(() => {
    const allForbidden = standards.filter(s => s.type === 'forbidden');
    const violatedStandardTexts = new Set<string>(currentResult.forbidden_issues.map(i => i.standard));
    return allForbidden.filter(s => {
      const key = s.qaFocus || s.content;
      if (violatedStandardTexts.has(key)) return false;
      const isViolated = Array.from(violatedStandardTexts).some((v: string) => v.includes(key) || key.includes(v));
      return !isViolated;
    });
  }, [standards, currentResult.forbidden_issues]);

  const { missedMandatory, passedMandatory } = useMemo(() => {
    const missed = currentResult.mandatory_checks.filter(c => c.status === 'missed' || c.performance_grade === 'poor');
    const passed = currentResult.mandatory_checks.filter(c => c.status === 'passed' && c.performance_grade !== 'poor');
    return { missedMandatory: missed, passedMandatory: passed };
  }, [currentResult.mandatory_checks]);

  // Match Logic
  /** 清理字符串，只保留汉字、英文和数字，去掉其它标点空格等 */
  const clean = (str: string) => {
    return str.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  };

  /** 在 clean 后的字符串中，找到所有子串 sub 出现的起始下标 */
  const getAllIndices = (str: string, sub: string): number[] => {
    const indices: number[] = [];
    if (!sub) return indices;
    let i = -1;
    while ((i = str.indexOf(sub, i + 1)) !== -1) {
      indices.push(i);
    }
    return indices;
  };

  /**
   * 将 clean 字符串中的区间映射回原始字符串的开始和结束位置
   */
  const mapToOriginal = (
    originalText: string,
    cleanStartIdx: number,
    cleanLength: number,
    method: string
  ): { start: number; end: number; found: boolean; method: string } => {
    let currentCleanIdx = 0;
    let originalStart = -1;
    let originalEnd = -1;

    for (let i = 0; i < originalText.length; i++) {
      const char = originalText[i];
      if (/[^\u4e00-\u9fa5a-zA-Z0-9]/.test(char)) {
        continue;
      }
      if (currentCleanIdx === cleanStartIdx) {
        originalStart = i;
      }
      currentCleanIdx++;
      if (currentCleanIdx === cleanStartIdx + cleanLength) {
        originalEnd = i + 1;
        break;
      }
    }
    if (originalStart !== -1 && originalEnd === -1) {
      originalEnd = originalText.length;
    }
    return {
      start: originalStart >= 0 ? originalStart : 0,
      end: originalEnd >= 0 ? originalEnd : 0,
      found: originalStart >= 0,
      method,
    };
  };

  /**
   * 在原始全文 fullText 中定位子串 quote
   */
  const findBestMatch = (
    fullText: string,
    quote: string
  ): { start: number; end: number; found: boolean; method: string } => {
    if (!quote || quote.length < 2) {
      return { start: 0, end: 0, found: false, method: 'none' };
    }

    const cleanFull = clean(fullText);
    const cleanQuote = clean(quote);
    const len = cleanQuote.length;

    // 1. 精确匹配
    const exactIdx = cleanFull.indexOf(cleanQuote);
    if (exactIdx !== -1) {
      return mapToOriginal(fullText, exactIdx, len, 'exact');
    }
    if (len < 6) {
      return { start: 0, end: 0, found: false, method: 'none' };
    }

    // 准备样本段 head/tail/mid
    const sampleSize = len > 12 ? 4 : 3;
    const head = cleanQuote.substring(0, sampleSize);
    const tail = cleanQuote.substring(len - sampleSize);
    const midStart = Math.floor((len - sampleSize) / 2);
    const mid = cleanQuote.substring(midStart, midStart + sampleSize);

    const heads = getAllIndices(cleanFull, head);
    const tails = getAllIndices(cleanFull, tail);
    const mids  = getAllIndices(cleanFull, mid);
    const minLen = len * 0.7;
    const maxLen = len * 1.3;

    // 2. head-tail 匹配
    for (const h of heads) {
      for (const t of tails) {
        const dist = t - h + sampleSize;
        if (dist > 0 && dist >= minLen && dist <= maxLen) {
          return mapToOriginal(fullText, h, dist, 'head-tail');
        }
      }
    }
    // 3. head-mid 模糊匹配
    const headToMidLen = midStart + sampleSize;
    for (const h of heads) {
      for (const m of mids) {
        const dist = m - h + sampleSize;
        if (dist > 0 && dist >= headToMidLen * 0.7 && dist <= headToMidLen * 1.3) {
          return mapToOriginal(fullText, h, len, 'head-mid');
        }
      }
    }
    // 4. mid-tail 模糊匹配
    const midToTailLen = len - midStart;
    for (const m of mids) {
      for (const t of tails) {
        const dist = t - m + sampleSize;
        if (
          dist > 0 &&
          dist >= midToTailLen * 0.7 &&
          dist <= midToTailLen * 1.3
        ) {
          const inferredStart = Math.max(0, t - len + sampleSize);
          return mapToOriginal(fullText, inferredStart, len, 'mid-tail');
        }
      }
    }
    // 5. 单点锚定：head/mid/tail 任一唯一出现
    if (heads.length === 1) {
      return mapToOriginal(fullText, heads[0], len, 'anchor-head');
    }
    if (mids.length === 1) {
      const start = Math.max(0, mids[0] - midStart);
      return mapToOriginal(fullText, start, len, 'anchor-mid');
    }
    if (tails.length === 1) {
      const start = Math.max(0, tails[0] - len + sampleSize);
      return mapToOriginal(fullText, start, len, 'anchor-tail');
    }

    return { start: 0, end: 0, found: false, method: 'none' };
  };

  /**
   * Dual-color text rendering (topic scene vs core evidence)
   */
  const renderDualColorText = (topicScene?: string, coreEvidence?: string) => {
    if (!topicScene) return null;
    if (!coreEvidence || coreEvidence.length < 2) {
      return <ExpandableText text={topicScene} maxLen={100} italic={true} className="text-slate-800" />;
    }

    // Try to find exact position of core evidence
    let exactIdx = topicScene.indexOf(coreEvidence);
    if (exactIdx === -1) {
       // If modified by AI slightly, just show them separately or fallback to simple representation
       return (
         <div className="flex flex-col gap-2">
           <ExpandableText text={topicScene} maxLen={100} italic={true} className="text-slate-500" />
           <div className="bg-orange-100 p-2 border-l-2 border-orange-500 rounded">
             <ExpandableText text={coreEvidence} italic={true} className="text-orange-800 font-bold" />
           </div>
         </div>
       );
    }

    const before = topicScene.substring(0, exactIdx);
    const middle = topicScene.substring(exactIdx, exactIdx + coreEvidence.length);
    const after = topicScene.substring(exactIdx + coreEvidence.length);

    return (
      <div className="text-sm leading-relaxed whitespace-pre-wrap break-words italic text-slate-500">
        {before}
        <span className="bg-orange-200 text-orange-900 font-bold px-1 rounded inline-block my-0.5 shadow-sm border border-orange-300">
          {middle}
        </span>
        {after}
      </div>
    );
  };

  /**
   * 增强型文本渲染逻辑：支持 AI 高亮 + 搜索高亮 + 瞬间定位
   */
  const renderHighlightedTranscript = () => {
    const fullText = activeRound === 'round1' ? localResult.round1Text : (localResult.round2Text || localResult.round1Text);
    if (!fullText) return "暂无原文数据";

    // 1. 处理 AI 定位 (黄底)
    let aiMatch = { start: -1, end: -1 };
    if (highlightQuote) {
      const match = findBestMatch(fullText, highlightQuote);
      if (match.found) {
        aiMatch = { start: match.start, end: match.end };
      }
    }

    // 2. 处理搜索匹配 (浅蓝)
    const matches: { start: number; end: number; isCurrent: boolean }[] = [];
    if (searchTerm && searchTerm.length >= 1) {
      let pos = 0;
      const lowerFull = fullText.toLowerCase();
      const lowerSearch = searchTerm.toLowerCase();
      while ((pos = lowerFull.indexOf(lowerSearch, pos)) !== -1) {
        matches.push({
          start: pos,
          end: pos + searchTerm.length,
          isCurrent: matches.length === currentMatchIndex
        });
        pos += searchTerm.length;
      }
    }

    // 3. 混合渲染逻辑
    const elements: React.ReactNode[] = [];
    let lastIdx = 0;

    // 将所有需要高亮的区间合并排序
    const allIntervals: { start: number; end: number; type: 'ai' | 'search'; isCurrent?: boolean; searchIdx?: number }[] = [];
    if (aiMatch.start !== -1) allIntervals.push({ ...aiMatch, type: 'ai' });
    matches.forEach((m, idx) => allIntervals.push({ ...m, type: 'search', searchIdx: idx }));
    
    allIntervals.sort((a, b) => a.start - b.start || b.end - a.end);

    allIntervals.forEach((interval, i) => {
      // 填充之前的普通文本
      if (interval.start > lastIdx) {
        elements.push(fullText.substring(lastIdx, interval.start));
      }
      
      // 避免重复渲染
      if (interval.start < lastIdx) return;

      const content = fullText.substring(interval.start, interval.end);
      if (interval.type === 'ai') {
        elements.push(
          <span key={`ai-${i}`} id="ai-highlight" className="bg-yellow-200 text-slate-900 font-bold px-0.5 rounded border-b-2 border-yellow-400 highlight-active">
            {content}
          </span>
        );
      } else {
        const isCurrent = interval.searchIdx === currentMatchIndex;
        elements.push(
          <span 
            key={`search-${i}`} 
            id={`search-match-${interval.searchIdx}`}
            className={`px-0.5 rounded transition-colors ${isCurrent ? 'bg-orange-500 text-white ring-2 ring-orange-300 z-10' : 'bg-blue-100 text-blue-800 border-b border-blue-300'}`}
          >
            {content}
          </span>
        );
      }
      lastIdx = interval.end;
    });

    if (lastIdx < fullText.length) {
      elements.push(fullText.substring(lastIdx));
    }

    return <>{elements}</>;
  };

  // --- 搜索逻辑 ---
  useEffect(() => {
    if (!searchTerm) {
      setSearchMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }
    const fullText = activeRound === 'round1' ? localResult.round1Text : (localResult.round2Text || localResult.round1Text);
    const lowerFull = fullText.toLowerCase();
    const lowerSearch = searchTerm.toLowerCase();
    const indices: number[] = [];
    let pos = 0;
    while ((pos = lowerFull.indexOf(lowerSearch, pos)) !== -1) {
      indices.push(pos);
      pos += searchTerm.length;
    }
    setSearchMatches(indices);
    if (indices.length > 0) {
      setCurrentMatchIndex(0);
    } else {
      setCurrentMatchIndex(-1);
    }
  }, [searchTerm, activeRound]);

  // 跳转逻辑 (瞬间跳转)
  const jumpToMatch = (index: number) => {
    if (index < 0 || index >= searchMatches.length) return;
    setCurrentMatchIndex(index);
    setTimeout(() => {
      const el = document.getElementById(`search-match-${index}`);
      if (el) {
        el.scrollIntoView({ behavior: 'auto', block: 'center' });
      }
    }, 10);
  };

  const handleTranscriptScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight > clientHeight) {
      setScrollPercent((scrollTop / (scrollHeight - clientHeight)) * 100);
    }
  };

  return (
    <div className="pb-4 animate-in slide-in-from-bottom-8 fade-in duration-500 bg-slate-50 min-h-screen">
      
      {/* 并排布局区域：顶部只有 44px 导航栏，内容区始终最大化 */}
      <div className={`flex justify-start items-start gap-6 px-4 py-2 mx-auto transition-all duration-500 overflow-hidden h-[calc(100vh-44px)] ${showAdminAudit ? 'max-w-full w-full' : 'max-w-[600px] justify-center'}`}>
        
        {/* 左侧：质检报告 - 宽度锁定，独立滚动，绝不动弹 */}
        <div 
          id="report-content" 
          ref={reportRef} 
          className={`bg-white transition-all duration-300 shadow-xl rounded-2xl w-[600px] shrink-0 p-8 md:p-10 h-full overflow-y-auto custom-scrollbar ${!showAdminAudit ? 'mx-auto' : 'ml-4'}`}
        >
          {/* METADATA HEADER */}
          <div className="mb-8 border-b-2 border-slate-900 pb-6">
             <div className="flex justify-between items-end mb-4">
                <h1 className="text-3xl font-black text-slate-900">直播质检报告</h1>
                {result.isDualMode && (
                   <span className={`px-3 py-1 rounded-full text-xs font-bold text-white ${activeRound === 'round1' ? 'bg-blue-600' : 'bg-indigo-600'}`}>
                     {activeRound === 'round1' ? '第一轮 (Round 1)' : '第二轮 (Round 2)'}
                   </span>
                )}
             </div>
             
             <div className="bg-slate-50 rounded-xl p-5 border border-slate-200">
                <div className="flex items-center gap-3">
                   <div className="bg-white p-2 rounded-full border border-slate-200 text-slate-500">
                      <User size={18} />
                   </div>
                   <div>
                     <p className="text-[9px] text-slate-400 font-bold uppercase">主播</p>
                     <p className="font-bold text-slate-800 text-lg">{metadata.anchorName || '未命名'}</p>
                   </div>
                </div>
             </div>
          </div>

          <div className="space-y-12 animate-in fade-in duration-300" key={activeRound}>
            {/* --- 新增：漏讲警报环节 (Omission Alarm UI) --- */}
            {(missedMandatory.length > 0 || currentResult.forbidden_issues.length > 0) && (
              <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-6">
                  <div className="bg-red-600 p-2 rounded-lg text-white shadow-md">
                    <AlertOctagon size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-red-900">漏讲警报 (Omission Alarm)</h3>
                    <p className="text-sm text-red-700 font-medium">系统已自动拎出所有不合格项，请优先处理</p>
                  </div>
                </div>

                <div className="space-y-6">
                  {/* 必查项漏讲 */}
                  {missedMandatory.map((check, idx) => {
                    const sourceIndex = activeRound === 'round1' 
                      ? localResult.round1.mandatory_checks.indexOf(check)
                      : (localResult.round2?.mandatory_checks.indexOf(check) ?? -1);
                    const isRejected = check.reviewStatus === 'rejected';
                    const isApproved = check.reviewStatus === 'approved';

                    return (
                      <div 
                        key={`alarm-m-${idx}`} 
                        id={`alarm-m-${idx}`}
                        className={`issue-card bg-white rounded-2xl border overflow-hidden shadow-sm flex flex-col transition-all duration-300 relative ${
                          isRejected ? 'border-slate-200 grayscale opacity-60' : 'border-red-100'
                        }`}
                        data-review-status={check.reviewStatus || 'pending'}
                        data-comment={check.operatorComment || ''}
                      >
                        {/* 误诊水印 */}
                        {isRejected && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                            <div className="bg-slate-800/80 text-white text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-lg transform -rotate-12 border border-slate-600">
                              已标记为误诊 · 不会导出
                            </div>
                          </div>
                        )}

                        {/* 1. 卡片头部 */}
                        <div className={`px-4 py-2 flex justify-between items-center transition-colors ${isRejected ? 'bg-slate-400' : 'bg-red-600'}`}>
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                            <h1 className="text-white text-[11px] font-black tracking-widest uppercase">漏讲警报 #{idx + 1}</h1>
                          </div>
                          <div className="bg-white/20 backdrop-blur-md border border-white/20 px-2 py-0.5 rounded text-[9px] text-white font-bold">
                            MANDATORY
                          </div>
                        </div>
                        
                        <div className="p-4 space-y-4">
                          {/* 2. 质检重点 */}
                          <div>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                              <ClipboardList size={10} /> 质检重点
                            </p>
                            <h4 className="font-bold text-[13px] text-slate-800 leading-snug">
                              {check.standard}
                            </h4>
                          </div>

                          {/* 3. 深度诊断区 */}
                          <div className="bg-red-50/40 rounded-xl p-3 border border-red-100/50">
                            {(() => {
                              const { score, elements } = parseDiagnosisLines(check.comment);
                              return elements.length > 0 ? (
                                <DiagnosisDisplay 
                                  score={score} 
                                  elements={elements} 
                                  isRejected={isRejected}
                                  elementStates={check.elementStates}
                                  onElementCheck={(elId, state) => updateElementState(sourceIndex, elId, state)}
                                />
                              ) : (
                                <p className="text-[11px] text-red-800 leading-relaxed italic">{check.comment}</p>
                              );
                            })()}
                          </div>

                          {/* 4. 主播当时原话 (点击定位) */}
                          {check.detected_content && (
                            <div 
                              onClick={() => handleQuoteClick(check.detected_content!, `alarm-m-${idx}`)}
                              className="bg-blue-50 border border-blue-100 rounded-xl p-3 cursor-pointer hover:bg-blue-100 transition-all active:scale-[0.98] group"
                            >
                              <p className="text-[9px] font-black text-blue-400 uppercase tracking-widest mb-1.5 flex justify-between items-center">
                                <span className="flex items-center gap-1"><Search size={10} /> 主播当时原话 (点击定位)</span>
                                <ArrowDownCircle size={10} className="group-hover:translate-y-0.5 transition-transform" />
                              </p>
                              <p className="text-blue-900 text-[12px] leading-relaxed italic font-medium">
                                “{check.detected_content}”
                              </p>
                            </div>
                          )}

                          {/* 5. 人工手检模块 */}
                          <div className="review-module pt-2 border-t border-slate-100">
                             <div className="flex gap-2">
                               <button 
                                 onClick={() => updateReviewStatus('mandatory', sourceIndex, 'approved')}
                                 className={`flex-1 py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                                   isApproved 
                                   ? 'bg-emerald-600 text-white shadow-md' 
                                   : 'bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100'
                                 }`}
                               >
                                  <CheckCircle2 size={12} />
                                  判定正确 (保留)
                               </button>
                               <button 
                                 onClick={() => updateReviewStatus('mandatory', sourceIndex, isRejected ? 'pending' : 'rejected')}
                                 className={`flex-1 py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                                   isRejected
                                   ? 'bg-slate-600 text-white shadow-md'
                                   : 'bg-slate-50 text-slate-400 border border-slate-200 hover:bg-red-50 hover:text-red-500 hover:border-red-100'
                                 }`}
                               >
                                  <AlertOctagon size={12} />
                                  {isRejected ? '撤销误诊' : '点击误诊 (排除)'}
                               </button>
                             </div>
                             
                             {/* 人工备注输入框 */}
                             {isApproved && (
                               <div className="mt-2 animate-in fade-in slide-in-from-top-1 duration-300">
                                  <textarea 
                                    value={check.operatorComment || ''}
                                    onChange={(e) => updateReviewStatus('mandatory', sourceIndex, 'approved', e.target.value)}
                                    placeholder="输入人工复核备注（将导出至报告）..." 
                                    className="w-full text-[11px] p-2 rounded-lg border border-emerald-100 bg-emerald-50/20 focus:outline-none focus:ring-1 focus:ring-emerald-300 h-16 resize-none placeholder:text-slate-300"
                                  ></textarea>
                               </div>
                             )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* 违规项警报 */}
                  {currentResult.forbidden_issues.map((issue, idx) => {
                    const sourceIndex = activeRound === 'round1'
                       ? localResult.round1.forbidden_issues.indexOf(issue)
                       : (localResult.round2?.forbidden_issues.indexOf(issue) ?? -1);
                    const isRejected = issue.reviewStatus === 'rejected';
                    const isApproved = issue.reviewStatus === 'approved';

                    return (
                      <div 
                        key={`alarm-f-${idx}`} 
                        id={`alarm-f-${idx}`}
                        className={`issue-card bg-white rounded-2xl border overflow-hidden shadow-sm flex flex-col transition-all duration-300 relative ${
                          isRejected ? 'border-slate-200 grayscale opacity-60' : 'border-red-100'
                        }`}
                        data-review-status={issue.reviewStatus || 'pending'}
                        data-comment={issue.operatorComment || ''}
                      >
                        {/* 误诊水印 */}
                        {isRejected && (
                          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
                            <div className="bg-slate-800/80 text-white text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest shadow-lg transform -rotate-12 border border-slate-600">
                              已标记为误诊 · 不会导出
                            </div>
                          </div>
                        )}

                        {/* 1. 卡片头部 */}
                        <div className={`px-4 py-2 flex justify-between items-center transition-colors ${isRejected ? 'bg-slate-400' : 'bg-red-600'}`}>
                          <div className="flex items-center gap-2">
                            <span className="w-1.5 h-1.5 bg-white rounded-full"></span>
                            <h1 className="text-white text-[11px] font-black tracking-widest uppercase">违规内容警报 #{idx + 1}</h1>
                          </div>
                          <div className="bg-white/20 backdrop-blur-md border border-white/20 px-2 py-0.5 rounded text-[9px] text-white font-bold">
                            FORBIDDEN
                          </div>
                        </div>

                        <div className="p-4 space-y-4">
                          {/* 2. 违规详情 */}
                          <div>
                            <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                              <Ban size={10} /> 触犯规则
                            </p>
                            <div className="bg-red-50/50 rounded-xl p-3 border border-red-100/50">
                              <h4 className="font-bold text-[13px] text-slate-800 mb-1">{issue.standard}</h4>
                              <p className="text-[11px] text-red-700 leading-relaxed font-medium">
                                {issue.reason}
                              </p>
                            </div>
                          </div>

                          {/* 3. 纠偏建议 */}
                          {issue.suggestion && (
                            <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-100/50">
                              <p className="text-[9px] font-black text-emerald-600 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                <Sparkles size={10} /> 纠偏建议
                              </p>
                              <p className="text-[11px] text-emerald-800 leading-relaxed font-bold">
                                {issue.suggestion}
                              </p>
                            </div>
                          )}

                          {/* 4. 违规现场证据 */}
                          <div 
                            onClick={() => handleQuoteClick(issue.detected_content, `alarm-f-${idx}`)}
                            className="bg-red-50 border border-red-100 rounded-xl p-3 cursor-pointer hover:bg-red-100 transition-all active:scale-[0.98] group"
                          >
                             <p className="text-[9px] font-black text-red-400 uppercase tracking-widest mb-1.5 flex justify-between items-center">
                                <span className="flex items-center gap-1"><Search size={10} /> 违规现场证据 (点击定位)</span>
                                <ArrowDownCircle size={10} className="group-hover:translate-y-0.5 transition-transform" />
                             </p>
                             <p className="text-red-900 text-[12px] leading-relaxed italic font-medium">
                               “{issue.detected_content}”
                             </p>
                          </div>

                          {/* 5. 人工手检模块 */}
                          <div className="review-module pt-2 border-t border-slate-100">
                             <div className="flex gap-2">
                               <button 
                                 onClick={() => updateReviewStatus('forbidden', sourceIndex, 'approved')}
                                 className={`flex-1 py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                                   isApproved 
                                   ? 'bg-emerald-600 text-white shadow-md' 
                                   : 'bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100'
                                 }`}
                               >
                                  <CheckCircle2 size={12} />
                                  判定正确 (保留)
                               </button>
                               <button 
                                 onClick={() => updateReviewStatus('forbidden', sourceIndex, isRejected ? 'pending' : 'rejected')}
                                 className={`flex-1 py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all ${
                                   isRejected
                                   ? 'bg-slate-600 text-white shadow-md'
                                   : 'bg-slate-50 text-slate-400 border border-slate-200 hover:bg-red-50 hover:text-red-500 hover:border-red-100'
                                 }`}
                               >
                                  <AlertOctagon size={12} />
                                  {isRejected ? '撤销误诊' : '点击误诊 (排除)'}
                               </button>
                             </div>
                             
                             {isApproved && (
                               <div className="mt-2 animate-in fade-in slide-in-from-top-1 duration-300">
                                  <textarea 
                                    value={issue.operatorComment || ''}
                                    onChange={(e) => updateReviewStatus('forbidden', sourceIndex, 'approved', e.target.value)}
                                    placeholder="输入人工复核备注（将导出至报告）..." 
                                    className="w-full text-[11px] p-2 rounded-lg border border-emerald-100 bg-emerald-50/20 focus:outline-none focus:ring-1 focus:ring-emerald-300 h-16 resize-none placeholder:text-slate-300"
                                  ></textarea>
                               </div>
                             )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* SECTION 1: MANDATORY */}
            <div className="hidden"> {/* 默认隐藏全量必查项，通过警报专区处理异常 */}
              <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
                <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
                  <ClipboardList size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">一定要讲</h3>
                  <p className="text-sm text-slate-500 font-medium">
                    {missedMandatory.length > 0
                     ? `警报：发现 ${missedMandatory.length} 处漏讲`
                     : "关键点全部覆盖"}
                  </p>
                </div>
              </div>

              {/* Missed Items */}
              {missedMandatory.length > 0 && (
                <div className="space-y-6 mb-8">
                  {missedMandatory.map((check, idx) => {
                     // Calculate real index source
                     const sourceIndex = activeRound === 'round1' 
                       ? localResult.round1.mandatory_checks.indexOf(check)
                       : (localResult.round2?.mandatory_checks.indexOf(check) ?? -1);

                     const isRejected = check.reviewStatus === 'rejected';

                     return (
                      <div 
                        key={idx} 
                        id={`mandatory-${idx}`} // 添加唯一 ID
                        className={`issue-card bg-white rounded-2xl border-2 overflow-hidden relative break-inside-avoid shadow-sm flex flex-col ${
                          isRejected ? 'border-slate-200 opacity-50 grayscale' : 'border-orange-100'
                        }`}
                        data-review-status={check.reviewStatus || 'pending'}
                        data-comment={check.operatorComment || ''}
                      >
                        {/* HEADER */}
                        <div className={`text-white px-5 py-3 flex items-center justify-between transition-colors ${isRejected ? 'bg-slate-400' : 'bg-orange-500'}`}>
                           <div className="flex items-center gap-2">
                              {isRejected ? <Trash2 size={18} /> : <AlertTriangle size={18} className="text-orange-100" />}
                              <span className="font-bold text-base tracking-wide">
                                {isRejected ? '已标记误诊/忽略' : `漏讲警报 #${idx + 1}`}
                              </span>
                           </div>
                        </div>

                        {/* CONTENT BODY */}
                        <div className={`p-5 space-y-4 flex-1 ${isRejected ? 'pointer-events-none' : ''}`}>
                          <div>
                            <p className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${isRejected ? 'text-slate-400' : 'text-orange-400'}`}>缺失内容</p>
                            <h4 className="text-lg font-black text-slate-800 leading-snug whitespace-pre-wrap break-words">
                              {check.standard}
                            </h4>
                          </div>

                          {check.topic_scene && check.topic_scene.length > 2 && (
                            <div className="pt-2">
                              <div className="flex flex-col gap-2 w-full">
                                 <div className="flex items-center gap-2">
                                   <div className={`p-1 rounded-full ${isRejected ? 'bg-slate-100 text-slate-400' : 'bg-orange-50 text-orange-400'}`}>
                                      <Search size={12} />
                                   </div>
                                   <span className={`text-xs font-bold block ${isRejected ? 'text-slate-500' : 'text-orange-700'}`}>定位当时语境 (相关话题)：</span>
                                 </div>
                                 
                                 <div 
                                   onClick={() => handleQuoteClick(check.core_evidence || check.topic_scene || '', `mandatory-${idx}`)}
                                   className={`text-xs cursor-pointer hover:border-blue-300 transition-colors p-3 rounded-xl border ${isRejected ? 'text-slate-400 bg-slate-50 border-slate-100' : 'bg-blue-50 border-blue-100'}`}
                                 >
                                   {renderDualColorText(check.topic_scene, check.core_evidence)}
                                   <div className="mt-2 flex items-center gap-1 text-[10px] font-bold text-orange-400">
                                     <ArrowDownCircle size={10} /> 点击跳转原文定位 (跳至核心原话)
                                   </div>
                                 </div>
                              </div>
                            </div>
                          )}
                        </div>


                      </div>
                    );
                  })}
            </div>
            )}

            {/* --- 新增：精准分割锚点核对区 --- */}
            {result.isDualMode && result.splitAnchors && (
              <div className="my-10 p-6 bg-indigo-50 rounded-2xl border-2 border-indigo-100 shadow-sm animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center gap-2 mb-4">
                  <div className="bg-indigo-600 p-1.5 rounded text-white shadow-sm">
                    <Split size={16} />
                  </div>
                  <h4 className="text-sm font-black text-indigo-900 uppercase tracking-wider">双轮切割定位核对 (精准坐标)</h4>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => handleQuoteClick(result.splitAnchors!.r1StartPhrase, 'anchor-r1-start')}
                    className="flex flex-col items-start p-3 bg-white border border-indigo-200 rounded-xl hover:border-indigo-400 hover:shadow-md transition-all text-left group"
                  >
                    <span className="text-[9px] font-bold text-indigo-400 uppercase mb-1">1. 第一轮开始点</span>
                    <span className="text-xs font-bold text-indigo-900 truncate w-full group-hover:text-blue-600 transition-colors">“{result.splitAnchors!.r1StartPhrase}”</span>
                  </button>

                  <button 
                    onClick={() => handleQuoteClick(result.splitAnchors!.r1EndPhrase, 'anchor-r1-end')}
                    className="flex flex-col items-start p-3 bg-white border border-indigo-200 rounded-xl hover:border-indigo-400 hover:shadow-md transition-all text-left group"
                  >
                    <span className="text-[9px] font-bold text-indigo-400 uppercase mb-1">2. 第一轮结束点</span>
                    <span className="text-xs font-bold text-indigo-900 truncate w-full group-hover:text-blue-600 transition-colors">“{result.splitAnchors!.r1EndPhrase}”</span>
                  </button>

                  <button 
                    onClick={() => handleQuoteClick(result.splitAnchors!.r2StartPhrase, 'anchor-r2-start')}
                    className="flex flex-col items-start p-3 bg-indigo-600 border border-indigo-700 rounded-xl hover:bg-indigo-700 shadow-lg hover:shadow-indigo-200 transition-all text-left group"
                  >
                    <span className="text-[9px] font-bold text-indigo-200 uppercase mb-1">3. 第二轮开启点 (核心)</span>
                    <span className="text-xs font-bold text-white truncate w-full">“{result.splitAnchors!.r2StartPhrase}”</span>
                  </button>

                  <button 
                    onClick={() => handleQuoteClick(result.splitAnchors!.r2EndPhrase, 'anchor-r2-end')}
                    className="flex flex-col items-start p-3 bg-white border border-indigo-200 rounded-xl hover:border-indigo-400 hover:shadow-md transition-all text-left group"
                  >
                    <span className="text-[9px] font-bold text-indigo-400 uppercase mb-1">4. 第二轮结束点</span>
                    <span className="text-xs font-bold text-indigo-900 truncate w-full group-hover:text-blue-600 transition-colors">“{result.splitAnchors!.r2EndPhrase}”</span>
                  </button>
                </div>
                <p className="mt-3 text-[10px] text-indigo-400 font-bold text-center flex items-center justify-center gap-1">
                   <ArrowDownCircle size={10} /> 点击上方按钮，直接在底部“逐字稿”中高亮定位并标黄
                </p>
              </div>
            )}

            {/* Passed Items */}
               <div id="mandatory-passed-section" className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden break-inside-avoid">
                <div className="bg-slate-100 px-5 py-2 border-b border-slate-200">
                   <h4 className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                     <ThumbsUp size={14} className="text-blue-600"/>
                     已达标 ({passedMandatory.length})
                   </h4>
                </div>
                {passedMandatory.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-xs">无达标项</div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {passedMandatory.map((check, idx) => {
                      const sourceIndex = activeRound === 'round1' 
                        ? localResult.round1.mandatory_checks.indexOf(check)
                        : (localResult.round2?.mandatory_checks.indexOf(check) ?? -1);
                      
                      return (
                        <div key={idx} className="px-5 py-4 space-y-3">
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 text-emerald-500 shrink-0">
                              <Check size={14} strokeWidth={3} />
                            </div>
                            <div className="flex-1">
                              <span className="text-sm text-slate-700 font-bold block">{check.standard}</span>
                            </div>
                          </div>
                          
                          {/* 达标项也展示明细，支持核减 */}
                          <div className="pl-6">
                            {(() => {
                              const { score, elements } = parseDiagnosisLines(check.comment);
                              return elements.length > 0 && (
                                <DiagnosisDisplay 
                                  score={score} 
                                  elements={elements} 
                                  elementStates={check.elementStates}
                                  onElementCheck={(elId, state) => updateElementState(sourceIndex, elId, state)}
                                />
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <hr className="border-slate-100" />

            {/* SECTION 2: FORBIDDEN */}
            <div className="hidden"> {/* 默认隐藏全量违规项，通过警报专区处理异常 */}
              <div className="flex items-center gap-3 mb-6 border-b border-slate-100 pb-4">
                <div className="bg-red-100 p-2 rounded-lg text-red-600">
                  <Ban size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900">一定不能讲</h3>
                  <p className="text-sm text-slate-500 font-medium">
                    {currentResult.forbidden_issues.length > 0 
                      ? `发现 ${currentResult.forbidden_issues.length} 处违规` 
                      : "本项检测全部通过"}
                  </p>
                </div>
              </div>

              {/* Violations */}
              {currentResult.forbidden_issues.length > 0 && (
                <div className="space-y-6 mb-8">
                  {currentResult.forbidden_issues.map((issue, idx) => {
                    const sourceIndex = activeRound === 'round1'
                       ? localResult.round1.forbidden_issues.indexOf(issue)
                       : (localResult.round2?.forbidden_issues.indexOf(issue) ?? -1);

                    const isRejected = issue.reviewStatus === 'rejected';

                    return (
                      <div 
                        key={idx} 
                        id={`forbidden-${idx}`} // 添加唯一 ID
                        className={`issue-card bg-white rounded-2xl border-2 overflow-hidden relative break-inside-avoid shadow-sm flex flex-col ${
                          isRejected ? 'border-slate-200 opacity-50 grayscale' : 'border-red-100'
                        }`}
                        data-review-status={issue.reviewStatus || 'pending'}
                        data-comment={issue.operatorComment || ''}
                      >
                        <div className={`text-white px-5 py-3 flex items-center justify-between transition-colors ${isRejected ? 'bg-slate-400' : 'bg-red-600'}`}>
                           <div className="flex items-center gap-2">
                              {isRejected ? <Trash2 size={18} /> : <AlertOctagon size={18} className="text-red-200" />}
                              <span className="font-bold text-base tracking-wide">
                                 {isRejected ? '已标记误诊/忽略' : `违规警报 #${idx + 1}`}
                              </span>
                           </div>
                        </div>
                        
                        <div className={`p-5 space-y-4 flex-1 ${isRejected ? 'pointer-events-none' : ''}`}>
                          <div>
                            <p className={`text-[9px] font-bold uppercase tracking-wider mb-1 ${isRejected ? 'text-slate-400' : 'text-red-400'}`}>触犯规则</p>
                            <h4 className="text-lg font-black text-slate-800 leading-snug whitespace-pre-wrap break-words">
                              {issue.standard}
                            </h4>
                          </div>

                          <div className={`rounded-xl p-4 border ${isRejected ? 'bg-slate-50 border-slate-200' : 'bg-red-50 border-red-100'}`}>
                            <p className={`text-[9px] font-bold uppercase tracking-wider mb-2 ${isRejected ? 'text-slate-400' : 'text-red-400'}`}>违规现场证据 (主播原话)</p>
                            <div 
                                 onClick={() => handleQuoteClick(issue.detected_content, `forbidden-${idx}`)}
                                 className="text-left w-full cursor-pointer group"
                            >
                              <ExpandableText text={`“${issue.detected_content}”`} maxLen={100} italic={true} className={`${isRejected ? 'text-slate-500' : 'text-slate-800 group-hover:text-red-600'}`} />
                              <div className={`mt-2 flex items-center gap-1 text-[10px] font-bold ${isRejected ? 'hidden' : 'text-red-400'}`}>
                                 <ArrowDownCircle size={10} /> 点击跳转原文定位
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4 pt-2">
                            <div className={`rounded-xl p-4 border ${isRejected ? 'bg-slate-50 border-slate-200' : 'bg-green-50 border-green-100'}`}>
                              <p className={`text-[9px] font-bold uppercase tracking-wider mb-1 flex items-center gap-1 ${isRejected ? 'text-slate-500' : 'text-green-600'}`}>
                                 <Sparkles size={12} /> 纠偏建议
                              </p>
                              <p className={`text-sm font-bold leading-relaxed ${isRejected ? 'text-slate-600' : 'text-green-800'}`}>
                                {issue.suggestion}
                              </p>
                            </div>
                          </div>
                        </div>


                      </div>
                    );
                  })}
                </div>
              )}

              <div id="forbidden-passed-section" className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden break-inside-avoid">
                <div className="bg-slate-100 px-5 py-2 border-b border-slate-200">
                   <h4 className="text-[9px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                     <CheckCircle2 size={14} className="text-green-600"/>
                     已通过 ({passedForbiddenRules.length})
                   </h4>
                </div>
                {passedForbiddenRules.length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-xs">无其他通过项</div>
                ) : (
                  <div className="grid grid-cols-2 gap-x-4 p-2">
                    {passedForbiddenRules.map((rule, idx) => (
                      <div key={idx} className="px-3 py-2 flex items-start gap-2">
                        <div className="mt-0.5 text-green-500 shrink-0">
                          <Check size={14} strokeWidth={3} />
                        </div>
                        <span className="text-xs text-slate-600 font-medium leading-tight">
                          {rule.qaFocus || rule.content}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="mt-12 pt-6 border-t border-slate-100 text-center text-slate-400 text-xs font-mono">
            StreamScript QA 智能质检 • {new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}
          </div>
        </div>

      {/* 4. 右侧多功能面板 - 移除 sticky，改用容器内高度铺满 */}
      {showAdminAudit && (
        <div className="flex-1 min-w-[600px] h-full flex flex-col animate-in slide-in-from-right-10 duration-500 print:hidden overflow-hidden">
          <div className={`bg-white rounded-2xl border-2 shadow-2xl overflow-hidden flex flex-col h-full flex-1 ${rightPanelTab === 'audit' ? 'border-orange-200' : 'border-blue-200'}`}>
            
            {/* 动态 Header */}
            <div className={`${rightPanelTab === 'audit' ? 'bg-orange-500' : 'bg-blue-600'} p-4 text-white flex justify-between items-center shrink-0`}>
              <div className="flex items-center gap-2">
                {rightPanelTab === 'audit' ? <Activity size={18} /> : <FileText size={18} />}
                <h3 className="font-bold">{rightPanelTab === 'audit' ? 'AI 案发现场 (指令核对)' : '主播全文 (逐字稿复盘)'}</h3>
              </div>
              <div className="flex items-center gap-3">
                 <div className="bg-black/20 rounded-lg p-0.5 flex">
                    <button 
                      onClick={() => setRightPanelTab('audit')}
                      className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${rightPanelTab === 'audit' ? 'bg-white text-orange-600 shadow-sm' : 'text-white/70 hover:text-white'}`}
                    >核对</button>
                    <button 
                      onClick={() => setRightPanelTab('transcript')}
                      className={`px-3 py-1 text-[10px] font-bold rounded transition-all ${rightPanelTab === 'transcript' ? 'bg-white text-blue-600 shadow-sm' : 'text-white/70 hover:text-white'}`}
                    >全文</button>
                 </div>
                 <button onClick={() => setShowAdminAudit(false)} className="hover:rotate-90 transition-transform">
                   <XCircleIcon size={20} />
                 </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              {rightPanelTab === 'audit' ? (
                <AdminAuditView 
                  result={localResult} 
                  onBack={() => setShowAdminAudit(false)} 
                  isSidebar={true} 
                  externalRound={activeRound}
                  onRoundChange={setActiveRound}
                />
              ) : (
                <div className="flex-1 flex flex-col h-full relative">
                  {/* 置顶搜索栏与切换 */}
                  <div className="sticky top-0 z-20 bg-white border-b border-slate-100 shadow-sm">
                    {/* 1. 轮次切换 */}
                    {result.isDualMode && (
                      <div className="p-2 flex gap-1 bg-slate-50/50">
                        <button 
                          onClick={() => setActiveRound('round1')}
                          className={`flex-1 py-1.5 text-[10px] font-black rounded border transition-all ${activeRound === 'round1' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white text-slate-400 border-slate-200 hover:border-blue-200'}`}
                        >第一轮原文</button>
                        <button 
                          onClick={() => setActiveRound('round2')}
                          className={`flex-1 py-1.5 text-[10px] font-black rounded border transition-all ${activeRound === 'round2' ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white text-slate-400 border-slate-200 hover:border-blue-200'}`}
                        >第二轮原文</button>
                      </div>
                    )}
                    
                    {/* 2. 搜索工具栏 */}
                    <div className="p-3 flex items-center gap-2 bg-white">
                      <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                        <input 
                          type="text" 
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="搜索全文关键字..."
                          className="w-full pl-9 pr-4 py-2 bg-slate-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-blue-500 transition-all font-medium"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') jumpToMatch((currentMatchIndex + 1) % searchMatches.length);
                          }}
                        />
                      </div>
                      
                      {searchTerm && (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] font-black text-slate-400 mr-1">
                            {searchMatches.length > 0 ? `${currentMatchIndex + 1} / ${searchMatches.length}` : '0 匹配'}
                          </span>
                          <button 
                            onClick={() => jumpToMatch((currentMatchIndex - 1 + searchMatches.length) % searchMatches.length)}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                          >
                            <ChevronUp size={16} />
                          </button>
                          <button 
                            onClick={() => jumpToMatch((currentMatchIndex + 1) % searchMatches.length)}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                          >
                            <ChevronDown size={16} />
                          </button>
                          <button 
                            onClick={() => setSearchTerm('')}
                            className="p-2 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-lg transition-colors"
                          >
                            <RotateCcw size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 逐字稿内容区 - 填满并独立滚动 */}
                  <div className="flex-1 relative flex overflow-hidden h-full">
                    <div 
                      ref={transcriptRef}
                      onScroll={handleTranscriptScroll}
                      className="flex-1 overflow-y-auto p-8 font-mono text-sm leading-[1.8] text-slate-600 whitespace-pre-wrap selection:bg-blue-200 selection:text-blue-900 scroll-smooth bg-white h-full"
                    >
                       {renderHighlightedTranscript()}
                    </div>

                    {/* 右侧热力进度条 */}
                    <div className="w-2.5 bg-slate-50 border-l border-slate-100 relative shrink-0 z-10">
                      {/* 搜索结果热力图 */}
                      {searchMatches.map((pos, i) => {
                        const fullText = activeRound === 'round1' ? localResult.round1Text : (localResult.round2Text || localResult.round1Text);
                        const top = (pos / fullText.length) * 100;
                        return (
                          <div 
                            key={i}
                            className={`absolute left-0 w-full h-0.5 ${i === currentMatchIndex ? 'bg-orange-500 z-10 h-1' : 'bg-blue-400 opacity-60'}`}
                            style={{ top: `${top}%` }}
                          />
                        );
                      })}
                      
                      {/* 滚动条滑块 */}
                      <div 
                        className="absolute left-0 w-full bg-slate-300/40 rounded-full border border-slate-400/20"
                        style={{ top: `${scrollPercent}%`, height: '40px' }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      </div>
      
      <button
        onClick={() => {
          if (lastClickedId) {
            const el = document.getElementById(lastClickedId);
            if (el) {
              el.scrollIntoView({ behavior: 'auto', block: 'center' });
              setLastClickedId(null); // 回去后清空，下次点击再触发
              return;
            }
          }
          scrollToTop();
        }}
        className={`fixed bottom-10 right-10 z-50 flex items-center gap-2 bg-slate-800 hover:bg-blue-600 text-white px-5 py-3 rounded-full shadow-2xl transition-all duration-300 transform font-bold print:hidden ${
          showBackToTop ? 'translate-y-0 opacity-100' : 'translate-y-24 opacity-0 pointer-events-none'
        }`}
      >
        {lastClickedId ? <Undo2 size={20} strokeWidth={3} /> : <ArrowUp size={20} strokeWidth={3} />}
        <span>{lastClickedId ? "回到原处" : "回到顶部"}</span>
      </button>

    </div>
  );
};

export default ReportView;
