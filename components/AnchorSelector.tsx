import React, { useEffect, useState } from 'react';
import { Anchor } from '../types';
import { Users, Plus, Settings, BookOpen, Loader2, AlertTriangle, Mic, Cpu, GraduationCap } from 'lucide-react';

interface Props {
  onSelectAnchor: (anchor: Anchor) => void;
  onGoAnchorAdmin: () => void;
  onGoScriptAdmin: () => void;
  onGoModelAdmin: () => void;
  onGoTrainingAdmin: () => void;
}

const AnchorSelector: React.FC<Props> = ({ onSelectAnchor, onGoAnchorAdmin, onGoScriptAdmin, onGoModelAdmin, onGoTrainingAdmin }) => {
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskCounts, setTaskCounts] = useState<Record<number, number>>({});

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

      // 加载每个主播的报告数量
      const counts: Record<number, number> = {};
      await Promise.all(
        data.map(async (a: Anchor) => {
          try {
            const r = await fetch(`/api/anchors/${a.id}/tasks`);
            const tasks = await r.json();
            counts[a.id] = Array.isArray(tasks) ? tasks.filter((t: any) => t.status === 'completed').length : 0;
          } catch { counts[a.id] = 0; }
        })
      );
      setTaskCounts(counts);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
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
        <div className="flex gap-2">
          <button
            onClick={onGoTrainingAdmin}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-all"
          >
            <GraduationCap size={14} />
            主播培训
          </button>
          <button
            onClick={onGoScriptAdmin}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
          >
            <BookOpen size={14} />
            话术管理
          </button>
          <button
            onClick={onGoAnchorAdmin}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
          >
            <Settings size={14} />
            主播管理
          </button>
          <button
            onClick={onGoModelAdmin}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition-all"
          >
            <Cpu size={14} />
            模型配置
          </button>
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
              {anchors.map((anchor, idx) => (
                <button
                  key={anchor.id}
                  onClick={() => onSelectAnchor(anchor)}
                  className="group bg-white rounded-2xl border border-slate-100 p-6 text-left hover:shadow-lg hover:border-blue-100 hover:-translate-y-0.5 transition-all duration-200"
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${avatarColors[idx % avatarColors.length]} flex items-center justify-center shadow-lg shrink-0`}>
                      <Mic size={24} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-black text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                        {anchor.name}
                      </h3>
                      <p className="text-xs text-slate-400 mt-1">
                        {taskCounts[anchor.id] ?? 0} 份质检报告
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-50 flex items-center justify-between">
                    <span className="text-xs text-slate-400">点击进入工作台</span>
                    <span className="text-xs font-bold text-blue-600 group-hover:translate-x-1 transition-transform">→</span>
                  </div>
                </button>
              ))}

              {/* 新增主播快捷入口 */}
              <button
                onClick={onGoAnchorAdmin}
                className="group bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-6 text-left hover:border-blue-300 hover:bg-blue-50/30 transition-all duration-200"
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
