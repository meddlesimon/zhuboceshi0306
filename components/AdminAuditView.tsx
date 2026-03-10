import React, { useState, useMemo, useEffect, useRef } from 'react';
import { MultiRoundResult } from '../types';
import { 
  ArrowLeft, 
  Search, 
  CheckCircle2, 
  XCircle, 
  Info, 
  Layout, 
  FileText,
  Activity,
  ChevronDown,
  ChevronUp,
  Split
} from 'lucide-react';

interface AdminAuditViewProps {
  result: MultiRoundResult;
  onBack: () => void;
  isSidebar?: boolean; // 新增：是否作为侧边栏模式
  externalRound?: 'round1' | 'round2'; // 新增：外部同步轮次
  onRoundChange?: (round: 'round1' | 'round2') => void; // 新增：回调
}

// 内部小组件：长卡片展示锚点
const AnchorCard: React.FC<{ 
  title: string, 
  phrase: string, 
  pos?: number, 
  desc: string, 
  isCore?: boolean, 
  isSidebar?: boolean,
  onClick?: () => void
}> = ({ title, phrase, pos, desc, isCore = false, isSidebar = false, onClick }) => (
  <div 
    onClick={onClick}
    className={`bg-white rounded-2xl border-2 transition-all shadow-sm cursor-pointer hover:scale-[1.01] active:scale-[0.99] ${isSidebar ? 'p-5' : 'p-8'} ${isCore ? 'border-indigo-500 ring-4 ring-indigo-50' : 'border-slate-200'} hover:border-indigo-300`}
  >
    <div className="flex justify-between items-start mb-3">
      <div className="flex items-center gap-2">
        <p className={`text-[10px] font-black uppercase tracking-widest ${isCore ? 'text-indigo-600' : 'text-slate-400'}`}>{title}</p>
        <span className="bg-indigo-100 text-indigo-600 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase">点击定位</span>
      </div>
      {pos !== undefined && pos !== -1 && (
        <span className="bg-slate-900 text-white text-[9px] font-mono px-2 py-0.5 rounded-full">
          字符坐标: {pos}
        </span>
      )}
    </div>
    <div className={`rounded-2xl mb-4 font-bold leading-relaxed italic ${isSidebar ? 'p-4 text-base' : 'p-6 text-xl'} ${isCore ? 'bg-indigo-50 text-indigo-900' : 'bg-slate-50 text-slate-700'}`}>
      “{phrase}”
    </div>
    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400">
      <Info size={14} />
      <span>{desc}</span>
    </div>
  </div>
);

