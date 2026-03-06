
import React, { useState } from 'react';
import { Standard, AppStep, AnalysisResult, MultiRoundResult, StreamMetadata } from './types';
import Header from './components/Header';
import ReportView from './components/ReportView';
import FileUploader from './components/FileUploader';
import StandardsExport from './components/StandardsExport'; // Import the new component
import { parseStandardsCSV, parseTranscript, parseMetadataFromFilename } from './utils/csvHelper';
import { analyzeScript, splitTranscript } from './services/geminiService';
import { 
  Loader2, 
  ShieldCheck, 
  ArrowRight, 
  CheckCircle2, 
  AlertTriangle,
  FileText,
  ExternalLink,
  BookOpen,
  ClipboardPaste,
  Upload,
  Link,
  Split,
  Layers
} from 'lucide-react';

const App: React.FC = () => {
  const [step, setStep] = useState<AppStep>(AppStep.UPLOAD_STANDARDS);
  const [standards, setStandards] = useState<Standard[]>([]);
  const [transcript, setTranscript] = useState<string>('');
  const [result, setResult] = useState<MultiRoundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [standardsFileName, setStandardsFileName] = useState<string>('');
  const [metadata, setMetadata] = useState<StreamMetadata>({
    fileName: '', anchorName: '', date: '', round: ''
  });

  // UI State for Upload Mode
  const [uploadMode, setUploadMode] = useState<'paste' | 'file'>('paste');
  const [pasteContent, setPasteContent] = useState('');

  // Dual Round Toggle
  // Changed default to true as per user request
  const [isDualRound, setIsDualRound] = useState(true);

  const handleStandardsUpload = (content: string, fileName: string) => {
    try {
      const parsed = parseStandardsCSV(content);
      if (parsed.length === 0) {
        throw new Error("未能在数据中识别出有效的质检标准 (需包含'分类'、'质检重点'等列)");
      }
      setStandards(parsed);
      setStandardsFileName(fileName);
      setError(null);
    } catch (e: any) {
      setError(e.message || "解析失败，请检查格式");
    }
  };

  const handlePasteSubmit = () => {
    if (!pasteContent.trim()) {
      setError("请先粘贴表格内容");
      return;
    }
    handleStandardsUpload(pasteContent, "粘贴的数据");
  };

  const handleTranscriptUpload = (content: string, fileName: string) => {
    try {
      const parsed = parseTranscript(content);
      if (!parsed || parsed.length < 5) {
        throw new Error("文本内容过短或为空，请检查文件。");
      }
      setTranscript(parsed);
      
      // Parse metadata from filename immediately
      const meta = parseMetadataFromFilename(fileName);
      setMetadata(meta);
      
      setError(null);
    } catch (e: any) {
      setError(e.message || "解析直播文本失败");
    }
  };

  const startAnalysis = async () => {
    setStep(AppStep.ANALYZING);
    try {
      if (isDualRound) {
        // 1. Dual Round Mode
        // Step A: Split
        const { part1, part2 } = await splitTranscript(transcript);
        
        if (!part2 || part2.length < 50) {
           // Fallback if split failed
           console.warn("Split failed or not found, falling back to single round.");
           const singleRes = await analyzeScript(transcript, standards);
           setResult({ 
             round1: singleRes, 
             round1Text: transcript,
             isDualMode: false 
           });
           setError("AI 未能检测到明显的第二轮开始点，已自动切换为单轮质检。");
        } else {
           // Step B: Analyze Both
           const [res1, res2] = await Promise.all([
             analyzeScript(part1, standards),
             analyzeScript(part2, standards)
           ]);
           setResult({ 
             round1: res1, 
             round2: res2, 
             round1Text: part1,
             round2Text: part2,
             isDualMode: true 
           });
        }
      } else {
        // 2. Single Round Mode
        const data = await analyzeScript(transcript, standards);
        setResult({ 
          round1: data, 
          round1Text: transcript,
          isDualMode: false 
        });
      }
      
      setStep(AppStep.REPORT);
    } catch (err: any) {
      setError(err.message || "检测过程出错，请重试。");
      setStep(AppStep.UPLOAD_TRANSCRIPT);
    }
  };

  const resetApp = () => {
    setStep(AppStep.UPLOAD_STANDARDS);
    setStandards([]);
    setTranscript('');
    setStandardsFileName('');
    setMetadata({ fileName: '', anchorName: '', date: '', round: '' });
    setResult(null);
    setError(null);
    setPasteContent('');
    setIsDualRound(true); // Reset to true as it is now the default
  };

  // Helper to count Importance
  const todayCount = standards.filter(s => s.importance === 'high').length;
  const totalCount = standards.length;

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 flex justify-center print:bg-white print:h-auto">
      <div className="w-full max-w-lg bg-white min-h-screen shadow-2xl flex flex-col relative print:max-w-none print:shadow-none print:min-h-0">
        <Header />

        <main className="flex-1 overflow-y-auto print:overflow-visible">
          {step !== AppStep.REPORT && (
            <div className="px-6 pt-6 pb-2 print:hidden">
              <div className="flex justify-between items-center text-xs font-medium text-slate-400">
                <span className={step === AppStep.UPLOAD_STANDARDS ? "text-blue-600 font-bold" : ""}>1. 标准</span>
                <span className="h-px flex-1 bg-slate-200 mx-2"></span>
                <span className={step === AppStep.UPLOAD_TRANSCRIPT ? "text-blue-600 font-bold" : ""}>2. 文本</span>
                <span className="h-px flex-1 bg-slate-200 mx-2"></span>
                <span className={step === AppStep.ANALYZING ? "text-blue-600 font-bold" : ""}>3. 质检</span>
              </div>
            </div>
          )}

          <div className="p-6 print:p-0">
            {step === AppStep.UPLOAD_STANDARDS && (
              <div className="space-y-6 animate-in slide-in-from-right-8 fade-in duration-300">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">导入质检标准</h2>
                  <p className="text-sm text-slate-500 mt-1">支持从飞书表格直接复制粘贴</p>
                </div>

                {standards.length === 0 ? (
                  <div className="space-y-4">
                    {/* Toggle Switch */}
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      <button 
                        onClick={() => setUploadMode('paste')} 
                        className={`flex-1 py-2 text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${uploadMode === 'paste' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        <ClipboardPaste size={16} /> 飞书/Excel 粘贴
                      </button>
                      <button 
                        onClick={() => setUploadMode('file')}
                        className={`flex-1 py-2 text-sm font-bold rounded-lg flex items-center justify-center gap-2 transition-all ${uploadMode === 'file' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
                      >
                        <Upload size={16} /> 上传 CSV 文件
                      </button>
                    </div>

                    {uploadMode === 'paste' && (
                      <div className="space-y-4 animate-in fade-in duration-300">
                        {/* 1. Link Card */}
                        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
                           <div className="flex justify-between items-start mb-3">
                             <div className="flex items-center gap-2 text-blue-800 font-bold">
                               <Link size={16} />
                               <span>王老师、可乐老师质检</span>
                             </div>
                             <ExternalLink size={14} className="text-blue-400" />
                           </div>
                           
                           <a 
                             href="https://gcnuamkwl51x.feishu.cn/wiki/CVsbwxx0fio5kfkG5DNcex7in6c?from=from_copylink"
                             target="_blank"
                             rel="noopener noreferrer"
                             className="block w-full bg-blue-600 hover:bg-blue-700 text-white font-bold text-center py-3 rounded-lg shadow-md hover:shadow-lg transition-all active:scale-95 mb-2"
                           >
                             <div className="flex items-center justify-center gap-2">
                               <ExternalLink size={18} />
                               1. 点击打开表格 (复制数据)
                             </div>
                           </a>
                           <p className="text-xs text-blue-400 text-center">
                             打开后按 <code className="bg-blue-100 px-1 rounded">Ctrl+A</code> 全选，<code className="bg-blue-100 px-1 rounded">Ctrl+C</code> 复制
                           </p>
                        </div>

                        {/* 2. Textarea */}
                        <div className="relative">
                          <textarea
                            value={pasteContent}
                            onChange={(e) => setPasteContent(e.target.value)}
                            placeholder="请点击上方按钮打开表格，全选复制后，在此处粘贴..."
                            className="w-full h-40 p-4 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none text-xs font-mono leading-relaxed shadow-inner"
                          />
                          <div className="absolute top-3 right-3 bg-white/80 backdrop-blur px-2 py-1 rounded text-xs font-bold text-slate-400 border border-slate-200">
                            2. 在此粘贴 (Ctrl+V)
                          </div>
                        </div>

                        <button 
                          onClick={handlePasteSubmit}
                          className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold py-4 rounded-xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                        >
                          <ShieldCheck size={20} />
                          解析并导入
                        </button>
                      </div>
                    )}

                    {uploadMode === 'file' && (
                      <div className="animate-in fade-in duration-300">
                        <FileUploader 
                          title="上传本地表格" 
                          description=".csv 格式 (需含'重要性'列区分今日/日常)"
                          accept=".csv"
                          icon={<ShieldCheck size={28} />}
                          onFileLoaded={handleStandardsUpload}
                        />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Status Card */}
                    <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
                      <div className="flex items-start gap-3 mb-4">
                        <div className="bg-green-100 p-2 rounded-lg text-green-600 shrink-0">
                          <CheckCircle2 size={20} />
                        </div>
                        <div className="overflow-hidden">
                          <h3 className="font-bold text-slate-800 text-sm">标准已加载</h3>
                          <p className="text-xs text-slate-500 truncate">{standardsFileName}</p>
                        </div>
                      </div>

                      {/* Counts */}
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="bg-white p-3 rounded-lg border border-slate-100 text-center">
                          <p className="text-[10px] text-slate-400 uppercase font-bold">总规则数</p>
                          <p className="text-xl font-bold text-slate-800">{totalCount}</p>
                        </div>
                        <div className="bg-blue-600 p-3 rounded-lg border border-blue-500 text-center shadow-md">
                          <p className="text-[10px] text-blue-200 uppercase font-bold">今日重点</p>
                          <p className="text-xl font-bold text-white">{todayCount}</p>
                        </div>
                      </div>
                      
                      <div className="bg-blue-50 rounded px-3 py-2 text-xs text-blue-700 mb-4 flex items-center gap-2">
                        <FileText size={14} />
                        <span>下方预览仅显示“今日重点”，质检时将检查全部内容。</span>
                      </div>

                      <button 
                        onClick={() => setStep(AppStep.UPLOAD_TRANSCRIPT)}
                        className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center justify-center gap-2"
                      >
                        下一步：上传文本
                        <ArrowRight size={16} />
                      </button>
                      
                      <button 
                        onClick={() => { setStandards([]); setStandardsFileName(''); setPasteContent(''); }}
                        className="w-full py-3 mt-1 text-xs text-slate-400 hover:text-slate-600"
                      >
                        重新上传
                      </button>
                    </div>

                    {/* New: Standards Preview & Export */}
                    <StandardsExport standards={standards} fileName={standardsFileName} />
                  </div>
                )}
                
                {error && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs flex items-start gap-2 animate-in slide-in-from-top-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}
              </div>
            )}

            {step === AppStep.UPLOAD_TRANSCRIPT && (
              <div className="space-y-6 animate-in slide-in-from-right-8 fade-in duration-300">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">导入直播文本</h2>
                  <p className="text-sm text-slate-500 mt-1">文件名示例：李佳琦_20231111_第一轮.docx</p>
                </div>

                {transcript.length === 0 ? (
                  <FileUploader 
                    title="上传直播文本" 
                    description=".docx, .txt, .csv"
                    accept=".csv,.docx,.txt"
                    icon={<FileText size={28} />}
                    onFileLoaded={handleTranscriptUpload}
                  />
                ) : (
                  <div className="bg-slate-50 rounded-xl border border-slate-200 p-5">
                    <div className="flex items-start gap-3 mb-4">
                      <div className="bg-green-100 p-2 rounded-lg text-green-600 shrink-0">
                        <CheckCircle2 size={20} />
                      </div>
                      <div className="overflow-hidden">
                        <h3 className="font-bold text-slate-800 text-sm">文本已加载</h3>
                        <p className="text-xs text-slate-500 truncate mb-1">{metadata.fileName}</p>
                        <div className="flex gap-2 text-[10px] text-slate-400">
                           <span className="bg-slate-100 px-1.5 py-0.5 rounded">{metadata.anchorName}</span>
                           <span className="bg-slate-100 px-1.5 py-0.5 rounded">{metadata.date}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="bg-white rounded-lg p-3 mb-4 border border-slate-100 max-h-32 overflow-hidden relative">
                      <p className="text-xs text-slate-500 font-mono leading-relaxed">
                        {transcript.slice(0, 300)}...
                      </p>
                      <div className="absolute bottom-0 left-0 w-full h-12 bg-gradient-to-t from-white to-transparent"></div>
                    </div>

                    {/* Dual Round Toggle */}
                    <div className={`p-3 rounded-lg border flex items-center gap-3 transition-colors mb-4 cursor-pointer select-none ${isDualRound ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-200'}`}
                         onClick={() => setIsDualRound(!isDualRound)}
                    >
                      <div className={`w-10 h-6 rounded-full relative transition-colors ${isDualRound ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                         <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${isDualRound ? 'left-5' : 'left-1'}`}></div>
                      </div>
                      <div className="flex-1">
                         <div className="flex items-center gap-2">
                           <Split size={16} className={isDualRound ? "text-indigo-600" : "text-slate-400"} />
                           <p className={`text-sm font-bold ${isDualRound ? 'text-indigo-900' : 'text-slate-600'}`}>包含两轮演练 (自动拆分)</p>
                         </div>
                         <p className="text-[10px] text-slate-400 mt-0.5">
                           {isDualRound 
                             ? "AI 将识别第二轮开头，把文本切分为两部分分别质检" 
                             : "默认将整个文本视为一轮进行质检"}
                         </p>
                      </div>
                    </div>

                    <button 
                      onClick={startAnalysis}
                      className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 active:scale-95 transition-transform flex items-center justify-center gap-2"
                    >
                      {isDualRound ? '开始双轮质检' : '开始全量质检'}
                      <Loader2 size={16} className="animate-spin" style={{ display: 'none' }} /> 
                    </button>
                    <p className="text-[10px] text-center text-slate-400 mt-2">
                      将检查全部 {standards.length} 条规则 (含{todayCount}条今日重点)
                    </p>
                    <button 
                      onClick={() => { setTranscript(''); setMetadata({fileName:'',anchorName:'',date:'',round:''}); }}
                      className="w-full py-3 mt-2 text-xs text-slate-400 hover:text-slate-600"
                    >
                      重新上传
                    </button>
                  </div>
                )}

                <button 
                  onClick={() => setStep(AppStep.UPLOAD_STANDARDS)}
                  className="w-full text-sm text-slate-400 hover:text-slate-600 flex items-center justify-center gap-1"
                >
                  返回上一步
                </button>

                {error && (
                  <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs flex items-start gap-2">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}
              </div>
            )}

            {step === AppStep.ANALYZING && (
              <div className="flex flex-col items-center justify-center h-64 space-y-6 animate-in fade-in duration-500">
                <div className="relative">
                  <div className="absolute inset-0 bg-blue-100 rounded-full animate-ping opacity-75"></div>
                  <div className="relative bg-white p-4 rounded-full shadow-xl border border-blue-50">
                    <Loader2 size={32} className="text-blue-600 animate-spin" />
                  </div>
                </div>
                <div className="text-center space-y-2">
                  <h2 className="text-lg font-bold text-slate-800">
                    {isDualRound ? "正在进行双轮拆分与质检..." : "正在进行全量质检..."}
                  </h2>
                  <p className="text-sm text-slate-500 px-4">
                    {isDualRound && (
                      <span className="block mb-1 text-indigo-600 font-bold bg-indigo-50 py-0.5 rounded">
                        AI 正在分析结构并拆分第一轮/第二轮
                      </span>
                    )}
                    正在逐条比对全部 {standards.length} 条标准<br/>
                    (含 {todayCount} 条今日重点 + {totalCount - todayCount} 条日常规范)
                  </p>
                </div>
              </div>
            )}
          </div>

          {step === AppStep.REPORT && result && (
             <ReportView result={result} standards={standards} metadata={metadata} onReset={resetApp} />
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
