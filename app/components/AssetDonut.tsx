'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = ['#3B82F6', '#10B981', '#6366F1', '#8B5CF6', '#F59E0B', '#64748B'];

export default function AssetDonut({ positions, cash, total: ignoredTotal }: { positions: any[], cash: number, total: number }) {
  
  // 1. 构造数据
  const data = [
    { name: '现金 (Cash)', value: cash, symbol: 'CASH' },
    ...positions.map(p => ({
      name: p.symbol,
      value: (p.last_action_price || 0) * p.quantity,
      symbol: p.symbol
    }))
  ].sort((a, b) => b.value - a.value);

  // 2. 关键修复：现场重新计算总资产，而不是使用数据库里可能过期的 total 字段
  // 这样能确保圆环图永远是 100% 闭环的
  const calculatedTotal = data.reduce((sum, item) => sum + item.value, 0);
  
  // 防止除以 0
  const safeTotal = calculatedTotal > 0 ? calculatedTotal : 1;

  return (
    <div className="flex flex-col w-full">
      {/* 上半部分：图表 */}
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
              formatter={(value: any) => `$${Number(value || 0).toLocaleString()}`}
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            />
          </PieChart>
        </ResponsiveContainer>
        
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <span className="text-[10px] text-slate-400 block">Total Assets</span>
            <span className="text-xs font-bold text-slate-700">${(calculatedTotal/1000).toFixed(1)}k</span>
          </div>
        </div>
      </div>

      {/* 下半部分：列表 */}
      <div className="mt-2 w-full px-1 pb-4">
        <div className="space-y-3">
          {data.map((item, index) => {
            // 使用重新计算的 safeTotal，保证占比准确
            const percent = (item.value / safeTotal) * 100;
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