import React from 'react';
import { Mic2 } from 'lucide-react';

interface HeaderProps {
  actionSlot?: React.ReactNode;
}

const Header: React.FC<HeaderProps> = ({ actionSlot }) => {
  return (
    <header className="bg-white/85 backdrop-blur-md sticky top-0 z-50 border-b border-slate-100 print:hidden">
      <div className="px-4 h-11 flex items-center justify-between relative">
        <div className="flex items-center gap-2">
          <div className="bg-[#07C160] p-1 rounded-lg text-white">
            <Mic2 size={16} />
          </div>
          <h1 className="text-sm font-bold text-slate-900 tracking-tight">AI 智能质检</h1>
          <span className="text-[9px] font-black bg-[#F7F7F7] text-slate-400 px-2 py-0.5 rounded-full uppercase tracking-widest ml-1">v2.8.5</span>
        </div>
        {actionSlot && (
          <div className="flex items-center gap-2">
            {actionSlot}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;