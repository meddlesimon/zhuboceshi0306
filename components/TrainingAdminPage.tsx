import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, BookOpen, ChevronDown, ChevronRight, GraduationCap,
  GripVertical, ImagePlus, Loader2, Plus, Save, Trash2, Upload, User, X, Check, AlertTriangle
} from 'lucide-react';
import { TrainingCourse, TrainingSlide, StandardsVersion } from '../types';

interface Props {
  onBack: () => void;
}

type Tab = 'courses' | 'slides' | 'accounts';

interface AccountItem {
  id: number;
  username: string;
  display_name: string;
}

const TrainingAdminPage: React.FC<Props> = ({ onBack }) => {
  const [tab, setTab] = useState<Tab>('courses');

  // ---- courses ----
  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [versions, setVersions] = useState<StandardsVersion[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<TrainingCourse | null>(null);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseVersionId, setNewCourseVersionId] = useState<number | ''>('');
  const [creatingCourse, setCreatingCourse] = useState(false);
  const [showNewCourseForm, setShowNewCourseForm] = useState(false);

  // ---- slides ----
  const [slides, setSlides] = useState<TrainingSlide[]>([]);
  const [slidesLoading, setSlidesLoading] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // 拖拽排序状态
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [orderDirty, setOrderDirty] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);

  // ---- accounts ----
  const [accounts, setAccounts] = useState<AccountItem[]>([]);
  const [showNewAccountForm, setShowNewAccountForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [creatingAccount, setCreatingAccount] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    loadCourses();
    loadVersions();
    loadAccounts();
  }, []);

  useEffect(() => {
    if (selectedCourse) loadSlides(selectedCourse.id);
  }, [selectedCourse]);

  const showSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 2500);
  };

  // ============================================================
  // Courses
  // ============================================================
  const loadCourses = async () => {
    try {
      const r = await fetch('/api/training/courses');
      const data = await r.json();
      setCourses(Array.isArray(data) ? data : []);
    } catch (e: any) { setError(e.message); }
  };

  const loadVersions = async () => {
    try {
      const r = await fetch('/api/standards');
      const data = await r.json();
      setVersions(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  };

  const createCourse = async () => {
    if (!newCourseName.trim() || !newCourseVersionId) {
      setError('请填写课程名称并选择话术版本');
      return;
    }
    setCreatingCourse(true);
    setError(null);
    try {
      const r = await fetch('/api/training/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newCourseName.trim(), standards_version_id: newCourseVersionId })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setCourses(prev => [data, ...prev]);
      setNewCourseName('');
      setNewCourseVersionId('');
      setShowNewCourseForm(false);
      showSuccess('课程创建成功');
    } catch (e: any) { setError(e.message); }
    finally { setCreatingCourse(false); }
  };

  const deleteCourse = async (id: number) => {
    if (!confirm('确定删除该课程及其所有幻灯片？')) return;
    try {
      await fetch(`/api/training/courses/${id}`, { method: 'DELETE' });
      setCourses(prev => prev.filter(c => c.id !== id));
      if (selectedCourse?.id === id) setSelectedCourse(null);
      showSuccess('已删除');
    } catch (e: any) { setError(e.message); }
  };

  const updateCourseVersion = async (courseId: number, versionId: number) => {
    try {
      const r = await fetch(`/api/training/courses/${courseId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ standards_version_id: versionId })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);

      // 更新本地状态
      setCourses(prev => prev.map(c => 
        c.id === courseId 
          ? { ...c, standards_version_id: versionId, standards_version_label: data.course.standards_version_label } 
          : c
      ));

      if (selectedCourse?.id === courseId) {
        setSelectedCourse(prev => prev ? { 
          ...prev, 
          standards_version_id: versionId, 
          standards_version_label: data.course.standards_version_label 
        } : null);
      }
      showSuccess('关联话术版本已更新');
    } catch (e: any) { 
      setError(e.message); 
    }
  };

  // ============================================================
  // Slides
  // ============================================================
  const loadSlides = async (courseId: number) => {
    setSlidesLoading(true);
    setOrderDirty(false);
    try {
      const r = await fetch(`/api/training/courses/${courseId}/slides`);
      const data = await r.json();
      setSlides(Array.isArray(data) ? data : []);
    } catch (e: any) { setError(e.message); }
    finally { setSlidesLoading(false); }
  };

  const handleBatchImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedCourse || !e.target.files || e.target.files.length === 0) return;
    setUploadingImages(true);
    setError(null);
    const files = Array.from(e.target.files as unknown as File[]).sort((a, b) => a.name.localeCompare(b.name));
    const currentMaxOrder = slides.length > 0 ? Math.max(...slides.map(s => s.order)) : 0;

    try {
      const newSlides: TrainingSlide[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const base64 = await fileToBase64(file);
        const r = await fetch('/api/training/slides', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            course_id: selectedCourse.id,
            order: currentMaxOrder + i + 1,
            title: file.name.replace(/\.[^/.]+$/, ''),
            image_base64: base64,
            standard_start: 1,
            standard_end: 1
          })
        });
        const data = await r.json();
        if (r.ok) newSlides.push(data);
      }
      setSlides(prev => {
        const combined = [...prev, ...newSlides].sort((a, b) => a.order - b.order);
        // 新上传的图片默认 count 为 1，加入队列后需要全量计算起止逻辑并让状态置脏
        setOrderDirty(true);
        return recalcRanges(combined);
      });
      showSuccess(`已上传 ${newSlides.length} 张幻灯片`);
    } catch (e: any) { setError(e.message); }
    finally {
      setUploadingImages(false);
      if (imageInputRef.current) imageInputRef.current.value = '';
    }
  };

  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('图片读取失败'));
    });
  };

  const updateSlide = async (id: number, fields: Partial<TrainingSlide>) => {
    try {
      if (fields.standard_end !== undefined || fields.standard_start !== undefined) {
        // 如果是触发起止范围发生变化，不走单独保存，而是强行影响全量，通过保存状态同步给后端
        setSlides(prev => {
            const next = prev.map(s => s.id === id ? { ...s, ...fields } : s);
            return recalcRanges(next);
        });
        setOrderDirty(true);
      } else {
        const r = await fetch(`/api/training/slides/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fields)
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setSlides(prev => prev.map(s => s.id === id ? { ...s, ...data } : s));
      }
    } catch (e: any) { setError(e.message); }
  };

  const deleteSlide = async (id: number) => {
    if (!confirm('确定删除该幻灯片？')) return;
    try {
      await fetch(`/api/training/slides/${id}`, { method: 'DELETE' });
      setSlides(prev => prev.filter(s => s.id !== id));
      showSuccess('已删除');
    } catch (e: any) { setError(e.message); }
  };

  // ---- 自动推算每页范围 ----
  const recalcRanges = (list: TrainingSlide[]) => {
    let currentStart = 1;
    return list.map(s => {
      let count = s.standard_end - s.standard_start + 1;
      if (count < 0) count = 0;
      const mapped = { ...s, standard_start: currentStart, standard_end: currentStart + count - 1 };
      currentStart += count;
      return mapped;
    });
  };

  // ---- 拖拽排序 ----
  const handleDragStart = (idx: number) => {
    setDragIndex(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    setOverIndex(idx);
    // 实时重排（本地）并重新计算区间
    setSlides(prev => {
      const next = [...prev];
      const [removed] = next.splice(dragIndex, 1);
      next.splice(idx, 0, removed);
      return recalcRanges(next);
    });
    setDragIndex(idx);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
    setOrderDirty(true);
  };

  const saveOrder = async () => {
    if (!selectedCourse) return;
    setSavingOrder(true);
    try {
      const updSlides = slides.map((s, idx) => ({
        id: s.id,
        order: idx + 1,
        standard_start: s.standard_start,
        standard_end: s.standard_end
      }));
      const r = await fetch(`/api/training/courses/${selectedCourse.id}/slides/bulk-update`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slides: updSlides })
      });
      if (!r.ok) throw new Error('保存失败');
      setOrderDirty(false);
      showSuccess('幻灯片顺序及关联范围已保存 ✓');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingOrder(false);
    }
  };

  // ============================================================
  // Accounts
  // ============================================================
  const loadAccounts = async () => {
    try {
      const r = await fetch('/api/training/accounts');
      const data = await r.json();
      setAccounts(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  };

  const createAccount = async () => {
    if (!newUsername.trim() || !newPassword || !newDisplayName.trim()) {
      setError('账号、密码、显示名均不能为空');
      return;
    }
    setCreatingAccount(true);
    setError(null);
    try {
      const r = await fetch('/api/training/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, display_name: newDisplayName.trim() })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      setAccounts(prev => [...prev, data]);
      setNewUsername('');
      setNewPassword('');
      setNewDisplayName('');
      setShowNewAccountForm(false);
      showSuccess('账号创建成功');
    } catch (e: any) { setError(e.message); }
    finally { setCreatingAccount(false); }
  };

  const deleteAccount = async (id: number) => {
    if (!confirm('确定删除该账号？主播将无法再登录。')) return;
    try {
      await fetch(`/api/training/accounts/${id}`, { method: 'DELETE' });
      setAccounts(prev => prev.filter(a => a.id !== id));
      showSuccess('已删除');
    } catch (e: any) { setError(e.message); }
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-slate-100 px-6 py-4 flex items-center gap-4 shadow-sm">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-xl transition-all">
          <ArrowLeft size={18} className="text-slate-600" />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow">
            <GraduationCap size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-black text-slate-900">主播培训管理</h1>
            <p className="text-xs text-slate-400">管理培训课程、幻灯片与主播账号</p>
          </div>
        </div>
      </div>

      {/* Toast */}
      {successMsg && (
        <div className="fixed top-4 right-4 z-50 bg-emerald-500 text-white px-4 py-2 rounded-xl shadow-lg flex items-center gap-2 text-sm font-bold animate-in slide-in-from-top-2">
          <Check size={16} /> {successMsg}
        </div>
      )}
      {error && (
        <div className="mx-6 mt-4 bg-red-50 text-red-600 border border-red-100 rounded-xl p-3 flex items-center gap-2 text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          {error}
          <button className="ml-auto" onClick={() => setError(null)}><X size={14} /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b border-slate-100 px-6">
        <div className="flex gap-0">
          {(['courses', 'slides', 'accounts'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 text-sm font-bold border-b-2 transition-all ${tab === t ? 'border-emerald-500 text-emerald-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
            >
              {t === 'courses' ? '课程管理' : t === 'slides' ? '幻灯片管理' : '账号管理'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 p-6 overflow-y-auto">

        {/* ======== Tab: Courses ======== */}
        {tab === 'courses' && (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-slate-800">培训课程列表</h2>
              <button
                onClick={() => { setShowNewCourseForm(true); setError(null); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition-all"
              >
                <Plus size={14} /> 新建课程
              </button>
            </div>

            {showNewCourseForm && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
                <p className="text-sm font-bold text-slate-700">新建培训课程</p>
                <div className="space-y-1">
                  <label className="text-xs text-slate-500 font-bold">课程名称</label>
                  <input
                    value={newCourseName}
                    onChange={e => setNewCourseName(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-100"
                    placeholder="例如：品牌知识培训 第一期"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-500 font-bold">绑定话术版本</label>
                  <select
                    value={newCourseVersionId}
                    onChange={e => setNewCourseVersionId(e.target.value ? parseInt(e.target.value) : '')}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
                  >
                    <option value="">-- 请选择版本 --</option>
                    {versions.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.version_label} ({v.total_count}条话术) {v.is_current === 1 ? '【当前版本】' : ''}
                      </option>
                    ))}
                  </select>
                  {versions.length === 0 && (
                    <p className="text-xs text-amber-500">请先在「话术管理」中上传话术版本</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={createCourse}
                    disabled={creatingCourse}
                    className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {creatingCourse ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    确认创建
                  </button>
                  <button
                    onClick={() => { setShowNewCourseForm(false); setError(null); }}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-bold rounded-xl transition-all"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {courses.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center">
                <BookOpen size={36} className="text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400">还没有培训课程，点击「新建课程」开始</p>
              </div>
            ) : (
              <div className="space-y-3">
                {courses.map(c => (
                  <div
                    key={c.id}
                    className={`bg-white border rounded-2xl p-4 flex items-center gap-4 cursor-pointer transition-all hover:shadow-md ${selectedCourse?.id === c.id ? 'border-emerald-300 shadow-md' : 'border-slate-100'}`}
                  >
                    <div
                      className="flex-1 min-w-0"
                      onClick={() => { setSelectedCourse(c); setTab('slides'); }}
                    >
                      <p className="text-sm font-bold text-slate-800 truncate">{c.title}</p>
                      <div className="flex items-center gap-1.5 mt-1.5" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs text-slate-400">话术版本：</span>
                        <select 
                          value={c.standards_version_id}
                          onChange={(e) => updateCourseVersion(c.id, parseInt(e.target.value))}
                          className="text-xs border border-slate-200 rounded px-1.5 py-0.5 text-slate-600 outline-none focus:border-emerald-400 bg-slate-50 hover:bg-white transition-colors cursor-pointer"
                        >
                           {versions.map(v => (
                             <option key={v.id} value={v.id}>
                               {v.version_label} {v.is_current ? '(当前最新)' : ''}
                             </option>
                           ))}
                        </select>
                        <span className="text-xs text-slate-400">· {c.created_at}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => { setSelectedCourse(c); setTab('slides'); }}
                      className="flex items-center gap-1 text-xs text-emerald-600 font-bold shrink-0"
                    >
                      管理幻灯片 <ChevronRight size={14} />
                    </button>
                    <button
                      onClick={() => deleteCourse(c.id)}
                      className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ======== Tab: Slides ======== */}
        {tab === 'slides' && (
          <div className="max-w-4xl space-y-4">
            {/* 课程选择 */}
            <div className="flex items-center gap-3">
              <div className="space-y-1 flex-1">
                <label className="text-xs text-slate-500 font-bold">当前课程</label>
                <select
                  value={selectedCourse?.id || ''}
                  onChange={e => {
                    const c = courses.find(c => c.id === parseInt(e.target.value));
                    setSelectedCourse(c || null);
                    setOrderDirty(false);
                  }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
                >
                  <option value="">-- 请选择课程 --</option>
                  {courses.map(c => (
                    <option key={c.id} value={c.id}>{c.title} ({c.standards_version_label})</option>
                  ))}
                </select>
              </div>
            </div>

            {!selectedCourse ? (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center">
                <p className="text-sm text-slate-400">请先选择一个课程</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-black text-slate-800">{selectedCourse.title}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-400">绑定话术版本：</span>
                      <select 
                        value={selectedCourse.standards_version_id}
                        onChange={(e) => updateCourseVersion(selectedCourse.id, parseInt(e.target.value))}
                        className="text-xs border border-slate-200 rounded px-1.5 py-0.5 text-slate-600 outline-none focus:border-emerald-400 bg-slate-50 hover:bg-white transition-colors cursor-pointer"
                      >
                         {versions.map(v => (
                           <option key={v.id} value={v.id}>
                             {v.version_label} {v.is_current ? '(当前最新)' : ''}
                           </option>
                         ))}
                      </select>
                      <span className="text-xs text-slate-400 ml-2">· 共 {slides.length} 张幻灯片</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 确认保存顺序与范围按钮 */}
                    {orderDirty && (
                      <button
                        onClick={saveOrder}
                        disabled={savingOrder}
                        className="flex items-center gap-1.5 px-3 py-2 bg-teal-500 hover:bg-teal-600 text-white text-xs font-bold rounded-xl transition-all disabled:opacity-60 shadow-md shadow-teal-200"
                        title="你有条数或顺序的改动，请点击保存"
                      >
                        {savingOrder ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                        确认保存变更
                      </button>
                    )}
                    <label className={`flex items-center gap-2 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition-all cursor-pointer ${uploadingImages ? 'opacity-60 pointer-events-none' : ''}`}>
                      {uploadingImages ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      批量上传图片
                      <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleBatchImageUpload} />
                    </label>
                  </div>
                </div>

                {/* 拖拽提示 */}
                {slides.length > 1 && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2">
                    <GripVertical size={13} className="text-teal-400 shrink-0" />
                    <span>拖动左侧 <strong className="text-teal-600">⠿</strong> 手柄可调整幻灯片顺序，调整完成后点击「确认保存顺序」</span>
                  </div>
                )}

                {slidesLoading ? (
                  <div className="flex justify-center py-10">
                    <Loader2 size={28} className="text-emerald-400 animate-spin" />
                  </div>
                ) : slides.length === 0 ? (
                  <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center">
                    <ImagePlus size={36} className="text-slate-200 mx-auto mb-3" />
                    <p className="text-sm text-slate-400">还没有幻灯片，点击「批量上传图片」开始</p>
                    <p className="text-xs text-slate-300 mt-1">支持 JPG / PNG / WEBP，多选后按文件名自动排序</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {slides.map((slide, idx) => (
                      <SlideRow
                        key={slide.id}
                        slide={slide}
                        index={idx}
                        isDragging={dragIndex === idx}
                        isOver={overIndex === idx}
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragEnd={handleDragEnd}
                        onUpdate={(fields) => updateSlide(slide.id, fields)}
                        onDelete={() => deleteSlide(slide.id)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ======== Tab: Accounts ======== */}
        {tab === 'accounts' && (
          <div className="max-w-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-slate-800">主播账号列表</h2>
              <button
                onClick={() => { setShowNewAccountForm(true); setError(null); }}
                className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-xl transition-all"
              >
                <Plus size={14} /> 新增账号
              </button>
            </div>

            {showNewAccountForm && (
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4 shadow-sm">
                <p className="text-sm font-bold text-slate-700">新增主播账号</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500 font-bold">显示名</label>
                    <input value={newDisplayName} onChange={e => setNewDisplayName(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
                      placeholder="例如：王老师" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-slate-500 font-bold">登录账号</label>
                    <input value={newUsername} onChange={e => setNewUsername(e.target.value)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
                      placeholder="例如：wang2024" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-slate-500 font-bold">登录密码</label>
                  <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-emerald-400"
                    placeholder="设定密码" />
                </div>
                <div className="flex gap-2">
                  <button onClick={createAccount} disabled={creatingAccount}
                    className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                    {creatingAccount ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                    确认创建
                  </button>
                  <button onClick={() => { setShowNewAccountForm(false); setError(null); }}
                    className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-bold rounded-xl transition-all">
                    取消
                  </button>
                </div>
              </div>
            )}

            {accounts.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center">
                <User size={36} className="text-slate-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400">还没有主播账号，点击「新增账号」</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
                <div className="grid grid-cols-3 bg-slate-50 px-5 py-2.5 text-xs font-bold text-slate-400">
                  <span>显示名</span><span>账号</span><span className="text-right">操作</span>
                </div>
                {accounts.map(a => (
                  <div key={a.id} className="grid grid-cols-3 px-5 py-3.5 border-t border-slate-50 items-center">
                    <span className="text-sm font-bold text-slate-700">{a.display_name}</span>
                    <span className="text-sm text-slate-500 font-mono">{a.username}</span>
                    <div className="flex justify-end">
                      <button onClick={() => deleteAccount(a.id)}
                        className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-700">
              <p className="font-bold mb-1">主播培训前台入口</p>
              <p>主播访问地址：<code className="bg-amber-100 px-1.5 py-0.5 rounded font-mono">http://服务器IP:8081/zhubopeixun</code></p>
              <p className="mt-1 text-amber-500">使用此处创建的账号密码登录</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ---- 幻灯片行组件 ----
interface SlideRowProps {
  slide: TrainingSlide;
  index: number;
  isDragging: boolean;
  isOver: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onUpdate: (fields: Partial<TrainingSlide>) => void;
  onDelete: () => void;
}

const SlideRow: React.FC<SlideRowProps> = ({
  slide, index, isDragging, isOver,
  onDragStart, onDragOver, onDragEnd,
  onUpdate, onDelete
}) => {
  const [title, setTitle] = useState(slide.title);
  
  const count = slide.standard_end - slide.standard_start + 1;
  const [localCount, setLocalCount] = useState(String(Math.max(0, count)));
  const [expanded, setExpanded] = useState(false);

  // 当父组件进行了重算，我们需要同步新的 count 给输入框
  useEffect(() => {
    setLocalCount(String(Math.max(0, slide.standard_end - slide.standard_start + 1)));
  }, [slide.standard_start, slide.standard_end]);

  const handleSaveTitle = () => {
    if (title !== slide.title) {
       onUpdate({ title });
    }
  };

  const handleSaveCount = () => {
    const c = parseInt(localCount);
    if (!isNaN(c) && c >= 0) {
      const oldCount = slide.standard_end - slide.standard_start + 1;
      if (c !== oldCount) {
         // 只用改 end 即可触发上层整个 slide 列表的大重算！
         onUpdate({ standard_end: slide.standard_start + c - 1 });
      }
    } else {
      setLocalCount(String(Math.max(0, count))); // 还原错误输入
    }
  };

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={`bg-white border rounded-2xl overflow-hidden shadow-sm transition-all duration-150 ${
        isDragging ? 'opacity-50 scale-[0.98] border-teal-300 shadow-lg' : 
        isOver ? 'border-teal-400 shadow-md' : 'border-slate-100'
      }`}
    >
      <div className="flex items-center gap-3 p-3">
        {/* 拖拽手柄 */}
        <div className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-teal-500 shrink-0 transition-colors">
          <GripVertical size={16} />
        </div>

        {/* 序号 */}
        <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
          <span className="text-xs font-black text-emerald-600">{index + 1}</span>
        </div>

        {/* 缩略图 */}
        <button onClick={() => setExpanded(e => !e)} className="shrink-0">
          {slide.image_base64 ? (
            <img src={slide.image_base64} alt={slide.title} className="w-16 h-10 object-cover rounded-lg border border-slate-100" />
          ) : (
            <div className="w-16 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <ImagePlus size={16} className="text-slate-300" />
            </div>
          )}
        </button>

        {/* 标题 */}
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onBlur={handleSaveTitle}
          className="flex-1 text-sm font-bold text-slate-700 bg-transparent border-b border-transparent focus:border-emerald-300 outline-none transition-all px-1 py-0.5 min-w-0"
          placeholder="幻灯片标题"
        />

        {/* 包含话术量区：填的是数量，自动生成的是范围 */}
        <div className="flex items-center shrink-0 pr-3 rounded-lg overflow-hidden bg-slate-50 border border-slate-100 shadow-sm transition-all focus-within:border-emerald-300 focus-within:ring-2 focus-within:ring-emerald-50">
          <div className="bg-slate-100/60 px-2 py-1.5 flex items-center gap-1 group/input">
            <span className="text-xs font-bold text-slate-500">包含</span>
            <input
              value={localCount}
              onChange={e => setLocalCount(e.target.value)}
              onBlur={handleSaveCount}
              className="w-8 text-center bg-white border border-slate-200 rounded text-emerald-600 font-extrabold text-xs py-0.5 outline-none focus:border-emerald-400 select-all"
            />
            <span className="text-xs font-bold text-slate-500">条</span>
          </div>
          <div className="pl-3 py-1.5 min-w-[100px] text-center">
            {count > 0 ? (
              <span className="text-[11px] font-mono text-slate-400 tracking-wider">
                <strong className="text-slate-600 font-bold mx-0.5">{slide.standard_start}</strong> 
                - 
                <strong className="text-slate-600 font-bold mx-0.5">{slide.standard_end}</strong>
              </span>
            ) : (
              <span className="text-[11px] text-slate-400">无话术</span>
            )}
          </div>
        </div>

        {/* 展开/删除 */}
        <button onClick={() => setExpanded(e => !e)} className="p-1.5 text-slate-300 hover:text-slate-500 rounded-lg transition-all">
          <ChevronDown size={14} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <button onClick={onDelete} className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all">
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && slide.image_base64 && (
        <div className="px-4 pb-4 border-t border-slate-50">
          <img src={slide.image_base64} alt={slide.title} className="w-full rounded-xl border border-slate-100 object-contain max-h-64" />
        </div>
      )}
    </div>
  );
};

export default TrainingAdminPage;
