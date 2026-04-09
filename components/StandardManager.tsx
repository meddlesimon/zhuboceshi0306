import React, { useState } from 'react';
import { Standard, StandardType } from '../types';
import { Plus, Trash2, ShieldAlert, CheckCircle2 } from 'lucide-react';

interface StandardManagerProps {
  standards: Standard[];
  onAddStandard: (type: StandardType, content: string) => void;
  onRemoveStandard: (id: string) => void;
}

const StandardManager: React.FC<StandardManagerProps> = ({ standards, onAddStandard, onRemoveStandard }) => {
  const [activeTab, setActiveTab] = useState<StandardType>('forbidden');
  const [inputValue, setInputValue] = useState('');

  const handleAdd = () => {
    if (inputValue.trim()) {
      onAddStandard(activeTab, inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAdd();
    }
  };

  const currentList = standards.filter(s => s.type === activeTab);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b border-slate-100 bg-slate-50/50">
        <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
          1. 质检标准配置
        </h2>
        <p className="text-sm text-slate-500 mt-1">
          定义直播间的“红线”与“必答题”
        </p>
      </div>

      <div className="flex border-b border-slate-200">
        <button
          onClick={() => setActiveTab('forbidden')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'forbidden'
              ? 'text-red-600 border-b-2 border-red-600 bg-red-50/30'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          <ShieldAlert size={16} />
          禁止项 (Forbidden)
        </button>
        <button
          onClick={() => setActiveTab('mandatory')}
          className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
            activeTab === 'mandatory'
              ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          <CheckCircle2 size={16} />
          必选项 (Mandatory)
        </button>
      </div>

      <div className="p-4 flex-1 flex flex-col min-h-[300px]">
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={activeTab === 'forbidden' ? "输入禁止说的话术..." : "输入必须涵盖的内容..."}
            className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-shadow"
          />
          <button
            onClick={handleAdd}
            className={`px-4 py-2 rounded-lg text-white font-medium flex items-center gap-1 transition-colors ${
              activeTab === 'forbidden' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            <Plus size={18} />
            添加
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {currentList.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <p>暂无{activeTab === 'forbidden' ? '禁止' : '必选'}规则</p>
              <p className="text-xs">请在上方输入并添加</p>
            </div>
          ) : (
            currentList.map((item) => (
              <div
                key={item.id}
                className={`group flex items-center justify-between p-3 rounded-lg border ${
                  item.type === 'forbidden'
                    ? 'bg-red-50 border-red-100 text-red-800'
                    : 'bg-blue-50 border-blue-100 text-blue-800'
                }`}
              >
                <span className="text-sm font-medium">{item.content}</span>
                <button
                  onClick={() => onRemoveStandard(item.id)}
                  className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                  aria-label="Remove"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default StandardManager;