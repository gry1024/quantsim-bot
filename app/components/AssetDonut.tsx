'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = ['#3B82F6', '#10B981', '#6366F1', '#8B5CF6', '#F59E0B', '#64748B'];

export default function AssetDonut({ positions, cash, total }: { positions: any[], cash: number, total: number }) {
  
  const data = [
    { name: '现金 (Cash)', value: cash, symbol: 'CASH' },
    ...positions.map(p => ({
      name: p.symbol,
      value: (p.last_action_price || 0) * p.quantity,
      symbol: p.symbol
    }))
  ].sort((a, b) => b.value - a.value);

  return (
    <div className="flex flex-col w-full">
      {/* 上半部分：图表 (保持固定高度，否则会消失) */}
      <div className="h-48 w-full relative -ml-2 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={60}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip 
              formatter={(value: number) => `$${value.toLocaleString()}`}
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            />
          </PieChart>
        </ResponsiveContainer>
        
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <span className="text-[10px] text-slate-400 block">Total</span>
            <span className="text-xs font-bold text-slate-700">${(total/1000).toFixed(1)}k</span>
          </div>
        </div>
      </div>

      {/* 下半部分：列表 (移除 overflow-y-auto，改为自动撑开) */}
      <div className="mt-2 w-full px-1 pb-4">
        <div className="space-y-3">
          {data.map((item, index) => {
            const percent = total > 0 ? (item.value / total) * 100 : 0;
            const color = COLORS[index % COLORS.length];

            return (
              <div key={item.symbol} className="flex items-center justify-between text-xs group border-b border-dashed border-slate-100 pb-1 last:border-0">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }}></div>
                  <span className="font-medium text-slate-700 group-hover:text-slate-900 transition-colors">
                    {item.name.split(' ')[0]} 
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-mono font-semibold text-slate-700">
                    ${Math.round(item.value).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {percent.toFixed(1)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}