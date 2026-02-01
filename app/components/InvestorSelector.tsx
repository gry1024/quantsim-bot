'use client';
import { INVESTORS } from '@/lib/config';

interface Props {
  current: string;
  onChange: (id: string) => void;
}

export default function InvestorSelector({ current, onChange }: Props) {
  // 安全获取当前名称
  const currentName = INVESTORS.find(i => i.id === current)?.name || current;

  return (
    <div className="flex items-center space-x-4 bg-white p-3 rounded-lg border border-slate-200 shadow-sm mb-4">
      <div className="flex flex-col">
         <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">当前视角 / View</span>
         <span className="text-sm font-bold text-slate-800">
           {currentName}
         </span>
      </div>
      
      <div className="h-6 w-px bg-slate-200 mx-2"></div>

      <div className="relative flex-1">
        <select 
          value={current}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-slate-50 text-slate-700 border border-slate-200 rounded px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer hover:bg-slate-100 transition font-medium"
        >
          {INVESTORS.map((inv) => (
            <option key={inv.id} value={inv.id}>
              {inv.name}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-400">
          <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
        </div>
      </div>
    </div>
  );
}