'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const COLORS = ['#3B82F6', '#10B981', '#6366F1', '#8B5CF6', '#F59E0B', '#EF4444', '#64748B'];

interface DonutProps {
  positions: any[];
  cash: number;
  total: number; // 这里的 total 应该是外部传入的 total_equity
}

export default function AssetDonut({ positions, cash, total }: DonutProps) {
  
  // 1. 构造标准数据格式
  // 现金作为一个特殊的 Asset 参与饼图渲染
  const data = [
    { name: '现金 (Cash)', value: Number(cash), symbol: 'USD' },
    ...positions.map(p => {
      // 优先使用最后成交价或市场价来计算当前市值，而非成本
      const price = p.last_action_price || p.avg_price || 0;
      const marketValue = price * (p.quantity || p.shares || 0);
      return {
        name: p.symbol,
        value: marketValue,
        symbol: p.symbol
      };
    })
  ]
  // 过滤掉价值极小的项，防止渲染重叠
  .filter(item => item.value > 1)
  .sort((a, b) => b.value - a.value);

  // 安全总额：防止除以0
  const safeTotal = total > 0 ? total : 1;

  return (
    <div className="flex flex-col w-full">
      {/* 图表区域 */}
      <div className="h-48 w-full relative -ml-2 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={65}
              paddingAngle={2}
              dataKey="value"
              stroke="none"
              cornerRadius={4}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.symbol === 'USD' ? '#CBD5E1' : COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            {/* ✅ 修复点：将 value 类型放宽为 any，并强制转为 Number 后再格式化 */}
            <Tooltip 
              formatter={(value: any) => [`$${Number(value).toLocaleString()}`, '市值']}
              contentStyle={{ 
                borderRadius: '8px', 
                border: 'none', 
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                backgroundColor: 'rgba(255, 255, 255, 0.95)'
              }}
              itemStyle={{ color: '#334155', fontSize: '12px', fontWeight: 'bold' }}
            />
          </PieChart>
        </ResponsiveContainer>
        
        {/* 中心文字 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">Net Worth</span>
          <span className="text-sm font-bold text-slate-800">${(safeTotal / 1000).toFixed(1)}k</span>
        </div>
      </div>

      {/* 列表区域 */}
      <div className="mt-1 w-full px-2 pb-2 space-y-2 max-h-[200px] overflow-y-auto custom-scrollbar">
        {data.map((item, index) => {
          const percent = (item.value / safeTotal) * 100;
          const color = item.symbol === 'USD' ? '#CBD5E1' : COLORS[index % COLORS.length];

          return (
            <div key={item.symbol} className="flex items-center justify-between text-xs group border-b border-dashed border-slate-100 pb-1 last:border-0">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }}></div>
                <span className="font-medium text-slate-700">
                  {item.name}
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
  );
}