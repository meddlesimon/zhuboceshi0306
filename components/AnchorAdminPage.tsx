import React, { useEffect, useState } from 'react';
import { Anchor } from '../types';
import { ArrowLeft, Plus, Trash2, Loader2, AlertTriangle, CheckCircle2, Mic, Users } from 'lucide-react';

interface Props {
  onBack: () => void;
}

const AnchorAdminPage: React.FC<Props> = ({ onBack }) => {
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => { loadAnchors(); }, []);

  const loadAnchors = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/anchors');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setAnchors(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 2500);
  };

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name) { setError('请输入主播名称'); return; }
    setAdding(true);
    setError(null);
    try {
      const res = await fetch('/api/anchors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '添加失败');
      setAnchors(prev => [...prev, data]);
      setNewName('');
      showSuccess(`已添加主播「${name}」`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (anchor: Anchor) => {
    if (!window.confirm(`确定要删除主播「${anchor.name}」吗？\n该主播的所有质检记录也将一并删除。`)) return;
    setDeletingId(anchor.id);
    setError(null);
    try {
      const res = await fetch(`/api/anchors/${anchor.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '删除失败');
      setAnchors(prev => prev.filter(a => a.id !== anchor.id));
      showSuccess(`已删除主播「${anchor.name}」`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeletingId(null);
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
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-4 shadow-sm">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors">
          <ArrowLeft size={18} className="text-slate-600" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center">
            <Users size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900">主播管理</h1>
            <p className="text-xs text-slate-400">新增或删除主播</p>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {/* 提示 */}
        {successMsg && (
          <div className="bg-green-50 border border-green-100 rounded-xl p-3 flex items-center gap-2 mb-4 animate-in slide-in-from-top-2">
            <CheckCircle2 size={16} className="text-green-600 shrink-0" />
            <p className="text-sm text-green-700">{successMsg}</p>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-center gap-2 mb-4">
            <AlertTriangle size={16} className="text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* 新增主播 */}
        <div className="bg-white rounded-2xl border border-slate-100 p-5 mb-6 shadow-sm">
          <h2 className="text-sm font-black text-slate-700 mb-4">新增主播</h2>
          <div className="flex gap-3">
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
              placeholder="输入主播名称，如：张老师"
              className="flex-1 bg-slate-50 border-2 border-slate-100 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-400 focus:bg-white transition-all"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="flex items-center gap-2 px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-blue-100"
            >
              {adding ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              添加
            </button>
          </div>
        </div>

        {/* 主播列表 */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-50">
            <h2 className="text-sm font-black text-slate-700">当前主播列表 ({anchors.length})</h2>
          </div>
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 size={28} className="text-blue-500 animate-spin" />
            </div>
          ) : anchors.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">暂无主播，请先添加</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {anchors.map((anchor, idx) => (
                <div key={anchor.id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50/50 transition-colors">
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${avatarColors[idx % avatarColors.length]} flex items-center justify-center shadow-sm shrink-0`}>
                    <Mic size={16} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-slate-800">{anchor.name}</p>
                    <p className="text-xs text-slate-400">创建于 {anchor.created_at?.slice(0, 10)}</p>
                  </div>
                  <button
                    onClick={() => handleDelete(anchor)}
                    disabled={deletingId === anchor.id}
                    className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-50"
                  >
                    {deletingId === anchor.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnchorAdminPage;
