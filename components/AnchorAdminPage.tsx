import React, { useEffect, useState } from 'react';
import { Anchor } from '../types';
import { ArrowLeft, Plus, Trash2, Loader2, AlertTriangle, CheckCircle2, Mic, Users, Pencil, X, Save, Video, Shield, Eye } from 'lucide-react';

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
  // 编辑状态
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', enable_qc: true, douyin_profile_url: '', douyin_room_url: '', status: 'active' });
  const [saving, setSaving] = useState(false);

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

  // 进入编辑模式
  const startEdit = (anchor: Anchor) => {
    setEditingId(anchor.id);
    setEditForm({
      name: anchor.name,
      enable_qc: !!anchor.enable_qc,
      douyin_profile_url: anchor.douyin_profile_url || '',
      douyin_room_url: anchor.douyin_room_url || '',
      status: anchor.status || 'active',
    });
  };

  // 保存编辑
  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/anchors/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');
      setAnchors(prev => prev.map(a => a.id === editingId ? data : a));
      setEditingId(null);
      showSuccess('主播信息已更新');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const avatarColors = [
    'from-[#2BD47D] to-[#06AD56]',
    'from-[#2BD47D] to-[#059352]',
    'from-rose-500 to-pink-600',
    'from-amber-500 to-orange-600',
    'from-emerald-500 to-teal-600',
    'from-cyan-500 to-[#059352]',
  ];

  return (
    <div className="min-h-screen bg-[#F7F7F7] flex flex-col">
      {/* 头部 */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-4 shadow-sm">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-[#F7F7F7] transition-colors">
          <ArrowLeft size={18} className="text-slate-600" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-[#07C160] to-[#059352] rounded-xl flex items-center justify-center">
            <Users size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900">主播管理</h1>
            <p className="text-xs text-slate-400">管理主播信息、质检开关、抖音监控链接</p>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 max-w-3xl mx-auto w-full">
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
              className="flex-1 bg-[#F7F7F7] border-2 border-slate-100 rounded-xl px-4 py-3 text-sm outline-none focus:border-[#07C160] focus:bg-white transition-all"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !newName.trim()}
              className="flex items-center gap-2 px-5 py-3 bg-[#07C160] hover:bg-[#06AD56] text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-[rgba(7,193,96,0.1)]"
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
              <Loader2 size={28} className="text-[#07C160] animate-spin" />
            </div>
          ) : anchors.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">暂无主播，请先添加</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {anchors.map((anchor, idx) => (
                <div key={anchor.id}>
                  {/* 主播信息行 */}
                  <div className="flex items-center gap-4 px-5 py-4 hover:bg-[#F7F7F7]/50 transition-colors">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${avatarColors[idx % avatarColors.length]} flex items-center justify-center shadow-sm shrink-0`}>
                      <Mic size={16} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-bold text-slate-800">{anchor.name}</p>
                        {/* 类型标签 */}
                        {!!anchor.enable_qc ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-[rgba(7,193,96,0.06)] text-[#07C160] border border-[rgba(7,193,96,0.15)]">
                            <Shield size={10} /> 内部·质检
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-50 text-amber-600 border border-amber-100">
                            <Eye size={10} /> 外部·跟踪
                          </span>
                        )}
                        {anchor.status === 'inactive' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold rounded-full bg-red-50 text-red-500 border border-red-100">
                            <AlertTriangle size={10} /> 监控已挂起
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <p className="text-xs text-slate-400">创建于 {anchor.created_at?.slice(0, 10)}</p>
                        {(anchor.douyin_profile_url || anchor.douyin_room_url) && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600">
                            <Video size={10} /> 已配置抖音
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => editingId === anchor.id ? setEditingId(null) : startEdit(anchor)}
                        className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-[#07C160] hover:bg-[rgba(7,193,96,0.06)] transition-all"
                        title="编辑"
                      >
                        {editingId === anchor.id ? <X size={16} /> : <Pencil size={16} />}
                      </button>
                      <button
                        onClick={() => handleDelete(anchor)}
                        disabled={deletingId === anchor.id}
                        className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-50"
                      >
                        {deletingId === anchor.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* 编辑面板（展开时显示） */}
                  {editingId === anchor.id && (
                    <div className="px-5 pb-5 bg-[#F7F7F7]/50 border-t border-slate-100 animate-in slide-in-from-top-2 duration-200">
                      <div className="max-w-lg space-y-4 pt-4">
                        {/* 名称 */}
                        <div>
                          <label className="text-xs font-bold text-slate-500 mb-1 block">主播名称</label>
                          <input
                            type="text"
                            value={editForm.name}
                            onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                            className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#07C160] transition-all"
                          />
                        </div>

                        {/* 质检开关 */}
                        <div className="flex items-center justify-between bg-white rounded-xl border-2 border-slate-200 px-4 py-3">
                          <div>
                            <p className="text-sm font-bold text-slate-700">开启话术质检</p>
                            <p className="text-xs text-slate-400">关闭后仅跟踪直播回看，不做质检分析</p>
                          </div>
                          <button
                            onClick={() => setEditForm(f => ({ ...f, enable_qc: !f.enable_qc }))}
                            className={`relative w-12 h-7 rounded-full transition-colors ${editForm.enable_qc ? 'bg-[#07C160]' : 'bg-slate-300'}`}
                          >
                            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${editForm.enable_qc ? 'left-6' : 'left-1'}`} />
                          </button>
                        </div>
                        
                        {/* 监控开关 */}
                        <div className="flex items-center justify-between bg-white rounded-xl border-2 border-slate-200 px-4 py-3">
                          <div>
                            <p className="text-sm font-bold text-slate-700">允许自动监控开播</p>
                            <p className="text-xs text-slate-400">开启后将定时扫描直播间并录制切片</p>
                          </div>
                          <button
                            onClick={() => setEditForm(f => ({ ...f, status: f.status === 'active' ? 'inactive' : 'active' }))}
                            className={`relative w-12 h-7 rounded-full transition-colors ${editForm.status === 'active' ? 'bg-blue-500' : 'bg-slate-300'}`}
                          >
                            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${editForm.status === 'active' ? 'left-6' : 'left-1'}`} />
                          </button>
                        </div>

                        {/* 抖音主页链接 */}
                        <div>
                          <label className="text-xs font-bold text-slate-500 mb-1 block">抖音主页链接</label>
                          <input
                            type="text"
                            value={editForm.douyin_profile_url}
                            onChange={e => setEditForm(f => ({ ...f, douyin_profile_url: e.target.value }))}
                            placeholder="https://www.douyin.com/user/MS4wLjAB..."
                            className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#07C160] transition-all font-mono"
                          />
                        </div>

                        {/* 直播间链接 */}
                        <div>
                          <label className="text-xs font-bold text-slate-500 mb-1 block">直播间链接</label>
                          <input
                            type="text"
                            value={editForm.douyin_room_url}
                            onChange={e => setEditForm(f => ({ ...f, douyin_room_url: e.target.value }))}
                            placeholder="https://live.douyin.com/123456789"
                            className="w-full bg-white border-2 border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-[#07C160] transition-all font-mono"
                          />
                        </div>

                        {/* 保存按钮 */}
                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 rounded-xl hover:bg-[#F7F7F7] transition-colors"
                          >
                            取消
                          </button>
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex items-center gap-2 px-5 py-2 bg-[#07C160] hover:bg-[#06AD56] text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50 shadow-md shadow-[rgba(7,193,96,0.1)]"
                          >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            保存
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
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
