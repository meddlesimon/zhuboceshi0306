import React, { useEffect, useState, useRef } from 'react';
import {
  ArrowLeft, Download, Loader2, AlertTriangle, Users, Zap, Megaphone,
  MessageSquareQuote, ChevronDown, ChevronUp, Eye, X, CheckCircle2, XCircle
} from 'lucide-react';

interface AccountStat {
  nickname: string;
  shortId: string;
  total: number;
  instruction: number;
  rendering: number;
  official: number;
  comments: { t: number; c: string; cat: string }[];
}

interface ReportData {
  hasData: boolean;
  message?: string;
  sessionId: string;
  totals: { instruction: number; rendering: number; official: number; total: number };
  accountStats: AccountStat[];
  config: {
    officialPrefix: string;
    targets: { head: { instruction: number; rendering: number }; normal: { instruction: number; rendering: number } };
  };
  generatedAt: string;
}

interface Props {
  sessionId: string | number;
  sessionTitle: string;
  sessionDate: string;
  anchorName: string;
  onBack: () => void;
}

const ZhongkongReportPage: React.FC<Props> = ({ sessionId, sessionTitle, sessionDate, anchorName, onBack }) => {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'head' | 'normal'>('head');
  const [detailAccount, setDetailAccount] = useState<AccountStat | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchReport();
  }, [sessionId]);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/zhongkong/session/${sessionId}/report`);
      const data = await res.json();
      setReport(data);
    } catch (e: any) {
      setReport({ hasData: false, message: '加载失败: ' + e.message } as any);
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = async () => {
    if (!reportRef.current) return;
    try {
      const { default: html2canvas } = await import('html2canvas');
      const { jsPDF } = await import('jspdf');
      const canvas = await html2canvas(reportRef.current, { scale: 2, useCORS: true, backgroundColor: '#f8fafc' });
      const pdf = new jsPDF('p', 'mm', 'a4');
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, (canvas.height * 210) / canvas.width);
      pdf.save(`中控质检_${anchorName}_${sessionDate}_${Date.now()}.pdf`);
    } catch (e) {
      alert('PDF 导出失败，请稍后重试');
    }
  };

  const targets = report?.config?.targets?.[mode] || { instruction: 350, rendering: 20 };

  const MetricBadge = ({
    icon: Icon, label, value, target, color
  }: { icon: any; label: string; value: number; target?: number; color: string }) => {
    const isMet = target ? value >= target : true;
    const progress = target ? Math.min(100, Math.round((value / target) * 100)) : 100;
    return (
      <div className={`relative bg-white rounded-3xl p-6 border ${color} overflow-hidden`}>
        <div className="flex items-center justify-between mb-2 relative z-10">
          <div className="flex items-center space-x-2">
            <Icon className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-500">{label}</span>
          </div>
          {target && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isMet ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
              {isMet ? '达标' : '待提升'}
            </span>
          )}
        </div>
        <div className="flex items-baseline space-x-1 relative z-10">
          <span className="text-2xl font-black text-slate-900">{value || 0}</span>
          {target && <span className="text-xs text-slate-400 font-medium">/ {target}</span>}
        </div>
        {target && (
          <div className={`absolute bottom-0 left-0 h-1 transition-all duration-1000 ${isMet ? 'bg-green-500' : 'bg-amber-400'}`}
            style={{ width: `${progress}%`, opacity: 0.15 }} />
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-4 shadow-sm print:hidden">
        <button onClick={onBack} className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 transition-colors">
          <ArrowLeft size={18} className="text-slate-600" />
        </button>
        <div>
          <h1 className="text-base font-black text-slate-900">{anchorName} · 中控质检报告</h1>
          <p className="text-xs text-slate-400">{sessionDate} · {sessionTitle}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center pt-20"><Loader2 size={32} className="text-purple-500 animate-spin" /></div>
      ) : !report?.hasData ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-4 text-slate-400 p-8">
          <AlertTriangle size={40} className="opacity-30" />
          <p className="text-sm">{report?.message || '该场次无水军数据'}</p>
          <button onClick={onBack} className="text-sm text-purple-600 underline">返回</button>
        </div>
      ) : (
        <>
          <div ref={reportRef} className="flex-1 max-w-5xl mx-auto w-full px-6 py-8 space-y-8">
            {/* 顶部：标题 + 模式切换 + 总发言 */}
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-4xl font-black text-slate-900 tracking-tight">{sessionTitle}</h2>
                <p className="text-slate-400 text-sm mt-1">{sessionDate} · 生成于 {report.generatedAt}</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex gap-2 bg-slate-100 p-1 rounded-xl">
                  {(['head', 'normal'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setMode(m)}
                      className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${mode === m ? 'bg-white shadow text-purple-600' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                      {m === 'head' ? '头部主播' : '普通主播'}
                    </button>
                  ))}
                </div>
                <div className="flex gap-3">
                  <div className="bg-slate-50 rounded-3xl p-6 border min-w-[120px] text-center">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-1">监控对象总发言</p>
                    <p className="text-3xl font-black text-purple-600">{report.totals.total}</p>
                  </div>
                  <div className="bg-slate-50 rounded-3xl p-6 border min-w-[120px] text-center">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter mb-1">审计覆盖率</p>
                    <p className="text-3xl font-black text-emerald-600">100%</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 整场质检指标 */}
            <div className="bg-white p-10 rounded-[2.5rem] border border-slate-100 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-50 pb-6 mb-8">
                <h4 className="text-2xl font-black text-slate-800">整场质检执行</h4>
                <span className="bg-slate-900 text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest">Full Session</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <MetricBadge icon={Zap} label="指令回应" value={report.totals.instruction} target={targets.instruction} color="border-orange-100" />
                <MetricBadge icon={Megaphone} label="氛围渲染" value={report.totals.rendering} target={targets.rendering} color="border-purple-100" />
                <MetricBadge icon={MessageSquareQuote} label="官方回复" value={report.totals.official} color="border-emerald-100" />
              </div>
            </div>

            {/* 审计对象明细表 */}
            <div className="bg-white rounded-[2.5rem] border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-10 border-b border-slate-50 font-black text-2xl flex items-center justify-between">
                <div className="flex items-center">
                  <Users className="w-8 h-8 mr-4 text-purple-600" />
                  审计对象明细表
                </div>
                <span className="text-sm font-bold text-slate-400 normal-case">{report.accountStats.length} 个账号</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-400 font-black">
                    <tr>
                      <th className="px-10 py-6 text-left uppercase tracking-tighter">账号昵称</th>
                      <th className="px-10 py-6 text-center">总发言</th>
                      <th className="px-10 py-6 text-center">⚡ 指令</th>
                      <th className="px-10 py-6 text-center">📢 渲染</th>
                      <th className="px-10 py-6 text-center">💬 官方</th>
                      <th className="px-10 py-6 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 font-bold">
                    {report.accountStats.map((acc, i) => (
                      <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-10 py-6 text-left font-black text-slate-800">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[10px] text-white ${acc.official > 0 && acc.instruction === 0 ? 'bg-emerald-600' : 'bg-purple-600'}`}>
                              {i + 1}
                            </div>
                            <div>
                              <p>{acc.nickname}</p>
                              {acc.shortId && <p className="text-[10px] text-slate-400 font-mono">{acc.shortId}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="px-10 py-6 text-center text-slate-400 font-mono">{acc.total}</td>
                        <td className="px-10 py-6 text-center text-orange-600">{acc.instruction || 0}</td>
                        <td className="px-10 py-6 text-center text-purple-600">{acc.rendering || 0}</td>
                        <td className="px-10 py-6 text-center text-emerald-600">{acc.official || 0}</td>
                        <td className="px-10 py-6 text-center">
                          <button
                            onClick={() => setDetailAccount(acc)}
                            className="p-2 bg-slate-100 hover:bg-purple-600 hover:text-white rounded-xl transition-all"
                            title="查看发言详情"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* 固定导出按钮 */}
          <button
            onClick={handleExportPDF}
            className="fixed bottom-10 right-10 bg-slate-900 text-white px-10 py-5 rounded-[2rem] shadow-2xl hover:scale-105 active:scale-95 transition-all font-black flex items-center space-x-3 z-50 print:hidden"
          >
            <Download className="w-6 h-6" />
            <span>导出 PDF 报告</span>
          </button>
        </>
      )}

      {/* 发言详情弹窗 */}
      {detailAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setDetailAccount(null)} />
          <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden mx-4">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900">{detailAccount.nickname}</h3>
                <p className="text-xs text-slate-400">共 {detailAccount.total} 条发言</p>
              </div>
              <button onClick={() => setDetailAccount(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-2">
              {detailAccount.comments.map((c, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-xl ${
                  c.cat === 'official' ? 'bg-emerald-50' :
                  c.cat === 'instruction' ? 'bg-orange-50' : 'bg-purple-50'
                }`}>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded-lg shrink-0 ${
                    c.cat === 'official' ? 'bg-emerald-100 text-emerald-700' :
                    c.cat === 'instruction' ? 'bg-orange-100 text-orange-700' : 'bg-purple-100 text-purple-700'
                  }`}>
                    {c.cat === 'official' ? '官方' : c.cat === 'instruction' ? '指令' : '渲染'}
                  </span>
                  <p className="text-sm text-slate-700 flex-1">{c.c}</p>
                  <span className="text-[10px] text-slate-400 shrink-0">{new Date(c.t).toLocaleTimeString('zh-CN')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ZhongkongReportPage;
