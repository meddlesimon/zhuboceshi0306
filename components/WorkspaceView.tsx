import React, { useEffect, useState, useRef } from 'react';
import { Anchor, Task, MultiRoundResult, Standard, StreamMetadata, AppStep, AnchorResult } from '../types';
import { parseTranscript, parseMetadataFromFilename } from '../utils/csvHelper';
import { findCandidateAnchors } from '../services/doubaoService';
import ReportView from './ReportView';
import AnchorVerification from './AnchorVerification';
import FileUploader from './FileUploader';
import SessionListView from './SessionListView';
import ReportVideoPanel from './ReportVideoPanel';
import {
  ArrowLeft, Plus, FileText, Loader2, AlertTriangle, CheckCircle2,
  Clock, TrendingUp, Split, ChevronUp, ChevronDown, RefreshCw, Mic,
  Video, Shield, Eye
} from 'lucide-react';

interface Props {
  anchor: Anchor;
  onBack: () => void;
}

type PanelMode = 'list' | 'new-check' | 'verify-anchors' | 'analyzing' | 'report';
type WorkspaceTab = 'replay' | 'qc';

const WorkspaceView: React.FC<Props> = ({ anchor, onBack }) => {
  // Tab 切换：外部主播默认只有"全场回看"，内部主播默认也先看"全场回看"
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('replay');
  const [replayDetail, setReplayDetail] = useState(false);
  const enableQc = anchor.enable_qc !== false;

  const [panelMode, setPanelMode] = useState<PanelMode>('list');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 新建质检状态
  const [transcript, setTranscript] = useState('');
  const [fullRawText, setFullRawText] = useState('');
  const [transcriptFileName, setTranscriptFileName] = useState('');
  const [metadata, setMetadata] = useState<StreamMetadata>({ fileName: '', anchorName: '', date: '', round: '' });
  const [isDualRound, setIsDualRound] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [candidateAnchors, setCandidateAnchors] = useState<AnchorResult | null>(null);
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [currentTaskStatus, setCurrentTaskStatus] = useState<string>('');
  const [currentTaskProgress, setCurrentTaskProgress] = useState<string>('');
  const [hasStandards, setHasStandards] = useState<boolean | null>(null);

  // 报告查看
  const [viewingReport, setViewingReport] = useState<{ result: MultiRoundResult; standards: Standard[]; metadata: StreamMetadata; taskId?: string } | null>(null);
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);

  // 视频面板相关
  const [reportVideoUrl, setReportVideoUrl] = useState<string | null>(null);
  const [reportVideoSegments, setReportVideoSegments] = useState<any[]>([]);
  const [showVideoPanel, setShowVideoPanel] = useState(false);

  // 排序
  const [sortBy, setSortBy] = useState<'created_at' | 'score_r1'>('created_at');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (enableQc) {
      loadTasks();
      checkStandards();
    }
  }, [anchor.id]);

  useEffect(() => {
    return () => { if (pollTimer.current) clearInterval(pollTimer.current); };
  }, []);

  const checkStandards = async () => {
    try {
      const res = await fetch('/api/standards/current/detail');
      setHasStandards(res.ok);
    } catch { setHasStandards(false); }
  };

  const loadTasks = async () => {
    setLoadingTasks(true);
    try {
      const res = await fetch(`/api/anchors/${anchor.id}/tasks`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setTasks(data);
      const running = data.find((t: Task) => t.status === 'pending' || t.status === 'running');
      if (running) startPolling(running.id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingTasks(false);
    }
  };

  const startPolling = (taskId: string) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        const task = await res.json();
        if (task.status === 'completed' || task.status === 'failed') {
          clearInterval(pollTimer.current!);
          loadTasks();
        } else {
          setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: task.status, progress_message: task.progress_message } : t));
        }
      } catch {}
    }, 3000);
  };

  const handleTranscriptUpload = (content: string, fileName: string) => {
    try {
      setFullRawText(content);
      const parsed = parseTranscript(content);
      if (!parsed || parsed.length < 5) throw new Error('文本内容过短，请检查文件');
      setTranscript(parsed);
      const meta = parseMetadataFromFilename(fileName);
      meta.anchorName = anchor.name;
      setMetadata(meta);
      setTranscriptFileName(fileName);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const startScanningAnchors = () => {
    setError(null);
    setCandidateAnchors({
      r1StartPhrase: null, r1StartPos: -1,
      r1EndPhrase: null, r1EndPos: -1,
      r2StartPhrase: null, r2StartPos: -1,
      r2EndPhrase: null, r2EndPos: -1,
    });
    setPanelMode('verify-anchors');
  };

  const submitTask = async (manualAnchors: AnchorResult | null) => {
    setPanelMode('analyzing');
    setError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          anchor_id: anchor.id,
          transcript_text: transcript,
          transcript_filename: transcriptFileName || '未命名文件',
          is_dual_mode: isDualRound,
          manual_anchors: manualAnchors
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '提交失败');

      setCurrentTaskId(data.task_id);
      setCurrentTaskStatus('pending');
      setCurrentTaskProgress('任务已提交，后台处理中...');

      const newTask: Task = {
        id: data.task_id,
        anchor_id: anchor.id,
        anchor_name: anchor.name,
        standards_version_id: null,
        status: 'pending',
        transcript_filename: transcriptFileName || '未命名文件',
        score_r1: null,
        score_r2: null,
        is_dual_mode: isDualRound ? 1 : 0,
        progress_message: '任务已提交...',
        created_at: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
        completed_at: null,
        error_message: null
      };
      setTasks(prev => [newTask, ...prev]);
      startPollingWithState(data.task_id);
    } catch (e: any) {
      setError(`提交失败: ${e.message}`);
      setPanelMode('new-check');
    }
  };

  const startPollingWithState = (taskId: string) => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    pollTimer.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}`);
        const task = await res.json();
        setCurrentTaskStatus(task.status);
        setCurrentTaskProgress(task.progress_message || '处理中...');
        setTasks(prev => prev.map(t => t.id === taskId ? {
          ...t, status: task.status,
          progress_message: task.progress_message,
          score_r1: task.score_r1,
          score_r2: task.score_r2,
          completed_at: task.completed_at
        } : t));
        if (task.status === 'completed' || task.status === 'failed') {
          clearInterval(pollTimer.current!);
        }
      } catch {}
    }, 3000);
  };

  const viewTaskReport = async (task: Task) => {
    if (task.status !== 'completed') return;
    try {
      const res = await fetch(`/api/tasks/${task.id}`);
      const data = await res.json();
      if (!data.result) return;
      const stdRes = await fetch(`/api/standards/current/detail`);
      const stdData = await stdRes.json();
      setViewingReport({
        result: data.result,
        standards: stdData.content || [],
        metadata: {
          fileName: task.transcript_filename,
          anchorName: task.anchor_name,
          date: task.created_at?.slice(0, 10) || '',
          round: task.is_dual_mode ? '双轮' : '单轮'
        },
        taskId: task.id
      });
      setPanelMode('report');

      // 异步查找对应的直播视频（不阻塞报告展示）
      setReportVideoUrl(null);
      setReportVideoSegments([]);
      setShowVideoPanel(true); // 默认展开视频面板
      try {
        const monitorSessionId = (task as any).monitor_session_id;
        if (monitorSessionId) {
          // 有 monitor_session_id：精确拉取对应场次
          const detailRes = await fetch(`/api/monitor/session/${monitorSessionId}`);
          const detail = await detailRes.json();
          if (detail.video_cos_url) {
            setReportVideoUrl(detail.video_cos_url);
            setShowVideoPanel(true);
          }
          if (detail.transcript?.timestamped_text) {
            const parsed = parseTimestampedSegments(detail.transcript.timestamped_text);
            setReportVideoSegments(parsed);
          }
        } else {
          // 无 monitor_session_id（手动上传任务）：找最近的有视频的场次
          const sessRes = await fetch(`/api/monitor/sessions/${encodeURIComponent(anchor.name)}`);
          const sessions = await sessRes.json();
          if (Array.isArray(sessions) && sessions.length > 0) {
            const withVideo = sessions.find((s: any) => s.video_cos_url);
            if (withVideo) {
              setReportVideoUrl(withVideo.video_cos_url);
              try {
                const detailRes = await fetch(`/api/monitor/session/${withVideo.id}`);
                const detail = await detailRes.json();
                if (detail.transcript?.timestamped_text) {
                  const parsed = parseTimestampedSegments(detail.transcript.timestamped_text);
                  setReportVideoSegments(parsed);
                }
              } catch {}
              setShowVideoPanel(true);
            }
          }
        }
      } catch {}
    } catch (e: any) {
      setError('加载报告失败: ' + e.message);
    }
  };

  // 解析带时间戳的逐字稿（对长句按标点拆分，提升搜索精度）
  const parseTimestampedSegments = (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];
      const toSec = (v: number) => (v || 0) / 1000;
      const raw = parsed.map((s: any) => ({
        start: toSec(s.start_time != null ? s.start_time : s.start),
        end: toSec(s.end_time != null ? s.end_time : s.end),
        text: (s.text || s.content || '').trim()
      })).filter((s: any) => s.text);

      // 对超过 10 秒的长句按标点拆分
      const result: any[] = [];
      for (const seg of raw) {
        const duration = seg.end - seg.start;
        if (duration <= 10 || seg.text.length <= 30) {
          result.push(seg);
          continue;
        }
        // 按标点拆分
        const parts = seg.text.split(/(?<=[。！？，,；、])/g).filter((p: string) => p.trim());
        if (parts.length <= 1) {
          result.push(seg);
          continue;
        }
        let charOffset = 0;
        const totalChars = seg.text.length;
        for (const part of parts) {
          const ratio = charOffset / totalChars;
          const endRatio = (charOffset + part.length) / totalChars;
          result.push({
            start: seg.start + ratio * duration,
            end: seg.start + endRatio * duration,
            text: part.trim()
          });
          charOffset += part.length;
        }
      }
      return result;
    } catch { return []; }
  };

  const resetNewCheck = () => {
    setTranscript('');
    setFullRawText('');
    setTranscriptFileName('');
    setMetadata({ fileName: '', anchorName: '', date: '', round: '' });
    setIsDualRound(true);
    setCandidateAnchors(null);
    setCurrentTaskId(null);
    setCurrentTaskStatus('');
    setError(null);
  };

  const sortedTasks = [...tasks].sort((a, b) => {
    let va: any = sortBy === 'score_r1' ? (a.score_r1 ?? -1) : a.created_at;
    let vb: any = sortBy === 'score_r1' ? (b.score_r1 ?? -1) : b.created_at;
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const toggleSort = (col: 'created_at' | 'score_r1') => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortBy(col); setSortDir('desc'); }
  };

  const SortIcon = ({ col }: { col: 'created_at' | 'score_r1' }) => {
    if (sortBy !== col) return <ChevronUp size={12} className="text-slate-300" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-[#07C160]" /> : <ChevronDown size={12} className="text-[#07C160]" />;
  };

  const statusBadge = (task: Task) => {
    if (task.status === 'completed') return <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full">已完成</span>;
    if (task.status === 'failed') return <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded-full">失败</span>;
    if (task.status === 'running') return <span className="px-2 py-0.5 bg-[rgba(7,193,96,0.1)] text-[#07C160] text-[10px] font-bold rounded-full flex items-center gap-1"><Loader2 size={8} className="animate-spin" />处理中</span>;
    return <span className="px-2 py-0.5 bg-amber-100 text-amber-600 text-[10px] font-bold rounded-full">排队中</span>;
  };

  const scoreColor = (s: number | null) => {
    if (s === null) return 'text-slate-400';
    if (s >= 85) return 'text-green-600 font-black';
    if (s >= 60) return 'text-amber-600 font-black';
    return 'text-red-600 font-black';
  };

  // ====== 报告模式 ======
  // 可拖拽分割线状态
  const [videoPanelWidth, setVideoPanelWidth] = useState(() => {
    try { return parseFloat(localStorage.getItem('qc_video_width') || '33') || 33; } catch { return 33; }
  });
  const isDraggingRef = useRef(false);
  const dragContainerRef = useRef<HTMLDivElement>(null);

  // 拖拽处理
  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !dragContainerRef.current) return;
      const rect = dragContainerRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(Math.max(pct, 20), 50); // 最小20%，最大50%
      setVideoPanelWidth(clamped);
    };
    const onUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // 保存到 localStorage
      setVideoPanelWidth(w => { try { localStorage.setItem('qc_video_width', String(w)); } catch {} return w; });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  if (panelMode === 'report' && viewingReport) {
    return (
      <div className="h-screen bg-white flex flex-col overflow-hidden">
        <div className="bg-white border-b border-slate-100 px-4 py-2 flex items-center gap-3 shadow-sm print:hidden shrink-0 z-10">
          <button onClick={() => { setPanelMode('list'); setViewingReport(null); setShowVideoPanel(false); }} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 font-bold transition-colors">
            <ArrowLeft size={16} />
            返回
          </button>
          <span className="text-slate-300">|</span>
          <span className="text-sm font-black text-slate-700">{anchor.name} · 质检报告</span>
          {reportVideoUrl && (
            <button
              onClick={() => setShowVideoPanel(v => !v)}
              className={`ml-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                showVideoPanel ? 'bg-[#07C160] text-white' : 'bg-[#F7F7F7] text-slate-500 hover:text-[#07C160]'
              }`}
            >
              <Video size={13} />
              {showVideoPanel ? '隐藏回放' : '显示回放'}
            </button>
          )}
          {headerActions}
        </div>
        {/* 三栏布局 + 可拖拽分割线 */}
        <div ref={dragContainerRef} className="flex flex-1 min-h-0 overflow-hidden">
          {/* 左侧视频面板 */}
          {showVideoPanel && reportVideoUrl && (
            <>
              <div style={{ width: `${videoPanelWidth}%` }} className="shrink-0 h-full">
                <ReportVideoPanel
                  videoUrl={reportVideoUrl}
                  segments={reportVideoSegments}
                  onClose={() => setShowVideoPanel(false)}
                />
              </div>
              {/* 可拖拽分割线 */}
              <div
                onMouseDown={handleDragStart}
                className="w-[5px] shrink-0 cursor-col-resize bg-slate-200 hover:bg-[#07C160] active:bg-[#07C160] transition-colors relative group"
                title="拖拽调整宽度"
              >
                <div className="absolute inset-y-0 -left-1 -right-1" /> {/* 扩大点击区域 */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-slate-400 group-hover:bg-white transition-colors" />
              </div>
            </>
          )}
          {/* 中间+右侧（ReportView 内部管理右侧核对台） */}
          <div className="flex-1 min-w-0 h-full">
            <ReportView
              result={viewingReport.result}
              standards={viewingReport.standards}
              metadata={viewingReport.metadata}
              taskId={viewingReport.taskId}
              onReset={() => { setPanelMode('list'); setViewingReport(null); setShowVideoPanel(false); }}
              onRegisterActions={setHeaderActions}
              videoSegments={reportVideoSegments}
            />
          </div>
        </div>
      </div>
    );
  }

  // ====== 锚点核对模式 ======
  if (panelMode === 'verify-anchors' && candidateAnchors) {
    return (
      <div className="h-screen flex flex-col bg-[#F7F7F7] overflow-hidden">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3 shadow-sm shrink-0">
          <button onClick={() => setPanelMode('new-check')} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-[#F7F7F7] transition-colors">
            <ArrowLeft size={18} className="text-slate-600" />
          </button>
          <span className="text-base font-black text-slate-900">核对锚点 — {anchor.name}</span>
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">
          <AnchorVerification
            fullText={transcript}
            initialAnchors={candidateAnchors}
            isDualRound={isDualRound}
            onConfirm={(final) => submitTask(final)}
            onBack={() => setPanelMode('new-check')}
          />
        </div>
      </div>
    );
  }

  // ====== 分析中 ======
  if (panelMode === 'analyzing') {
    const isDone = currentTaskStatus === 'completed' || currentTaskStatus === 'failed';
    return (
      <div className="min-h-screen bg-[#F7F7F7]">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3 shadow-sm">
          <span className="text-base font-black text-slate-900">质检进行中 — {anchor.name}</span>
        </div>
        <div className="p-6 max-w-[480px] mx-auto space-y-5">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm text-center space-y-4">
            <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center ${isDone ? (currentTaskStatus === 'completed' ? 'bg-green-100' : 'bg-red-100') : 'bg-[rgba(7,193,96,0.1)]'}`}>
              {isDone
                ? (currentTaskStatus === 'completed' ? <CheckCircle2 size={32} className="text-green-600" /> : <AlertTriangle size={32} className="text-red-500" />)
                : <Loader2 size={32} className="text-[#07C160] animate-spin" />
              }
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">
                {isDone ? (currentTaskStatus === 'completed' ? '质检完成！' : '质检失败') : '后台质检运行中'}
              </h2>
              <p className="text-xs text-slate-400 mt-1">{currentTaskProgress}</p>
            </div>
            {!isDone && (
              <div className="bg-[rgba(7,193,96,0.06)] rounded-xl p-3 text-xs text-[#06AD56]">
                <p className="font-bold mb-1">可以关闭页面！</p>
                <p>质检在后台运行，完成后报告会自动出现在历史表格中</p>
              </div>
            )}
          </div>
          <div className="flex gap-3">
            {isDone && currentTaskStatus === 'completed' && currentTaskId && (
              <button
                onClick={() => { const task = tasks.find(t => t.id === currentTaskId); if (task) viewTaskReport(task); }}
                className="flex-1 py-3 bg-[#07C160] hover:bg-[#06AD56] text-white font-bold text-sm rounded-xl shadow-md transition-all"
              >查看报告</button>
            )}
            <button
              onClick={() => { setPanelMode('list'); resetNewCheck(); }}
              className="flex-1 py-3 border border-slate-200 text-slate-600 font-bold text-sm rounded-xl hover:bg-[#F7F7F7] transition-all"
            >返回工作台</button>
          </div>
        </div>
      </div>
    );
  }

  // ====== 主界面（带 Tab 切换）======
  return (
    <div className="min-h-screen bg-[#F7F7F7] flex flex-col">
      {/* Header — 只放主播信息（详情模式时完全隐藏） */}
      {!(activeTab === 'replay' && replayDetail) && (
      <div className="bg-white border-b border-slate-100 px-3 md:px-6 py-2.5 md:py-3 flex items-center gap-3 md:gap-4 shrink-0">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-[#F7F7F7] transition-colors">
          <ArrowLeft size={18} className="text-slate-600" />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-[#2BD47D] to-[#06AD56] rounded-xl flex items-center justify-center shadow">
            <Mic size={16} className="text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-black text-slate-900">{anchor.name}</h1>
              {enableQc ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-[rgba(7,193,96,0.06)] text-[#07C160] border border-[rgba(7,193,96,0.15)]">
                  <Shield size={8} /> 质检
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-amber-50 text-amber-600 border border-amber-100">
                  <Eye size={8} /> 跟踪
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-400">工作台</p>
          </div>
        </div>
      </div>
      )}

      {/* 独立全宽 Tab 栏（详情模式时隐藏） */}
      {!(activeTab === 'replay' && replayDetail) && (
      <div className="bg-white border-b border-slate-200 px-3 md:px-6 flex items-center justify-center shrink-0 shadow-sm">
        <div className="flex gap-1 py-1">
          <button
            onClick={() => setActiveTab('replay')}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition-all ${
              activeTab === 'replay'
                ? 'bg-[#07C160] text-white shadow-md'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Video size={15} />
            全场回看
          </button>
          {enableQc && (
            <button
              onClick={() => setActiveTab('qc')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-lg transition-all ${
                activeTab === 'qc'
                  ? 'bg-[#07C160] text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Shield size={15} />
              话术质检
            </button>
          )}
        </div>
      </div>
      )}

      {/* ====== Tab 内容区 ====== */}
      <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 100px)' }}>

        {/* ====== 全场回看 Tab ====== */}
        {activeTab === 'replay' && (
          <div className="flex-1 overflow-hidden">
            <SessionListView anchor={anchor} onBack={() => {}} onDetailChange={setReplayDetail} />
          </div>
        )}

        {/* ====== 话术质检 Tab ====== */}
        {activeTab === 'qc' && enableQc && (
          <>
            {/* 左侧：质检历史表格 */}
            <div className={`flex flex-col overflow-hidden transition-all duration-300 flex-1`}>
              <div className="max-w-full md:max-w-[900px] mx-auto w-full flex flex-col flex-1 overflow-hidden">
              {/* 工具栏 */}
              <div className="flex items-center justify-between px-5 py-3 shrink-0">
                <h2 className="text-sm font-bold text-slate-700">质检记录</h2>
                <div className="flex items-center gap-2">
                  <button onClick={loadTasks} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white transition-colors text-slate-400 hover:text-slate-600">
                    <RefreshCw size={15} />
                  </button>
                  <button
                    onClick={() => { setPanelMode('new-check'); resetNewCheck(); }}
                    className="flex items-center gap-2 px-4 py-2 bg-[#07C160] hover:bg-[#06AD56] text-white text-sm font-bold rounded-xl transition-all shadow-md shadow-[rgba(7,193,96,0.1)]"
                  >
                    <Plus size={15} /> 新建质检
                  </button>
                </div>
              </div>
              {error && (
                <div className="mx-4 mt-4 bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2 shrink-0">
                  <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}

              {!hasStandards && hasStandards !== null && (
                <div className="mx-4 mt-4 bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-start gap-2 shrink-0">
                  <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">尚未配置话术！请先前往「话术管理」上传话术，才能发起质检。</p>
                </div>
              )}

              {loadingTasks ? (
                <div className="flex justify-center pt-12"><Loader2 size={28} className="text-[#07C160] animate-spin" /></div>
              ) : tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center flex-1 gap-4 text-slate-400 p-8">
                  <FileText size={40} className="opacity-30" />
                  <p className="text-sm">暂无质检记录</p>
                  <button
                    onClick={() => { setPanelMode('new-check'); resetNewCheck(); }}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#07C160] hover:bg-[#06AD56] text-white text-sm font-bold rounded-xl shadow-md transition-all"
                  >
                    <Plus size={16} /> 发起第一次质检
                  </button>
                </div>
              ) : (
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-white border-b border-slate-100 sticky top-0 z-10">
                      <tr>
                        <th className="text-left px-5 py-3.5 font-bold text-slate-500 cursor-pointer select-none" onClick={() => toggleSort('created_at')}>
                          <div className="flex items-center gap-1">开播时间 <SortIcon col="created_at" /></div>
                        </th>
                        <th className="text-left px-5 py-3.5 font-bold text-slate-500">文件名</th>
                        <th className="text-left px-5 py-3.5 font-bold text-slate-500">话术版本</th>
                        <th className="text-left px-5 py-3.5 font-bold text-slate-500 cursor-pointer select-none" onClick={() => toggleSort('score_r1')}>
                          <div className="flex items-center gap-1">评分 <SortIcon col="score_r1" /></div>
                        </th>
                        <th className="text-left px-5 py-3.5 font-bold text-slate-500">状态</th>
                        <th className="text-left px-5 py-3.5 font-bold text-slate-500">操作</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {sortedTasks.map(task => (
                        <tr key={task.id} className="hover:bg-white transition-colors">
                          <td className="px-5 py-3.5 text-slate-600 whitespace-nowrap">{(task as any).live_start_time || task.created_at?.replace(/^\d{4}\//, '').replace(/:\d{2}$/, '') || '--'}</td>
                          <td className="px-5 py-3.5 text-slate-600 max-w-[240px]">
                            <div className="flex items-center gap-1.5">
                              {(task as any).source === 'auto_asr' && (
                                <span className="px-1.5 py-0.5 bg-emerald-50 text-emerald-600 text-[9px] font-black rounded border border-emerald-100 shrink-0">自动</span>
                              )}
                              <p className="truncate" title={task.transcript_filename}>{task.transcript_filename}</p>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-slate-500">{(task as any).standards_version_label || '-'}</td>
                          <td className={`px-5 py-3.5 ${scoreColor(task.score_r1)}`}>
                            {task.score_r1 !== null ? `${task.score_r1}分` : '—'}
                          </td>
                          <td className="px-5 py-3.5">{statusBadge(task)}</td>
                          <td className="px-5 py-3.5">
                            {task.status === 'completed' ? (
                              <button
                                onClick={() => viewTaskReport(task)}
                                className="px-4 py-1.5 bg-[#07C160] hover:bg-[#06AD56] text-white text-xs font-bold rounded-lg transition-all"
                              >查看</button>
                            ) : task.status === 'failed' ? (
                              <div className="flex items-center gap-2">
                                {(task as any).retried_by ? (
                                  <span className="text-slate-300 text-xs">已重试</span>
                                ) : (
                                  <button
                                    onClick={async () => {
                                      try {
                                        const res = await fetch(`/api/tasks/${task.id}/retry`, { method: 'POST' });
                                        const data = await res.json();
                                        if (data.success) {
                                          loadTasks();
                                        } else {
                                          alert('重试失败: ' + (data.error || '未知错误'));
                                        }
                                      } catch (e: any) {
                                        alert('重试失败: ' + e.message);
                                      }
                                    }}
                                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg transition-all"
                                    title={task.error_message || '失败'}
                                  >重新质检</button>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 text-xs">{task.progress_message || '等待中...'}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              </div>
            </div>

            {/* 右侧：新建质检面板 */}
            {panelMode === 'new-check' && (
              <div className="w-[380px] bg-white border-l border-slate-100 flex flex-col shrink-0 shadow-xl overflow-y-auto">
                <div className="px-5 py-4 border-b border-slate-50 flex items-center justify-between shrink-0">
                  <div>
                    <h2 className="text-sm font-black text-slate-800">新建质检</h2>
                    <p className="text-xs text-slate-400">{anchor.name}</p>
                  </div>
                  <button onClick={() => { setPanelMode('list'); resetNewCheck(); }} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-[#F7F7F7] text-slate-400 transition-colors text-lg font-light">×</button>
                </div>

                <div className="p-5 flex-1 space-y-5">
                  {/* 话术状态 */}
                  <div className={`rounded-xl p-3 flex items-center gap-2 text-xs ${hasStandards ? 'bg-green-50 border border-green-100' : 'bg-amber-50 border border-amber-100'}`}>
                    {hasStandards
                      ? <><CheckCircle2 size={14} className="text-green-600 shrink-0" /><span className="text-green-700 font-medium">话术已就绪，自动加载最新版本</span></>
                      : <><AlertTriangle size={14} className="text-amber-500 shrink-0" /><span className="text-amber-700">话术未配置，请先到「话术管理」上传</span></>
                    }
                  </div>

                  {/* 上传文字稿 */}
                  <div>
                    <p className="text-xs font-black text-slate-600 mb-2">上传直播文字稿</p>
                    {transcript.length === 0 ? (
                      <FileUploader
                        title="上传文字稿"
                        description=".docx / .txt / .csv"
                        accept=".csv,.docx,.txt"
                        icon={<FileText size={24} />}
                        onFileLoaded={handleTranscriptUpload}
                      />
                    ) : (
                      <div className="bg-[#F7F7F7] rounded-xl border border-slate-200 p-4">
                        <div className="flex items-start gap-2 mb-3">
                          <CheckCircle2 size={16} className="text-green-500 shrink-0 mt-0.5" />
                          <div className="overflow-hidden">
                            <p className="text-xs font-bold text-slate-800 truncate">{metadata.fileName}</p>
                            <p className="text-[10px] text-slate-400">{transcript.length} 字符</p>
                          </div>
                        </div>
                        <div className="bg-white rounded-lg p-2 mb-3 border border-slate-100 max-h-20 overflow-hidden relative">
                          <p className="text-[10px] text-slate-500 font-mono leading-relaxed">{transcript.slice(0, 200)}...</p>
                          <div className="absolute bottom-0 left-0 w-full h-6 bg-gradient-to-t from-white to-transparent"></div>
                        </div>
                        <button onClick={() => { setTranscript(''); setFullRawText(''); setTranscriptFileName(''); }} className="text-[10px] text-slate-400 hover:text-slate-600 w-full text-center">重新上传</button>
                      </div>
                    )}
                  </div>

                  {/* 双轮开关 */}
                  {transcript.length > 0 && (
                    <div
                      className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer select-none transition-colors ${isDualRound ? 'bg-indigo-50 border-indigo-200' : 'bg-[#F7F7F7] border-slate-200'}`}
                      onClick={() => setIsDualRound(!isDualRound)}
                    >
                      <div className={`w-10 h-6 rounded-full relative transition-colors ${isDualRound ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow ${isDualRound ? 'left-5' : 'left-1'}`}></div>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-1.5">
                          <Split size={14} className={isDualRound ? 'text-[#07C160]' : 'text-slate-400'} />
                          <p className={`text-xs font-bold ${isDualRound ? 'text-indigo-900' : 'text-slate-600'}`}>包含两轮演练（自动拆分）</p>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {isDualRound ? 'AI 自动切分为两轮分别质检' : '整个文本视为一轮质检'}
                        </p>
                      </div>
                    </div>
                  )}

                  {error && (
                    <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2">
                      <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-red-600">{error}</p>
                    </div>
                  )}
                </div>

                {/* 底部按钮 */}
                <div className="p-5 border-t border-slate-50 shrink-0">
                  <button
                    onClick={startScanningAnchors}
                    disabled={!transcript || isScanning || !hasStandards}
                    className="w-full py-3.5 bg-[#07C160] hover:bg-[#06AD56] text-white font-bold text-sm rounded-xl shadow-md shadow-[rgba(7,193,96,0.1)] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {'下一步：选择锚点'}
                  </button>
                  <p className="text-[10px] text-center text-slate-400 mt-2">
                    提交后后台运行，可关闭页面
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default WorkspaceView;
