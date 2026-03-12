import React, { useEffect, useState } from 'react';
import { Standard, StandardsVersion } from '../types';
import { parseStandardsCSV } from '../utils/csvHelper';
import { ArrowLeft, BookOpen, Upload, CheckCircle2, AlertTriangle, Loader2, ChevronRight, ExternalLink, ClipboardPaste } from 'lucide-react';

interface Props {
  onBack: () => void;
}

const ScriptAdminPage: React.FC<Props> = ({ onBack }) => {
  const [versions, setVersions] = useState<StandardsVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 选中预览的版本
  const [selectedVersion, setSelectedVersion] = useState<StandardsVersion | null>(null);
  const [selectedContent, setSelectedContent] = useState<Standard[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // 上传新话术
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [parsedStandards, setParsedStandards] = useState<Standard[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // 表格筛选
  const [filter, setFilter] = useState<'all' | 'high' | 'normal' | 'forbidden'>('all');

  useEffect(() => { loadVersions(); }, []);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 2500);
  };

  const loadVersions = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/standards');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setVersions(data);
      // 默认展示当前版本
      const current = data.find((v: StandardsVersion) => v.is_current === 1);
      if (current) loadVersionDetail(current);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadVersionDetail = async (ver: StandardsVersion) => {
    setLoadingDetail(true);
    setSelectedVersion(ver);
    try {
      const res = await fetch(`/api/standards/${ver.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '加载失败');
      setSelectedContent(data.content || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleParse = () => {
    if (!pasteContent.trim()) { setParseError('请先粘贴内容'); return; }
    try {
      const result = parseStandardsCSV(pasteContent);
      if (result.length === 0) throw new Error('未能识别出有效话术，请检查格式（需包含"分类"、"质检重点"等列）');
      setParsedStandards(result);
      setParseError(null);
    } catch (e: any) {
      setParseError(e.message);
      setParsedStandards(null);
    }
  };

  const handleUpload = async () => {
    if (!parsedStandards || parsedStandards.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch('/api/standards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_json: parsedStandards })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '上传失败');
      setShowUploadPanel(false);
      setPasteContent('');
      setParsedStandards(null);
      showSuccess(`新版本话术已上传（共 ${data.total_count} 条），已设为当前使用版本`);
      loadVersions();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };

  const filteredContent = selectedContent.filter(s => {
    if (filter === 'all') return true;
    if (filter === 'forbidden') return s.type === 'forbidden';
    if (filter === 'high') return s.importance === 'high' && s.type !== 'forbidden';
    if (filter === 'normal') return s.importance === 'normal' && s.type !== 'forbidden';
    return true;
  });

  const typeLabel = (s: Standard) => {
    if (s.type === 'forbidden') return <span className="px-2 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded-full">禁止</span>;
    if (s.importance === 'high') return <span className="px-2 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded-full">今日重点</span>;
    return <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-bold rounded-full">日常</span>;
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-4 shadow-sm">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors">
          <ArrowLeft size={18} className="text-slate-600" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-violet-600 to-purple-700 rounded-xl flex items-center justify-center">
            <BookOpen size={16} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900">话术管理</h1>
            <p className="text-xs text-slate-400">所有主播共用同一套话术</p>
          </div>
        </div>
        <div className="ml-auto">
          <button
            onClick={() => { setShowUploadPanel(true); setParsedStandards(null); setPasteContent(''); setParseError(null); }}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-violet-100"
          >
            <Upload size={14} />
            上传新版本话术
          </button>
        </div>
      </div>

      {/* 提示 */}
      {successMsg && (
        <div className="mx-6 mt-4 bg-green-50 border border-green-100 rounded-xl p-3 flex items-center gap-2 animate-in slide-in-from-top-2">
          <CheckCircle2 size={16} className="text-green-600 shrink-0" />
          <p className="text-sm text-green-700">{successMsg}</p>
        </div>
      )}
      {error && (
        <div className="mx-6 mt-4 bg-red-50 border border-red-100 rounded-xl p-3 flex items-center gap-2">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden" style={{ height: 'calc(100vh - 73px)' }}>
        {/* 左侧：版本列表 */}
        <div className="w-64 bg-white border-r border-slate-100 flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-slate-50">
            <p className="text-xs font-black text-slate-500 uppercase tracking-wide">版本历史</p>
          </div>
          {loading ? (
            <div className="flex justify-center pt-8"><Loader2 size={24} className="text-violet-500 animate-spin" /></div>
          ) : versions.length === 0 ? (
            <div className="text-center pt-8 text-sm text-slate-400">尚未上传话术</div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {versions.map(ver => (
                <button
                  key={ver.id}
                  onClick={() => loadVersionDetail(ver)}
                  className={`w-full text-left px-4 py-4 border-b border-slate-50 hover:bg-slate-50 transition-colors ${selectedVersion?.id === ver.id ? 'bg-violet-50 border-l-2 border-l-violet-500' : ''}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-black text-slate-800">{ver.version_label}</span>
                    {ver.is_current === 1 && (
                      <span className="text-[10px] font-bold bg-violet-600 text-white px-2 py-0.5 rounded-full">当前</span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">{ver.total_count} 条 · {ver.created_at?.slice(0, 10)}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 右侧：话术详情表格 */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {loadingDetail ? (
            <div className="flex justify-center pt-12"><Loader2 size={28} className="text-violet-500 animate-spin" /></div>
          ) : !selectedVersion ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-4 text-slate-400">
              <BookOpen size={40} className="opacity-30" />
              <p className="text-sm">请选择左侧版本查看详情</p>
            </div>
          ) : (
            <>
              {/* 表格工具栏 */}
              <div className="bg-white border-b border-slate-100 px-5 py-3 flex items-center justify-between gap-3 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-black text-slate-800">{selectedVersion.version_label}</span>
                  <span className="text-xs text-slate-400">共 {selectedContent.length} 条</span>
                  {selectedVersion.is_current === 1 && (
                    <span className="text-[10px] font-bold bg-violet-600 text-white px-2 py-0.5 rounded-full">当前使用中</span>
                  )}
                </div>
                <div className="flex gap-1">
                  {(['all', 'high', 'normal', 'forbidden'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${filter === f ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >
                      {f === 'all' ? '全部' : f === 'high' ? '今日重点' : f === 'normal' ? '日常' : '禁止项'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 表格内容 */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0 z-10">
                    <tr>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 w-24">类型</th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500 w-40">质检重点</th>
                      <th className="text-left px-4 py-3 font-bold text-slate-500">标准话术</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {filteredContent.map((s, idx) => (
                      <tr key={s.id || idx} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3">{typeLabel(s)}</td>
                        <td className="px-4 py-3 font-medium text-slate-700 align-top">{s.qaFocus}</td>
                        <td className="px-4 py-3 text-slate-500 leading-relaxed">{s.content}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredContent.length === 0 && (
                  <div className="text-center py-12 text-sm text-slate-400">该分类下暂无内容</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 上传新版本话术的侧边抽屉 */}
      {showUploadPanel && (
        <div className="fixed inset-0 z-50 flex">
          <div className="flex-1 bg-black/40" onClick={() => setShowUploadPanel(false)} />
          <div className="w-[500px] bg-white flex flex-col shadow-2xl animate-in slide-in-from-right-8 duration-300">
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-black text-slate-900">上传新版本话术</h2>
                <p className="text-xs text-slate-400 mt-0.5">上传后自动设为当前版本，旧版本历史保留</p>
              </div>
              <button onClick={() => setShowUploadPanel(false)} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors text-slate-400 text-xl font-light">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* 第一步：飞书链接 */}
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-blue-800 font-bold text-sm mb-3">
                  <span className="w-5 h-5 bg-blue-600 text-white rounded-full text-xs flex items-center justify-center">1</span>
                  打开飞书表格，全选复制
                </div>
                <a
                  href="https://gcnuamkwl51x.feishu.cn/wiki/CVsbwxx0fio5kfkG5DNcex7in6c?from=from_copylink"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm py-3 rounded-xl transition-all"
                >
                  <ExternalLink size={16} />
                  打开飞书表格
                </a>
                <p className="text-xs text-blue-400 text-center mt-2">打开后 Ctrl+A 全选，Ctrl+C 复制</p>
              </div>

              {/* 第二步：粘贴 */}
              <div>
                <div className="flex items-center gap-2 text-slate-700 font-bold text-sm mb-2">
                  <span className="w-5 h-5 bg-slate-800 text-white rounded-full text-xs flex items-center justify-center">2</span>
                  粘贴到下方
                </div>
                <div className="relative">
                  <textarea
                    value={pasteContent}
                    onChange={e => { setPasteContent(e.target.value); setParsedStandards(null); setParseError(null); }}
                    placeholder="在此处粘贴（Ctrl+V）..."
                    className="w-full h-36 p-4 border-2 border-slate-200 rounded-xl text-xs font-mono leading-relaxed outline-none focus:border-violet-400 focus:bg-white transition-all resize-none"
                  />
                  <div className="absolute top-3 right-3 bg-white/80 px-2 py-1 rounded text-[10px] font-bold text-slate-400 border border-slate-200 flex items-center gap-1">
                    <ClipboardPaste size={10} /> 粘贴区
                  </div>
                </div>
              </div>

              {/* 解析按钮 */}
              <button
                onClick={handleParse}
                disabled={!pasteContent.trim()}
                className="w-full py-3 border-2 border-dashed border-slate-300 hover:border-violet-400 text-slate-600 hover:text-violet-600 font-bold text-sm rounded-xl transition-all disabled:opacity-50"
              >
                解析预览
              </button>

              {/* 解析错误 */}
              {parseError && (
                <div className="bg-red-50 border border-red-100 rounded-xl p-3 flex items-start gap-2">
                  <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs text-red-600">{parseError}</p>
                </div>
              )}

              {/* 解析预览结果 */}
              {parsedStandards && (
                <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 size={16} className="text-green-600" />
                    <p className="text-sm font-bold text-green-800">解析成功！共 {parsedStandards.length} 条规则</p>
                  </div>
                  <div className="flex gap-3 text-xs text-green-700">
                    <span>今日重点：{parsedStandards.filter(s => s.importance === 'high' && s.type !== 'forbidden').length} 条</span>
                    <span>日常：{parsedStandards.filter(s => s.importance === 'normal').length} 条</span>
                    <span>禁止项：{parsedStandards.filter(s => s.type === 'forbidden').length} 条</span>
                  </div>
                  {/* 预览前5条 */}
                  <div className="mt-3 space-y-1.5 max-h-32 overflow-y-auto">
                    {parsedStandards.slice(0, 5).map((s, i) => (
                      <div key={i} className="bg-white rounded-lg px-3 py-2 text-xs text-slate-600 truncate">
                        {s.qaFocus}：{s.content.slice(0, 40)}{s.content.length > 40 ? '...' : ''}
                      </div>
                    ))}
                    {parsedStandards.length > 5 && (
                      <p className="text-xs text-green-500 text-center">…还有 {parsedStandards.length - 5} 条</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 底部操作 */}
            <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
              <button onClick={() => setShowUploadPanel(false)} className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50 transition-all">
                取消
              </button>
              <button
                onClick={handleUpload}
                disabled={!parsedStandards || uploading}
                className="flex-1 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md shadow-violet-100"
              >
                {uploading ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                确认保存为新版本
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScriptAdminPage;
