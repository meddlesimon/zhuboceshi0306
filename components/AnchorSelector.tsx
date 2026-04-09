import React, { useEffect, useState } from 'react';
import { Anchor } from '../types';
import { Users, Plus, Settings, BookOpen, Loader2, AlertTriangle, Mic, GraduationCap, Radio, Clock, Video } from 'lucide-react';

interface Props {
  onSelectAnchor: (anchor: Anchor) => void;
  onGoAnchorAdmin: () => void;
  onGoScriptAdmin: () => void;
  onGoModelAdmin: () => void;
  onGoTrainingAdmin: () => void;
}

interface SessionSummary {
  id: number;
  status: string;
  live_date: string;
  duration_seconds: number;
  created_at: string;
}

// 录制状态轮询间隔
const RECORDING_POLL_INTERVAL = 15000;

const AnchorSelector: React.FC<Props> = ({ onSelectAnchor, onGoAnchorAdmin, onGoScriptAdmin, onGoModelAdmin, onGoTrainingAdmin }) => {
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskCounts, setTaskCounts] = useState<Record<number, number>>({});
  const [latestSessions, setLatestSessions] = useState<Record<number, SessionSummary | null>>({});
  const [sessionCounts, setSessionCounts] = useState<Record<number, number>>({});
  const [recordingAnchors, setRecordingAnchors] = useState<Record<number, SessionSummary>>({});
  const [showMenu, setShowMenu] = useState(false);

  useEffect(() => {
    loadAnchors();
    // 定期轮询录制状态
    const timer = setInterval(pollRecordingStatus, RECORDING_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, []);

  // 轮询所有主播的录制状态（轻量查询）
  const pollRecordingStatus = async () => {
    try {
      const res = await fetch('/api/anchors');
      const data = await res.json();
      if (!Array.isArray(data)) return;
      const recording: Record<number, SessionSummary> = {};
      await Promise.all(
        data.map(async (a: Anchor) => {
          try {
            const r = await fetch(`/api/monitor/sessions/${encodeURIComponent(a.name)}`);
            const ss = await r.json();
            if (Array.isArray(ss)) {
              const rec = ss.find((s: any) => s.status === 'recording');
              if (rec) recording[a.id] = rec;
            }
          } catch {}
        })
      );
      setRecordingAnchors(recording);
    } catch {}
  };

  const loadAnchors = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/anchors');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setAnchors(data);
      const counts: Record<number, number> = {};
      const sessions: Record<number, SessionSummary | null> = {};
      const sCounts: Record<number, number> = {};
      const recordingMap: Record<number, SessionSummary> = {};
      await Promise.all(
        data.map(async (a: Anchor) => {
          try {
            const r = await fetch(`/api/anchors/${a.id}/tasks`);
            const tasks = await r.json();
            counts[a.id] = Array.isArray(tasks) ? tasks.filter((t: any) => t.status === 'completed').length : 0;
          } catch { counts[a.id] = 0; }
          try {
            const r2 = await fetch(`/api/monitor/sessions/${encodeURIComponent(a.name)}`);
            const ss = await r2.json();
            if (Array.isArray(ss) && ss.length > 0) {
              sCounts[a.id] = ss.filter((s: any) => s.duration_seconds > 60).length;
              // 优先用正在录制的 session，否则用最近有时长的
              const rec = ss.find((s: any) => s.status === 'recording');
              const valid = ss.find((s: any) => s.duration_seconds > 60);
              sessions[a.id] = rec || valid || null;
              // 记录录制状态
              if (rec) recordingMap[a.id] = rec;
            } else { sCounts[a.id] = 0; sessions[a.id] = null; }
          } catch { sCounts[a.id] = 0; sessions[a.id] = null; }
        })
      );
      setTaskCounts(counts);
      setLatestSessions(sessions);
      setSessionCounts(sCounts);
      setRecordingAnchors(recordingMap);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const fmtDuration = (sec: number) => {
    if (!sec) return '--';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h${m}m`;
    return `${m}min`;
  };

  const fmtTime = (dateStr: string) => {
    if (!dateStr) return '';
    try {
      // 数据库存的已经是北京时间，直接解析即可
      const s = dateStr.trim().replace(' ', 'T');
      const d = new Date(s);
      if (isNaN(d.getTime())) { const m = dateStr.match(/(\d{1,2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : ''; }
      return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch { const m = dateStr.match(/(\d{1,2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : ''; }
  };

  const liveStatus = (anchorId: number, s: SessionSummary | null) => {
    // 优先检查录制状态
    const isRecording = !!recordingAnchors[anchorId];
    if (isRecording) return <span className="mint-tag mint-tag-recording"><span className="mint-tag-dot-recording" /> 录制中</span>;
    if (!s) return null;
    if (s.status === 'recording') return <span className="mint-tag mint-tag-recording"><span className="mint-tag-dot-recording" /> 录制中</span>;
    if (s.status === 'done' || s.status === 'completed') return <span className="mint-tag mint-tag-done">✓ 已结束</span>;
    if (s.status === 'transcribing' || s.status === 'extracting' || s.status === 'uploading') return <span className="mint-tag mint-tag-processing">⏳ 处理中</span>;
    return null;
  };

  const avClasses = ['mint-av-1', 'mint-av-2', 'mint-av-3', 'mint-av-4', 'mint-av-5', 'mint-av-6'];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      {/* 导航栏 */}
      <div className="mint-topbar">
        <div className="flex items-center gap-2.5">
          <div className="mint-logo">
            <Users size={15} className="text-white" />
          </div>
          <span className="text-sm font-extrabold" style={{ color: 'var(--text)' }}>AI 智能质检</span>
        </div>
        {/* PC端：按钮平铺 */}
        <div className="hidden md:flex items-center gap-1.5">
          {localStorage.getItem('qc_role') === 'super_admin' && (
            <button onClick={onGoModelAdmin} className="mint-btn mint-btn-green">
              <Users size={13} /> 管理员
            </button>
          )}
          <button onClick={onGoTrainingAdmin} className="mint-btn">
            <GraduationCap size={13} /> 主播培训
          </button>
          <button onClick={onGoScriptAdmin} className="mint-btn">
            <BookOpen size={13} /> 话术管理
          </button>
          <button onClick={onGoAnchorAdmin} className="mint-btn">
            <Settings size={13} /> 主播管理
          </button>
          <div className="mint-user">
            <span className="mint-user-dot" />
            {localStorage.getItem('qc_display_name') || '管理员'}
          </div>
        </div>
        {/* 移动端：汉堡菜单按钮 */}
        <button className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors" onClick={() => setShowMenu(!showMenu)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
        </button>
      </div>

      {/* 移动端汉堡菜单 */}
      {showMenu && (
        <div className="fixed inset-0 z-[999] md:hidden" onClick={() => setShowMenu(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="absolute top-0 right-0 w-[240px] h-full bg-white shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#07C160]" />
                <span className="text-sm font-bold text-slate-700">{localStorage.getItem('qc_display_name') || '管理员'}</span>
              </div>
            </div>
            <div className="flex-1 py-2">
              {localStorage.getItem('qc_role') === 'super_admin' && (
                <button onClick={() => { setShowMenu(false); onGoModelAdmin(); }} className="w-full px-4 py-3 flex items-center gap-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                  <Users size={16} className="text-[#07C160]" /> 管理员设置
                </button>
              )}
              <button onClick={() => { setShowMenu(false); onGoTrainingAdmin(); }} className="w-full px-4 py-3 flex items-center gap-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                <GraduationCap size={16} className="text-slate-400" /> 主播培训
              </button>
              <button onClick={() => { setShowMenu(false); onGoScriptAdmin(); }} className="w-full px-4 py-3 flex items-center gap-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                <BookOpen size={16} className="text-slate-400" /> 话术管理
              </button>
              <button onClick={() => { setShowMenu(false); onGoAnchorAdmin(); }} className="w-full px-4 py-3 flex items-center gap-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors">
                <Settings size={16} className="text-slate-400" /> 主播管理
              </button>
            </div>
            <div className="p-4 border-t border-slate-100">
              <button onClick={() => { localStorage.removeItem('qc_logged_in'); window.location.reload(); }} className="w-full py-2.5 text-sm text-red-500 font-bold rounded-lg hover:bg-red-50 transition-colors">
                退出登录
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 主内容 */}
      <div className="max-w-[960px] mx-auto px-4 md:px-7 py-5 md:py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Loader2 size={28} className="animate-spin" style={{ color: 'var(--green)' }} />
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>加载中...</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 rounded-xl p-5 flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-red-700">加载失败</p>
              <p className="text-xs text-red-500 mt-1">{error}</p>
              <button onClick={loadAnchors} className="mt-2 text-xs text-red-600 underline font-bold">重试</button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h2 className="text-xl font-black" style={{ color: 'var(--text)' }}>选择主播</h2>
              <p className="text-[13px] mt-1" style={{ color: 'var(--text-3)' }}>点击主播卡片进入工作台，查看历史报告或发起新质检</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {anchors.map((anchor, idx) => {
                const latest = latestSessions[anchor.id];
                const sCount = sessionCounts[anchor.id] || 0;
                const isLive = latest?.status === 'recording' || !!recordingAnchors[anchor.id];

                return (
                  <button
                    key={anchor.id}
                    onClick={() => onSelectAnchor(anchor)}
                    className={`mint-card group text-left ${isLive ? 'mint-card-live' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="relative">
                        <div className={`mint-avatar ${avClasses[idx % avClasses.length]}`}>
                          <Mic size={20} className="text-white" />
                        </div>
                        {isLive && <span className="mint-live-dot" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-extrabold truncate" style={{ color: 'var(--text)' }}>{anchor.name}</h3>
                          {liveStatus(anchor.id, latest)}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>
                            🎬 <b style={{ color: 'var(--text-2)', fontWeight: 800 }}>{sCount}</b> 场录制
                          </span>
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--text-3)' }}>
                            📋 <b style={{ color: 'var(--text-2)', fontWeight: 800 }}>{taskCounts[anchor.id] ?? 0}</b> 份报告
                          </span>
                        </div>
                      </div>
                    </div>

                    {latest && latest.duration_seconds > 0 ? (
                      <div className="mt-3 pt-2.5 flex items-center gap-3 text-[11px] font-semibold" style={{ borderTop: '1px solid var(--border)', color: 'var(--text-4)' }}>
                        <span>📅 {latest.live_date}</span>
                        <span className="flex items-center gap-0.5"><Clock size={10} /> {fmtDuration(latest.duration_seconds)}</span>
                        {latest.created_at && <span style={{ color: 'var(--red)' }}>开播 {fmtTime(latest.created_at)}</span>}
                      </div>
                    ) : (
                      <div className="mt-3 pt-2.5" style={{ borderTop: '1px solid var(--border)' }}>
                        <span className="text-[11px] font-medium" style={{ color: 'var(--text-4)' }}>暂无直播记录</span>
                      </div>
                    )}

                    {/* hover 箭头 */}
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all" style={{ color: 'var(--green)' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </button>
                );
              })}

              {/* 添加主播 */}
              <button onClick={onGoAnchorAdmin} className="mint-add">
                <div className="mint-add-icon">
                  <Plus size={18} style={{ color: 'var(--text-4)' }} />
                </div>
                <div>
                  <p className="text-[13px] font-bold" style={{ color: 'var(--text-3)' }}>添加主播</p>
                  <p className="text-[11px]" style={{ color: 'var(--text-4)' }}>管理主播列表</p>
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
