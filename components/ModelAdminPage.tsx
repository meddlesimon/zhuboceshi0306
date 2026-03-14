import React, { useEffect, useState } from 'react';
import { ModelPreset, ModelConfig } from '../types';
import {
  ArrowLeft, Cpu, CheckCircle2, Loader2, AlertTriangle,
  Eye, EyeOff, Edit2, Save, X, Plus, Trash2, Zap, ChevronDown, ChevronUp
} from 'lucide-react';

interface Props {
  onBack: () => void;
}

const ModelAdminPage: React.FC<Props> = ({ onBack }) => {
  const [config, setConfig] = useState<ModelConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ id: string; msg: string; ok: boolean } | null>(null);

  // 测试连接
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; msg: string; ok: boolean } | null>(null);

  // 激活切换
  const [activatingId, setActivatingId] = useState<string | null>(null);

  // 新增自定义模型
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newApiUrl, setNewApiUrl] = useState('https://cn2us02.opapi.win/v1/chat/completions');
  const [newApiKey, setNewApiKey] = useState('');
  const [addingModel, setAddingModel] = useState(false);

  // 高级设置展开
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/model-config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setConfig(data);
      setSelectedId(data.active_model_id);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async (modelId: string) => {
    setActivatingId(modelId);
    try {
      const res = await fetch('/api/model-config/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '切换失败');
      setConfig(prev => prev ? { ...prev, active_model_id: modelId } : prev);
      setSelectedId(modelId);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActivatingId(null);
    }
  };

  const startEdit = (preset: ModelPreset) => {
    setEditingId(preset.id);
    setEditKey('');
    setEditUrl(preset.api_url || 'https://cn2us02.opapi.win/v1/chat/completions');
    setShowKey(false);
    setSaveMsg(null);
    setTestResult(null);
    setShowAdvanced(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditKey('');
    setShowKey(false);
  };

  const handleSave = async (preset: ModelPreset) => {
    setSavingId(preset.id);
    setSaveMsg(null);
    try {
      const body: any = {};
      if (editKey.trim()) body.api_key = editKey.trim();
      if (editUrl.trim()) body.api_url = editUrl.trim();

      const res = await fetch(`/api/model-config/presets/${preset.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存失败');

      // 更新本地显示
      setConfig(prev => prev ? {
        ...prev,
        presets: prev.presets.map(p => p.id === preset.id ? { ...p, ...data } : p)
      } : prev);
      setSaveMsg({ id: preset.id, msg: '保存成功', ok: true });
      setEditingId(null);
      setEditKey('');
    } catch (e: any) {
      setSaveMsg({ id: preset.id, msg: e.message, ok: false });
    } finally {
      setSavingId(null);
    }
  };

  const handleTest = async (modelId: string) => {
    setTestingId(modelId);
    setTestResult(null);
    try {
      const res = await fetch('/api/model-config/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: modelId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setTestResult({ id: modelId, msg: `连接失败：${data.error || '未知错误'}`, ok: false });
      } else {
        setTestResult({ id: modelId, msg: `连接成功！延迟 ${data.latency}，回复：${data.reply}`, ok: true });
      }
    } catch (e: any) {
      setTestResult({ id: modelId, msg: `请求失败：${e.message}`, ok: false });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (modelId: string) => {
    if (!confirm('确认删除此自定义模型？')) return;
    try {
      const res = await fetch(`/api/model-config/presets/${modelId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '删除失败');
      setConfig(prev => prev ? { ...prev, presets: prev.presets.filter(p => p.id !== modelId) } : prev);
      if (selectedId === modelId) setSelectedId(config?.active_model_id || null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleAddModel = async () => {
    if (!newName.trim() || !newModelName.trim()) {
      setError('模型名称和模型 ID 不能为空');
      return;
    }
    setAddingModel(true);
    try {
      const res = await fetch('/api/model-config/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          model_name: newModelName.trim(),
          api_url: newApiUrl.trim(),
          api_key: newApiKey.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '添加失败');
      setConfig(prev => prev ? { ...prev, presets: [...prev.presets, data] } : prev);
      setShowAddForm(false);
      setNewName(''); setNewModelName(''); setNewApiKey('');
      setNewApiUrl('https://cn2us02.opapi.win/v1/chat/completions');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAddingModel(false);
    }
  };

  const activePreset = config?.presets.find(p => p.id === config.active_model_id);
  const selectedPreset = config?.presets.find(p => p.id === selectedId);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors text-slate-500"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gradient-to-br from-purple-600 to-indigo-700 rounded-xl flex items-center justify-center shadow">
              <Cpu size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-base font-black text-slate-900">模型配置</h1>
              <p className="text-xs text-slate-400">
                当前使用：<span className="text-purple-600 font-bold">{activePreset?.name || '未知'}</span>
              </p>
            </div>
          </div>
        </div>
        <button
          onClick={() => { setShowAddForm(true); setError(null); }}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-xl transition-all"
        >
          <Plus size={14} />
          自定义模型
        </button>
      </div>

      <div className="flex-1 p-6 max-w-3xl mx-auto w-full">
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-4 flex items-start gap-3 mb-4">
            <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-red-700">{error}</p>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X size={16} />
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Loader2 size={32} className="text-purple-500 animate-spin" />
            <p className="text-sm text-slate-400">加载中...</p>
          </div>
        ) : (
          <>
            {/* 新增自定义模型表单 */}
            {showAddForm && (
              <div className="bg-white rounded-2xl border-2 border-purple-200 p-5 mb-4 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-black text-slate-800">添加自定义模型</h3>
                  <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={16} />
                  </button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1 block">显示名称 *</label>
                    <input
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="例如：DeepSeek V3"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-purple-400"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1 block">模型 ID *</label>
                    <input
                      value={newModelName}
                      onChange={e => setNewModelName(e.target.value)}
                      placeholder="例如：deepseek-chat"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-purple-400 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1 block">API Key</label>
                    <input
                      value={newApiKey}
                      onChange={e => setNewApiKey(e.target.value)}
                      placeholder="sk-..."
                      type="password"
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-purple-400 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-500 mb-1 block">接口地址</label>
                    <input
                      value={newApiUrl}
                      onChange={e => setNewApiUrl(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-purple-400 font-mono text-xs"
                    />
                  </div>
                  <button
                    onClick={handleAddModel}
                    disabled={addingModel}
                    className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {addingModel ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                    添加
                  </button>
                </div>
              </div>
            )}

            {/* 模型列表 */}
            <div className="space-y-3">
              {config?.presets.map(preset => {
                const isActive = config.active_model_id === preset.id;
                const isEditing = editingId === preset.id;
                const isTesting = testingId === preset.id;
                const isActivating = activatingId === preset.id;
                const hasKey = !!preset.api_key_masked;

                return (
                  <div
                    key={preset.id}
                    className={`bg-white rounded-2xl border-2 transition-all ${
                      isActive
                        ? 'border-purple-300 shadow-md shadow-purple-100'
                        : 'border-slate-100 hover:border-slate-200'
                    }`}
                  >
                    {/* 主行 */}
                    <div className="p-4">
                      <div className="flex items-start gap-3">
                        {/* 激活状态图标 */}
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                            isActive
                              ? 'bg-purple-100'
                              : 'bg-slate-100'
                          }`}
                        >
                          <Cpu size={18} className={isActive ? 'text-purple-600' : 'text-slate-400'} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-sm font-black text-slate-900">{preset.name}</h3>
                            {isActive && (
                              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold rounded-full">
                                当前使用
                              </span>
                            )}
                            {!hasKey && (
                              <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold rounded-full">
                                未配置 Key
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 font-mono mt-0.5">{preset.model_name}</p>
                          {hasKey && (
                            <p className="text-[10px] text-slate-300 font-mono mt-0.5">{preset.api_key_masked}</p>
                          )}
                        </div>

                        {/* 操作按钮 */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isActive && (
                            <button
                              onClick={() => handleActivate(preset.id)}
                              disabled={isActivating || !hasKey}
                              title={!hasKey ? '请先配置 API Key' : '设为当前使用'}
                              className="px-3 py-1.5 text-xs font-bold text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                              {isActivating ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                              启用
                            </button>
                          )}
                          <button
                            onClick={() => isEditing ? cancelEdit() : startEdit(preset)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-all"
                          >
                            {isEditing ? <X size={14} /> : <Edit2 size={14} />}
                          </button>
                          {!preset.is_builtin && (
                            <button
                              onClick={() => handleDelete(preset.id)}
                              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* 编辑表单 */}
                      {isEditing && (
                        <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                          {/* API Key 编辑 */}
                          <div>
                            <label className="text-xs font-bold text-slate-500 mb-1.5 block">
                              API Key
                              {hasKey && <span className="ml-2 text-slate-300 font-normal">（留空则保留现有 Key）</span>}
                            </label>
                            <div className="relative">
                              <input
                                type={showKey ? 'text' : 'password'}
                                value={editKey}
                                onChange={e => setEditKey(e.target.value)}
                                placeholder={hasKey ? `当前：${preset.api_key_masked}` : 'sk-...'}
                                className="w-full px-3 py-2 pr-10 text-sm border border-slate-200 rounded-xl outline-none focus:border-purple-400 font-mono"
                              />
                              <button
                                onClick={() => setShowKey(!showKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                              >
                                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                            </div>
                          </div>

                          {/* 高级设置：接口地址 */}
                          <div>
                            <button
                              onClick={() => setShowAdvanced(!showAdvanced)}
                              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
                            >
                              {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              高级设置（接口地址）
                            </button>
                            {showAdvanced && (
                              <div className="mt-2">
                                <input
                                  value={editUrl}
                                  onChange={e => setEditUrl(e.target.value)}
                                  placeholder="https://..."
                                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl outline-none focus:border-purple-400 font-mono"
                                />
                              </div>
                            )}
                          </div>

                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSave(preset)}
                              disabled={!!savingId}
                              className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                              {savingId === preset.id ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                              保存
                            </button>
                            <button
                              onClick={() => handleTest(preset.id)}
                              disabled={isTesting}
                              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                              {isTesting ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}
                              测试连接
                            </button>
                          </div>

                          {/* 保存/测试结果 */}
                          {saveMsg?.id === preset.id && (
                            <div className={`text-xs px-3 py-2 rounded-lg flex items-center gap-2 ${saveMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                              {saveMsg.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                              {saveMsg.msg}
                            </div>
                          )}
                          {testResult?.id === preset.id && (
                            <div className={`text-xs px-3 py-2 rounded-lg flex items-start gap-2 ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                              {testResult.ok ? <CheckCircle2 size={12} className="shrink-0 mt-0.5" /> : <AlertTriangle size={12} className="shrink-0 mt-0.5" />}
                              <span>{testResult.msg}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* 非编辑状态下的测试结果 */}
                      {!isEditing && testResult?.id === preset.id && (
                        <div className={`mt-3 text-xs px-3 py-2 rounded-lg flex items-start gap-2 ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                          {testResult.ok ? <CheckCircle2 size={12} className="shrink-0 mt-0.5" /> : <AlertTriangle size={12} className="shrink-0 mt-0.5" />}
                          <span>{testResult.msg}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 说明提示 */}
            <div className="mt-6 bg-purple-50 rounded-2xl p-4 text-xs text-purple-700">
              <p className="font-bold mb-1">使用说明</p>
              <ul className="space-y-1 text-purple-600">
                <li>• 所有模型使用相同的接口地址（OhMyGPT 中转），只需填写对应模型的 API Key 和模型 ID</li>
                <li>• 点击「编辑」→ 填写 API Key → 保存后即可「启用」该模型</li>
                <li>• 切换后立即生效，下一次质检将使用新模型</li>
                <li>• 「测试连接」可验证 Key 是否有效</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default ModelAdminPage;
