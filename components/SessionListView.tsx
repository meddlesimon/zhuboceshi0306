import React, { useEffect, useState, useRef } from 'react';
import { Anchor } from '../types';
import {
  ArrowLeft, Play, Clock, Calendar, Video, Loader2, AlertTriangle,
  Search, X, ChevronRight, Monitor, Pause, Shield
} from 'lucide-react';

interface LiveSession {
  id: number;
  anchor_id: number;
  anchor_name: string;
  title: string;
  live_date: string;
  status: string;
  duration_seconds: number;
  video_cos_url: string;
  transcript?: {
    timestamped_text?: string;
    full_text?: string;
  };
  created_at: string;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface Props {
  anchor: Anchor;
  onBack: () => void;
}

const SessionListView: React.FC<Props> = ({ anchor, onBack }) => {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<LiveSession | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [activeSegIndex, setActiveSegIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // 视频加载状态
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [buffering, setBuffering] = useState(false);

  // 可拖拽分割线
  const [videoPct, setVideoPct] = useState(() => {
    try { return parseFloat(localStorage.getItem('replay_video_width') || '45') || 45; } catch { return 45; }
  });
  const isDraggingRef = useRef(false);
  const layoutRef = useRef<HTMLDivElement>(null);

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !layoutRef.current) return;
      const rect = layoutRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setVideoPct(Math.min(Math.max(pct, 25), 65));
    };
    const onUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      setVideoPct(w => { try { localStorage.setItem('replay_video_width', String(w)); } catch {} return w; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const videoRef = useRef<HTMLVideoElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const segRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    loadSessions();
  }, [anchor.name]);

  const loadSessions = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/monitor/sessions/${encodeURIComponent(anchor.name)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setSessions(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e.message);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  // 选择某个场次，加载详情
  const selectSession = async (session: LiveSession) => {
    setSelectedSession(session);
    setSegments([]);
    setActiveSegIndex(-1);
    setSearchQuery('');
    setVideoLoading(true);
    setVideoError(null);
    setVideoReady(false);
    setBuffering(false);
    setCurrentTime(0);
    setDuration(0);
    try {
      const res = await fetch(`/api/monitor/session/${session.id}`);
      const data = await res.json();
      if (data.transcript?.timestamped_text) {
        const parsed = parseTimestampedText(data.transcript.timestamped_text);
        setSegments(parsed);
      }
      // 更新 session 信息（包含 video_cos_url）
      setSelectedSession({ ...session, ...data });
    } catch (e: any) {
      console.error('加载场次详情失败:', e);
    }
  };

  // 重试加载视频
  const retryVideo = () => {
    setVideoError(null);
    setVideoLoading(true);
    setVideoReady(false);
    if (videoRef.current && selectedSession?.video_cos_url) {
      videoRef.current.load();
    }
  };

  // 手动触发质检
  const [triggeringQC, setTriggeringQC] = useState<number | null>(null);
  const triggerQC = async (session: LiveSession, e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止冒泡，别跳转到场次详情
    if (triggeringQC) return;
    setTriggeringQC(session.id);
    try {
      const res = await fetch('/api/webhook/trigger-qc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anchor_id: anchor.id, session_id: session.id })
      });
      const data = await res.json();
      if (data.success) {
        alert(`✅ 质检已触发\n任务ID: ${data.task_id}\n文本: ${data.text_length}字\n模式: ${data.is_dual ? '双轮' : '单轮'}`);
      } else {
        alert(`❌ 触发失败: ${data.error || '未知错误'}`);
      }
    } catch (err: any) {
      alert(`❌ 请求失败: ${err.message}`);
    } finally {
      setTriggeringQC(null);
    }
  };

