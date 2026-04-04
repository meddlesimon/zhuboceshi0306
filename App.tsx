
import React, { useState } from 'react';
import { Standard, AppStep, AnalysisResult, MultiRoundResult, StreamMetadata, AnchorResult, Anchor, AppPage } from './types';
import Header from './components/Header';
import ReportView from './components/ReportView';
import FileUploader from './components/FileUploader';
import StandardsExport from './components/StandardsExport'; // Import the new component
import AnchorVerification from './components/AnchorVerification'; // Import the new component
import AnchorSelector from './components/AnchorSelector';
import WorkspaceView from './components/WorkspaceView';
import AnchorAdminPage from './components/AnchorAdminPage';
import ScriptAdminPage from './components/ScriptAdminPage';
import ModelAdminPage from './components/ModelAdminPage';
import TrainingAdminPage from './components/TrainingAdminPage';
import TrainingFlashcard from './components/TrainingFlashcard';
import { parseStandardsCSV, parseTranscript, parseMetadataFromFilename } from './utils/csvHelper';
import { analyzeScript, splitTranscript, findCandidateAnchors } from './services/doubaoService';
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
  // ============================================================
  // 主播培训前台入口：/zhubopeixun 路径直接渲染闪卡页面
  // ============================================================
  if (typeof window !== 'undefined' && window.location.pathname === '/zhubopeixun') {
    return <TrainingFlashcard />;
  }

  // ============================================================
  // 新增：顶层页面路由（不影响原有步骤逻辑）
  // ============================================================
  const [appPage, setAppPage] = useState<AppPage>(() =>
    localStorage.getItem('qc_logged_in') === '1' ? 'home' : 'login'
  );
  const [selectedAnchor, setSelectedAnchor] = useState<Anchor | null>(null);

  // ============================================================
  // 以下为原有状态（一字未动）
  // ============================================================
  const [step, setStep] = useState<AppStep>(AppStep.LOGIN);
  const [isLoginLoading, setIsLoginLoading] = useState(false);
  const [standards, setStandards] = useState<Standard[]>([]);
  const [transcript, setTranscript] = useState<string>('');
  const [fullRawText, setFullRawText] = useState<string>('');
  const [result, setResult] = useState<MultiRoundResult | null>(null);
  const [candidateAnchors, setCandidateAnchors] = useState<AnchorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [headerActions, setHeaderActions] = useState<React.ReactNode>(null);
  
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

  const [analysisProgress, setAnalysisProgress] = useState<string>('');
  const [analysisBatches, setAnalysisBatches] = useState<any[]>([]);
  const [isScanning, setIsScanning] = useState(false);

  const handleAdminLogin = async (u: string, p: string) => {
    setIsLoginLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
      });
      const data = await response.json();
      if (data.success) {
        localStorage.setItem('qc_logged_in', '1');
        localStorage.setItem('qc_role', data.role || 'admin');
        localStorage.setItem('qc_display_name', data.display_name || '管理员');
        localStorage.setItem('qc_username', data.username || u);
        setAppPage('home');
      } else {
        setError(data.error || "账号或密码错误");
      }
    } catch (err: any) {
      setError("连接服务器失败，请稍后重试");
    } finally {
      setIsLoginLoading(false);
    }
  };

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
      setFullRawText(content); // Store 100% original content
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

  // 单轮和双轮都走锚点扫描流程，用锚点框定有效质检区间
  const startScanningAnchors = async () => {
    setIsScanning(true);
    setError(null);
    try {
      const anchors = await findCandidateAnchors(transcript);
      setCandidateAnchors(anchors);
      setStep(AppStep.VERIFY_ANCHORS);
    } catch (err: any) {
      setError(`锚点预找失败: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  const startAnalysis = async (manualAnchors: any) => {
    setStep(AppStep.ANALYZING);
    setAnalysisBatches([]);
    setError(null);
    try {
      if (isDualRound) {
        // 1. 双轮模式
        setAnalysisProgress('正在执行 4-视窗严格切分...');
        const { part1, part2, anchors } = await splitTranscript(transcript, manualAnchors);
        
        if (!part2 || part2.length < 50) {
           console.warn("Split failed or not found, falling back to single round.");
           setAnalysisProgress('未检测到第二轮，正在进行全量质检...');
           const singleRes = await analyzeScript(
             transcript, 
             standards,
             (init) => setAnalysisBatches(init),
             (id, status) => setAnalysisBatches(prev => prev.map(b => b.id === id ? {...b, status} : b))
           );
           setResult({ 
             round1: singleRes, 
             round1Text: transcript,
             fullRawText: fullRawText,
             isDualMode: false 
           });
           setError("AI 未能检测到明显的第二轮开始点，已自动切换为单轮质检。");
        } else {
           setAnalysisProgress('检测到双轮结构，正在并行分析中...');
           const [res1, res2] = await Promise.all([
             analyzeScript(
               part1, 
               standards,
               (init) => setAnalysisBatches(prev => [...prev, ...init.map(b => ({...b, id: 'r1-'+b.id, label: '第一轮: ' + b.label}))]),
               (id, status) => setAnalysisBatches(prev => prev.map(b => b.id === 'r1-'+id ? {...b, status} : b))
             ),
             analyzeScript(
               part2, 
               standards,
               (init) => setAnalysisBatches(prev => [...prev, ...init.map(b => ({...b, id: 'r2-'+b.id, label: '第二轮: ' + b.label}))]),
               (id, status) => setAnalysisBatches(prev => prev.map(b => b.id === 'r2-'+id ? {...b, status} : b))
             )
           ]);
           setResult({ 
             round1: res1, 
             round2: res2, 
             round1Text: part1,
             round2Text: part2,
             fullRawText: fullRawText,
             isDualMode: true,
             splitAnchors: anchors
           });
        }
      } else {
        // 2. 单轮模式：用锚点截取有效区间后质检
        let effectiveText = transcript;
        if (manualAnchors) {
          const { r1StartPos, r1EndPos, r1EndPhrase } = manualAnchors;
          const effectiveStart = (r1StartPos === -1 || r1StartPos === undefined) ? 0 : r1StartPos;
          const effectiveEnd = (r1EndPos === -1 || r1EndPos === undefined) ? transcript.length : r1EndPos + (r1EndPhrase?.length || 0);
          effectiveText = transcript.substring(effectiveStart, effectiveEnd).trim();
          console.log(`[单轮锚点截取] 从 ${effectiveStart} 到 ${effectiveEnd}，有效文本长度: ${effectiveText.length}`);
        }
        setAnalysisProgress('正在对比质检标准，请稍候...');
        const data = await analyzeScript(
          effectiveText, 
          standards,
          (init) => setAnalysisBatches(init),
          (id, status) => setAnalysisBatches(prev => prev.map(b => b.id === id ? {...b, status} : b))
        );
        setResult({ 
          round1: data, 
          round1Text: effectiveText,
          fullRawText: fullRawText,
          isDualMode: false 
        });
      }
      
      setStep(AppStep.REPORT);
    } catch (err: any) {
      console.error("Analysis Error:", err);
      const detail = err.response?.data?.error || err.response?.data?.error_detail || err.message;
      setError(`检测失败: ${detail}。请检查网络、余额或 AI 配置。`);
      setStep(AppStep.UPLOAD_TRANSCRIPT);
    }
  };

  const resetApp = () => {
    setStep(AppStep.UPLOAD_STANDARDS);
    setStandards([]);
    setTranscript('');
    setFullRawText('');
    setStandardsFileName('');
    setMetadata({ fileName: '', anchorName: '', date: '', round: '' });
    setResult(null);
    setError(null);
    setPasteContent('');
    setIsDualRound(true); // Reset to true as it is now the default
    setHeaderActions(null);
  };

  // ============================================================
  // 新增：渲染新页面（不影响原有 return 逻辑）
  // ============================================================
  if (appPage === 'home') {
    return (
      <AnchorSelector
        onSelectAnchor={(anchor) => { setSelectedAnchor(anchor); setAppPage('workspace'); }}
        onGoAnchorAdmin={() => setAppPage('anchor-admin')}
        onGoScriptAdmin={() => setAppPage('script-admin')}
        onGoModelAdmin={() => setAppPage('model-admin')}
        onGoTrainingAdmin={() => setAppPage('training-admin')}
      />
    );
  }

  if (appPage === 'workspace' && selectedAnchor) {
    return (
      <WorkspaceView
        anchor={selectedAnchor}
        onBack={() => setAppPage('home')}
      />
    );
  }

  if (appPage === 'anchor-admin') {
    return <AnchorAdminPage onBack={() => setAppPage('home')} />;
  }

  if (appPage === 'script-admin') {
    return <ScriptAdminPage onBack={() => setAppPage('home')} />;
  }

  if (appPage === 'model-admin') {
    return <ModelAdminPage onBack={() => setAppPage('home')} />;
  }

  if (appPage === 'training-admin') {
    return <TrainingAdminPage onBack={() => setAppPage('home')} />;
  }

  // Helper to count Importance
  const todayCount = standards.filter(s => s.importance === 'high').length;
  const totalCount = standards.length;

  return (
    <div className={`min-h-screen bg-slate-100 font-sans text-slate-900 print:bg-white print:h-auto overflow-x-hidden ${(step === AppStep.REPORT || step === AppStep.VERIFY_ANCHORS) ? '' : 'flex justify-center'}`}>
      <div className={`w-full bg-white min-h-screen shadow-2xl flex flex-col relative print:max-w-none print:shadow-none print:min-h-0 transition-all duration-500 ease-in-out ${(step === AppStep.REPORT || step === AppStep.VERIFY_ANCHORS) ? 'max-w-none' : 'max-w-[600px]'}`}>
        <Header actionSlot={step === AppStep.REPORT ? headerActions : undefined} />

        <main className={`flex-1 flex flex-col print:overflow-visible ${step === AppStep.VERIFY_ANCHORS ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {step === AppStep.LOGIN && (
            <LoginView onLogin={handleAdminLogin} loading={isLoginLoading} />
          )}

          {step !== AppStep.REPORT && step !== AppStep.LOGIN && (
            <div className="px-6 pt-6 pb-2 print:hidden">
              <div className="flex justify-between items-center text-xs font-medium text-slate-400">
                <span className={step === AppStep.UPLOAD_STANDARDS ? "text-blue-600 font-bold" : ""}>1. 标准</span>
                <span className="h-px flex-1 bg-slate-200 mx-2"></span>
                <span className={step === AppStep.UPLOAD_TRANSCRIPT ? "text-blue-600 font-bold" : ""}>2. 文本</span>
                <span className="h-px flex-1 bg-slate-200 mx-2"></span>
                <span className={step === AppStep.VERIFY_ANCHORS ? "text-blue-600 font-bold" : ""}>3. 核对</span>
                <span className="h-px flex-1 bg-slate-200 mx-2"></span>
                <span className={step === AppStep.ANALYZING ? "text-blue-600 font-bold" : ""}>4. 质检</span>
              </div>
            </div>
          )}

          <div className={step === AppStep.VERIFY_ANCHORS ? 'flex-1 flex flex-col overflow-hidden print:p-0' : 'p-6 print:p-0'}>
            {step === AppStep.LOGIN && error && (
              <div className="bg-red-50 text-red-600 p-3 rounded-lg text-xs flex items-start gap-2 mb-4 animate-in slide-in-from-top-2">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                {error}
              </div>
            )}

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
                      onClick={startScanningAnchors}
                      disabled={isScanning}
                      className="w-full py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 active:scale-95 transition-transform flex items-center justify-center gap-2"
                    >
                      {isScanning ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          正在扫描锚点...
                        </>
                      ) : (
                        '下一步：核对锚点'
                      )}
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

            {step === AppStep.VERIFY_ANCHORS && candidateAnchors && (
              <AnchorVerification 
                fullText={transcript} 
                initialAnchors={candidateAnchors} 
                isDualRound={isDualRound}
                onConfirm={(final) => startAnalysis(final)}
                onBack={() => setStep(AppStep.UPLOAD_TRANSCRIPT)}
              />
            )}

            {step === AppStep.ANALYZING && (
              <div className="space-y-6 animate-in fade-in duration-500">
                <div className="text-center">
                   <h2 className="text-lg font-bold text-slate-800 mb-1">AI 专家集群正在质检</h2>
                   <p className="text-xs text-slate-400">已开启并行加速，各组专家正在独立作业</p>
                </div>

                {/* 批次进度条列表 */}
                <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-3 max-h-[400px] overflow-y-auto shadow-inner">
                  {analysisBatches.length > 0 ? (
                    analysisBatches.map((batch) => (
                      <div key={batch.id} className="space-y-1.5">
                        <div className="flex justify-between text-[10px] font-bold">
                          <span className="text-slate-600">{batch.label}</span>
                          <span className={
                            batch.status === 'completed' ? 'text-green-500' : 
                            batch.status === 'loading' ? 'text-blue-500 animate-pulse' : 'text-slate-300'
                          }>
                            {batch.status === 'completed' ? '已完成' : 
                             batch.status === 'loading' ? '正在分析...' : 
                             batch.status === 'error' ? '出错了' : '排队中'}
                          </span>
                        </div>
                        <div className="h-2 w-full bg-white rounded-full overflow-hidden border border-slate-100">
                          <div 
                            className={`h-full transition-all duration-700 ease-in-out ${
                              batch.status === 'completed' ? 'bg-green-500' : 
                              batch.status === 'loading' ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'bg-transparent'
                            }`}
                            style={{ 
                              width: batch.status === 'completed' ? '100%' : batch.status === 'loading' ? '70%' : '0%' 
                            }}
                          ></div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 space-y-4">
                      <Loader2 size={32} className="text-blue-600 animate-spin" />
                      <p className="text-xs text-slate-400">{analysisProgress || "准备中..."}</p>
                    </div>
                  )}
                </div>

                <div className="bg-blue-50 rounded-xl p-3 flex items-center gap-3">
                  <div className="bg-blue-600 p-2 rounded-lg text-white">
                    <Loader2 size={16} className="animate-spin" />
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-blue-700 leading-tight">
                      <strong>正在进行精密比对</strong><br/>
                      AI 正在对全部 {standards.length} 条标准进行深度扫描...
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {step === AppStep.REPORT && result && (
             <ReportView result={result} standards={standards} metadata={metadata} onReset={resetApp} onRegisterActions={setHeaderActions} />
          )}
        </main>
      </div>
    </div>
  );
};

// 在 App.tsx 中添加以下组件定义
const LoginView: React.FC<{ onLogin: (u: string, p: string) => void; loading: boolean }> = ({ onLogin, loading }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="flex flex-col items-center justify-center py-24 px-8 space-y-10 animate-in fade-in zoom-in duration-500">
      {/* 品牌图标 */}
      <div className="relative">
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-3xl blur opacity-25"></div>
        <div className="relative w-24 h-24 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-3xl flex items-center justify-center shadow-2xl transform hover:scale-105 transition-transform duration-300">
          <ShieldCheck size={48} className="text-white" />
        </div>
      </div>

      {/* 标题区 */}
      <div className="text-center space-y-3">
        <h2 className="text-3xl font-black tracking-tight text-slate-900">
          AI 智能质检
          <span className="block text-blue-600 text-lg font-bold mt-1">管理控制台</span>
        </h2>
        <div className="h-1.5 w-12 bg-blue-600 rounded-full mx-auto"></div>
      </div>

      {/* 输入区 */}
      <div className="w-full space-y-6">
        <div className="space-y-2 group">
          <label className="text-xs font-bold text-slate-500 uppercase ml-1 flex items-center gap-1.5 transition-colors group-focus-within:text-blue-600">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
            管理员账号
          </label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-base outline-none focus:border-blue-500 focus:bg-white transition-all shadow-sm"
            placeholder="请输入账号"
          />
        </div>

        <div className="space-y-2 group">
          <label className="text-xs font-bold text-slate-500 uppercase ml-1 flex items-center gap-1.5 transition-colors group-focus-within:text-blue-600">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
            访问密码
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-5 py-4 text-base outline-none focus:border-blue-500 focus:bg-white transition-all shadow-sm"
            placeholder="请输入密码"
          />
        </div>

        {/* 登录按钮 */}
        <button
          onClick={() => onLogin(username, password)}
          disabled={loading || !username || !password}
          className="group relative w-full overflow-hidden rounded-2xl bg-slate-900 py-5 text-white shadow-xl transition-all hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 disabled:cursor-not-allowed"
        >
          <div className="relative flex items-center justify-center gap-3 font-bold text-lg">
            {loading ? (
              <Loader2 className="animate-spin" size={24} />
            ) : (
              <>
                <span>进入系统</span>
                <ArrowRight size={20} className="transition-transform group-hover:translate-x-1" />
              </>
            )}
          </div>
        </button>

        <p className="text-center text-[10px] text-slate-400 font-medium tracking-widest uppercase">
          Secure Access System • Version 2.0
        </p>
      </div>
    </div>
  );
};

export default App;