// 新增：带有高亮功能的全文显示组件
const FullTextWithHighlight: React.FC<{ 
  text: string, 
  highlightRange?: { start: number, end: number },
  highlightId?: string 
}> = ({ text, highlightRange, highlightId }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (highlightRange && containerRef.current) {
      const highlightElement = containerRef.current.querySelector(`[data-highlight-id="${highlightId}"]`);
      if (highlightElement) {
        highlightElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [highlightRange, highlightId]);

  if (!text) return null;

  if (!highlightRange || highlightRange.start === -1) {
    return (
      <div className="bg-white rounded-2xl p-8 border-2 border-slate-200 text-slate-700 leading-loose whitespace-pre-wrap font-medium">
        {text}
      </div>
    );
  }

  const before = text.substring(0, highlightRange.start);
  const highlighted = text.substring(highlightRange.start, highlightRange.end);
  const after = text.substring(highlightRange.end);

  return (
    <div ref={containerRef} className="bg-white rounded-2xl p-8 border-2 border-slate-200 text-slate-700 leading-loose whitespace-pre-wrap font-medium relative">
      {before}
      <span 
        data-highlight-id={highlightId}
        className="bg-yellow-300 text-slate-900 px-1 rounded shadow-sm font-black transition-all duration-500 animate-pulse ring-2 ring-yellow-400"
      >
        {highlighted}
      </span>
      {after}
    </div>
  );
};

const AdminAuditView: React.FC<AdminAuditViewProps> = ({ 
  result, 
  onBack, 
  isSidebar = false,
  externalRound,
  onRoundChange
}) => {
  const [internalRound, setInternalRound] = useState<'round1' | 'round2'>('round1');
  
  // 核心：优先使用外部传入的轮次，否则使用内部状态
  const activeRound = externalRound || internalRound;
  const handleRoundChange = onRoundChange || setInternalRound;

  const [filter, setFilter] = useState<'all' | 'passed' | 'missed'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const activeItemRef = useRef<HTMLDivElement | null>(null);

  // 1. 管理哪些 6000 字视窗是展开的 (默认全部收缩)
  const [expandedSnippetIds, setExpandedSnippetIds] = useState<Set<string>>(new Set());

  // 2. 滚动锚定逻辑：在展开/收起后保持视线不变
  const [scrollLock, setScrollLock] = useState<{ id: string, top: number } | null>(null);

  const handleToggleExpand = (id: string, e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setScrollLock({ id, top: rect.top }); // 记录点击时元素的位置
    setExpandedId(expandedId === id ? null : id);
  };

  useEffect(() => {
    if (scrollLock && activeItemRef.current && scrollContainerRef.current) {
      const newRect = activeItemRef.current.getBoundingClientRect();
      const diff = newRect.top - scrollLock.top;
      scrollContainerRef.current.scrollTop += diff; // 修正滚动差值，实现“视觉中心不动”
      setScrollLock(null);
    }
  }, [expandedId]);

  const toggleSnippet = (id: string) => {
    setExpandedSnippetIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // 3. 智能定位：自动展开并跳转
  const scrollToHit = (checkId: string) => {
    if (!expandedSnippetIds.has(checkId)) {
      toggleSnippet(checkId);
    }
    
    // 给一点渲染时间等视窗打开
    setTimeout(() => {
      const hitEl = document.getElementById(`hit-mark-${checkId}`);
      if (hitEl) {
        hitEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // 增加一个闪烁动画效果
        hitEl.classList.add('animate-pulse', 'ring-4', 'ring-yellow-400');
        setTimeout(() => hitEl.classList.remove('animate-pulse', 'ring-4', 'ring-yellow-400'), 2000);
      }
    }, 150);
  };

  // 新增：高亮定位状态
  const [activeHighlight, setActiveHighlight] = useState<{ start: number, end: number, id: string } | undefined>();

  const handleAnchorClick = (phrase: string, pos?: number) => {
    if (pos === undefined || pos === -1) return;
    setActiveHighlight({
      start: pos,
      end: pos + phrase.length,
      id: `anchor-${pos}`
    });
  };

  // --- 自动滚动逻辑：仅在首次进入时或切换轮次时尝试定位 ---
  useEffect(() => {
    // 切换轮次时清除高亮
    setActiveHighlight(undefined);
  }, [activeRound]);

  // --- 超强防御：如果 result 为空，直接显示错误占位符 ---
  if (!result) {
    return (
      <div className="p-20 text-center">
        <p className="text-red-500 font-bold">数据加载异常，请尝试刷新页面。</p>
        <button onClick={onBack} className="mt-4 text-blue-600 underline">返回报告</button>
      </div>
    );
  }

  // 安全提取当前轮次数据
  const currentChecks = useMemo(() => {
    try {
      const roundData = activeRound === 'round1' ? result.round1 : (result.round2 || result.round1);
      if (!roundData || !Array.isArray(roundData.mandatory_checks)) return [];
      return roundData.mandatory_checks;
    } catch (e) {
      console.error("AdminAuditView: Failed to extract currentChecks", e);
      return [];
    }
  }, [result, activeRound]);

  // 安全过滤
  const filteredChecks = useMemo(() => {
    return currentChecks.filter(c => {
      if (!c) return false;
      if (filter === 'all') return true;
      return c.status === filter;
    });
  }, [currentChecks, filter]);

  // 计算统计
  const missedCount = currentChecks.filter(c => c?.status === 'missed').length;
  const passedCount = currentChecks.filter(c => c?.status === 'passed').length;

  return (
    <div ref={scrollContainerRef} className={`${isSidebar ? 'bg-white h-full overflow-y-auto' : 'bg-slate-50 min-h-screen'} pb-20 custom-scrollbar`}>
      {/* Header - 只有非侧边栏模式才显示 */}
      {!isSidebar && (
        <div className="bg-white border-b border-slate-200 sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-4">
            <button 
              onClick={onBack}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600"
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-xl font-black text-slate-900">质检案发现场复盘 (Admin)</h1>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">诊断 AI 匹配逻辑与文本定位</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {result.isDualMode && (
              <div className="bg-slate-100 p-1 rounded-lg flex">
                <button 
                  onClick={() => handleRoundChange('round1')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${activeRound === 'round1' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}
                >
                  第一轮
                </button>
                <button 
                  onClick={() => handleRoundChange('round2')}
                  className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${activeRound === 'round2' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500'}`}
                >
                  第二轮
                </button>
              </div>
            )}

            <select 
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="all">显示全部 ({currentChecks.length})</option>
              <option value="missed">只看漏讲 ({missedCount})</option>
              <option value="passed">只看达标 ({passedCount})</option>
            </select>
          </div>
        </div>
      )}

      {/* 侧边栏模式下的精简筛选器 */}
      {isSidebar && (
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
           <div className="flex gap-2">
             <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">筛选器</span>
             {result.isDualMode && (
               <button onClick={() => handleRoundChange(activeRound === 'round1' ? 'round2' : 'round1')} className="text-[10px] text-blue-600 font-bold underline">
                 切换到{activeRound === 'round1' ? '第二轮' : '第一轮'}
               </button>
             )}
           </div>
           <select 
             value={filter} 
             onChange={(e) => setFilter(e.target.value as any)}
             className="text-[10px] font-bold bg-white border border-slate-200 rounded p-1"
           >
             <option value="all">全部</option>
             <option value="missed">漏讲 ({missedCount})</option>
             <option value="passed">达标 ({passedCount})</option>
           </select>
        </div>
      )}

      <div className={`${isSidebar ? 'px-3 py-4' : 'max-w-6xl mx-auto px-6 py-8'}`}>
        <div className="space-y-6">
          {filteredChecks.length === 0 ? (
            <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-20 text-center">
              <Layout size={48} className="mx-auto text-slate-200 mb-4" />
              <p className="text-slate-400 font-bold">
                {currentChecks.length === 0 ? "暂无数据 (可能未解析到质检项)" : "没有符合筛选条件的记录"}
              </p>
            </div>
          ) : (
            filteredChecks.map((check, idx) => {
              if (!check) return null;
              
              const checkId = `${activeRound}-${idx}`;
              const isExpanded = expandedId === checkId;
              const isSnippetExpanded = expandedSnippetIds.has(checkId);
              const isPassed = check.status === 'passed';

              return (
                <div 
                  key={checkId} 
                  ref={isExpanded ? activeItemRef : null}
                  id={checkId} // 添加 ID 方便从报告跳转
                  className={`bg-white rounded-2xl border-2 shadow-sm transition-all overflow-hidden ${isPassed ? 'border-blue-100' : 'border-orange-100'}`}
                >
                  <div 
                    onClick={(e) => handleToggleExpand(checkId, e)}
                    className="p-5 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <div className={`p-2 rounded-xl ${isPassed ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
                        {isPassed ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded border ${isPassed ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-orange-50 border-orange-200 text-orange-600'}`}>
                            {check.status === 'passed' ? 'PASSED' : 'MISSED'}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">Position: {check.cursorPos ?? 'N/A'}</span>
                        </div>
                        <h3 className="text-lg font-black text-slate-800">{check.standard || "（未知规则）"}</h3>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4">
                      {isExpanded ? <ChevronUp size={20} className="text-slate-400" /> : <ChevronDown size={20} className="text-slate-400" />}
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-slate-100 p-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-6">
                          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                            <h4 className="flex items-center gap-2 text-sm font-black text-slate-900 mb-4 border-b border-slate-200 pb-2">
                              <Info size={16} className="text-blue-500" />
                              板块 A: 投喂给 AI 的指令 (The Input)
                            </h4>
                            <div className="space-y-4">
                              <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">质检重点 (QA Focus)</p>
                                <p className="text-sm font-bold text-slate-800">{check.standard}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">标准话术 (Standard Content)</p>
                                <div className="bg-white rounded-xl p-3 border border-slate-200 text-sm text-slate-600 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
                                  {check.standardContent || "（未保存原始标准）"}
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100">
                            <h4 className="flex items-center gap-2 text-sm font-black text-slate-900 mb-4 border-b border-slate-200 pb-2">
                              <Activity size={16} className="text-indigo-500" />
                              板块 C: 算法执行诊断 (The Diagnostics)
                            </h4>
                            <div className="space-y-4">
                              <div className="grid grid-cols-3 gap-3">
                                <div className="bg-white p-2 rounded-lg border border-slate-200">
                                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">理论占比</p>
                                  <p className="text-sm font-black text-indigo-600">{check.theoreticalPercent || 'N/A'}</p>
                                </div>
                                <div className="bg-white p-2 rounded-lg border border-slate-200">
                                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">搜索范围</p>
                                  <p className="text-sm font-black text-slate-700">{check.searchRange || 'N/A'}</p>
                                </div>
                                <div className="bg-white p-2 rounded-lg border border-slate-200">
                                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">匹配轮次</p>
                                  <p className="text-sm font-black text-orange-600">{check.searchRound || 'N/A'}</p>
                                </div>
                              </div>
                              <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">AI 原始回复 (Raw JSON)</p>
                                <pre className="bg-slate-900 text-green-400 rounded-xl p-3 text-[11px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                                  {check.aiRawResponse ? (() => {
                                    try {
                                      const raw = check.aiRawResponse;
                                      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                                      return JSON.stringify(parsed, null, 2);
                                    } catch(e) {
                                      return String(check.aiRawResponse);
                                    }
                                  })() : "（无记录）"}
                                </pre>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col h-full">
                          <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 flex-1 flex flex-col">
                            <h4 className="flex items-center gap-2 text-sm font-black text-slate-900 mb-4 border-b border-slate-200 pb-2">
                              <FileText size={16} className="text-orange-500" />
                              板块 B: AI 检索的直播视野 (The Context)
                            </h4>
                            
                            {/* 1. 定位命中片段 - 挪到最上面 */}
                            {isPassed && check.detected_content ? (
                              <div 
                                onClick={() => scrollToHit(checkId)}
                                className="mb-4 p-4 bg-blue-600 border border-blue-400 rounded-xl shadow-md cursor-pointer hover:bg-blue-700 transition-colors group relative"
                              >
                                <div className="absolute top-2 right-2 bg-blue-500 text-[9px] text-white px-1.5 py-0.5 rounded flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <Activity size={10} /> 点击定位
                                </div>
                                <p className="text-xs font-bold text-white mb-2 flex items-center gap-1 opacity-90">
                                  <Search size={14} /> 定位命中片段 (AI 找到的证据):
                                </p>
                                <p className="text-base font-black text-white leading-relaxed italic">“{check.detected_content}”</p>
                              </div>
                            ) : (
                               !isPassed && (
                                 <div className="mb-4 p-3 bg-orange-100 border border-orange-200 rounded-lg text-orange-700 text-xs font-bold">
                                   未检测到匹配片段，请核对下方原始文本
                                 </div>
                               )
                            )}

                            {/* 2. 6000字视野切片 - 增加折叠逻辑 */}
                            <div 
                              onClick={() => toggleSnippet(checkId)}
                              className="flex items-center justify-between mb-2 cursor-pointer hover:text-blue-600 group"
                            >
                               <p className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 group-hover:text-blue-500 transition-colors">
                                 6000字视野切片 (当时传给 AI 的完整文本)
                                 {isSnippetExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                               </p>
                               <span className="text-[10px] text-slate-300 font-bold">{isSnippetExpanded ? '点击收起' : '点击展开全文视野'}</span>
                            </div>
                            
                            {isSnippetExpanded ? (
                              <div className="bg-white rounded-xl p-4 border border-slate-200 text-sm font-mono leading-loose text-slate-600 flex-1 overflow-y-auto min-h-[400px] whitespace-pre-wrap relative custom-scrollbar shadow-inner animate-in fade-in slide-in-from-top-2 duration-200">
                                {(() => {
                                  const fullText = check.windowSnippet || '';
                                  const highlight = check.detected_content || '';
                                  
                                  if (!highlight || highlight.length < 5) return fullText || "（无视野文本记录）";

                                  // 将文本按命中片段拆分并进行高亮处理
                                  const parts = fullText.split(highlight);
                                  if (parts.length === 1) return fullText;

                                  return parts.map((part, i) => (
                                    <React.Fragment key={i}>
                                      {part}
                                      {i < parts.length - 1 && (
                                        <mark id={`hit-mark-${checkId}`} className="bg-yellow-200 text-yellow-900 px-1 rounded font-black border-b-2 border-yellow-400 shadow-sm scroll-mt-20">
                                          {highlight}
                                        </mark>
                                      )}
                                    </React.Fragment>
                                  ));
                                })()}
                              </div>
                            ) : (
                              <div 
                                onClick={() => toggleSnippet(checkId)}
                                className="bg-slate-50 rounded-xl p-6 border-2 border-dashed border-slate-200 text-center cursor-pointer hover:bg-slate-100 transition-all group"
                              >
                                <FileText size={24} className="mx-auto text-slate-300 mb-2 group-hover:text-blue-400 group-hover:scale-110 transition-transform" />
                                <p className="text-xs text-slate-400 font-bold">视野文本已收起</p>
                                <p className="text-[10px] text-slate-300 mt-1">点击查看 AI 诊断时参考的 6000 字原文切片</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* --- 重点：底部“切割锚点”核对专区 --- */}
      {result.splitAnchors && (
        <div id="split-anchors-focus" className={`mt-10 space-y-6 border-t-2 border-dashed border-slate-200 pt-10 ${isSidebar ? 'px-4' : 'max-w-6xl mx-auto px-6'}`}>
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg">
              <Split size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">双轮切割定位核对 (精准坐标)</h2>
              <p className="text-[10px] text-slate-500">全文总长度: {result.fullRawText?.length || 0} 字</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <AnchorCard 
              title="1. 第一轮开始 (Start of R1)" 
              phrase={result.splitAnchors.r1StartPhrase} 
              pos={result.splitAnchors.r1StartPos}
              desc="特征：第一轮互动扣1-5（开始）"
              isSidebar={isSidebar}
              onClick={() => handleAnchorClick(result.splitAnchors!.r1StartPhrase, result.splitAnchors!.r1StartPos)}
            />
            <AnchorCard 
              title="2. 第一轮结束 (End of R1)" 
              phrase={result.splitAnchors.r1EndPhrase} 
              pos={result.splitAnchors.r1EndPos}
              desc="特征：第一轮上链介绍结束（结束）"
              isSidebar={isSidebar}
              onClick={() => handleAnchorClick(result.splitAnchors!.r1EndPhrase, result.splitAnchors!.r1EndPos)}
            />
            <AnchorCard 
              title="3. 第二轮开始 (Start of R2)" 
              phrase={result.splitAnchors.r2StartPhrase} 
              pos={result.splitAnchors.r2StartPos}
              desc="特征：第二轮互动扣1-5（开始）"
              isCore={true}
              isSidebar={isSidebar}
              onClick={() => handleAnchorClick(result.splitAnchors!.r2StartPhrase, result.splitAnchors!.r2StartPos)}
            />
            <AnchorCard 
              title="4. 第二轮结束 (End of R2)" 
              phrase={result.splitAnchors.r2EndPhrase} 
              pos={result.splitAnchors.r2EndPos}
              desc="特征：第二轮上链介绍结束（结束）"
              isSidebar={isSidebar}
              onClick={() => handleAnchorClick(result.splitAnchors!.r2EndPhrase, result.splitAnchors!.r2EndPos)}
            />
          </div>

          <div className="mt-10 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
                <FileText size={18} className="text-slate-400" />
                直播全文源码 (核实锚点精准度)
              </h3>
              <p className="text-[10px] font-bold text-slate-400">点击上方卡片可自动跳转至对应原文位置</p>
            </div>
            
            <FullTextWithHighlight 
              text={result.fullRawText} 
              highlightRange={activeHighlight} 
              highlightId={activeHighlight?.id}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminAuditView;
