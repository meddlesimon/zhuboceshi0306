
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
  Undo2
} from 'lucide-react';

// Declare global html2pdf from the script tag
declare var html2pdf: any;

interface ReportViewProps {
  result: MultiRoundResult;
  standards: Standard[];
  metadata: StreamMetadata;
  onReset: () => void;
}

/**
 * Manual Review Input Block
 */
const ManualReviewBlock: React.FC<{
  status: 'approved' | 'rejected' | 'pending' | undefined;
  comment: string;
  onConfirm: () => void;
  onReject: () => void;
  onCommentChange: (val: string) => void;
  onResetStatus: () => void;
}> = ({ status, comment, onConfirm, onReject, onCommentChange, onResetStatus }) => {
  const isApproved = status === 'approved';
  const isRejected = status === 'rejected';

  return (
    <div className="bg-slate-50 border-t border-slate-100 p-4 mt-auto">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
           <div className="bg-slate-200 text-slate-600 p-1 rounded">
             <PenLine size={14} />
           </div>
           <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">人工手检 (Manual Review)</span>
        </div>
        
        {/* Status Label (if decided) */}
        {isApproved && (
           <span className="text-xs font-bold text-green-600 flex items-center gap-1 bg-green-50 px-2 py-1 rounded border border-green-100">
             <CheckCircle2 size={12} /> 已确认保留
           </span>
        )}
        {isRejected && (
           <span className="text-xs font-bold text-slate-500 flex items-center gap-1 bg-slate-100 px-2 py-1 rounded border border-slate-200">
             <XCircle size={12} /> 已标记误诊
           </span>
        )}
      </div>

      {/* Action Buttons */}
      {!isApproved && !isRejected && (
        <div className="flex gap-3">
          <button 
            onClick={onConfirm}
            className="flex-1 bg-white hover:bg-green-50 border border-slate-200 hover:border-green-300 text-slate-600 hover:text-green-700 py-2.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <CheckCircle2 size={16} />
            确认保留 (需填写)
          </button>
          <button 
            onClick={onReject}
            className="flex-1 bg-white hover:bg-slate-100 border border-slate-200 hover:border-slate-300 text-slate-400 hover:text-slate-600 py-2.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <XCircle size={16} />
            点击误诊 (不导出)
          </button>
        </div>
      )}

      {/* Approved State: Input Box */}
      {isApproved && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
          <textarea 
            value={comment}
            onChange={(e) => onCommentChange(e.target.value)}
            placeholder="请输入人工复核意见（必填，将显示在报告中）..."
            className="w-full text-sm p-3 rounded-lg border border-green-200 focus:border-green-400 focus:ring-2 focus:ring-green-100 outline-none h-20 resize-none bg-white text-slate-800 placeholder:text-slate-400 mb-2"
            autoFocus
          />
          <div className="flex justify-between items-center">
             <span className="text-[10px] text-green-600 font-medium">
               * 此内容将导出至 PDF
             </span>
             <button 
               onClick={onResetStatus}
               className="text-xs text-slate-400 underline hover:text-slate-600"
             >
               重新选择
             </button>
          </div>
        </div>
      )}

      {/* Rejected State: Undo Button */}
      {isRejected && (
        <div className="flex justify-end animate-in fade-in">
           <button 
             onClick={onResetStatus}
             className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded hover:bg-blue-100 transition-colors"
           >
             <Undo2 size={12} /> 撤销误诊操作
           </button>
        </div>
      )}
    </div>
  );
};

