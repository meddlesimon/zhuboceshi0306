import React, { useEffect, useState, useRef } from 'react';
import { Anchor, Task, MultiRoundResult, Standard, StreamMetadata, AppStep, AnchorResult } from '../types';
import { parseTranscript, parseMetadataFromFilename } from '../utils/csvHelper';
import { findCandidateAnchors } from '../services/doubaoService';
import ReportView from './ReportView';
import AnchorVerification from './AnchorVerification';
import FileUploader from './FileUploader';
import {
  ArrowLeft, Plus, FileText, Loader2, AlertTriangle, CheckCircle2,
  Clock, TrendingUp, Split, ChevronUp, ChevronDown, RefreshCw, Mic
} from 'lucide-react';

interface Props {
  anchor: Anchor;
  onBack: () => void;
}

type PanelMode = 'list' | 'new-check' | 'verify-anchors' | 'analyzing' | 'report';

const WorkspaceView: React.FC<Props> = ({ anchor, onBack }) => {
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
  const [viewingReport, setViewingReport] = useState<{ result: MultiRoundResult; standards: Standard[]; metadata: StreamMetadata } | null>(null);
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);

  // 排序
  const [sortBy, setSortBy] = useState<'created_at' | 'score_r1'>('created_at');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadTasks();
    checkStandards();
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
      // 如果有进行中任务，开始轮询
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
          loadTasks(); // 刷新列表
        } else {
          // 更新进度
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

  const startScanningAnchors = async () => {
    if (!isDualRound) {
      await submitTask(null);
      return;
    }
    setIsScanning(true);
    setError(null);
    try {
      const anchors = await findCandidateAnchors(transcript);
      setCandidateAnchors(anchors);
      setPanelMode('verify-anchors');
    } catch (err: any) {
      setError(`锚点预找失败: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
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

      // 添加到任务列表
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

      // 开始轮询
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
        }
      });
      setPanelMode('report');
    } catch (e: any) {
      setError('加载报告失败: ' + e.message);
    }
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
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-blue-500" /> : <ChevronDown size={12} className="text-blue-500" />;
  };

  const statusBadge = (task: Task) => {
    if (task.status === 'completed') return <span className="px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-bold rounded-full">已完成</span>;
    if (task.status === 'failed') return <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded-full">失败</span>;
    if (task.status === 'running') return <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded-full flex items-center gap-1"><Loader2 size={8} className="animate-spin" />处理中</span>;
    return <span className="px-2 py-0.5 bg-amber-100 text-amber-600 text-[10px] font-bold rounded-full">排队中</span>;
  };

  const scoreColor = (s: number | null) => {
    if (s === null) return 'text-slate-400';
    if (s >= 85) return 'text-green-600 font-black';
    if (s >= 60) return 'text-amber-600 font-black';
    return 'text-red-600 font-black';
  };

  // 如果是查看报告模式
  if (panelMode === 'report' && viewingReport) {
    return (
      <div className="min-h-screen bg-white">
        <div className="bg-white border-b border-slate-100 px-6 py-3 flex items-center gap-3 shadow-sm print:hidden">
          <button onClick={() => { setPanelMode('list'); setViewingReport(null); }} className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-700 font-bold transition-colors">
            <ArrowLeft size={16} />
            返回工作台
          </button>
          <span className="text-slate-300">|</span>
          <span className="text-sm font-black text-slate-700">{anchor.name} · 质检报告</span>
          {headerActions}
        </div>
        <ReportView
          result={viewingReport.result}
          standards={viewingReport.standards}
          metadata={viewingReport.metadata}
          onReset={() => { setPanelMode('list'); setViewingReport(null); }}
          onRegisterActions={setHeaderActions}
        />
      </div>
    );
  }

  // 核对锚点模式（复用原有组件）
  if (panelMode === 'verify-anchors' && candidateAnchors) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3 shadow-sm">
          <button onClick={() => setPanelMode('new-check')} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors">
            <ArrowLeft size={18} className="text-slate-600" />
          </button>
          <span className="text-base font-black text-slate-900">核对锚点 — {anchor.name}</span>
        </div>
        <div className="p-6 max-w-[600px] mx-auto">
          <AnchorVerification
            fullText={transcript}
            initialAnchors={candidateAnchors}
            onConfirm={(final) => submitTask(final)}
            onBack={() => setPanelMode('new-check')}
          />
        </div>
      </div>
    );
  }

  // 分析中模式
  if (panelMode === 'analyzing') {
    const isDone = currentTaskStatus === 'completed' || currentTaskStatus === 'failed';
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-3 shadow-sm">
          <span className="text-base font-black text-slate-900">质检进行中 — {anchor.name}</span>
        </div>
        <div className="p-6 max-w-[480px] mx-auto space-y-5">
          <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm text-center space-y-4">
            <div className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center ${isDone ? (currentTaskStatus === 'completed' ? 'bg-green-100' : 'bg-red-100') : 'bg-blue-100'}`}>
              {isDone
                ? (currentTaskStatus === 'completed' ? <CheckCircle2 size={32} className="text-green-600" /> : <AlertTriangle size={32} className="text-red-500" />)
                : <Loader2 size={32} className="text-blue-500 animate-spin" />
              }
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">
                {isDone ? (currentTaskStatus === 'completed' ? '质检完成！' : '质检失败') : '后台质检运行中'}
              </h2>
              <p className="text-xs text-slate-400 mt-1">{currentTaskProgress}</p>
            </div>
            {!isDone && (
              <div className="bg-blue-50 rounded-xl p-3 text-xs text-blue-700">
                <p className="font-bold mb-1">可以关闭页面！</p>
                <p>质检在后台运行，完成后报告会自动出现在历史表格中</p>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            {isDone && currentTaskStatus === 'completed' && currentTaskId && (
              <button
                onClick={() => {
                  const task = tasks.find(t => t.id === currentTaskId);
                  if (task) viewTaskReport(task);
                }}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md transition-all"
              >
                查看报告
              </button>
            )}
            <button
              onClick={() => { setPanelMode('list'); resetNewCheck(); }}
              className="flex-1 py-3 border border-slate-200 text-slate-600 font-bold text-sm rounded-xl hover:bg-slate-50 transition-all"
            >
              返回工作台
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-4 shadow-sm shrink-0">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors">
          <ArrowLeft size={18} className="text-slate-600" />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow">
            <Mic size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900">{anchor.name} 工作台</h1>
            <p className="text-xs text-slate-400">质检历史记录</p>
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={loadTasks} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600">
            <RefreshCw size={16} />
          </button>
          <button
            onClick={() => { setPanelMode('new-check'); resetNewCheck(); }}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-all shadow-md shadow-blue-100"
          >
            <Plus size={16} />
            新建质检
          </button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 73px)' }}>
        {/* 左侧：报告历史表格 */}
        <div className={`flex flex-col overflow-hidden transition-all duration-300 ${panelMode === 'new-check' ? 'flex-1' : 'flex-1'}`}>
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
            <div className="flex justify-center pt-12"><Loader2 size={28} className="text-blue-500 animate-spin" /></div>
          ) : tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-4 text-slate-400 p-8">
              <FileText size={40} className="opacity-30" />
              <p className="text-sm">暂无质检记录</p>
              <button
                onClick={() => { setPanelMode('new-check'); resetNewCheck(); }}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl shadow-md transition-all"
              >
                <Plus size={16} /> 发起第一次质检
              </button>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-white border-b border-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 cursor-pointer select-none" onClick={() => toggleSort('created_at')}>
                      <div className="flex items-center gap-1">质检时间 <SortIcon col="created_at" /></div>
                    </th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 max-w-[180px]">文件名</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500">话术版本</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500">模式</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500 cursor-pointer select-none" onClick={() => toggleSort('score_r1')}>
                      <div className="flex items-center gap-1">第一轮 <SortIcon col="score_r1" /></div>
                    </th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500">第二轮</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500">状态</th>
                    <th className="text-left px-4 py-3 font-bold text-slate-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sortedTasks.map(task => (
                    <tr key={task.id} className="hover:bg-white transition-colors">
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{task.created_at?.slice(5, 16)}</td>
                      <td className="px-4 py-3 text-slate-600 max-w-[180px]">
                        <p className="truncate" title={task.transcript_filename}>{task.transcript_filename}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{(task as any).standards_version_label || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${task.is_dual_mode ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-500'}`}>
                          {task.is_dual_mode ? '双轮' : '单轮'}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-sm ${scoreColor(task.score_r1)}`}>
                        {task.score_r1 !== null ? `${task.score_r1}分` : '—'}
                      </td>
                      <td className={`px-4 py-3 text-sm ${scoreColor(task.score_r2)}`}>
                        {task.score_r2 !== null ? `${task.score_r2}分` : '—'}
                      </td>
                      <td className="px-4 py-3">{statusBadge(task)}</td>
                      <td className="px-4 py-3">
                        {task.status === 'completed' ? (
                          <button
                            onClick={() => viewTaskReport(task)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold rounded-lg transition-all"
                          >
                            查看
                          </button>
                        ) : task.status === 'failed' ? (
                          <span className="text-red-400 text-[10px]">{task.error_message?.slice(0, 20) || '失败'}</span>
                        ) : (
                          <span className="text-slate-400 text-[10px]">{task.progress_message || '等待中...'}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 右侧：新建质检面板 */}
        {panelMode === 'new-check' && (
          <div className="w-[380px] bg-white border-l border-slate-100 flex flex-col shrink-0 shadow-xl overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-50 flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-sm font-black text-slate-800">新建质检</h2>
                <p className="text-xs text-slate-400">{anchor.name}</p>
              </div>
              <button onClick={() => { setPanelMode('list'); resetNewCheck(); }} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-slate-100 text-slate-400 transition-colors text-lg font-light">×</button>
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
                  <div className="bg-slate-50 rounded-xl border border-slate-200 p-4">
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
                  className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer select-none transition-colors ${isDualRound ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}
                  onClick={() => setIsDualRound(!isDualRound)}
                >
                  <div className={`w-10 h-6 rounded-full relative transition-colors ${isDualRound ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform shadow ${isDualRound ? 'left-5' : 'left-1'}`}></div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <Split size={14} className={isDualRound ? 'text-indigo-600' : 'text-slate-400'} />
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
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md shadow-blue-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isScanning ? (
                  <><Loader2 size={16} className="animate-spin" /> 正在扫描锚点...</>
                ) : isDualRound ? '下一步：核对锚点' : '开始质检'}
              </button>
              <p className="text-[10px] text-center text-slate-400 mt-2">
                提交后后台运行，可关闭页面
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkspaceView;
