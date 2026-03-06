import React from 'react';
import { Mic2 } from 'lucide-react';

const Header: React.FC = () => {
  return (
    <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-slate-100 print:hidden">
      <div className="px-6 h-14 flex items-center justify-center relative">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-1.5 rounded-lg text-white">
            <Mic2 size={18} />
          </div>
          <h1 className="text-base font-bold text-slate-900 tracking-tight">StreamScript QA</h1>
        </div>
      </div>
    </header>
  );
};

export default Header;