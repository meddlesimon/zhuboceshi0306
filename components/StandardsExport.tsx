
import React, { useRef, useState } from 'react';
import { Standard } from '../types';
import { Loader2, Share2, Info, AlertOctagon, ListChecks, Quote, Target, Ban, CheckCircle2, CalendarClock } from 'lucide-react';

// Declare global html2pdf
declare var html2pdf: any;

interface StandardsExportProps {
  standards: Standard[];
  fileName?: string;
}

const StandardsExport: React.FC<StandardsExportProps> = ({ standards, fileName }) => {
  const [isExporting, setIsExporting] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // LOGIC CHANGE: 
  // 1. Filter only items marked as "High" (今日/Today)
  // 2. Reverse so latest are at top
  const todayStandards = standards.filter(s => s.importance === 'high');
  const mandatory = todayStandards.filter(s => s.type === 'mandatory').reverse();
  const forbidden = todayStandards.filter(s => s.type === 'forbidden').reverse();

  // Count hidden "daily" items for the footer note
  const dailyCount = standards.length - todayStandards.length;

  const handleExport = async () => {
    if (!cardRef.current) return;
    if (typeof html2pdf === 'undefined') {
      alert('导出组件正在加载，请稍候...');
      return;
    }

    setIsExporting(true);
    const element = cardRef.current;

    try {
      // 1. SETUP: Use exact width of the preview container (480px) for consistency
      const TARGET_WIDTH = 480; 
      // Padding similar to p-6 (24px) or p-8 (32px)
      const CONTENT_PADDING = 32;

      // 2. CLONE: Create a clean clone for rendering
      const clone = element.cloneNode(true) as HTMLElement;
      
      // 3. STYLE: Apply strict layout styles to the clone
      // Force the width to match the target exactly
      clone.style.width = `${TARGET_WIDTH}px`;
      clone.style.minWidth = `${TARGET_WIDTH}px`;
      clone.style.maxWidth = `${TARGET_WIDTH}px`;
      
      // Box model settings
      clone.style.boxSizing = 'border-box';
      clone.style.padding = `${CONTENT_PADDING}px`;
      // Reset margins
      clone.style.margin = '0';
      clone.style.marginLeft = '0';
      clone.style.marginRight = '0';
      
      // Reset height/overflow to ensure full capture
      clone.style.height = 'auto';
      clone.style.minHeight = 'auto';
      clone.style.overflow = 'visible';
      
      // Background must be white
      clone.style.backgroundColor = '#ffffff';

      // Position off-screen but strictly top-left to avoid capture offsets
      clone.style.position = 'fixed'; 
      clone.style.top = '0';
      clone.style.left = '0';
      clone.style.zIndex = '-9999';

      // Clean up styling classes that might interfere (remove shadows, rounded corners for the "print" version if desired, or keep them inside)
      // We remove external positioning/shadow classes but keep internal structure
      clone.classList.remove('shadow-sm', 'rounded-xl', 'md:p-8', 'p-6', 'w-full', 'max-w-[480px]'); 
      
      // Append to body to render
      document.body.appendChild(clone);
      
      // Wait for DOM to paint and images/fonts to settle
      await new Promise(resolve => setTimeout(resolve, 800));

      // 4. MEASURE
      const contentHeight = clone.scrollHeight;
      const dateStr = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');

      // 5. CONFIG
      const opt = {
        margin: 0,
        filename: `主播上播前确认单_${dateStr}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 3, // High scale for crisp text on mobile
          width: TARGET_WIDTH,
          height: contentHeight,
          windowWidth: TARGET_WIDTH,
          scrollY: 0,
          scrollX: 0,
          x: 0,
          y: 0,
          useCORS: true,
          logging: false
        },
        jsPDF: {
          unit: 'px',
          format: [TARGET_WIDTH, contentHeight], // Single long page
          orientation: 'portrait',
          hotfixes: ['px_scaling']
        }
      };

      await html2pdf().set(opt).from(clone).save();
      
      // Cleanup
      document.body.removeChild(clone);

    } catch (error) {
      console.error(error);
      alert('导出失败，请重试');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-2 text-slate-600">
           <Info size={16} />
           <span className="text-xs font-medium">生成上播前确认单</span>
        </div>
        <button
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-2 bg-slate-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-slate-800 transition-all active:scale-95 shadow-md"
        >
          {isExporting ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
          {isExporting ? '处理中...' : '导出仅含“今日”的长图'}
        </button>
      </div>

      {/* Preview Container */}
      <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-100 p-2 md:p-6 flex justify-center">
        
        {/* === THE CARD TO EXPORT === */}
        {/* NOTE: We set a fixed max-width here which matches TARGET_WIDTH in export logic */}
        <div 
          ref={cardRef} 
          className="bg-white w-full max-w-[600px] shadow-sm rounded-xl p-6 md:p-8 text-slate-900 relative"
        >
          {/* Header Section */}
          <div className="border-b-4 border-slate-900 pb-5 mb-6">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none mb-2">今日直播上播前确认单</h2>
            <div className="flex justify-between items-end">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">PRE-STREAM CHECKLIST</span>
              <span className="text-xs font-mono font-bold bg-slate-100 px-2 py-1 rounded text-slate-600">{new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</span>
            </div>
          </div>

          {/* Top Briefing */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-8">
            <h3 className="text-sm font-black text-slate-800 flex items-center gap-2 mb-3">
              <ListChecks size={18} />
              <span>本场关键要求</span>
            </h3>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                 <div className="w-5 h-5 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-[10px] font-bold mt-0.5">1</div>
                 <p className="text-xs text-slate-600 font-medium leading-relaxed">请优先落实下列<span className="font-bold text-slate-900">“今日”</span>新增/重点事项</p>
              </div>
               <div className="flex items-start gap-2">
                 <div className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold mt-0.5">2</div>
                 <p className="text-xs text-slate-600 font-medium leading-relaxed">系统将在播后对<span className="font-bold text-slate-900">今日重点+日常规范</span>进行全量质检</p>
              </div>
            </div>
          </div>

          {/* SECTION 1: MANDATORY (Green) */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-100">
              <div className="bg-green-600 text-white p-1.5 rounded-lg shadow-sm">
                <CheckCircle2 size={18} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800 leading-none">一定要讲 (Must Say)</h3>
                <p className="text-[10px] text-slate-400 mt-1 font-medium">请务必覆盖以下“今日”重点</p>
              </div>
            </div>
            
            {mandatory.length === 0 ? (
              <div className="text-center py-4 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                <p className="text-sm text-slate-400 italic">今日无新增/重点强制要求</p>
              </div>
            ) : (
              <div className="space-y-4">
                {mandatory.map((item, idx) => (
                  <div key={item.id} className="bg-green-50/50 rounded-xl border border-green-100 overflow-hidden">
                    {/* Header: Index & QA Focus */}
                    <div className="bg-green-100/50 px-3 py-2 border-b border-green-100 flex items-start gap-2">
                       <span className="bg-green-600 text-white text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5">{(idx + 1)}</span>
                       <div className="flex-1">
                          <div className="flex items-center gap-1 text-[10px] text-green-600 uppercase font-bold tracking-wider mb-0.5">
                             <Target size={10} /> 质检重点
                          </div>
                          <p className="text-sm font-black text-slate-900 leading-tight">{item.qaFocus}</p>
                       </div>
                    </div>
                    
                    {/* Body: Standard Script */}
                    <div className="p-3 bg-white">
                       <div className="flex items-start gap-2">
                          <Quote size={12} className="text-slate-300 mt-1 shrink-0" />
                          <div className="flex-1">
                             <p className="text-[10px] text-slate-400 font-bold mb-1">标准话术参考：</p>
                             <p className="text-sm text-slate-600 font-medium leading-relaxed italic border-l-2 border-slate-200 pl-2">
                               {item.content}
                             </p>
                          </div>
                       </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SECTION 2: FORBIDDEN (Red) */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-100">
              <div className="bg-red-600 text-white p-1.5 rounded-lg shadow-sm">
                <AlertOctagon size={18} strokeWidth={2.5} />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-800 leading-none">一定不能讲 (Forbidden)</h3>
                <p className="text-[10px] text-slate-400 mt-1 font-medium">严禁触犯以下“今日”红线</p>
              </div>
            </div>

            {forbidden.length === 0 ? (
              <div className="text-center py-4 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                <p className="text-sm text-slate-400 italic">今日无新增/重点禁忌</p>
              </div>
            ) : (
              <div className="space-y-4">
                {forbidden.map((item, idx) => (
                  <div key={item.id} className="bg-red-50/50 rounded-xl border border-red-100 overflow-hidden">
                    {/* Header: Index & QA Focus */}
                    <div className="bg-red-100/50 px-3 py-2 border-b border-red-100 flex items-start gap-2">
                       <span className="bg-red-600 text-white text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5">{(idx + 1)}</span>
                       <div className="flex-1">
                          <div className="flex items-center gap-1 text-[10px] text-red-400 uppercase font-bold tracking-wider mb-0.5">
                             <Target size={10} /> 质检重点 (红线)
                          </div>
                          <p className="text-sm font-black text-slate-900 leading-tight">{item.qaFocus}</p>
                       </div>
                    </div>
                    
                    {/* Body: Standard Script (What not to say, or details) */}
                    <div className="p-3 bg-white">
                       <div className="flex items-start gap-2">
                          <Ban size={12} className="text-red-300 mt-1 shrink-0" />
                          <div className="flex-1">
                             <p className="text-[10px] text-slate-400 font-bold mb-1">相关话术/场景：</p>
                             <p className="text-sm text-slate-600 font-medium leading-relaxed border-l-2 border-red-100 pl-2">
                               {item.content}
                             </p>
                          </div>
                       </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-10 pt-6 border-t-2 border-slate-100 text-center">
            {dailyCount > 0 && (
              <div className="mb-3 inline-flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-full text-[10px] text-slate-500 font-bold">
                 <CalendarClock size={12} />
                 另有 {dailyCount} 条“日常规范”不在此表中，但也需执行
              </div>
            )}
            <p className="text-xs text-slate-900 font-black tracking-widest uppercase">StreamScript QA</p>
            <p className="text-[10px] text-slate-400 font-mono mt-1">AI 智能质检系统生成</p>
          </div>

        </div>
      </div>
    </div>
  );
};

export default StandardsExport;
