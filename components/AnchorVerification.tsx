import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  CheckCircle2, 
  Search, 
  MousePointer2, 
  ArrowRight, 
  RotateCcw,
  Target,
  LocateFixed,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { findAnchorPosition } from '../services/doubaoService';

interface Anchor {
  id: string;
  name: string;
  phrase: string | null;
  pos: number;
  range: [number, number];
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

// 预计算全文各行的起始偏移，避免 O(n²) 循环
function buildLineOffsets(text: string): number[] {
  const offsets: number[] = [];
  let offset = 0;
  const lines = text.split('\n');
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
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
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);
  const textContainerRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string, start: number, end: number } | null>(null);

  // 预计算每行偏移
  const lines = useMemo(() => fullText.split('\n'), [fullText]);
  const lineOffsets = useMemo(() => buildLineOffsets(fullText), [fullText]);

  // 预计算搜索关键词的所有命中位置
  const searchMatches = useMemo(() => {
    if (!searchText || searchText.length < 1) return [];
    const positions: number[] = [];
    let idx = 0;
    while (true) {
      const found = fullText.indexOf(searchText, idx);
      if (found === -1) break;
      positions.push(found);
      idx = found + 1;
    }
    return positions;
  }, [fullText, searchText]);

  // 搜索词变化时重置索引
  useEffect(() => {
    setSearchMatchIdx(0);
  }, [searchText]);

  const scrollToPosition = useCallback((pos: number, rangeStartPercent?: number) => {
    if (!textContainerRef.current) return;
    if (pos !== -1) {
      const scrollRatio = pos / fullText.length;
      const targetScroll = textContainerRef.current.scrollHeight * scrollRatio - 200;
      textContainerRef.current.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
    } else if (rangeStartPercent !== undefined) {
      const targetScroll = textContainerRef.current.scrollHeight * rangeStartPercent;
      textContainerRef.current.scrollTo({ top: targetScroll, behavior: 'smooth' });
    }
  }, [fullText]);

  // 导航到指定搜索命中
  const navigateToMatch = useCallback((idx: number) => {
    if (searchMatches.length === 0) return;
    const normalized = ((idx % searchMatches.length) + searchMatches.length) % searchMatches.length;
    setSearchMatchIdx(normalized);
    scrollToPosition(searchMatches[normalized]);
  }, [searchMatches, scrollToPosition]);

  const handleLocate = useCallback((anchor: Anchor) => {
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
  }, [fullText, scrollToPosition]);

  useEffect(() => {
    if (activeAnchorId) {
      const anchor = anchors.find(a => a.id === activeAnchorId);
      if (anchor) handleLocate(anchor);
    }
  }, [activeAnchorId, anchors, handleLocate]);

  const handleSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !sel.toString().trim()) {
      setSelection(null);
      return;
    }
    const selectedText = sel.toString().trim();
    if (selectedText.length < 5) return;

    const range = sel.getRangeAt(0);
    const container = textContainerRef.current;
    if (!container) return;

    try {
      const preRange = document.createRange();
      preRange.setStart(container, 0);
      preRange.setEnd(range.startContainer, range.startOffset);
      const pos = preRange.toString().length;
      setSelection({ text: selectedText, start: pos, end: pos + selectedText.length });
    } catch {
      const pos = fullText.indexOf(selectedText);
      setSelection({ text: selectedText, start: pos, end: pos + selectedText.length });
    }
  };

  const setAsAnchor = (anchorId: string) => {
    if (!selection) return;
    setAnchors(prev => prev.map(a => 
      a.id === anchorId ? { ...a, phrase: selection.text, pos: selection.start } : a
    ));
    setSelection(null);
    const nextUnset = anchors.find(a => !a.phrase && a.id !== anchorId);
    if (nextUnset) setActiveAnchorId(nextUnset.id);
  };

  const handleConfirm = () => {
    if (anchors[0].pos !== -1 && anchors[1].pos !== -1 && anchors[1].pos < anchors[0].pos) return alert("第一轮结束点不能早于第一轮开始点");
    if (anchors[1].pos !== -1 && anchors[2].pos !== -1 && anchors[2].pos < anchors[1].pos) return alert("第二轮开始点不能早于第一轮结束点");
    if (anchors[2].pos !== -1 && anchors[3].pos !== -1 && anchors[3].pos < anchors[2].pos) return alert("第二轮结束点不能早于第二轮开始点");
    onConfirm({
      r1StartPhrase: anchors[0].phrase, r1StartPos: anchors[0].pos,
      r1EndPhrase: anchors[1].phrase, r1EndPos: anchors[1].pos,
      r2StartPhrase: anchors[2].phrase, r2StartPos: anchors[2].pos,
      r2EndPhrase: anchors[3].phrase, r2EndPos: anchors[3].pos,
    });
  };

  // 渲染文本行，支持锚点高亮（蓝色）和搜索高亮（当前命中橙色，其余黄色）
  const renderLine = (line: string, lineIdx: number) => {
    const currentOffset = lineOffsets[lineIdx];

    // 高亮区间（锚点定位）
    const isLineHighlighted = highlightedRange &&
      currentOffset < highlightedRange.end &&
      (currentOffset + line.length) > highlightedRange.start;

    // 搜索命中片段（收集当前行内所有命中）
    const lineSearchHits: { start: number; end: number; isCurrent: boolean }[] = [];
    if (searchText && searchMatches.length > 0) {
      for (let mi = 0; mi < searchMatches.length; mi++) {
        const mPos = searchMatches[mi];
        const inLineStart = mPos - currentOffset;
        const inLineEnd = inLineStart + searchText.length;
        if (inLineEnd > 0 && inLineStart < line.length) {
          lineSearchHits.push({
            start: Math.max(0, inLineStart),
            end: Math.min(line.length, inLineEnd),
            isCurrent: mi === searchMatchIdx
          });
        }
      }
    }

    if (isLineHighlighted && highlightedRange) {
      const startInLine = Math.max(0, highlightedRange.start - currentOffset);
      const endInLine = Math.min(line.length, highlightedRange.end - currentOffset);
      return (
        <p key={lineIdx}>
          {line.substring(0, startInLine)}
          <mark className="bg-blue-100 text-blue-900 border-b-2 border-blue-400">
            {line.substring(startInLine, endInLine)}
          </mark>
          {line.substring(endInLine)}
        </p>
      );
    }

    if (lineSearchHits.length > 0) {
      // 将命中区间合并渲染
      const segments: React.ReactNode[] = [];
      let cursor = 0;
      for (const hit of lineSearchHits.sort((a, b) => a.start - b.start)) {
        if (hit.start > cursor) segments.push(line.substring(cursor, hit.start));
        segments.push(
          <mark
            key={hit.start}
            className={hit.isCurrent ? 'bg-orange-300 text-slate-900 rounded' : 'bg-yellow-100 text-slate-800'}
          >
            {line.substring(hit.start, hit.end)}
          </mark>
        );
        cursor = hit.end;
      }
      if (cursor < line.length) segments.push(line.substring(cursor));
      return <p key={lineIdx}>{segments}</p>;
    }

    return <p key={lineIdx}>{line}</p>;
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden animate-in slide-in-from-right-8 fade-in duration-300">
      {/* 顶部工具栏 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-slate-200 shrink-0">
        {/* 搜索区 */}
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 flex-1 max-w-lg">
          <Search size={15} className="text-slate-400 shrink-0" />
          <input
            type="text"
            placeholder="搜索原文关键词..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') navigateToMatch(searchMatchIdx + 1);
            }}
            className="bg-transparent text-sm outline-none flex-1 min-w-0"
          />
          {searchText && (
            <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
              {searchMatches.length > 0 ? `${searchMatchIdx + 1}/${searchMatches.length}` : '无结果'}
            </span>
          )}
        </div>

        {/* 上一个 / 下一个 */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigateToMatch(searchMatchIdx - 1)}
            disabled={searchMatches.length === 0}
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronUp size={14} />
            上一个
          </button>
          <button
            onClick={() => navigateToMatch(searchMatchIdx + 1)}
            disabled={searchMatches.length === 0}
            className="flex items-center gap-1 px-3 py-2 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            下一个
            <ChevronDown size={14} />
          </button>
        </div>

        <div className="flex-1" />

        {/* 操作提示 */}
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-400">
          <MousePointer2 size={13} />
          <span>鼠标选中文字 → 设为锚点</span>
        </div>

        {/* 返回按钮 */}
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500 hover:text-slate-700 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
        >
          <RotateCcw size={13} />
          重新上传
        </button>

        {/* 确认按钮 */}
        <button
          onClick={handleConfirm}
          className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm shadow-blue-100 transition-all active:scale-95"
        >
          确认锚点，进入质检
          <ArrowRight size={16} />
        </button>
      </div>

      {/* 主体区域：左侧全文 + 右侧锚点卡片 */}
      <div className="flex flex-1 overflow-hidden gap-0">
        {/* 左侧全文区 */}
        <div className="flex-1 flex flex-col overflow-hidden bg-white border-r border-slate-200">
          <div
            ref={textContainerRef}
            onMouseUp={handleSelection}
            className="flex-1 px-8 py-6 overflow-y-auto font-mono text-sm leading-relaxed select-text whitespace-pre-wrap text-slate-600"
          >
            {lines.map((line, i) => renderLine(line, i))}
          </div>
        </div>

        {/* 右侧锚点卡片区 */}
        <div className="w-[380px] flex flex-col bg-slate-50 overflow-hidden shrink-0">
          {/* 标题 */}
          <div className="px-5 py-4 bg-blue-600 text-white shrink-0">
            <h3 className="font-bold flex items-center gap-2 text-sm">
              <Target size={16} />
              锚点核对
            </h3>
            <p className="text-[11px] opacity-75 mt-0.5">确认或手动修正 AI 找出的四个分界点</p>
          </div>

          {/* 锚点卡片列表 */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {anchors.map((a) => (
              <div
                key={a.id}
                onClick={() => { setActiveAnchorId(a.id); handleLocate(a); }}
                className={`p-4 rounded-2xl border-2 transition-all cursor-pointer bg-white ${
                  activeAnchorId === a.id
                    ? 'border-blue-500 shadow-md ring-4 ring-blue-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${a.bgColor} ${a.color}`}>
                    {a.name}
                  </span>
                  {a.phrase && <CheckCircle2 size={14} className="text-green-500" />}
                </div>

                {a.phrase ? (
                  <div className="space-y-2">
                    <p className="text-xs text-slate-600 italic leading-relaxed line-clamp-3">
                      "{a.phrase}"
                    </p>
                    <div className="flex justify-between items-center pt-2 border-t border-slate-100">
                      <span className="text-[10px] text-slate-400">位置：{a.pos} 字</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={e => { e.stopPropagation(); handleLocate(a); }}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="定位到此处"
                        >
                          <LocateFixed size={14} />
                        </button>
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            setAnchors(prev => prev.map(pa => pa.id === a.id ? { ...pa, phrase: null, pos: -1 } : pa));
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
                  <div className="py-1">
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
        </div>
      </div>

      {/* 选中文本确认弹窗 */}
      {selection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="bg-white rounded-3xl shadow-2xl w-[340px] overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100"
            onClick={e => e.stopPropagation()}
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
  );
};

export default AnchorVerification;
