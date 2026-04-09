import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Video, X, ChevronLeft, ChevronRight } from 'lucide-react';

interface TranscriptSegment {
  start: number;   // 秒
  end: number;
  text: string;
}

interface Props {
  videoUrl: string;
  segments: TranscriptSegment[];
  onClose: () => void;
}

/**
 * 报告页左侧视频面板 — 纯播放器
 * 使用字符级时间索引实现精准文本→时间定位
 */
const ReportVideoPanel: React.FC<Props> = ({ videoUrl, segments, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const formatTime = (sec: number) => {
    if (!sec || isNaN(sec)) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const seekTo = (time: number) => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = time;
      if (v.paused) v.play().catch(() => {});
    }
  };

  // ========== 字符级时间索引 ==========
  // 把所有片段拼接成一个连续字符串，每个字符记录对应的时间
  const charTimeIndex = useMemo(() => {
    if (segments.length === 0) return { fullText: '', charTimes: [] as number[] };
    // 去标点后的连续文本 + 每个字符对应的时间
    const charTimes: number[] = [];
    let fullText = '';
    for (const seg of segments) {
      const clean = seg.text; // 保留原文（包括标点），和右侧显示一致
      const duration = seg.end - seg.start;
      for (let i = 0; i < clean.length; i++) {
        fullText += clean[i];
        const ratio = clean.length > 1 ? i / (clean.length - 1) : 0;
        charTimes.push(seg.start + ratio * duration);
      }
    }
    return { fullText, charTimes };
  }, [segments]);

  // 在连续文本中搜索选中内容，返回精确时间
  const findTextTime = (text: string): number | null => {
    if (!text || text.length < 2) return null;
    const { fullText, charTimes } = charTimeIndex;
    if (fullText.length === 0) return null;

    // 直接搜索（数据源一致，不需要去标点）
    const query = text.replace(/[\n\r]/g, '').trim();
    if (query.length < 2) return null;

    // 精确子串匹配
    const idx = fullText.indexOf(query);
    if (idx >= 0) {
      return charTimes[idx];
    }

    // 容错：去标点后重试
    const stripPunc = (s: string) => s.replace(/[\s。，、！？：；""''【】（）……·\-—,.\n\r]/g, '');
    const q2 = stripPunc(query);
    const ft2 = stripPunc(fullText);
    if (q2.length >= 2) {
      const idx2 = ft2.indexOf(q2);
      if (idx2 >= 0) {
        // 反查原始位置
        let origIdx = 0, strippedCount = 0;
        for (let i = 0; i < fullText.length && strippedCount < idx2; i++) {
          if (stripPunc(fullText[i]).length > 0) strippedCount++;
          origIdx = i + 1;
        }
        return charTimes[Math.min(origIdx, charTimes.length - 1)];
      }
    }

    return null;
  };

  // 暴露全局方法
  useEffect(() => {
    (window as any).__reportVideoSeek = (time: number) => {
      if (isCollapsed) setIsCollapsed(false);
      seekTo(time);
    };
    (window as any).__reportVideoFindText = (text: string): boolean => {
      if (isCollapsed) setIsCollapsed(false);
      const time = findTextTime(text);
      if (time !== null) {
        seekTo(time);
        return true;
      }
      return false;
    };
    return () => {
      delete (window as any).__reportVideoSeek;
      delete (window as any).__reportVideoFindText;
    };
  }, [isCollapsed, charTimeIndex]);

  // 折叠模式
  if (isCollapsed) {
    return (
      <div className="w-10 bg-slate-900 flex flex-col items-center py-3 gap-2 shrink-0">
        <button onClick={() => setIsCollapsed(false)}
          className="w-8 h-8 rounded-lg bg-[#07C160] flex items-center justify-center text-white hover:bg-[#07C160] transition-colors"
          title="展开视频面板">
          <ChevronRight size={14} />
        </button>
        <div className="text-[10px] text-slate-500 font-bold tracking-widest"
          style={{ writingMode: 'vertical-lr' as any }}>直播回放</div>
      </div>
    );
  }

  return (
    <div className="h-full bg-slate-900 flex flex-col">
      {/* 视频播放器 — 绝对定位撑满全部空间 */}
      <div className="flex-1 relative overflow-hidden">
        <video
          ref={videoRef}
          src={videoUrl}
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: 'contain' }}
          controls
          preload="metadata"
          onTimeUpdate={() => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime); }}
          onLoadedMetadata={() => { if (videoRef.current) setDuration(videoRef.current.duration); }}
        />
      </div>
    </div>
  );
};

export default ReportVideoPanel;