const ReportView: React.FC<ReportViewProps> = ({ result, standards, metadata, onReset }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [activeRound, setActiveRound] = useState<'round1' | 'round2'>('round1');
  const [highlightQuote, setHighlightQuote] = useState<string>('');
  const [showBackToTop, setShowBackToTop] = useState(false);
  
  // Local State for Reviews
  const [localResult, setLocalResult] = useState<MultiRoundResult>(JSON.parse(JSON.stringify(result)));

  const reportRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  // Sync props to local state if props change (re-analysis)
  useEffect(() => {
    setLocalResult(JSON.parse(JSON.stringify(result)));
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

  const currentTranscript = activeRound === 'round1' ? localResult.round1Text : localResult.round2Text || '';

  useEffect(() => {
    if (highlightQuote && transcriptRef.current) {
      setTimeout(() => {
        const highlightEl = transcriptRef.current?.querySelector('.highlight-active');
        if (highlightEl) {
          highlightEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 100);
    }
  }, [highlightQuote, activeRound]);

  const handleQuoteClick = (quote: string) => {
    if (!quote || quote.length < 2) return;
    setHighlightQuote(quote);
    if (transcriptRef.current) {
        transcriptRef.current.scrollIntoView({ behavior: 'smooth' });
    }
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
    const MOBILE_WIDTH = 390; 
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

      // --- STRICT FILTERING LOGIC ---
      const issueCards = clone.querySelectorAll('.issue-card');
      let visibleCount = 0;

      issueCards.forEach(card => {
        const el = card as HTMLElement;
        const status = el.dataset.reviewStatus; // 'approved' | 'rejected' | 'pending'

        // Rule: Only export 'approved' (Confirmed) items
        if (status !== 'approved') {
          el.remove();
          return;
        }

        visibleCount++;

        // Fix styling for card
        el.style.boxShadow = 'none';
        el.style.marginBottom = '16px';
        el.style.border = '1px solid #e2e8f0';

        // Replace Manual Review Input with Static Text
        const comment = el.dataset.comment || '';
        
        // Find the footer
        const footer = el.lastElementChild as HTMLElement;
        if (footer) {
           const staticNote = document.createElement('div');
           staticNote.className = "mt-0 p-3 bg-green-50 border-t border-green-100";
           staticNote.innerHTML = `
             <div class="flex items-center gap-1 mb-1">
               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="text-green-600"><path d="M20 6L9 17l-5-5"></path></svg>
               <span class="text-xs font-bold text-green-700">人工已确认</span>
             </div>
             <p class="text-sm text-slate-900 font-medium leading-relaxed whitespace-pre-wrap">${comment || '（无附加备注）'}</p>
           `;
           footer.replaceWith(staticNote);
        }
      });

      // 3. Inject Mobile Header
      const header = document.createElement('div');
      header.className = "mb-6 pb-4 border-b border-slate-200";
      header.innerHTML = `
        <h1 class="text-xl font-black text-slate-900 mb-2">直播质检·人工确认单</h1>
        <div class="flex justify-between items-end text-xs text-slate-500">
          <div>
            <p>主播：<span class="font-bold text-slate-900">${metadata.anchorName || '-'}</span></p>
            <p>日期：${metadata.date || new Date().toLocaleDateString()}</p>
          </div>
          <span class="bg-blue-50 text-blue-600 px-2 py-1 rounded font-bold">已确认 ${visibleCount} 项</span>
        </div>
      `;
      clone.prepend(header);

      // 4. Handle Empty State
      if (visibleCount === 0) {
        const msg = document.createElement('div');
        msg.className = "p-8 text-center border-2 border-dashed border-slate-200 rounded-xl mt-4";
        msg.innerHTML = `
          <p class="text-slate-400 font-bold mb-1">本次无人工确认的风险项</p>
          <p class="text-xs text-slate-300">请在报告页面点击“确认保留”后再导出</p>
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
    const missed = currentResult.mandatory_checks.filter(c => c.status === 'missed');
    const passed = currentResult.mandatory_checks.filter(c => c.status === 'passed');
    return { missedMandatory: missed, passedMandatory: passed };
  }, [currentResult.mandatory_checks]);

  // Match Logic
  const clean = (str: string) => str.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  const getAllIndices = (str: string, sub: string): number[] => {
    const indices: number[] = [];
    if (!sub) return indices;
    let i = -1;
    while ((i = str.indexOf(sub, i + 1)) !== -1) { indices.push(i); }
    return indices;
  };
  const mapToOriginal = (originalText: string, cleanStartIdx: number, cleanLength: number, method: string) => {
    let currentCleanIdx = 0;
    let originalStart = -1;
    let originalEnd = -1;
    for (let i = 0; i < originalText.length; i++) {
      const char = originalText[i];
      if (/[^\u4e00-\u9fa5a-zA-Z0-9]/.test(char)) { continue; }
      if (currentCleanIdx === cleanStartIdx) { originalStart = i; }
      currentCleanIdx++;
      if (currentCleanIdx === cleanStartIdx + cleanLength) { originalEnd = i + 1; break; }
    }
    if (originalStart !== -1 && originalEnd === -1) { originalEnd = originalText.length; }
    return { start: originalStart !== -1 ? originalStart : 0, end: originalEnd !== -1 ? originalEnd : 0, found: originalStart !== -1, method };
  };
  const findBestMatch = (fullText: string, quote: string): { start: number, end: number, found: boolean, method: string } => {
    if (!quote || quote.length < 2) return { start: 0, end: 0, found: false, method: 'none' };
    const cleanFull = clean(fullText);
    const cleanQuote = clean(quote);
    const len = cleanQuote.length;
    
    const exactIdx = cleanFull.indexOf(cleanQuote);
    if (exactIdx !== -1) return mapToOriginal(fullText, exactIdx, len, 'exact');
    if (len < 6) return { start: 0, end: 0, found: false, method: 'none' };

    const sampleSize = len > 12 ? 4 : 3;
    const head = cleanQuote.substring(0, sampleSize);
    const tail = cleanQuote.substring(len - sampleSize);
    const midStart = Math.floor((len - sampleSize) / 2);
    const mid = cleanQuote.substring(midStart, midStart + sampleSize);

    const heads = getAllIndices(cleanFull, head);
    const tails = getAllIndices(cleanFull, tail);
    const mids = getAllIndices(cleanFull, mid);
    const minLen = len * 0.7;
    const maxLen = len * 1.3;

    for (const h of heads) {
      for (const t of tails) {
        const dist = t - h + sampleSize; 
        if (dist > 0 && dist >= minLen && dist <= maxLen) return mapToOriginal(fullText, h, dist, 'head-tail');
      }
    }
    const headToMidLen = midStart + sampleSize; 
    for (const h of heads) {
      for (const m of mids) {
        const dist = m - h + sampleSize; 
        if (dist > 0 && dist >= headToMidLen * 0.7 && dist <= headToMidLen * 1.3) return mapToOriginal(fullText, h, len, 'head-mid'); 
      }
    }
    const midToTailLen = len - midStart;
    for (const m of mids) {
      for (const t of tails) {
        const dist = t - m + sampleSize;
        if (dist > 0 && dist >= midToTailLen * 0.7 && dist <= midToTailLen * 1.3) {
           const inferredStart = Math.max(0, t - len + sampleSize);
           return mapToOriginal(fullText, inferredStart, len, 'mid-tail');
        }
      }
    }
    if (heads.length === 1) return mapToOriginal(fullText, heads[0], len, 'anchor-head');
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

  const renderHighlightedTranscript = () => {
     if (!highlightQuote) return currentTranscript;
     const match = findBestMatch(currentTranscript, highlightQuote);
     if (!match.found) {
       return (
         <>
           <div className="absolute top-4 right-4 bg-orange-100 text-orange-700 text-xs px-3 py-1.5 rounded-full flex items-center gap-1 shadow-sm border border-orange-200 animate-pulse z-10">
             <AlertTriangle size={12} />
             定位失败
           </div>
           {currentTranscript}
         </>
       );
     }
     const { start, end, method } = match;
     const isFuzzy = method !== 'exact';
     const badgeColor = method.includes('anchor') ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700';
     const badgeText = method === 'exact' ? '精确' : '模糊';

     return (
       <>
         {isFuzzy && (
           <div className={`absolute top-4 right-4 ${badgeColor} text-xs px-2 py-1 rounded-full flex items-center gap-1 shadow-sm border z-10 opacity-75`}>
             <Search size={10} /> {badgeText}
           </div>
         )}
         {currentTranscript.substring(0, start)}
         <span id="highlight-target" className="bg-yellow-200 text-slate-900 font-bold px-1 rounded mx-0.5 border-b-2 border-yellow-400 shadow-sm highlight-active">
           {currentTranscript.substring(start, end)}
         </span>
         {currentTranscript.substring(end)}
       </>
     );
  };

  return (
    <div className="pb-24 animate-in slide-in-from-bottom-8 fade-in duration-500 bg-slate-50 min-h-screen">
      
      {/* 1. Control Header */}
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 md:py-4 shadow-sm sticky top-0 z-30 flex flex-row justify-between items-center print:hidden">
        
        <button
          onClick={onReset}
          className="border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 px-3 py-2 md:px-4 rounded-lg font-bold flex items-center gap-2 transition-all active:scale-95 text-xs md:text-sm shadow-sm"
        >
          <RotateCcw size={16} />
          <span>新一轮</span>
        </button>
        
        <div className="flex gap-2">
            <button 
              onClick={handleExportChecklist}
              className="bg-green-600 hover:bg-green-700 text-white px-3 py-2 md:px-4 rounded-lg font-bold flex items-center gap-2 shadow-lg transition-all active:scale-95 text-xs md:text-sm"
            >
              <FileSpreadsheet size={16} />
              <span>导出已确认清单</span>
            </button>

            <button 
              onClick={handleExportPDF}
              disabled={isExporting}
              className={`bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 md:px-4 rounded-lg font-bold flex items-center gap-2 shadow-lg transition-all active:scale-95 text-xs md:text-sm ${isExporting ? 'opacity-75 cursor-wait' : ''}`}
            >
              {isExporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              <span>导出 PDF (仅已确认)</span>
            </button>
        </div>
      </div>
      
      {/* 2. Round Switcher */}
      {result.isDualMode && (
        <div className="bg-white p-2 flex justify-center border-b border-slate-100 sticky top-[60px] z-20 print:hidden">
           <div className="bg-slate-100 p-1 rounded-xl flex w-full max-w-sm">
             <button 
               onClick={() => { setActiveRound('round1'); setHighlightQuote(''); }}
               className={`flex-1 py-2 text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${activeRound === 'round1' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
             >
               第一轮质检
             </button>
             <button 
               onClick={() => { setActiveRound('round2'); setHighlightQuote(''); }}
               className={`flex-1 py-2 text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${activeRound === 'round2' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:text-slate-700'}`}
             >
               第二轮质检
             </button>
           </div>
        </div>
      )}

      {/* 3. Printable Content Area */}
      <div id="report-content" ref={reportRef} className="bg-white max-w-3xl mx-auto p-8 md:p-12 min-h-screen">
        
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
                    <p className="text-xs text-slate-400 font-bold uppercase">主播</p>
                    <p className="font-bold text-slate-800 text-lg">{metadata.anchorName || '未命名'}</p>
                 </div>
              </div>
           </div>
        </div>

        <div className="space-y-12 animate-in fade-in duration-300" key={activeRound}>
          {/* SECTION 1: MANDATORY */}
          <div>
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
                          <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${isRejected ? 'text-slate-400' : 'text-orange-400'}`}>缺失内容</p>
                          <h4 className="text-lg font-black text-slate-800 leading-snug whitespace-pre-wrap break-words">
                            {check.standard}
                          </h4>
                        </div>

                        <div className={`rounded-xl p-4 border relative ${isRejected ? 'bg-slate-50 border-slate-200' : 'bg-orange-50 border-orange-100'}`}>
                          <p className={`text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-1 ${isRejected ? 'text-slate-500' : 'text-orange-600'}`}>
                             <Sparkles size={12} /> 补充建议
                          </p>
                          <p className="text-sm font-medium text-slate-800 leading-relaxed">
                            {check.comment}
                          </p>
                        </div>

                        {check.detected_content && check.detected_content.length > 2 && (
                          <div className="pt-2">
                            <button 
                               onClick={() => handleQuoteClick(check.detected_content!)}
                               className="text-left group flex flex-col gap-2 w-full"
                            >
                               <div className="flex items-center gap-2">
                                 <div className={`p-1 rounded-full ${isRejected ? 'bg-slate-100 text-slate-400' : 'bg-orange-50 text-orange-400'}`}>
                                    <Search size={12} />
                                 </div>
                                 <span className={`text-xs font-bold block ${isRejected ? 'text-slate-500' : 'text-orange-700'}`}>定位当时语境 (相关话题)：</span>
                               </div>
                               
                               <span className={`text-xs block italic leading-relaxed p-2 rounded border ${isRejected ? 'text-slate-400 bg-slate-50 border-slate-100' : 'text-orange-600 bg-white/50 border-orange-100/50'}`}>
                                 "{check.detected_content}"
                               </span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* NEW MODULE: MANUAL REVIEW */}
                      <ManualReviewBlock 
                        status={check.reviewStatus}
                        comment={check.operatorComment || ''}
                        onConfirm={() => updateReviewStatus('mandatory', sourceIndex, 'approved')}
                        onReject={() => updateReviewStatus('mandatory', sourceIndex, 'rejected')}
                        onCommentChange={(val) => updateReviewStatus('mandatory', sourceIndex, 'approved', val)}
                        onResetStatus={() => updateReviewStatus('mandatory', sourceIndex, 'pending', '')}
                      />
                    </div>
                  );
                })}
              </div>
            )}

             {/* Passed Items */}
             <div id="mandatory-passed-section" className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden break-inside-avoid">
              <div className="bg-slate-100 px-5 py-2 border-b border-slate-200">
                 <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
                   <ThumbsUp size={14} className="text-blue-600"/>
                   已达标 ({passedMandatory.length})
                 </h4>
              </div>
              {passedMandatory.length === 0 ? (
                <div className="p-4 text-center text-slate-400 text-xs">无达标项</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {passedMandatory.map((check, idx) => (
                    <div key={idx} className="px-5 py-3 flex items-start gap-3">
                      <div className="mt-0.5 text-blue-500 shrink-0">
                        <Check size={14} strokeWidth={3} />
                      </div>
                      <div className="flex-1">
                        <span className="text-sm text-slate-700 font-bold block">{check.standard}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* SECTION 2: FORBIDDEN */}
          <div>
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
                          <p className={`text-xs font-bold uppercase tracking-wider mb-1 ${isRejected ? 'text-slate-400' : 'text-red-400'}`}>触犯规则</p>
                          <h4 className="text-lg font-black text-slate-800 leading-snug whitespace-pre-wrap break-words">
                            {issue.standard}
                          </h4>
                        </div>

                        <div className={`rounded-xl p-4 border ${isRejected ? 'bg-slate-50 border-slate-200' : 'bg-red-50 border-red-100'}`}>
                          <p className={`text-xs font-bold uppercase tracking-wider mb-2 ${isRejected ? 'text-slate-400' : 'text-red-400'}`}>主播原话</p>
                          <button 
                               onClick={() => handleQuoteClick(issue.detected_content)}
                               className="text-left w-full group"
                          >
                            <p className={`text-base font-medium leading-relaxed italic transition-colors ${isRejected ? 'text-slate-500' : 'text-slate-800 group-hover:text-red-600'}`}>
                              “{issue.detected_content}”
                              <span className={`inline-flex items-center ml-2 text-[10px] border px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity ${isRejected ? 'hidden' : 'bg-white border-red-200 text-red-600'}`}>
                                   <ArrowDownCircle size={10} className="mr-0.5" /> 定位上下文
                              </span>
                            </p>
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-4 pt-2">
                          <div className="space-y-1">
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">错误原因</p>
                            <p className="text-sm text-slate-600 font-medium leading-relaxed">
                              {issue.reason}
                            </p>
                          </div>
                          <div className={`rounded-xl p-3 border ${isRejected ? 'bg-slate-50 border-slate-200' : 'bg-green-50 border-green-100'}`}>
                            <p className={`text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-1 ${isRejected ? 'text-slate-500' : 'text-green-600'}`}>
                               <Sparkles size={12} /> 建议调整
                            </p>
                            <p className={`text-sm font-bold leading-relaxed ${isRejected ? 'text-slate-600' : 'text-green-800'}`}>
                              {issue.suggestion}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* NEW MODULE: MANUAL REVIEW */}
                      <ManualReviewBlock 
                        status={issue.reviewStatus}
                        comment={issue.operatorComment || ''}
                        onConfirm={() => updateReviewStatus('forbidden', sourceIndex, 'approved')}
                        onReject={() => updateReviewStatus('forbidden', sourceIndex, 'rejected')}
                        onCommentChange={(val) => updateReviewStatus('forbidden', sourceIndex, 'approved', val)}
                        onResetStatus={() => updateReviewStatus('forbidden', sourceIndex, 'pending', '')}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            <div id="forbidden-passed-section" className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden break-inside-avoid">
              <div className="bg-slate-100 px-5 py-2 border-b border-slate-200">
                 <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-2">
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
        
        <div id="transcript-section" className="mt-16 pt-10 border-t-4 border-slate-200 animate-in fade-in duration-700">
          <div className="flex items-center gap-2 mb-6">
            <div className="bg-slate-200 p-2 rounded-lg text-slate-700">
               <FileText size={20} />
            </div>
            <div>
               <h3 className="text-xl font-black text-slate-900">逐字稿复盘</h3>
               <p className="text-sm text-slate-500">
                 {highlightQuote 
                   ? "已定位至选中原话，背景高亮显示" 
                   : "点击上方报告中的“主播原话”可快速定位"}
               </p>
            </div>
          </div>
          <div ref={transcriptRef} className="bg-slate-50 rounded-xl p-6 md:p-8 font-mono text-sm leading-loose text-slate-600 border border-slate-200 whitespace-pre-wrap relative">
             {renderHighlightedTranscript()}
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-100 text-center text-slate-400 text-xs font-mono">
          StreamScript QA 智能质检 • {new Date().toLocaleDateString()}
        </div>
      </div>
      
      <button
        onClick={scrollToTop}
        className={`fixed bottom-10 right-10 z-50 flex items-center gap-2 bg-slate-800 hover:bg-blue-600 text-white px-5 py-3 rounded-full shadow-2xl transition-all duration-300 transform font-bold print:hidden ${
          showBackToTop ? 'translate-y-0 opacity-100' : 'translate-y-24 opacity-0 pointer-events-none'
        }`}
      >
        <ArrowUp size={20} strokeWidth={3} />
        <span>回到顶部</span>
      </button>

    </div>
  );
};

export default ReportView;
