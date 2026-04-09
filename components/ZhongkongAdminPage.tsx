import React, { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Trash2, Save, Users, Settings, Shield, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

interface Agent {
  id: string;
  shortId: string;
  note: string;
  addedAt: string;
}

interface ZhongkongConfig {
  officialPrefix: string;
  targets: {
    head: { instruction: number; rendering: number };
    normal: { instruction: number; rendering: number };
  };
}

interface Props {
  onBack: () => void;
}

const ZhongkongAdminPage: React.FC<Props> = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState<'agents' | 'config'>('agents');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [config, setConfig] = useState<ZhongkongConfig>({
    officialPrefix: '北大孙叶夫妇',
    targets: {
      head: { instruction: 350, rendering: 20 },
      normal: { instruction: 245, rendering: 14 }
    }
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // 新增账号输入
  const [newShortId, setNewShortId] = useState('');
  const [newNote, setNewNote] = useState('');

  useEffect(() => { loadData(); }, []);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [agentsRes, configRes] = await Promise.all([
        fetch('/api/zhongkong/agents'),
        fetch('/api/zhongkong/config')
      ]);
      setAgents(await agentsRes.json());
      setConfig(await configRes.json());
    } catch (e: any) {
      showToast('加载失败: ' + e.message, false);
    } finally {
      setLoading(false);
    }
  };

  const addAgent = async () => {
    if (!newShortId.trim()) return;
    try {
      const res = await fetch('/api/zhongkong/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortId: newShortId.trim(), note: newNote.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAgents(prev => [...prev, data]);
      setNewShortId('');
      setNewNote('');
      showToast('水军账号已添加');
    } catch (e: any) {
      showToast(e.message, false);
    }
  };

  const deleteAgent = async (id: string) => {
    if (!confirm('确认删除该水军账号？')) return;
    try {
      await fetch(`/api/zhongkong/agents/${id}`, { method: 'DELETE' });
      setAgents(prev => prev.filter(a => a.id !== id));
      showToast('已删除');
    } catch (e: any) {
      showToast('删除失败', false);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/zhongkong/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (!res.ok) throw new Error('保存失败');
      showToast('质检配置已保存');
    } catch (e: any) {
      showToast(e.message, false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-4 shadow-sm">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors">
          <ArrowLeft size={18} className="text-slate-600" />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center shadow">
            <Shield size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900">中控管理</h1>
            <p className="text-xs text-slate-400">水军账号 & 质检配置</p>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-bold ${toast.ok ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          {toast.msg}
        </div>
      )}

      {/* Tab Bar */}
      <div className="bg-white border-b border-slate-100 px-6">
        <div className="flex gap-1 -mb-px">
          {[
            { key: 'agents', label: '水军账号', icon: Users },
            { key: 'config', label: '质检配置', icon: Settings }
          ].map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key as any)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-purple-600 text-purple-600'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {loading ? (
          <div className="flex justify-center pt-20"><Loader2 size={32} className="text-purple-500 animate-spin" /></div>
        ) : activeTab === 'agents' ? (
          <div className="space-y-4">
            {/* 新增表单 */}
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <h2 className="text-sm font-black text-slate-800 mb-4">添加水军账号</h2>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">抖音号 (shortId)*</label>
                  <input
                    value={newShortId}
                    onChange={e => setNewShortId(e.target.value)}
                    placeholder="如：100123456"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-purple-400"
                    onKeyDown={e => e.key === 'Enter' && addAgent()}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-500 mb-1 block">备注名（可选）</label>
                  <input
                    value={newNote}
                    onChange={e => setNewNote(e.target.value)}
                    placeholder="如：机器1号"
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-purple-400"
                    onKeyDown={e => e.key === 'Enter' && addAgent()}
                  />
                </div>
              </div>
              <button
                onClick={addAgent}
                disabled={!newShortId.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50"
              >
                <Plus size={14} /> 添加
              </button>
            </div>

            {/* 账号列表 */}
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-50 flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-800">水军账号列表</h2>
                <span className="text-xs text-slate-400">{agents.length} 个账号</span>
              </div>
              {agents.length === 0 ? (
                <div className="p-10 text-center text-slate-400">
                  <Users size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">暂无水军账号，请先添加</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="text-left px-5 py-3 text-xs font-bold text-slate-400">抖音号</th>
                      <th className="text-left px-5 py-3 text-xs font-bold text-slate-400">备注</th>
                      <th className="text-left px-5 py-3 text-xs font-bold text-slate-400">添加时间</th>
                      <th className="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {agents.map(agent => (
                      <tr key={agent.id} className="hover:bg-slate-50/50">
                        <td className="px-5 py-3 font-mono font-bold text-slate-800">{agent.shortId}</td>
                        <td className="px-5 py-3 text-slate-500">{agent.note || '—'}</td>
                        <td className="px-5 py-3 text-slate-400 text-xs">{agent.addedAt?.slice(0, 10)}</td>
                        <td className="px-5 py-3">
                          <button
                            onClick={() => deleteAgent(agent.id)}
                            className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        ) : (
          /* 质检配置 Tab */
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
              <h2 className="text-sm font-black text-slate-800 mb-4">官方账号识别</h2>
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">官方账号昵称前缀</label>
                <input
                  value={config.officialPrefix}
                  onChange={e => setConfig(c => ({ ...c, officialPrefix: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-purple-400"
                />
                <p className="text-xs text-slate-400 mt-1">发言昵称以该文字开头的账号视为「官方账号」</p>
              </div>
            </div>

            {/* 目标值配置 */}
            {(['head', 'normal'] as const).map(mode => (
              <div key={mode} className="bg-white rounded-2xl border border-slate-100 p-5 shadow-sm">
                <h2 className="text-sm font-black text-slate-800 mb-1">
                  {mode === 'head' ? '头部主播' : '普通主播'} 质检目标
                </h2>
                <p className="text-xs text-slate-400 mb-4">
                  {mode === 'head' ? '满分标准' : '× 0.7 折扣标准'}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1 block">⚡ 指令回应目标（条）</label>
                    <input
                      type="number"
                      value={config.targets[mode].instruction}
                      onChange={e => setConfig(c => ({
                        ...c,
                        targets: { ...c.targets, [mode]: { ...c.targets[mode], instruction: parseInt(e.target.value) || 0 } }
                      }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-purple-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1 block">📢 氛围渲染目标（条）</label>
                    <input
                      type="number"
                      value={config.targets[mode].rendering}
                      onChange={e => setConfig(c => ({
                        ...c,
                        targets: { ...c.targets, [mode]: { ...c.targets[mode], rendering: parseInt(e.target.value) || 0 } }
                      }))}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-purple-400"
                    />
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={saveConfig}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-3 bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm rounded-xl transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              保存配置
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ZhongkongAdminPage;
