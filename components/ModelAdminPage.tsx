import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, Users, Loader2, AlertTriangle, Plus, Trash2, X, Shield, User, Key
} from 'lucide-react';

interface AdminAccount {
  id: string;
  username: string;
  display_name: string;
  role: string;
  created_at: string;
}

interface Props {
  onBack: () => void;
}

const ModelAdminPage: React.FC<Props> = ({ onBack }) => {
  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('888888');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // 重置密码
  const [resetId, setResetId] = useState<string | null>(null);
  const [resetPwd, setResetPwd] = useState('');

  useEffect(() => { loadAccounts(); }, []);

  const loadAccounts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/accounts');
      const data = await res.json();
      setAccounts(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newUsername.trim() || !newDisplayName.trim()) {
      setError('账号和显示名不能为空');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword || '888888', display_name: newDisplayName.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setShowAddForm(false);
      setNewUsername(''); setNewPassword('888888'); setNewDisplayName('');
      loadAccounts();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该管理员？')) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/accounts/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      loadAccounts();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleResetPwd = async (id: string) => {
    if (!resetPwd.trim()) return;
    try {
      const res = await fetch(`/api/admin/accounts/${id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPwd.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setResetId(null);
      setResetPwd('');
      alert('密码已重置');
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-500">
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gradient-to-br from-purple-600 to-indigo-700 rounded-xl flex items-center justify-center shadow">
              <Shield size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-black text-slate-900">管理员管理</h1>
              <p className="text-xs text-slate-400">添加、删除管理员账号</p>
            </div>
          </div>
        </div>
        <button
          onClick={() => { setShowAddForm(true); setError(null); }}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition-all"
        >
          <Plus size={14} /> 添加管理员
        </button>
      </div>

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3 mb-4">
            <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X size={16} /></button>
          </div>
        )}

        {/* 添加表单 */}
        {showAddForm && (
          <div className="bg-white rounded-2xl border-2 border-purple-200 p-5 mb-4 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-black text-slate-800">添加管理员</h3>
              <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">显示名称 *</label>
                <input value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)} placeholder="例如：张浩辉"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-purple-400" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">登录账号 * <span className="text-slate-300 font-normal">（建议用名字全拼）</span></label>
                <input value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="例如：zhanghaohui"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-purple-400 font-mono" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">初始密码 <span className="text-slate-300 font-normal">（默认 888888）</span></label>
                <input value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-purple-400 font-mono" />
              </div>
              <button onClick={handleAdd} disabled={adding}
                className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 确认添加
              </button>
            </div>
          </div>
        )}

        {/* 账号列表 */}
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Loader2 size={32} className="text-purple-500 animate-spin" />
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map(acc => (
              <div key={acc.id} className={`bg-white rounded-2xl border-2 p-4 transition-all ${acc.role === 'super_admin' ? 'border-purple-200 shadow-sm' : 'border-slate-100'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${acc.role === 'super_admin' ? 'bg-purple-100' : 'bg-slate-100'}`}>
                    {acc.role === 'super_admin' ? <Shield size={18} className="text-purple-600" /> : <User size={18} className="text-slate-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-black text-slate-800">{acc.display_name}</h3>
                      {acc.role === 'super_admin' && (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold rounded-full">超级管理员</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 font-mono mt-0.5">账号：{acc.username}</p>
                    <p className="text-[10px] text-slate-300 mt-0.5">创建于 {acc.created_at}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* 重置密码 */}
                    <button onClick={() => { setResetId(resetId === acc.id ? null : acc.id); setResetPwd(''); }}
                      className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all" title="重置密码">
                      <Key size={14} />
                    </button>
                    {/* 删除（超级管理员不可删） */}
                    {acc.role !== 'super_admin' && (
                      <button onClick={() => handleDelete(acc.id)} disabled={deleting === acc.id}
                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all disabled:opacity-50" title="删除">
                        {deleting === acc.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      </button>
                    )}
                  </div>
                </div>
                {/* 重置密码表单 */}
                {resetId === acc.id && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
                    <input value={resetPwd} onChange={e => setResetPwd(e.target.value)} placeholder="输入新密码"
                      className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:border-purple-400 font-mono" />
                    <button onClick={() => handleResetPwd(acc.id)}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 rounded-lg transition-all">确认重置</button>
                    <button onClick={() => setResetId(null)} className="text-slate-400 hover:text-slate-600"><X size={14} /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ModelAdminPage;