  // 解析带时间戳的文字稿
  const parseTimestampedText = (jsonStr: string): TranscriptSegment[] => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];
      const toSec = (v: number) => (v || 0) / 1000;
      const raw = parsed.map((s: any) => ({
        start: toSec(s.start_time != null ? s.start_time : s.start),
        end: toSec(s.end_time != null ? s.end_time : s.end),
        text: (s.text || s.content || '').trim()
      })).filter((s: TranscriptSegment) => s.text);

      // 每30秒合并
      const MERGE_SEC = 30;
      const merged: TranscriptSegment[] = [];
      let group: TranscriptSegment | null = null;
      for (const seg of raw) {
        if (!group || seg.start - group.start >= MERGE_SEC) {
          group = { start: seg.start, end: seg.end, text: seg.text };
          merged.push(group);
        } else {
          group.end = seg.end;
          group.text += seg.text;
        }
      }
      return merged;
    } catch {
      return [];
    }
  };

  // 格式化时间
  const formatTime = (sec: number) => {
    if (!sec || isNaN(sec)) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // 格式化时长
  const formatDuration = (sec: number) => {
    if (!sec) return '--';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}小时${m}分`;
    return `${m}分钟`;
  };

  // 格式化为北京时间（数据库存的是 UTC 时间，无时区标识）
  const parseUTCDate = (dateStr: string) => {
    if (!dateStr) return null;
    // 如果没有时区标识（Z 或 +/-），当作 UTC 解析
    const s = dateStr.trim();
    if (!s.includes('Z') && !s.includes('+') && !s.match(/\d{2}:\d{2}:\d{2}[+-]/)) {
      return new Date(s.replace(' ', 'T') + 'Z');
    }
    return new Date(s);
  };

  const toBeijingTime = (dateStr: string, format: 'datetime' | 'time' | 'date' = 'datetime') => {
    try {
      const d = parseUTCDate(dateStr);
      if (!d || isNaN(d.getTime())) return dateStr;
      if (format === 'time') return d.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
      if (format === 'date') return d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit' });
      return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return dateStr; }
  };

  // 计算开播和结束时间
  const getSessionTimes = (session: LiveSession) => {
    const startStr = session.created_at || session.live_date;
    const startD = parseUTCDate(startStr);
    const start = toBeijingTime(startStr, 'time');
    const startDate = toBeijingTime(startStr, 'date');
    if (session.duration_seconds && session.duration_seconds > 0 && startD) {
      try {
        const endDate = new Date(startD.getTime() + session.duration_seconds * 1000);
        const end = endDate.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });
        return { startDate, start, end, duration: formatDuration(session.duration_seconds), startMs: startD.getTime() };
      } catch {}
    }
    return { startDate, start, end: null, duration: formatDuration(session.duration_seconds), startMs: startD?.getTime() || 0 };
  };

  // 正在录制的场次：动态计算已录时长
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 视频时间更新 → 同步字幕高亮
  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    setCurrentTime(v.currentTime);
    // 找到当前时间对应的段落
    let found = -1;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (v.currentTime >= segments[i].start) { found = i; break; }
    }
    if (found >= 0 && found !== activeSegIndex) {
      setActiveSegIndex(found);
      // 滚动到对应位置
      const el = segRefs.current[found];
      const container = transcriptRef.current;
      if (el && container) {
        const elRect = el.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const isVisible = elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom;
        if (!isVisible) {
          container.scrollTo({
            top: elRect.top - containerRect.top + container.scrollTop - 16,
            behavior: 'smooth'
          });
        }
      }
    }
  };

  // 点击字幕跳转视频
  const seekTo = (time: number) => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = time;
      if (v.paused) { v.play().catch(() => {}); setIsPlaying(true); }
    }
  };

  // 搜索过滤
  const searchMatchIndexes = searchQuery.trim()
    ? segments.map((s, i) => s.text.toLowerCase().includes(searchQuery.toLowerCase()) ? i : -1).filter(i => i >= 0)
    : [];
  const searchMatchSet = new Set(searchMatchIndexes);

  // 高亮搜索词
  const highlightSearch = (text: string) => {
    if (!searchQuery.trim()) return text;
    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark style="background:#fef08a;color:#92400e;border-radius:2px;padding:0 2px">$1</mark>');
  };

  // 状态标签
  const statusBadge = (status: string) => {
    const map: Record<string, { cls: string; label: string }> = {
      'completed': { cls: 'bg-green-100 text-green-700', label: '已完成' },
      'done': { cls: 'bg-green-100 text-green-700', label: '已完成' },
      'transcribed': { cls: 'bg-blue-100 text-blue-700', label: '已转录' },
      'recording': { cls: 'bg-red-100 text-red-700', label: '录制中' },
      'transcribing': { cls: 'bg-amber-100 text-amber-700', label: '转录中' },
      'uploading': { cls: 'bg-purple-100 text-purple-700', label: '上传中' },
      'extracting': { cls: 'bg-purple-100 text-purple-700', label: '处理中' },
      'error': { cls: 'bg-red-100 text-red-600', label: '失败' },
    };
    const m = map[status] || { cls: 'bg-slate-100 text-slate-500', label: status };
    return <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${m.cls}`}>{m.label}</span>;
  };

  // ====== 场次详情视图（视频 + 逐字稿） ======
  if (selectedSession) {
    return (
      <div className="h-screen flex flex-col bg-slate-50 overflow-hidden">
        {/* 顶部栏 */}
        <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 shadow-sm shrink-0 z-10">
          <button onClick={() => setSelectedSession(null)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors">
            <ArrowLeft size={16} className="text-slate-600" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">{selectedSession.title || '直播回放'}</p>
            <p className="text-[10px] text-slate-400">
              {(() => {
                const t = getSessionTimes(selectedSession);
                if (selectedSession.status === 'recording') {
                  const elapsed = Math.floor((now - (parseUTCDate(selectedSession.created_at || selectedSession.live_date)?.getTime() || now)) / 1000);
                  return `🔴 录制中 · ${t.start}开播 · 已录${formatDuration(elapsed)}`;
                }
                return `${t.startDate} ${t.start}${t.end ? ` - ${t.end}` : ''} · ${t.duration}`;
              })()}
            </p>
          </div>
          {/* 搜索 */}
          <div className="flex items-center gap-1 bg-slate-50 rounded-full px-3 py-1.5 border border-slate-200 max-w-[200px]">
            <Search size={12} className="text-slate-400 shrink-0" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索..."
              className="bg-transparent border-none outline-none text-xs text-slate-600 w-full"
            />
            {searchQuery && (
              <>
                <span className="text-[10px] text-emerald-600 font-bold whitespace-nowrap">{searchMatchIndexes.length}处</span>
                <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600"><X size={12} /></button>
              </>
            )}
          </div>
        </div>

        {/* 主体：左视频 + 拖拽线 + 右逐字稿 */}
        <div ref={layoutRef} className="flex-1 flex min-h-0">
          {/* 左：视频区 */}
          <div style={{ width: `${videoPct}%` }} className="bg-slate-900 shrink-0 overflow-hidden flex flex-col">
            {selectedSession.video_cos_url ? (
              <>
                <div className="relative p-3 flex-1 min-h-0 flex items-start justify-center">
                  {/* 视频元素 */}
                  <video
                    ref={videoRef}
                    src={selectedSession.video_cos_url}
                    className="w-full rounded-lg shadow-2xl"
                    style={{ maxHeight: 'calc(100vh - 130px)', objectFit: 'contain' }}
                    controls
                    preload="auto"
                    onTimeUpdate={onTimeUpdate}
                    onLoadedMetadata={() => {
                      if (videoRef.current) setDuration(videoRef.current.duration);
                      setVideoLoading(false);
                      setVideoReady(true);
                    }}
                    onCanPlay={() => {
                      setVideoReady(true);
                      setVideoLoading(false);
                      setBuffering(false);
                    }}
                    onWaiting={() => setBuffering(true)}
                    onPlaying={() => { setBuffering(false); setIsPlaying(true); }}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onError={(e) => {
                      const video = e.currentTarget;
                      const err = video.error;
                      let msg = '视频加载失败';
                      if (err) {
                        if (err.code === 1) msg = '视频加载被中断';
                        else if (err.code === 2) msg = '网络错误，请检查网络连接';
                        else if (err.code === 3) msg = '视频解码失败，格式可能不支持';
                        else if (err.code === 4) msg = '视频源不可用';
                      }
                      setVideoError(msg);
                      setVideoLoading(false);
                    }}
                  />

                  {/* 加载中遮罩 */}
                  {videoLoading && !videoError && !videoReady && (
                    <div className="absolute inset-3 flex flex-col items-center justify-center bg-slate-900/80 rounded-lg">
                      <Loader2 size={36} className="text-blue-400 animate-spin mb-3" />
                      <p className="text-sm text-slate-300 font-bold">视频加载中...</p>
                      <p className="text-[10px] text-slate-500 mt-1">
                        {selectedSession.duration_seconds > 3600
                          ? '较大文件，首次加载可能需要 10-30 秒'
                          : '请稍候'}
                      </p>
                    </div>
                  )}

                  {/* 缓冲中提示 */}
                  {buffering && !videoLoading && (
                    <div className="absolute top-6 left-6 right-6 flex items-center justify-center">
                      <div className="bg-black/70 rounded-full px-4 py-2 flex items-center gap-2">
                        <Loader2 size={14} className="text-white animate-spin" />
                        <span className="text-xs text-white font-medium">缓冲中...</span>
                      </div>
                    </div>
                  )}

                  {/* 错误状态 */}
                  {videoError && (
                    <div className="absolute inset-3 flex flex-col items-center justify-center bg-slate-900/90 rounded-lg">
                      <AlertTriangle size={32} className="text-red-400 mb-3" />
                      <p className="text-sm text-red-300 font-bold mb-1">{videoError}</p>
                      <p className="text-[10px] text-slate-500 mb-3">可能是网络问题或视频文件异常</p>
                      <button
                        onClick={retryVideo}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition-colors"
                      >
                        重新加载
                      </button>
                    </div>
                  )}
                </div>
                <div className="px-4 pb-2 flex items-center gap-3 shrink-0">
                  <span className="text-xs text-slate-400 font-mono">{formatTime(currentTime)} / {formatTime(duration)}</span>
                  {selectedSession.duration_seconds > 1800 && (
                    <span className="text-[9px] text-slate-600 bg-slate-800 px-2 py-0.5 rounded-full">
                      {formatDuration(selectedSession.duration_seconds)}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-400">
                <div className="text-center">
                  {selectedSession.status === 'recording' ? (
                    <>
                      <div className="w-16 h-16 mx-auto mb-4 bg-red-500/20 rounded-full flex items-center justify-center">
                        <div className="w-4 h-4 bg-red-500 rounded-full animate-pulse" />
                      </div>
                      <p className="text-sm font-bold text-red-400 mb-1">🔴 正在录制中</p>
                      <p className="text-xs text-slate-500">
                        {getSessionTimes(selectedSession).start} 开播 · 已录制 {formatDuration(Math.floor((now - (parseUTCDate(selectedSession.created_at || selectedSession.live_date)?.getTime() || now)) / 1000))}
                      </p>
                      <p className="text-[10px] text-slate-600 mt-2">直播结束后自动生成回放视频</p>
                    </>
                  ) : (
                    <>
                      <Video size={40} className="mx-auto mb-3 opacity-30" />
                      <p className="text-sm">视频处理中...</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 可拖拽分割线 */}
          <div
            onMouseDown={handleDragStart}
            className="w-[5px] shrink-0 cursor-col-resize bg-slate-200 hover:bg-blue-400 active:bg-blue-500 transition-colors relative group"
            title="拖拽调整宽度"
          >
            <div className="absolute inset-y-0 -left-1 -right-1" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-slate-400 group-hover:bg-white transition-colors" />
          </div>

          {/* 右：逐字稿区 */}
          <div ref={transcriptRef} className="flex-1 overflow-y-auto bg-white">
            {segments.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                {selectedSession.status === 'transcribing' ? '🔄 正在转录中...' : '暂无逐字稿'}
              </div>
            ) : (
              <div>
                {segments.map((seg, idx) => (
                  <div
                    key={idx}
                    ref={el => { segRefs.current[idx] = el; }}
                    className={`flex gap-3 px-4 py-3 cursor-pointer border-l-3 transition-colors border-b border-slate-50 ${
                      idx === activeSegIndex
                        ? 'bg-blue-50 border-l-blue-500 border-l-[3px]'
                        : searchMatchSet.has(idx)
                        ? 'bg-amber-50 border-l-transparent border-l-[3px]'
                        : 'hover:bg-slate-50 border-l-transparent border-l-[3px]'
                    }`}
                    onClick={() => seekTo(seg.start)}
                  >
                    <span className="text-[11px] text-blue-500 font-mono font-bold whitespace-nowrap pt-0.5 min-w-[40px]">
                      {formatTime(seg.start)}
                    </span>
                    <p
                      className={`text-sm leading-relaxed ${idx === activeSegIndex ? 'text-slate-900 font-medium' : 'text-slate-600'}`}
                      dangerouslySetInnerHTML={{ __html: highlightSearch(seg.text) }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ====== 场次列表视图 ======
  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* 空状态 / 加载中 / 列表 */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={28} className="text-blue-500 animate-spin" />
        </div>
      ) : error ? (
        <div className="p-6">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 flex items-start gap-2">
            <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-600">{error}</p>
          </div>
        </div>
      ) : sessions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400 p-8">
          <Monitor size={48} className="opacity-20" />
          <div className="text-center">
            <p className="text-sm font-medium mb-1">暂无直播录制记录</p>
            <p className="text-xs">请先在主播管理中配置抖音直播间链接，<br/>系统将自动监控并录制直播</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {(() => {
            // 按日期分组
            const groups: Record<string, LiveSession[]> = {};
            sessions.forEach(s => {
              const dateKey = toBeijingTime(s.created_at || s.live_date, 'date');
              if (!groups[dateKey]) groups[dateKey] = [];
              groups[dateKey].push(s);
            });
            const weekDays = ['周日','周一','周二','周三','周四','周五','周六'];
            return Object.entries(groups).map(([dateStr, dateSessions]) => {
              const d = parseUTCDate(dateSessions[0].created_at || dateSessions[0].live_date);
              const weekDay = d ? weekDays[d.getDay()] : '';
              return (
                <div key={dateStr}>
                  {/* 日期大标题 */}
                  <div className="flex items-center gap-3 mb-2.5 px-1">
                    <h2 className="text-base font-black text-slate-800">{dateStr} {weekDay}</h2>
                    <span className="text-[11px] text-slate-400 font-medium">{dateSessions.length} 场</span>
                    <div className="flex-1 h-px bg-slate-200" />
                  </div>
                  {/* 该日期下的场次 */}
                  <div className="space-y-2">
                    {dateSessions.map((session, idx) => {
                      const t = getSessionTimes(session);
                      const isRecording = session.status === 'recording';
                      const elapsed = isRecording ? Math.floor((now - (t.startMs || now)) / 1000) : 0;
                      return (
                        <div
                          key={session.id}
                          onClick={() => selectSession(session)}
                          className={`bg-white rounded-xl border p-4 hover:shadow-md transition-all cursor-pointer group ${isRecording ? 'border-red-200 shadow-sm' : 'border-slate-100 hover:border-blue-200'}`}
                        >
                          <div className="flex items-center gap-4">
                            {/* 场次序号 */}
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm shrink-0 ${isRecording ? 'bg-gradient-to-br from-red-500 to-red-600' : 'bg-gradient-to-br from-blue-500 to-indigo-600'}`}>
                              {isRecording 
                                ? <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                                : <Play size={16} className="text-white ml-0.5" />
                              }
                            </div>
                            {/* 核心信息：时间为主 */}
                            <div className="flex-1 min-w-0">
                              {/* 主标题 = 时间 */}
                              <div className="flex items-baseline gap-2">
                                <span className="text-lg font-black text-slate-800">
                                  {t.start}
                                </span>
                                {t.end && !isRecording && (
                                  <>
                                    <span className="text-slate-300">→</span>
                                    <span className="text-lg font-black text-slate-800">{t.end}</span>
                                  </>
                                )}
                                {isRecording && (
                                  <span className="text-sm font-bold text-red-500 animate-pulse">录制中</span>
                                )}
                              </div>
                              {/* 副标题 = 时长 + 标题 */}
                              <div className="flex items-center gap-2 mt-0.5">
                                {isRecording ? (
                                  <span className="text-xs text-red-400 font-bold">已录 {formatDuration(elapsed)}</span>
                                ) : (
                                  <span className="text-xs text-slate-400 font-medium">{t.duration}</span>
                                )}
                                {session.title && (
                                  <span className="text-xs text-slate-300 truncate">· {session.title}</span>
                                )}
                              </div>
                            </div>
                            {/* 右侧：质检按钮 + 状态 */}
                            <div className="flex items-center gap-2 shrink-0">
                              {session.status === 'done' && session.duration_seconds > 60 && (
                                <button
                                  onClick={(e) => triggerQC(session, e)}
                                  disabled={triggeringQC === session.id}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded-lg border border-emerald-100 hover:bg-emerald-100 transition-colors disabled:opacity-50"
                                >
                                  {triggeringQC === session.id ? (
                                    <Loader2 size={10} className="animate-spin" />
                                  ) : (
                                    <Shield size={10} />
                                  )}
                                  质检
                                </button>
                              )}
                              {statusBadge(session.status)}
                              <ChevronRight size={16} className="text-slate-300 group-hover:text-blue-500 transition-colors" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}
    </div>
  );
};

export default SessionListView;
