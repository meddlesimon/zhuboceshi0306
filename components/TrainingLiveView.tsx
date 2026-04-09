import React, { useEffect, useState } from 'react';
import { Loader2, Monitor } from 'lucide-react';
import { Anchor } from '../types';
import SessionListView from './SessionListView';

interface Props {
  onBack: () => void;
}

/**
 * 主播端 - 直播观摩（只读版）
 * 选择主播 → 复用 SessionListView（readOnly 模式）
 */
const TrainingLiveView: React.FC<Props> = ({ onBack }) => {
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAnchor, setSelectedAnchor] = useState<Anchor | null>(null);
  // 用于控制 SessionListView 的 onDetailChange
  const [inDetail, setInDetail] = useState(false);

  useEffect(() => {
    fetch('/api/anchors')
      .then(r => r.json())
      .then(data => { setAnchors(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // 如果选了主播，直接渲染 SessionListView（只读模式）
  if (selectedAnchor) {
    return (
      <SessionListView
        anchor={selectedAnchor}
        readOnly
        onBack={() => { setSelectedAnchor(null); setInDetail(false); }}
        onDetailChange={setInDetail}
      />
    );
  }

  // 主播选择网格
  return (
    <div className="flex-1 p-4 md:p-6 max-w-2xl mx-auto w-full">
      <div className="mb-4">
        <h2 className="text-lg font-black text-slate-900">直播观摩</h2>
        <p className="text-sm text-slate-400 mt-0.5">选择主播查看直播回放与逐字稿</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Loader2 size={28} className="text-teal-400 animate-spin" />
        </div>
      ) : anchors.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center">
          <Monitor size={36} className="text-slate-200 mx-auto mb-3" />
          <p className="text-sm text-slate-400">暂无主播</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {anchors.map(a => (
            <button
              key={a.id}
              onClick={() => setSelectedAnchor(a)}
              className="group bg-white rounded-xl border border-teal-100 p-4 text-center hover:shadow-lg hover:shadow-teal-100 hover:border-teal-200 hover:-translate-y-0.5 transition-all duration-200"
            >
              <div className="w-12 h-12 mx-auto rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center text-white font-black text-lg shadow-lg mb-3">
                {a.name.charAt(0)}
              </div>
              <p className="text-sm font-bold text-slate-700 group-hover:text-teal-600 transition-colors">{a.name}</p>
              <p className="text-[10px] text-slate-400 mt-1">
                {a.enable_qc ? '内部·质检' : '外部·跟踪'}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default TrainingLiveView;
