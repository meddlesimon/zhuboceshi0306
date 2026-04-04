import React, { useEffect, useState } from 'react';
import { Anchor } from '../types';
import { Users, Plus, Settings, BookOpen, Loader2, AlertTriangle, Mic, Cpu, GraduationCap, Radio, Clock, Video } from 'lucide-react';

interface Props {
  onSelectAnchor: (anchor: Anchor) => void;
  onGoAnchorAdmin: () => void;
  onGoScriptAdmin: () => void;
  onGoModelAdmin: () => void;
  onGoTrainingAdmin: () => void;
}

// 直播场次摘要
interface SessionSummary {
  id: number;
  status: string;
  live_date: string;
  duration_seconds: number;
  created_at: string;
}

const AnchorSelector: React.FC<Props> = ({ onSelectAnchor, onGoAnchorAdmin, onGoScriptAdmin, onGoModelAdmin, onGoTrainingAdmin }) => {
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskCounts, setTaskCounts] = useState<Record<number, number>>({});
  // 每个主播最近的直播场次
  const [latestSessions, setLatestSessions] = useState<Record<number, SessionSummary | null>>({});
  const [sessionCounts, setSessionCounts] = useState<Record<number, number>>({});

  useEffect(() => {
    loadAnchors();
  }, []);

  const loadAnchors = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/anchors');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setAnchors(data);

      // 并行加载报告数量和直播信息
      const counts: Record<number, number> = {};
      const sessions: Record<number, SessionSummary | null> = {};
      const sCounts: Record<number, number> = {};
      await Promise.all(
        data.map(async (a: Anchor) => {
          try {
            const r = await fetch(`/api/anchors/${a.id}/tasks`);
            const tasks = await r.json();
            counts[a.id] = Array.isArray(tasks) ? tasks.filter((t: any) => t.status === 'completed').length : 0;
          } catch { counts[a.id] = 0; }

          // 拉取直播场次
          try {
            const r2 = await fetch(`/api/monitor/sessions/${encodeURIComponent(a.name)}`);
            const ss = await r2.json();
            if (Array.isArray(ss) && ss.length > 0) {
              sCounts[a.id] = ss.filter((s: any) => s.duration_seconds > 60).length;
              // 找最近一场有效的
              const valid = ss.find((s: any) => s.duration_seconds > 60);
              sessions[a.id] = valid || null;
            } else {
              sCounts[a.id] = 0;
              sessions[a.id] = null;
            }
          } catch {
            sCounts[a.id] = 0;
            sessions[a.id] = null;
          }
        })
      );
      setTaskCounts(counts);
      setLatestSessions(sessions);
      setSessionCounts(sCounts);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // 格式化时长
  const fmtDuration = (sec: number) => {
    if (!sec) return '--';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h${m}m`;
    return `${m}min`;
  };

  // 格式化时间（UTC → 北京时间）
  const fmtTime = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      // 监控系统的 created_at 是 UTC，格式如 '2026-04-04 07:00:12'
      const utcStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T');
      const d = new Date(utcStr + (utcStr.includes('Z') || utcStr.includes('+') ? '' : 'Z'));
      if (isNaN(d.getTime())) {
        const match = dateStr.match(/(\d{1,2}):(\d{2})/);
        return match ? `${match[1]}:${match[2]}` : '';
      }
      return d.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
    } catch {
      const match = dateStr.match(/(\d{1,2}):(\d{2})/);
      return match ? `${match[1]}:${match[2]}` : '';
    }
  };

  // 直播状态标签
  const liveStatus = (s: SessionSummary | null) => {
    if (!s) return null;
    if (s.status === 'recording') {
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-black rounded-full bg-red-50 text-red-600 border border-red-100 animate-pulse"><Radio size={8} /> 直播中</span>;
    }
    if (s.status === 'done' || s.status === 'completed') {
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-green-50 text-green-600 border border-green-100">已结束</span>;
    }
    if (s.status === 'transcribing' || s.status === 'extracting' || s.status === 'uploading') {
      return <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold rounded-full bg-amber-50 text-amber-600 border border-amber-100">处理中</span>;
    }
    return null;
  };

  const avatarColors = [
    'from-blue-500 to-indigo-600',
    'from-violet-500 to-purple-600',
    'from-rose-500 to-pink-600',
    'from-amber-500 to-orange-600',
    'from-emerald-500 to-teal-600',
    'from-cyan-500 to-blue-600',
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 顶部 Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center shadow">
            <Users size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900">AI 智能质检系统</h1>
            <p className="text-xs text-slate-400">选择主播开始质检</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {localStorage.getItem('qc_role') === 'super_admin' && (
            <button onClick={onGoModelAdmin} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition-all">
              <Users size={14} /> 管理员管理
            </button>
          )}
          <button onClick={onGoTrainingAdmin} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-all">
            <GraduationCap size={14} /> 主播培训
          </button>
          <button onClick={onGoScriptAdmin} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all">
            <BookOpen size={14} /> 话术管理
          </button>
          <button onClick={onGoAnchorAdmin} className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all">
            <Settings size={14} /> 主播管理
          </button>
          <span className="text-[11px] text-slate-400 ml-1">{localStorage.getItem('qc_display_name') || ''}</span>
        </div>
      </div>

      {/* 主内容 */}
      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Loader2 size={32} className="text-blue-500 animate-spin" />
            <p className="text-sm text-slate-400">加载中...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-6 flex items-start gap-3">
            <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-700">加载失败</p>
              <p className="text-xs text-red-500 mt-1">{error}</p>
              <button onClick={loadAnchors} className="mt-3 text-xs text-red-600 underline">重试</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-lg font-black text-slate-900">选择主播</h2>
              <p className="text-sm text-slate-400 mt-0.5">点击主播卡片进入工作台，查看历史报告或发起新质检</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {anchors.map((anchor, idx) => {
                const latest = latestSessions[anchor.id];
                const sCount = sessionCounts[anchor.id] || 0;
                const isLive = latest?.status === 'recording';

                return (
                <button
                  key={anchor.id}
                  onClick={() => onSelectAnchor(anchor)}
                  className={`group bg-white rounded-2xl border p-5 text-left hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 ${
                    isLive ? 'border-red-200 ring-1 ring-red-100' : 'border-slate-100 hover:border-blue-100'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarColors[idx % avatarColors.length]} flex items-center justify-center shadow-lg shrink-0 relative`}>
                      <Mic size={24} className="text-white" />
                      {isLive && (
                        <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full border-2 border-white animate-pulse" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-black text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                          {anchor.name}
                        </h3>
                        {liveStatus(latest)}
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <Video size={10} /> {sCount} 场录制
                        </span>
                        <span className="text-[11px] text-slate-400">
                          📋 {taskCounts[anchor.id] ?? 0} 份报告
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 最近一场直播信息 */}
                  {latest && latest.duration_seconds > 0 ? (
                    <div className="mt-3 pt-3 border-t border-slate-50 flex items-center gap-4 text-[11px] text-slate-400">
                      <span>📅 {latest.live_date}</span>
                      <span className="flex items-center gap-1"><Clock size={10} /> {fmtDuration(latest.duration_seconds)}</span>
                      {latest.created_at && <span className="text-slate-300">开播 {fmtTime(latest.created_at)}</span>}
                    </div>
                  ) : (
                    <div className="mt-3 pt-3 border-t border-slate-50">
                      <span className="text-[11px] text-slate-300">暂无直播记录</span>
                    </div>
                  )}
                </button>
                );
              })}

              {/* 新增主播快捷入口 */}
              <button
                onClick={onGoAnchorAdmin}
                className="group bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-5 text-left hover:border-blue-300 hover:bg-blue-50/30 transition-all duration-200"
              >
                <div className="flex items-center gap-4 h-14">
                  <div className="w-14 h-14 rounded-2xl bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center transition-colors shrink-0">
                    <Plus size={24} className="text-slate-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-500 group-hover:text-blue-600 transition-colors">添加主播</p>
                    <p className="text-xs text-slate-400">管理主播列表</p>
                  </div>
                </div>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AnchorSelector;
