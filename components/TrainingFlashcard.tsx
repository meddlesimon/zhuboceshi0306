import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpen, ChevronLeft, ChevronRight,
  Eye, EyeOff, Expand, GraduationCap, Loader2, LogOut, ShieldCheck, X, CornerDownRight
} from 'lucide-react';
import { Standard, TrainingCourse, TrainingSlide } from '../types';

// ============================================================
// 工具函数：拆分 qaFocus 中的 1/2/3 编号要点
// ============================================================
function splitKeyPoints(text: string): string[] {
  if (!text) return [];
  // 匹配常见编号格式：1. 1、1） 1: ① ② 一、 等
  const parts = text.split(/(?=\d+\s*[\.、．\)）:：]\s*|(?=^|\s)[①②③④⑤⑥⑦⑧⑨])/m);
  const result = parts
    .map(p => p.replace(/^\d+\s*[\.、．\)）:：]\s*|^[①-⑨]\s*/, '').trim())
    .filter(Boolean);
  // 如果拆出来只有1条且和原文差不多，说明没有编号，直接返回整条
  if (result.length <= 1) return [text.trim()];
  return result;
}

// ============================================================
// 顶层入口：判断登录状态
// ============================================================
const TrainingFlashcard: React.FC = () => {
  const [loggedIn, setLoggedIn] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [phase, setPhase] = useState<'login' | 'select' | 'flashcard'>('login');
  const [selectedCourse, setSelectedCourse] = useState<TrainingCourse | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('training_display_name');
    const savedLogin = localStorage.getItem('training_logged_in');
    if (savedLogin === '1' && saved) {
      setDisplayName(saved);
      setLoggedIn(true);
      setPhase('select');
    }
  }, []);

  const handleLogin = (name: string) => {
    setDisplayName(name);
    setLoggedIn(true);
    setPhase('select');
  };

  const handleLogout = () => {
    localStorage.removeItem('training_logged_in');
    localStorage.removeItem('training_display_name');
    setLoggedIn(false);
    setPhase('login');
    setSelectedCourse(null);
  };

  if (phase === 'login') {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (phase === 'select') {
    return (
      <CourseSelectPage
        displayName={displayName}
        onSelect={(c) => { setSelectedCourse(c); setPhase('flashcard'); }}
        onLogout={handleLogout}
      />
    );
  }

  if (phase === 'flashcard' && selectedCourse) {
    return (
      <FlashcardPage
        course={selectedCourse}
        onBack={() => setPhase('select')}
        onLogout={handleLogout}
      />
    );
  }

  return null;
};

