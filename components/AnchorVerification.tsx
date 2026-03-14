import React, { useState, useRef, useEffect } from 'react';
import { 
  CheckCircle2, 
  Search, 
  MousePointer2, 
  ArrowRight, 
  RotateCcw,
  Target,
  LocateFixed
} from 'lucide-react';
import { findAnchorPosition } from '../services/doubaoService';

interface Anchor {
  id: string;
  name: string;
  phrase: string | null;
  pos: number;
  range: [number, number]; // [start%, end%]
  color: string;
  bgColor: string;
}

interface AnchorVerificationProps {
  fullText: string;
  initialAnchors: {
    r1StartPhrase: string | null;
    r1StartPos: number;
    r1EndPhrase: string | null;
    r1EndPos: number;
    r2StartPhrase: string | null;
    r2StartPos: number;
    r2EndPhrase: string | null;
    r2EndPos: number;
  };
  onConfirm: (finalAnchors: any) => void;
  onBack: () => void;
}

const AnchorVerification: React.FC<AnchorVerificationProps> = ({ fullText, initialAnchors, onConfirm, onBack }) => {
  const [anchors, setAnchors] = useState<Anchor[]>([
    { id: 'r1_start', name: '第一轮开始', phrase: initialAnchors.r1StartPhrase, pos: initialAnchors.r1StartPos, range: [0, 0.15], color: 'text-green-600', bgColor: 'bg-green-50' },
    { id: 'r1_end', name: '第一轮结束', phrase: initialAnchors.r1EndPhrase, pos: initialAnchors.r1EndPos, range: [0.35, 0.60], color: 'text-red-600', bgColor: 'bg-red-50' },
    { id: 'r2_start', name: '第二轮开始', phrase: initialAnchors.r2StartPhrase, pos: initialAnchors.r2StartPos, range: [0.50, 0.65], color: 'text-blue-600', bgColor: 'bg-blue-50' },
    { id: 'r2_end', name: '第二轮结束', phrase: initialAnchors.r2EndPhrase, pos: initialAnchors.r2EndPos, range: [0.85, 1.0], color: 'text-purple-600', bgColor: 'bg-purple-50' },
  ]);

  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [highlightedRange, setHighlightedRange] = useState<{ start: number, end: number } | null>(null);
  const [searchText, setSearchText] = useState('');
  const textContainerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string, start: number, end: number } | null>(null);

  // 优化滚动定位：支持高亮显示与精准跳转
  const handleLocate = (anchor: Anchor) => {
    const match = findAnchorPosition(fullText, anchor.phrase);
    if (match) {
      setHighlightedRange({ start: match.pos, end: match.pos + match.length });
      scrollToPosition(match.pos);
    } else if (anchor.pos !== -1) {
      setHighlightedRange({ start: anchor.pos, end: anchor.pos + (anchor.phrase?.length || 0) });
      scrollToPosition(anchor.pos);
    } else {
      scrollToPosition(-1, anchor.range[0]);
    }
  };

  const scrollToPosition = (pos: number, rangeStartPercent?: number) => {
    if (!textContainerRef.current) return;
    
    if (pos !== -1) {
      const scrollRatio = pos / fullText.length;
      const targetScroll = textContainerRef.current.scrollHeight * scrollRatio - 150;
      textContainerRef.current.scrollTo({
        top: Math.max(0, targetScroll),
        behavior: 'smooth'
      });
    } else if (rangeStartPercent !== undefined) {
      const targetScroll = textContainerRef.current.scrollHeight * rangeStartPercent;
      textContainerRef.current.scrollTo({
        top: targetScroll,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    if (activeAnchorId) {
      const anchor = anchors.find(a => a.id === activeAnchorId);
      if (anchor) {
        handleLocate(anchor);
      }
    }
  }, [activeAnchorId]);

  const handleSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) {
      setSelection(null);
      return;
    }

    const selectedText = sel.toString().trim();
    if (selectedText.length < 5) return; // 太短不给选

    // ✅ 修复：通过 DOM Range 计算用户实际选中位置在全文中的真实全局偏移
    // 避免 indexOf() 永远返回第一次出现位置的 Bug
    const range = sel.getRangeAt(0);
    const container = textContainerRef.current;
    if (!container) return;

    try {
      const preRange = document.createRange();
      preRange.setStart(container, 0);
      preRange.setEnd(range.startContainer, range.startOffset);
      const pos = preRange.toString().length;

      setSelection({
        text: selectedText,
        start: pos,
        end: pos + selectedText.length
      });
    } catch {
      // 兜底：如果 DOM Range 计算失败，退回 indexOf
      const pos = fullText.indexOf(selectedText);
      setSelection({ text: selectedText, start: pos, end: pos + selectedText.length });
    }
  };

  const setAsAnchor = (anchorId: string) => {
    if (!selection) return;
    
    setAnchors(prev => prev.map(a => 
      a.id === anchorId 
        ? { ...a, phrase: selection.text, pos: selection.start } 
        : a
    ));
    setSelection(null);
    // 选中后自动切换到下一个未完成的锚点
    const nextUnset = anchors.find(a => !a.phrase && a.id !== anchorId);
    if (nextUnset) setActiveAnchorId(nextUnset.id);
  };

  // 移除严格的 isReady 检查，允许直接进行下一步
  const handleConfirm = () => {
    // 仅在锚点都存在时进行顺序逻辑校验，如果用户未干预且部分缺失，则交由后续流程处理
    if (anchors[0].pos !== -1 && anchors[1].pos !== -1 && anchors[1].pos < anchors[0].pos) return alert("第一轮结束点不能早于第一轮开始点");
    if (anchors[1].pos !== -1 && anchors[2].pos !== -1 && anchors[2].pos < anchors[1].pos) return alert("第二轮开始点不能早于第一轮结束点");
    if (anchors[2].pos !== -1 && anchors[3].pos !== -1 && anchors[3].pos < anchors[2].pos) return alert("第二轮结束点不能早于第二轮开始点");

    onConfirm({
      r1StartPhrase: anchors[0].phrase,
      r1StartPos: anchors[0].pos,
      r1EndPhrase: anchors[1].phrase,
      r1EndPos: anchors[1].pos,
      r2StartPhrase: anchors[2].phrase,
      r2StartPos: anchors[2].pos,
      r2EndPhrase: anchors[3].phrase,
      r2EndPos: anchors[3].pos,
    });
  };

  return (
    <div className="flex h-[calc(100vh-120px)] overflow-hidden gap-4 animate-in slide-in-from-right-8 fade-in duration-300">
      {/* 左侧：文本浏览器 */}
      <div className="flex-1 bg-white border border-slate-200 rounded-2xl flex flex-col overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-slate-400" />
            <input 
              type="text" 
              placeholder="搜索原文关键字..." 
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="bg-transparent text-sm outline-none w-48"
            />
          </div>
          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-2">
            <MousePointer2 size={14} />
            用鼠标抹黑选中一段话，然后点击右侧对应的设为锚点
          </div>
        </div>
        
        <div 
          ref={textContainerRef}
          onMouseUp={handleSelection}
          className="flex-1 p-6 overflow-y-auto font-mono text-sm leading-relaxed select-text whitespace-pre-wrap text-slate-600 relative"
        >
          {fullText.split('\n').map((line, i) => {
            // 获取当前行在全文中的绝对起始位置 (粗略计算，仅用于高亮判断)
            // 生产环境建议将 fullText 预处理为带索引的结构
            const lines = fullText.split('\n');
            let currentOffset = 0;
            for(let j=0; j<i; j++) currentOffset += lines[j].length + 1;

            const isLineHighlighted = highlightedRange && 
              currentOffset < highlightedRange.end && 
              (currentOffset + line.length) > highlightedRange.start;

            const renderLine = () => {
              if (isLineHighlighted && highlightedRange) {
                const startInLine = Math.max(0, highlightedRange.start - currentOffset);
                const endInLine = Math.min(line.length, highlightedRange.end - currentOffset);
                
                return (
                  <p key={i}>
                    {line.substring(0, startInLine)}
                    <mark className="bg-blue-100 text-blue-900 border-b-2 border-blue-400">
                      {line.substring(startInLine, endInLine)}
                    </mark>
                    {line.substring(endInLine)}
                  </p>
                );
              }

              if (searchText && line.includes(searchText)) {
                const parts = line.split(searchText);
                return (
                  <p key={i}>
                    {parts.map((part, pi) => (
                      <React.Fragment key={pi}>
                        {part}
                        {pi < parts.length - 1 && <mark className="bg-yellow-200 text-slate-900">{searchText}</mark>}
                      </React.Fragment>
                    ))}
                  </p>
                );
              }
              return <p key={i}>{line}</p>;
            };

            return renderLine();
          })}
        </div>

        {/* 全新设计的选择确认模态弹窗 */}
        {selection && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div 
              className="bg-white rounded-3xl shadow-2xl w-[320px] overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="bg-slate-50 p-4 border-b border-slate-100">
                <div className="flex items-center gap-2 text-blue-600 mb-1">
                  <MousePointer2 size={16} />
                  <span className="text-xs font-bold uppercase tracking-wider">确认选中文本</span>
                </div>
                <div className="bg-white p-3 rounded-xl border border-slate-200 mt-2">
                  <p className="text-sm text-slate-700 italic leading-relaxed line-clamp-4">
                    "{selection.text}"
                  </p>
                </div>
              </div>
              
              <div className="p-4 grid grid-cols-1 gap-2">
                <p className="text-[10px] text-slate-400 font-bold px-1 mb-1">设置为：</p>
                {anchors.map(a => (
                  <button 
                    key={a.id}
                    onClick={() => setAsAnchor(a.id)}
                    className={`flex items-center justify-between p-3 rounded-xl border-2 transition-all active:scale-95 ${
                      activeAnchorId === a.id 
                      ? 'border-blue-500 bg-blue-50 text-blue-700' 
                      : 'border-slate-100 hover:border-blue-200 text-slate-600'
                    }`}
                  >
                    <span className="text-xs font-bold">{a.name}</span>
                    <ArrowRight size={14} className={activeAnchorId === a.id ? 'opacity-100' : 'opacity-30'} />
                  </button>
                ))}
                
                <button 
                  onClick={() => setSelection(null)}
                  className="mt-2 py-2 text-xs text-slate-400 hover:text-slate-600 font-medium"
                >
                  取消选择
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 右侧：核对卡片 */}
      <div className="w-80 flex flex-col bg-slate-50 border-l border-slate-200 relative">
        <div className="p-4 flex flex-col gap-4 overflow-y-auto pb-32">
          <div className="bg-blue-600 p-4 rounded-2xl text-white shadow-lg shrink-0">
             <h3 className="font-bold flex items-center gap-2">
               <Target size={18} />
               锚点核对
             </h3>
             <p className="text-[10px] opacity-80 mt-1">请确认或手动修正 AI 找出的四个分界点</p>
          </div>

          {anchors.map((a) => (
            <div 
              key={a.id} 
              onClick={() => {
                setActiveAnchorId(a.id);
                handleLocate(a);
              }}
              className={`p-4 rounded-2xl border-2 transition-all cursor-pointer relative overflow-hidden group ${
                activeAnchorId === a.id ? 'border-blue-500 bg-white shadow-md ring-4 ring-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                 <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${a.bgColor} ${a.color}`}>
                    {a.name}
                 </span>
                 {a.phrase && (
                   <CheckCircle2 size={14} className="text-green-500" />
                 )}
              </div>

              {a.phrase ? (
                 <div className="space-y-2">
                   <p className="text-xs text-slate-600 italic leading-relaxed line-clamp-2">
                     "{a.phrase}"
                   </p>
                   <div className="flex justify-between items-center pt-2 border-t border-slate-50">
                      <span className="text-[10px] text-slate-400">位置: {a.pos} 字</span>
                      <div className="flex gap-2">
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            handleLocate(a);
                          }}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="定位到此处"
                        >
                          <LocateFixed size={14} />
                        </button>
                        <button 
                          onClick={(e) => { 
                            e.stopPropagation(); 
                            setAnchors(prev => prev.map(pa => pa.id === a.id ? {...pa, phrase: null, pos: -1} : pa)); 
                            setActiveAnchorId(a.id);
                            setHighlightedRange(null);
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors border border-transparent hover:border-blue-100"
                          title="重新选择锚点"
                        >
                          <MousePointer2 size={12} />
                          <span className="text-[10px] font-bold">重新定位</span>
                        </button>
                      </div>
                   </div>
                 </div>
              ) : (
                 <div className="py-2">
                   <p className="text-[10px] text-slate-400 mb-1">未设置</p>
                   <div className="flex items-center gap-1.5 text-[10px] font-bold text-blue-500">
                      <MousePointer2 size={12} className="animate-bounce" />
                      请在左侧文字中选中原话
                   </div>
                 </div>
              )}
            </div>
          ))}
        </div>

        {/* 固定在底部的操作栏：始终显示下一步按钮 */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-white/80 backdrop-blur-md border-t border-slate-200">
          <div className="flex flex-col gap-3">
             <button 
                onClick={handleConfirm}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-xl shadow-blue-100 flex items-center justify-center gap-2 transition-all active:scale-95 animate-in slide-in-from-bottom-4"
             >
                确认锚点，进入质检
                <ArrowRight size={20} />
             </button>
             
             <button 
                onClick={onBack}
                className="w-full text-xs text-slate-400 hover:text-slate-600 font-medium py-1 flex items-center justify-center gap-1"
             >
                <RotateCcw size={12} />
                重新上传文本
             </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnchorVerification;
