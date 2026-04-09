import React, { useEffect, useState, useRef } from 'react';
import { ArrowLeft, Loader2, AlertTriangle, ChevronUp, RefreshCw, Send, MessageCircle } from 'lucide-react';

interface Props {
  sessionId: number;
  anchorName: string;
  sessionTitle: string;
  sessionTime: string;
  onBack: () => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * AI 话术分析报告页 — 结构化文档风格 + 对话问答
 */
const AnalysisReportView: React.FC<Props> = ({ sessionId, anchorName, sessionTitle, sessionTime, onBack }) => {
  const [status, setStatus] = useState<'loading' | 'analyzing' | 'done' | 'failed'>('loading');
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState('');
  const [showTop, setShowTop] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 对话问答状态
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // 历史问答记录（持久化，所有人共享）
  const [savedQA, setSavedQA] = useState<{id: string; question: string; answer: string; asked_by: string; asked_at: string}[]>([]);

  // 页面加载时读取历史问答
  useEffect(() => {
    fetch('/api/qa/' + sessionId)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setSavedQA(data); })
      .catch(() => {});
  }, [sessionId]);

  // 轮询分析状态
  useEffect(() => {
    let timer: any;
    const check = async () => {
      try {
        const res = await fetch(`/api/analysis/${sessionId}`);
        const data = await res.json();
        if (data.status === 'done') {
          setMarkdown(data.result || '');
          setStatus('done');
          return;
        } else if (data.status === 'failed') {
          setError(data.error || '分析失败');
          setStatus('failed');
          return;
        } else if (data.status === 'analyzing') {
          setStatus('analyzing');
        } else {
          await fetch('/api/analysis/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, anchor_name: anchorName })
          });
          setStatus('analyzing');
        }
        timer = setTimeout(check, 5000);
      } catch {
        setError('网络错误');
        setStatus('failed');
      }
    };
    check();
    return () => clearTimeout(timer);
  }, [sessionId, anchorName]);

  // 滚动到顶部按钮
  const handleScroll = () => {
    if (containerRef.current) {
      setShowTop(containerRef.current.scrollTop > 300);
    }
  };

  // 重试
  const retry = async () => {
    setStatus('analyzing');
    setError('');
    await fetch('/api/analysis/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, anchor_name: anchorName })
    });
  };

  // 发送对话
  const sendChat = async () => {
    const q = chatInput.trim();
    if (!q || chatLoading) return;
    setChatInput('');
    setChatExpanded(true);
    const newHistory = [...chatHistory, { role: 'user' as const, content: q }];
    setChatHistory(newHistory);
    setChatLoading(true);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    try {
      const res = await fetch('/api/analysis/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          anchor_name: anchorName,
          question: q,
          history: newHistory.slice(0, -1)
        })
      });
      const data = await res.json();
      if (data.error) {
        setChatHistory([...newHistory, { role: 'assistant', content: `⚠️ ${data.error}` }]);
      } else {
        setChatHistory([...newHistory, { role: 'assistant', content: data.answer }]);
          // 保存到持久化存储
          fetch('/api/qa/' + sessionId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question: q, answer: data.answer, asked_by: '管理员' })
          }).then(r => r.json()).then(record => {
            setSavedQA(prev => [...prev, record]);
          }).catch(() => {});
      }
    } catch (e) {
      setChatHistory([...newHistory, { role: 'assistant', content: '⚠️ 网络错误，请重试' }]);
    }
    setChatLoading(false);
    setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  // 渲染对话内容中的 markdown 粗体和换行
  const renderChatText = (text: string) => {
    return text.split('\n').map((line, li) => (
      <React.Fragment key={li}>
        {li > 0 && <br />}
        {line.split(/\*\*(.+?)\*\*/g).map((part, pi) =>
          pi % 2 === 1 ? <strong key={pi} className="font-bold">{part}</strong> : part
        )}
      </React.Fragment>
    ));
  };

  // 渲染 markdown 为结构化 HTML
  const renderMarkdown = (md: string) => {
    const lines = md.split('\n');
    const elements: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) { i++; continue; }
      if (/^---+$/.test(trimmed)) {
        elements.push(<hr key={i} className="my-6 border-slate-200" />);
        i++; continue;
      }
      if (/^# /.test(trimmed)) {
        elements.push(
          <h1 key={i} className="text-xl md:text-2xl font-black text-slate-900 mb-2 mt-6">
            {trimmed.replace(/^# /, '')}
          </h1>
        );
        i++; continue;
      }
      if (/^## /.test(trimmed)) {
        const title = trimmed.replace(/^## /, '');
        elements.push(
          <div key={i} className="mt-8 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-1 h-6 bg-[#07C160] rounded-full shrink-0" />
              <h2 className="text-lg font-black text-slate-800">{title}</h2>
            </div>
            <div className="ml-4 mt-1 border-b border-slate-200" />
          </div>
        );
        i++; continue;
      }
      if (/^### /.test(trimmed)) {
        const title = trimmed.replace(/^### /, '');
        const isGood = title.includes('✅');
        const isBad = title.includes('❌');
        const borderColor = isGood ? 'border-l-emerald-400' : isBad ? 'border-l-red-400' : 'border-l-slate-300';
        elements.push(
          <h3 key={i} className={`text-base font-bold text-slate-700 mt-5 mb-2 pl-3 border-l-[3px] ${borderColor}`}>
            {title}
          </h3>
        );
        i++; continue;
      }
      if (/^[-*]\s+\*\*/.test(trimmed)) {
        const match = trimmed.match(/^[-*]\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)/);
        if (match) {
          const label = match[1];
          const value = match[2];
          if (label.includes('原话') || label.includes('【原话')) {
            elements.push(
              <div key={i} className="my-2 ml-4">
                <p className="text-xs font-bold text-slate-500 mb-1">💬 {label}</p>
                {value && (
                  <div className="bg-slate-50 border-l-[3px] border-slate-300 px-4 py-2.5 rounded-r-lg">
                    <p className="text-sm text-slate-600 italic leading-relaxed break-words">{formatBold(value)}</p>
                  </div>
                )}
              </div>
            );
            i++;
            const quoteLines: string[] = [];
            while (i < lines.length && lines[i].trim() && !/^[-*#]/.test(lines[i].trim())) {
              quoteLines.push(lines[i].trim());
              i++;
            }
            if (quoteLines.length > 0 && !value) {
              elements.push(
                <div key={`q-${i}`} className="ml-4 mb-2 bg-slate-50 border-l-[3px] border-slate-300 px-4 py-2.5 rounded-r-lg">
                  <p className="text-sm text-slate-600 italic leading-relaxed break-words">
                    {quoteLines.join('\n')}
                  </p>
                </div>
              );
            }
            continue;
          }
          if (label.includes('话术逻辑') || label.includes('排除策略')) {
            elements.push(
              <div key={i} className="my-2 ml-4">
                <p className="text-xs font-bold text-amber-600 mb-1">🔍 {label}</p>
                <div className="bg-amber-50 border-l-[3px] border-amber-300 px-4 py-2.5 rounded-r-lg">
                  <p className="text-sm text-slate-700 leading-relaxed break-words">{formatBold(value)}</p>
                </div>
              </div>
            );
            i++; continue;
          }
          elements.push(
            <div key={i} className="my-1.5 ml-4 flex flex-wrap gap-1">
              <span className="text-sm font-bold text-slate-600 shrink-0">{label}：</span>
              <span className="text-sm text-slate-600 break-words">{formatBold(value)}</span>
            </div>
          );
          i++; continue;
        }
      }
      if (/^\d+\.\s+/.test(trimmed)) {
        const match = trimmed.match(/^(\d+)\.\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)/);
        if (match) {
          elements.push(
            <div key={i} className="my-1.5 ml-4">
              <span className="text-sm font-bold text-slate-600">{match[1]}. {match[2]}：</span>
              <span className="text-sm text-slate-600 break-words">{formatBold(match[3])}</span>
            </div>
          );
        } else {
          const text = trimmed.replace(/^\d+\.\s+/, '');
          const num = trimmed.match(/^(\d+)\./)?.[1];
          elements.push(
            <div key={i} className="my-1.5 ml-4">
              <span className="text-sm text-slate-600">{num}. {formatBold(text)}</span>
            </div>
          );
        }
        i++; continue;
      }
      if (/^\s+[-*]\s+\*\*/.test(line)) {
        const match = line.trim().match(/^[-*]\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)/);
        if (match) {
          const label = match[1];
          const value = match[2];
          if (label.includes('原话') || label.includes('【原话')) {
            elements.push(
              <div key={i} className="my-2 ml-8 bg-slate-50 border-l-[3px] border-slate-300 px-4 py-2.5 rounded-r-lg">
                <p className="text-xs font-bold text-slate-500 mb-1">💬 {label}</p>
                <p className="text-sm text-slate-600 italic leading-relaxed break-words">{value}</p>
              </div>
            );
          } else {
            elements.push(
              <div key={i} className="my-1 ml-8">
                <span className="text-sm font-bold text-slate-600">{label}：</span>
                <span className="text-sm text-slate-600 break-words">{formatBold(value)}</span>
              </div>
            );
          }
          i++; continue;
        }
      }
      elements.push(
        <p key={i} className="text-sm text-slate-600 leading-relaxed my-1.5 ml-4 break-words">
          {formatBold(trimmed)}
        </p>
      );
      i++;
    }
    return elements;
  };

  const formatBold = (text: string): React.ReactNode => {
    if (!text) return null;
    const parts = text.split(/\*\*(.+?)\*\*/g);
    return parts.map((part, idx) =>
      idx % 2 === 1 ? <strong key={idx} className="font-bold text-slate-800">{part}</strong> : part
    );
  };

  return (
    <div className="h-screen flex flex-col bg-[#F7F7F7]">
      {/* 顶部栏 */}
      <div className="bg-white border-b border-slate-100 px-3 md:px-4 py-2.5 flex items-center gap-3 shadow-sm shrink-0 z-10">
        <button onClick={onBack} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-[#F7F7F7] transition-colors shrink-0">
          <ArrowLeft size={14} className="text-slate-500" />
          <span className="text-sm font-bold text-[#07C160]">返回</span>
        </button>
        <span className="text-slate-200">|</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 truncate">
            <span className="font-bold">{anchorName}</span>
            <span className="text-slate-300 mx-1.5">·</span>
            <span className="text-xs text-slate-400">话术结构分析</span>
            {sessionTime && <>
              <span className="text-slate-300 mx-1.5">·</span>
              <span className="text-xs text-slate-400">{sessionTime}</span>
            </>}
          </p>
        </div>
      </div>

      {/* 内容区 */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {status === 'loading' || status === 'analyzing' ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <Loader2 size={32} className="text-[#07C160] animate-spin" />
            <div className="text-center">
              <p className="text-sm font-bold text-slate-700">
                {status === 'loading' ? '正在加载...' : 'AI 正在分析逐字稿...'}
              </p>
              <p className="text-xs text-slate-400 mt-1">预计需要 1-2 分钟，请稍候</p>
            </div>
          </div>
        ) : status === 'failed' ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <AlertTriangle size={32} className="text-red-400" />
            <p className="text-sm text-red-500 font-bold">分析失败</p>
            <p className="text-xs text-slate-400">{error}</p>
            <button onClick={retry} className="flex items-center gap-2 px-4 py-2 bg-[#07C160] hover:bg-[#06AD56] text-white text-sm font-bold rounded-lg transition-colors">
              <RefreshCw size={14} /> 重新分析
            </button>
          </div>
        ) : (
          <div className="max-w-[800px] mx-auto px-3 md:px-8 py-4 md:py-6 pb-20">
            {/* 报告头 */}
            <div className="mb-4 pb-3 border-b-2 border-[#07C160]">
              <h1 className="text-lg md:text-2xl font-black text-slate-900">{anchorName} · 话术结构分析报告</h1>
              <div className="flex flex-wrap items-center gap-3 mt-2">
                {sessionTitle && <span className="text-sm text-slate-500">{sessionTitle}</span>}
                {sessionTime && <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded">{sessionTime}</span>}
                <span className="text-xs text-slate-400">AI 生成</span>
              </div>
            </div>

            {/* 💬 AI 对话问答区 — 报告头下方、正文上方 */}
            <div className="mb-6 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              {/* 标题栏 */}
              <div
                className="flex items-center justify-between px-4 py-2.5 bg-gradient-to-r from-[#07C160]/5 to-transparent cursor-pointer"
                onClick={() => setChatExpanded(!chatExpanded)}
              >
                <div className="flex items-center gap-2">
                  <MessageCircle size={15} className="text-[#07C160]" />
                  <span className="text-sm font-bold text-slate-700">话术追问</span>
                  <span className="text-[10px] text-slate-400">基于逐字稿对话</span>
                </div>
                <div className="flex items-center gap-2">
                  {(savedQA.length > 0 || chatHistory.length > 0) && (
                    <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                      {savedQA.length + chatHistory.filter(m => m.role === 'user').length} 次提问
                    </span>
                  )}
                </div>
              </div>

              {/* 历史问答记录（所有人共享） */}
              {chatExpanded && savedQA.length > 0 && (
                <div className="px-3 md:px-4 py-3 border-t border-slate-100 space-y-4 max-h-[500px] overflow-y-auto bg-slate-50/50">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">历史问答</span>
                    <div className="flex-1 border-t border-slate-200" />
                  </div>
                  {savedQA.map((qa) => (
                    <div key={qa.id} className="bg-white rounded-lg border border-slate-100 p-3 space-y-2">
                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                        <span className="bg-[#07C160]/10 text-[#07C160] font-bold px-1.5 py-0.5 rounded">{qa.asked_by}</span>
                        <span>{qa.asked_at}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-[#07C160] font-bold text-xs shrink-0 pt-0.5">Q:</span>
                        <p className="text-sm text-slate-800 font-medium">{qa.question}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-slate-400 font-bold text-xs shrink-0 pt-0.5">A:</span>
                        <div className="text-sm text-slate-600 leading-relaxed">{renderChatText(qa.answer)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 当前会话对话（本次新提问） */}
              {chatExpanded && chatHistory.length > 0 && (
                <div className="px-3 md:px-4 py-3 border-t border-slate-100 max-h-[400px] overflow-y-auto space-y-3">
                  {chatHistory.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-3.5 py-2.5 rounded-xl text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-[#07C160] text-white rounded-br-sm'
                          : 'bg-slate-50 text-slate-700 border border-slate-200 rounded-bl-sm'
                      }`}>
                        {msg.role === 'assistant' ? renderChatText(msg.content) : msg.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-slate-50 border border-slate-200 rounded-xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-2">
                        <Loader2 size={14} className="text-[#07C160] animate-spin" />
                        <span className="text-sm text-slate-400">思考中...</span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>
              )}

              {/* 输入区 */}
              <div className="px-3 py-2.5 border-t border-slate-100 flex items-center gap-2">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  placeholder="针对这场话术提问，例如：他是怎么排除科大讯飞的？"
                  className="flex-1 bg-[#F7F7F7] border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none focus:border-[#07C160] focus:ring-1 focus:ring-[#07C160]/20 transition-all"
                  disabled={chatLoading}
                />
                <button
                  onClick={sendChat}
                  disabled={chatLoading || !chatInput.trim()}
                  className="w-9 h-9 flex items-center justify-center rounded-lg bg-[#07C160] text-white hover:bg-[#06AD56] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                >
                  {chatLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                </button>
              </div>
            </div>

            {/* 报告正文 */}
            {renderMarkdown(markdown)}
          </div>
        )}
      </div>

      {/* 返回顶部 */}
      {showTop && (
        <button
          onClick={() => containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          className="fixed bottom-6 right-6 w-10 h-10 bg-[#07C160] text-white rounded-full shadow-lg flex items-center justify-center hover:bg-[#06AD56] transition-colors z-50"
        >
          <ChevronUp size={20} />
        </button>
      )}
    </div>
  );
};

export default AnalysisReportView;