// ============================================================
// 登录页
// ============================================================
const LoginPage: React.FC<{ onLogin: (name: string) => void }> = ({ onLogin }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!username.trim() || !password) { setError('请填写账号和密码'); return; }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch('/api/training/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password })
      });
      const data = await r.json();
      if (!r.ok || !data.success) throw new Error(data.error || '账号或密码错误');
      localStorage.setItem('training_logged_in', '1');
      localStorage.setItem('training_display_name', data.display_name);
      onLogin(data.display_name);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-emerald-50 to-cyan-100 flex items-center justify-center px-6">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-2xl shadow-teal-100 p-8 space-y-8 animate-in fade-in zoom-in duration-300">
        {/* logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-20 h-20 bg-gradient-to-br from-teal-400 to-emerald-500 rounded-3xl flex items-center justify-center shadow-xl shadow-teal-200">
            <GraduationCap size={40} className="text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-black text-slate-800">学习机知识培训系统</h1>
            <p className="text-sm text-slate-400 mt-1">请使用管理员分配的账号登录</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase">账号</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full border-2 border-slate-100 rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-teal-400 focus:bg-teal-50/30 transition-all bg-slate-50"
              placeholder="请输入账号"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-500 uppercase">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
              className="w-full border-2 border-slate-100 rounded-2xl px-4 py-3.5 text-sm outline-none focus:border-teal-400 focus:bg-teal-50/30 transition-all bg-slate-50"
              placeholder="请输入密码"
            />
          </div>
          {error && (
            <div className="text-red-500 text-xs bg-red-50 rounded-xl px-3 py-2">{error}</div>
          )}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-teal-200 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
            进入培训中心
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================
// 课程选择页
// ============================================================
const CourseSelectPage: React.FC<{
  displayName: string;
  onSelect: (c: TrainingCourse) => void;
  onLogout: () => void;
}> = ({ displayName, onSelect, onLogout }) => {
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/training/courses')
      .then(r => r.json())
      .then(data => { setCourses(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const courseColors = [
    'from-teal-400 to-emerald-500',
    'from-cyan-400 to-teal-500',
    'from-emerald-400 to-green-500',
    'from-sky-400 to-cyan-500',
    'from-green-400 to-teal-500',
    'from-teal-500 to-cyan-600',
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-teal-50/40 flex flex-col">
      <div className="bg-white border-b border-teal-100 px-6 py-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-teal-400 to-emerald-500 rounded-xl flex items-center justify-center shadow">
            <GraduationCap size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900">学习机知识培训系统</h1>
            <p className="text-xs text-teal-500">欢迎，{displayName} 👋</p>
          </div>
        </div>
        <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500 hover:text-red-500 bg-slate-100 hover:bg-red-50 rounded-xl transition-all">
          <LogOut size={14} /> 退出
        </button>
      </div>

      <div className="flex-1 p-6 max-w-2xl mx-auto w-full">
        <div className="mb-6">
          <h2 className="text-lg font-black text-slate-900">选择培训课程</h2>
          <p className="text-sm text-slate-400 mt-0.5">点击课程进入闪卡练习模式</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={32} className="text-teal-400 animate-spin" />
          </div>
        ) : courses.length === 0 ? (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center">
            <BookOpen size={36} className="text-slate-200 mx-auto mb-3" />
            <p className="text-sm text-slate-400">暂无培训课程，请联系管理员添加</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {courses.map((c, idx) => (
              <button
                key={c.id}
                onClick={() => onSelect(c)}
                className="group bg-white rounded-2xl border border-teal-100 p-5 text-left hover:shadow-lg hover:shadow-teal-100 hover:border-teal-200 hover:-translate-y-0.5 transition-all duration-200"
              >
                <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${courseColors[idx % courseColors.length]} flex items-center justify-center shadow-lg mb-4`}>
                  <BookOpen size={22} className="text-white" />
                </div>
                <h3 className="text-base font-black text-slate-900 group-hover:text-teal-600 transition-colors">{c.title}</h3>
                <p className="text-xs text-slate-400 mt-1">话术版本：{c.standards_version_label}</p>
                <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between">
                  <span className="text-xs text-slate-400">点击开始练习</span>
                  <ChevronRight size={16} className="text-teal-500 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// 闪卡练习页（核心）— 翻页单位为「话术（Standard）」
// ============================================================

// 展平的导航项：话术维度
interface FlatItem {
  slideIdx: number;   // 属于第几张 PPT（slides 数组下标）
  stdGlobalIdx: number; // 在 standards 数组中的全局下标
  stdNumber: number;  // 话术序号（1-based，即 standard_start + offset）
}

const FlashcardPage: React.FC<{
  course: TrainingCourse;
  onBack: () => void;
  onLogout: () => void;
}> = ({ course, onBack, onLogout }) => {
  const [slides, setSlides] = useState<TrainingSlide[]>([]);
  const [standards, setStandards] = useState<Standard[]>([]);
  // 展平后的导航序列
  const [flatItems, setFlatItems] = useState<FlatItem[]>([]);
  // 当前在 flatItems 中的下标
  const [currentFlatIdx, setCurrentFlatIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  // 图片懒加载缓存：slideId -> base64
  const imageCache = useRef<Map<number, string>>(new Map());
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const loadingIds = useRef<Set<number>>(new Set());

  // 显示/隐藏控制
  const [showKeyPoints, setShowKeyPoints] = useState(true);
  const [showScript, setShowScript] = useState(true);

  // PPT全屏
  const [pptFullscreen, setPptFullscreen] = useState(false);

  // 手机端检测与标签页状态
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);
  const [mobileTab, setMobileTab] = useState<'keypoints' | 'script'>('keypoints');

  // 跳转输入框
  const [showJump, setShowJump] = useState(false);
  const [jumpInput, setJumpInput] = useState('');
  const [jumpError, setJumpError] = useState('');
  const jumpInputRef = useRef<HTMLInputElement>(null);

  // 打开跳转浮层时自动聚焦
  useEffect(() => {
    if (showJump) {
      setJumpInput('');
      setJumpError('');
      setTimeout(() => jumpInputRef.current?.focus(), 50);
    }
  }, [showJump]);

  // 监听窗口大小变化，判断是否手机端
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // 加载单张幻灯片图片（有缓存则直接返回）
  const loadSlideImage = useCallback(async (slideId: number): Promise<string | null> => {
    if (imageCache.current.has(slideId)) {
      return imageCache.current.get(slideId)!;
    }
    if (loadingIds.current.has(slideId)) return null;
    loadingIds.current.add(slideId);
    try {
      const r = await fetch(`/api/training/slides/${slideId}/image`);
      if (!r.ok) return null;
      const data = await r.json();
      const img = data.image_base64 || '';
      imageCache.current.set(slideId, img);
      return img;
    } catch {
      return null;
    } finally {
      loadingIds.current.delete(slideId);
    }
  }, []);

  // 切换到指定 slide（有缓存则直接用，否则请求）
  const switchToSlideById = useCallback(async (slideId: number, allSlides: TrainingSlide[]) => {
    if (imageCache.current.has(slideId)) {
      setCurrentImage(imageCache.current.get(slideId)!);
      setImageLoading(false);
    } else {
      setImageLoading(true);
      setCurrentImage(null);
      const img = await loadSlideImage(slideId);
      setCurrentImage(img);
      setImageLoading(false);
    }
    // 后台预加载下一张（找下一个不同 slideId）
    const curSlideObj = allSlides.find(s => s.id === slideId);
    if (curSlideObj) {
      const nextSlide = allSlides.find(s => s.order === curSlideObj.order + 1);
      if (nextSlide && !imageCache.current.has(nextSlide.id)) {
        loadSlideImage(nextSlide.id).catch(() => {});
      }
    }
  }, [loadSlideImage]);

  // 执行跳转
  const doJump = useCallback((val: string, items: FlatItem[], allSlides: TrainingSlide[]) => {
    const num = parseInt(val.trim(), 10);
    if (isNaN(num) || num < 1 || num > items.length) {
      setJumpError(`请输入 1 ~ ${items.length} 之间的数字`);
      return;
    }
    const targetIdx = num - 1;
    const targetItem = items[targetIdx];
    const curItem = items[currentFlatIdx];
    setCurrentFlatIdx(targetIdx);
    if (targetItem && targetItem.slideIdx !== curItem?.slideIdx) {
      switchToSlideById(allSlides[targetItem.slideIdx]?.id, allSlides);
    }
    setShowJump(false);
  }, [currentFlatIdx, switchToSlideById]);

  // 初始化
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const [metaRes, stdRes] = await Promise.all([
          fetch(`/api/training/courses/${course.id}/slides/meta`),
          fetch(`/api/standards/${course.standards_version_id}`)
        ]);
        const metaData = await metaRes.json();
        const stdData = await stdRes.json();

        const sortedSlides: TrainingSlide[] = (Array.isArray(metaData) ? metaData : [])
          .sort((a: TrainingSlide, b: TrainingSlide) => a.order - b.order);
        const allStds: Standard[] = Array.isArray(stdData.content) ? stdData.content : [];

        setSlides(sortedSlides);
        setStandards(allStds);

        // 构建展平序列：每条话术对应一个 FlatItem
        const items: FlatItem[] = [];
        sortedSlides.forEach((slide, slideIdx) => {
          const start = slide.standard_start; // 1-based
          const end = slide.standard_end;     // inclusive
          for (let num = start; num <= end; num++) {
            items.push({
              slideIdx,
              stdGlobalIdx: num - 1, // standards 数组是 0-based
              stdNumber: num,
            });
          }
        });
        setFlatItems(items);
        setLoading(false);

        // 加载第一张 PPT 图片
        if (sortedSlides.length > 0) {
          await switchToSlideById(sortedSlides[0].id, sortedSlides);
        }
      } catch (e) {
        console.error(e);
        setLoading(false);
      }
    };
    init();
  }, [course, switchToSlideById]);

  // 当前条目
  const currentItem = flatItems[currentFlatIdx];
  const currentSlide = currentItem ? slides[currentItem.slideIdx] : undefined;
  const currentStd = currentItem ? standards[currentItem.stdGlobalIdx] : undefined;
  const totalItems = flatItems.length;

  // 跳页时：若 slideIdx 变化则切换图片
  const prevSlideIdxRef = useRef<number>(-1);

  const goNext = useCallback(() => {
    if (currentFlatIdx < totalItems - 1) {
      const nextFlatIdx = currentFlatIdx + 1;
      setCurrentFlatIdx(nextFlatIdx);
      const nextItem = flatItems[nextFlatIdx];
      if (nextItem && nextItem.slideIdx !== flatItems[currentFlatIdx]?.slideIdx) {
        switchToSlideById(slides[nextItem.slideIdx]?.id, slides);
      }
    }
  }, [currentFlatIdx, totalItems, flatItems, slides, switchToSlideById]);

  const goPrev = useCallback(() => {
    if (currentFlatIdx > 0) {
      const prevFlatIdx = currentFlatIdx - 1;
      setCurrentFlatIdx(prevFlatIdx);
      const prevItem = flatItems[prevFlatIdx];
      if (prevItem && prevItem.slideIdx !== flatItems[currentFlatIdx]?.slideIdx) {
        switchToSlideById(slides[prevItem.slideIdx]?.id, slides);
      }
    }
  }, [currentFlatIdx, flatItems, slides, switchToSlideById]);

  // 键盘导航
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (showJump) {
        if (e.key === 'Escape') setShowJump(false);
        return; // 跳转浮层打开时不触发翻页
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goNext();
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goPrev();
      if (e.key === 'Escape') setPptFullscreen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goNext, goPrev, showJump]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-teal-50 to-slate-100 gap-4">
        <div className="w-16 h-16 bg-gradient-to-br from-teal-400 to-emerald-500 rounded-2xl flex items-center justify-center shadow-lg animate-pulse">
          <GraduationCap size={32} className="text-white" />
        </div>
        <Loader2 size={28} className="text-teal-400 animate-spin" />
        <p className="text-sm text-slate-400">正在加载课程…</p>
      </div>
    );
  }

  if (slides.length === 0 || flatItems.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
        <BookOpen size={48} className="text-slate-200" />
        <p className="text-slate-400">该课程还没有幻灯片</p>
        <button onClick={onBack} className="px-4 py-2 bg-slate-200 rounded-xl text-sm text-slate-600">返回</button>
      </div>
    );
  }

  // 当前话术的核心要点（拆分 qaFocus）
  const keyPoints = currentStd ? splitKeyPoints(currentStd.qaFocus) : [];
  const keyPointsVisible = showKeyPoints;

  // 当前 PPT 内是第几条话术（1-based，用于显示）
  const stdOffsetInSlide = currentItem
    ? currentItem.stdNumber - (currentSlide?.standard_start ?? currentItem.stdNumber) + 1
    : 1;
  const stdsInSlide = currentSlide
    ? currentSlide.standard_end - currentSlide.standard_start + 1
    : 1;

  // ==================== 手机端布局 ====================
  if (isMobile) {
    return (
      <div className="h-screen bg-slate-50 flex flex-col overflow-hidden">
        {/* ---- 手机端顶部导航栏 ---- */}
        <div className="h-12 shrink-0 bg-white border-b border-teal-100 shadow-sm flex items-center px-3 gap-2">
          <button onClick={onBack} className="w-8 h-8 flex items-center justify-center hover:bg-teal-50 rounded-lg transition-all shrink-0">
            <ArrowLeft size={16} className="text-slate-500" />
          </button>
          <span className="text-xs text-slate-500 truncate flex-1 min-w-0">{course.title}</span>
          <button onClick={goPrev} disabled={currentFlatIdx === 0}
            className="w-8 h-8 flex items-center justify-center bg-slate-100 hover:bg-teal-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 shrink-0">
            <ChevronLeft size={16} className="text-slate-600" />
          </button>
          {/* 进度 + 跳转 */}
          <div className="relative shrink-0">
            <button onClick={() => setShowJump(v => !v)} className="flex items-center gap-1 px-2 h-7 rounded-lg hover:bg-teal-50 transition-all">
              <span className="text-xs font-black text-teal-700">{currentFlatIdx + 1}</span>
              <span className="text-[10px] text-slate-400">/ {totalItems}</span>
            </button>
            {showJump && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowJump(false)} />
                <div className="absolute top-9 right-0 z-40 bg-white rounded-2xl shadow-2xl shadow-teal-100 border border-teal-100 p-4 w-56">
                  <p className="text-xs font-bold text-slate-600 mb-2">跳转到指定话术</p>
                  <p className="text-[10px] text-slate-400 mb-3">共 {totalItems} 条话术</p>
                  <div className="flex gap-2">
                    <input ref={jumpInputRef} type="number" min={1} max={totalItems} value={jumpInput}
                      onChange={e => { setJumpInput(e.target.value); setJumpError(''); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') doJump(jumpInput, flatItems, slides);
                        if (e.key === 'Escape') setShowJump(false);
                      }}
                      placeholder={`1 - ${totalItems}`}
                      className="flex-1 border-2 border-slate-100 focus:border-teal-400 rounded-xl px-3 py-2 text-sm outline-none bg-slate-50 focus:bg-teal-50/30 transition-all w-0"
                    />
                    <button onClick={() => doJump(jumpInput, flatItems, slides)}
                      className="w-9 h-9 bg-gradient-to-br from-teal-500 to-emerald-500 rounded-xl flex items-center justify-center text-white shadow-sm transition-all active:scale-95 shrink-0">
                      <CornerDownRight size={14} />
                    </button>
                  </div>
                  {jumpError && <p className="text-[10px] text-red-500 mt-2">{jumpError}</p>}
                </div>
              </>
            )}
          </div>
          <button onClick={goNext} disabled={currentFlatIdx === totalItems - 1}
            className="w-8 h-8 flex items-center justify-center bg-gradient-to-r from-teal-500 to-emerald-500 rounded-lg transition-all disabled:opacity-30 shrink-0 shadow-sm">
            <ChevronRight size={16} className="text-white" />
          </button>
          <div className="w-px h-5 bg-slate-200 shrink-0" />
          <button onClick={onLogout} className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0">
            <LogOut size={14} />
          </button>
        </div>

        {/* 进度条 */}
        <div className="h-1 bg-slate-200 shrink-0">
          <div className="h-full bg-gradient-to-r from-teal-400 to-emerald-500 transition-all duration-300"
            style={{ width: `${((currentFlatIdx + 1) / totalItems) * 100}%` }} />
        </div>

        {/* 标签页切换 */}
        <div className="flex bg-white border-b border-slate-200 shrink-0">
          <button onClick={() => setMobileTab('keypoints')}
            className={`flex-1 py-3 text-sm font-bold text-center transition-all ${
              mobileTab === 'keypoints' ? 'text-teal-600 border-b-2 border-teal-500 bg-teal-50/30' : 'text-slate-400'
            }`}>
            核心重点
          </button>
          <button onClick={() => setMobileTab('script')}
            className={`flex-1 py-3 text-sm font-bold text-center transition-all ${
              mobileTab === 'script' ? 'text-sky-600 border-b-2 border-sky-500 bg-sky-50/30' : 'text-slate-400'
            }`}>
            标准话术
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto">
          {mobileTab === 'keypoints' ? (
            <div className="p-4">
              {!currentStd ? (
                <p className="text-slate-400 text-sm text-center py-10">暂无话术内容</p>
              ) : (
                <div className="bg-white rounded-2xl p-4 border border-teal-100 shadow-sm">
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b border-teal-50">
                    <span className="w-6 h-6 rounded-lg bg-teal-500 text-white text-xs font-black flex items-center justify-center shrink-0">
                      {currentItem?.stdNumber}
                    </span>
                    <span className="text-xs font-bold text-teal-600 leading-snug">
                      {currentStd.qaFocus.length > 50 ? currentStd.qaFocus.slice(0, 50) + '…' : currentStd.qaFocus}
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {keyPoints.map((point, pi) => (
                      <div key={pi} className="flex items-start gap-2.5">
                        <span className="mt-0.5 w-5 h-5 rounded-md bg-teal-100 text-teal-600 text-[11px] font-black flex items-center justify-center shrink-0">
                          {pi + 1}
                        </span>
                        <p className="text-[15px] font-bold text-slate-700 leading-relaxed">{point}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4">
              {!currentStd ? (
                <p className="text-slate-400 text-sm text-center py-10">暂无话术内容</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-start gap-2">
                    <span className="px-2 py-0.5 bg-sky-100 text-sky-600 rounded-lg text-xs font-black shrink-0">
                      #{currentItem?.stdNumber}
                    </span>
                    <p className="text-sm font-bold text-slate-600">{currentStd.qaFocus}</p>
                  </div>
                  <div className="bg-white rounded-2xl border border-slate-100 px-4 py-4 shadow-sm">
                    <p className="text-base leading-[2] text-slate-700 whitespace-pre-wrap">{currentStd.content}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* PPT 全屏遮罩 */}
      {pptFullscreen && currentImage && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          onClick={() => setPptFullscreen(false)}
        >
          <img
            src={currentImage}
            alt={currentSlide?.title}
            className="max-w-full max-h-full object-contain"
            onClick={e => e.stopPropagation()}
          />
          <button
            onClick={() => setPptFullscreen(false)}
            className="absolute top-4 right-4 w-9 h-9 bg-white/10 hover:bg-white/20 rounded-full flex items-center justify-center text-white transition-all"
          >
            <X size={18} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); goPrev(); }}
            disabled={currentFlatIdx === 0}
            className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/25 rounded-full flex items-center justify-center text-white transition-all disabled:opacity-20"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); goNext(); }}
            disabled={currentFlatIdx === totalItems - 1}
            className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/10 hover:bg-white/25 rounded-full flex items-center justify-center text-white transition-all disabled:opacity-20"
          >
            <ChevronRight size={22} />
          </button>
          <div className="absolute bottom-4 text-white/50 text-xs">话术 {currentFlatIdx + 1} / {totalItems}</div>
        </div>
      )}

      {/* 主界面 */}
      <div className="h-screen bg-slate-100 flex flex-col overflow-hidden">
        {/* ---- 顶部导航栏 h-10 ---- */}
        <div className="h-10 shrink-0 bg-white border-b border-teal-100 shadow-sm flex items-center px-3 gap-2">
          {/* 返回 */}
          <button
            onClick={onBack}
            className="w-7 h-7 flex items-center justify-center hover:bg-teal-50 rounded-lg transition-all shrink-0"
          >
            <ArrowLeft size={14} className="text-slate-500" />
          </button>

          {/* 系统名 */}
          <span className="text-xs font-black text-teal-700 shrink-0">学习机知识培训系统</span>
          <span className="text-teal-200 text-xs shrink-0">·</span>
          <span className="text-xs text-slate-400 truncate flex-1 min-w-0">{course.title}</span>

          {/* 翻页按钮 */}
          <button
            onClick={goPrev}
            disabled={currentFlatIdx === 0}
            className="w-7 h-7 flex items-center justify-center bg-slate-100 hover:bg-teal-50 border border-slate-200 rounded-lg transition-all disabled:opacity-30 shrink-0"
          >
            <ChevronLeft size={14} className="text-slate-600" />
          </button>

          {/* 进度：点击可跳转 */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowJump(v => !v)}
              title="点击跳转到指定话术"
              className="flex items-center gap-1 px-2 h-6 rounded-md hover:bg-teal-50 transition-all"
            >
              <span className="text-xs font-black text-teal-700">{currentFlatIdx + 1}</span>
              <span className="text-[10px] text-slate-400">/ {totalItems}</span>
              <span className="text-[10px] text-slate-300 mx-0.5">·</span>
              <span className="text-[10px] text-slate-400">PPT {(currentItem?.slideIdx ?? 0) + 1}/{slides.length}</span>
            </button>

            {/* 跳转浮层 */}
            {showJump && (
              <>
                {/* 遮罩 */}
                <div className="fixed inset-0 z-30" onClick={() => setShowJump(false)} />
                <div className="absolute top-8 left-1/2 -translate-x-1/2 z-40 bg-white rounded-2xl shadow-2xl shadow-teal-100 border border-teal-100 p-4 w-56">
                  <p className="text-xs font-bold text-slate-600 mb-2">跳转到指定话术</p>
                  <p className="text-[10px] text-slate-400 mb-3">共 {totalItems} 条话术，输入目标编号</p>
                  <div className="flex gap-2">
                    <input
                      ref={jumpInputRef}
                      type="number"
                      min={1}
                      max={totalItems}
                      value={jumpInput}
                      onChange={e => { setJumpInput(e.target.value); setJumpError(''); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') doJump(jumpInput, flatItems, slides);
                        if (e.key === 'Escape') setShowJump(false);
                      }}
                      placeholder={`1 - ${totalItems}`}
                      className="flex-1 border-2 border-slate-100 focus:border-teal-400 rounded-xl px-3 py-2 text-sm outline-none bg-slate-50 focus:bg-teal-50/30 transition-all w-0"
                    />
                    <button
                      onClick={() => doJump(jumpInput, flatItems, slides)}
                      className="w-9 h-9 bg-gradient-to-br from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 rounded-xl flex items-center justify-center text-white shadow-sm transition-all active:scale-95 shrink-0"
                    >
                      <CornerDownRight size={14} />
                    </button>
                  </div>
                  {jumpError && (
                    <p className="text-[10px] text-red-500 mt-2">{jumpError}</p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* 进度条 */}
          <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden shrink-0">
            <div
              className="h-full bg-gradient-to-r from-teal-400 to-emerald-500 transition-all duration-300 rounded-full"
              style={{ width: `${((currentFlatIdx + 1) / totalItems) * 100}%` }}
            />
          </div>

          <button
            onClick={goNext}
            disabled={currentFlatIdx === totalItems - 1}
            className="w-7 h-7 flex items-center justify-center bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 rounded-lg transition-all disabled:opacity-30 shrink-0 shadow-sm"
          >
            <ChevronRight size={14} className="text-white" />
          </button>

          {/* 分隔 */}
          <div className="w-px h-4 bg-slate-200 shrink-0" />

          {/* 核心要点 显示/隐藏 */}
          <button
            onClick={() => setShowKeyPoints(v => !v)}
            title={showKeyPoints ? '隐藏核心要点' : '显示核心要点'}
            className={`flex items-center gap-1 px-2 h-6 rounded-md text-[10px] font-bold transition-all shrink-0 ${showKeyPoints ? 'bg-teal-100 text-teal-700 hover:bg-teal-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
          >
            {showKeyPoints ? <Eye size={11} /> : <EyeOff size={11} />}
            要点
          </button>

          {/* 逐字稿 显示/隐藏 */}
          <button
            onClick={() => setShowScript(v => !v)}
            title={showScript ? '隐藏逐字稿' : '显示逐字稿'}
            className={`flex items-center gap-1 px-2 h-6 rounded-md text-[10px] font-bold transition-all shrink-0 ${showScript ? 'bg-sky-100 text-sky-700 hover:bg-sky-200' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
          >
            {showScript ? <Eye size={11} /> : <EyeOff size={11} />}
            逐字稿
          </button>

          {/* 退出 */}
          <button
            onClick={onLogout}
            className="w-7 h-7 flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all shrink-0"
          >
            <LogOut size={12} />
          </button>
        </div>

        {/* ---- 主内容区 ---- */}
        <div className="flex-1 flex overflow-hidden">

          {/* 左侧：PPT + 核心要点 */}
          <div
            className={`flex flex-col border-r border-slate-200 overflow-hidden transition-all duration-300 ${
              showScript ? 'w-1/2' : 'w-full'
            }`}
          >
            {/* PPT 图片区域 */}
            <div
              className="shrink-0 bg-slate-200 flex items-center justify-center overflow-hidden relative group"
              style={{ height: keyPointsVisible ? '60%' : '100%' }}
            >
              {imageLoading ? (
                <div className="flex flex-col items-center gap-3 text-teal-400">
                  <Loader2 size={32} className="animate-spin" />
                  <p className="text-xs text-slate-400">加载中…</p>
                </div>
              ) : currentImage ? (
                <>
                  <img
                    src={currentImage}
                    alt={currentSlide?.title || `第${(currentItem?.slideIdx ?? 0) + 1}页`}
                    className="max-w-full max-h-full object-contain"
                  />
                  {/* PPT 内进度小标签 */}
                  <div className="absolute top-2 left-2 bg-black/30 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
                    本页第 {stdOffsetInSlide}/{stdsInSlide} 条话术
                  </div>
                  {/* 右下角全屏按钮 */}
                  <button
                    onClick={() => setPptFullscreen(true)}
                    className="absolute bottom-2 right-2 w-8 h-8 bg-black/20 hover:bg-black/40 rounded-lg flex items-center justify-center text-white/80 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
                    title="全屏查看"
                  >
                    <Expand size={14} />
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center gap-3 text-slate-400">
                  <BookOpen size={48} className="text-slate-300" />
                  <p className="text-sm">暂无图片</p>
                </div>
              )}
            </div>

            {/* 核心要点区域：只显示当前这 1 条话术的要点 */}
            {keyPointsVisible && (
              <div className="flex-1 bg-teal-50/60 border-t border-teal-100 flex flex-col overflow-hidden">
                <div className="px-4 pt-2.5 pb-1.5 shrink-0 flex items-center gap-2 bg-white/60 border-b border-teal-100">
                  <div className="w-1 h-3.5 bg-teal-500 rounded-full"></div>
                  <span className="text-[11px] font-bold text-teal-700 uppercase tracking-wider">核心要点</span>
                  {currentStd && (
                    <span className="text-[10px] text-teal-400 ml-1">
                      — 话术 #{currentItem?.stdNumber}
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto px-4 pb-3 pt-2">
                  {!currentStd ? (
                    <p className="text-slate-400 text-sm">暂无话术内容</p>
                  ) : (
                    <div className="bg-white rounded-xl p-3 border border-teal-100 shadow-sm">
                      {/* 话术编号标题 */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="w-5 h-5 rounded-md bg-teal-500 text-white text-xs font-black flex items-center justify-center shrink-0">
                          {currentItem?.stdNumber}
                        </span>
                        <span className="text-[10px] font-bold text-teal-500 uppercase tracking-wide">
                          {currentStd.qaFocus.length > 30 ? currentStd.qaFocus.slice(0, 30) + '…' : currentStd.qaFocus}
                        </span>
                      </div>
                      {/* 拆分后的要点 */}
                      <div className="space-y-1.5">
                        {keyPoints.map((point, pi) => (
                          <div key={pi} className="flex items-start gap-2">
                            <span className="mt-0.5 w-4 h-4 rounded bg-teal-100 text-teal-600 text-[10px] font-black flex items-center justify-center shrink-0">
                              {pi + 1}
                            </span>
                            <p className="text-[14px] font-bold text-slate-700 leading-snug">{point}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 右侧：当前话术的完整标准话术（逐字稿） */}
          {showScript && (
            <div className="w-1/2 flex flex-col bg-white overflow-hidden">
              <div className="px-4 pt-2.5 pb-1.5 shrink-0 bg-white border-b border-sky-100 flex items-center gap-2">
                <div className="w-1 h-3.5 bg-sky-500 rounded-full"></div>
                <span className="text-[11px] font-bold text-sky-700 uppercase tracking-wider">标准话术</span>
                {currentStd && (
                  <span className="text-[10px] text-slate-400 ml-1 truncate">— {currentStd.qaFocus}</span>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4 bg-slate-50/50">
                {!currentStd ? (
                  <p className="text-slate-400 text-sm">暂无话术内容</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2">
                      <span className="px-1.5 py-0.5 bg-sky-100 text-sky-600 rounded-md text-xs font-black shrink-0">
                        #{currentItem?.stdNumber}
                      </span>
                      <p className="text-sm font-bold text-slate-600">{currentStd.qaFocus}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-100 px-4 py-3 shadow-sm">
                      <p className="text-base leading-[1.9] text-slate-700 whitespace-pre-wrap">{currentStd.content}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default TrainingFlashcard;
