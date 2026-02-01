'use client';

import { useState } from 'react';
import { INVESTORS } from '@/lib/config';
import { TrendingUp, TrendingDown, Trophy, ArrowRight, BookOpen, X } from 'lucide-react';

// 🔑 策略文案与代码逻辑完全一致
const STRATEGY_DESCRIPTIONS: Record<string, string> = {
    leek: "每支标的买入 $100,000 作为底仓。单日涨幅超过 2%,追高买入 $50,000;单日跌幅超过 5%全部清仓。单日最多对每支标的执行一次操作。",
    
    gambler: "每支标的买入 $100,000 底仓。如果价格较上次买入价下跌超过 3%,则以当前持仓成本同等金额加倍补仓;如果较上次买入价上涨超过 3%,卖出30%仓位。单日最多对每支标的执行一次操作。",
    
    mom: "每支标的买入 $200,000 满仓。如果价格较上次买入价上涨超过 10%,卖出 20% 仓位取现;永不买入。单日最多对每支标的执行一次操作。",
    
    dog: "每支标的买入 $50,000 底仓。若价格较上次成交价上涨超过 5% 时卖出一半;若单日跌幅超2%买入$10,000。若总资产低于 $500,000 底线,全部清仓退场。单日最多对每支标的执行一次操作。",
    
    xiaoqing: "每支标的买入 $100,000 底仓。如果价格较上次成交价下跌超过 3%,加仓 $50,000。永不卖出。单日最多对每支标的执行一次操作。",
    
    soldier: "每支标的买入 $100,000 底仓。若价格跌破一周内最低点则买入50%仓位。若突破一周内最高点则卖出10%仓位。单日最多对每支标的执行一次操作。",
    
    zen: "每支标的买入 $100,000 底仓。每天对每支标的以持仓金额的10%随机买入或卖出。单日最多对每支标的执行一次操作。"
};

interface Props {
  portfolios: any[];
  currentInvestorId: string;
  onSelect: (id: string) => void;
}

export default function LeaderboardView({ portfolios = [], currentInvestorId, onSelect }: Props) {
  // 状态：当前正在查看谁的策略，null 表示没在看
  const [viewingStrategyId, setViewingStrategyId] = useState<string | null>(null);

  const safeList = Array.isArray(portfolios) ? portfolios : [];
  const sortedList = [...safeList].sort((a, b) => (b.total_equity || 0) - (a.total_equity || 0));

  return (
    <div className="max-w-5xl mx-auto pb-12 relative">
      <div className="text-center space-y-3 mb-10">
        <h2 className="text-3xl font-bold text-slate-900 flex items-center justify-center gap-3">
          <Trophy className="text-yellow-500" size={32} />
          实盘资产排行榜
        </h2>
        <p className="text-slate-500">
          实时监控所有量化策略的表现，点击列表可切换至对应视角。
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="grid grid-cols-12 px-6 py-4 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-500 uppercase tracking-wider">
          <div className="col-span-1">排名</div>
          <div className="col-span-3">投资者</div>
          <div className="col-span-3 text-right">总资产 (USD)</div>
          <div className="col-span-2 text-right">收益率</div>
          <div className="col-span-3 text-center">操作</div>
        </div>

        <div className="divide-y divide-slate-50">
          {sortedList.map((item, index) => {
            const config = INVESTORS.find(i => i.id === item.investor_id);
            const name = config?.name || item.investor_id;
            const initial = item.initial_capital || 1000000;
            const current = item.total_equity || initial;
            const pnl = current - initial;
            const pnlPercent = initial > 0 ? (pnl / initial) * 100 : 0;
            const isProfit = pnl >= 0;
            const isCurrent = currentInvestorId === item.investor_id;

            return (
              <div 
                key={item.investor_id} 
                className={`grid grid-cols-12 px-6 py-4 items-center transition-colors group ${isCurrent ? 'bg-blue-50/50' : 'hover:bg-slate-50'}`}
              >
                {/* 排名 */}
                <div className="col-span-1 font-mono font-bold text-lg text-slate-400">
                  {index === 0 ? <span className="text-yellow-500">🥇</span> : 
                   index === 1 ? <span className="text-slate-400">🥈</span> : 
                   index === 2 ? <span className="text-orange-400">🥉</span> : 
                   `#${index + 1}`}
                </div>

                {/* 名字 */}
                <div className="col-span-3 flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-sm ${index === 0 ? 'bg-yellow-500' : 'bg-slate-900'}`}>
                    {(name || '?').charAt(0)}
                  </div>
                  <div>
                    <div className="font-bold text-slate-900">{name}</div>
                    <div className="text-xs text-slate-400 font-mono">ID: {item.investor_id}</div>
                  </div>
                </div>

                {/* 总资产 */}
                <div className="col-span-3 text-right font-mono font-bold text-slate-800 text-lg">
                  ${Math.round(current).toLocaleString()}
                </div>

                {/* 收益率 */}
                <div className={`col-span-2 text-right font-bold flex items-center justify-end gap-1 ${isProfit ? 'text-red-500' : 'text-green-500'}`}>
                   {isProfit ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                   {pnlPercent > 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                </div>

                {/* 操作按钮区 */}
                <div className="col-span-3 flex justify-center gap-2">
                   {/* 1. 查看策略按钮 */}
                   <button 
                     onClick={(e) => {
                       e.stopPropagation(); // 防止触发 onSelect
                       setViewingStrategyId(item.investor_id);
                     }}
                     className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-blue-600 transition flex items-center gap-1"
                   >
                     <BookOpen size={14} /> 策略
                   </button>

                   {/* 2. 切换视角按钮 */}
                   <button 
                     onClick={() => onSelect(item.investor_id)}
                     className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-slate-900 hover:bg-blue-600 transition flex items-center gap-1 shadow-sm"
                   >
                     视角 <ArrowRight size={14} />
                   </button>
                </div>
              </div>
            );
          })}
          {sortedList.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-sm">暂无数据</div>
          )}
        </div>
      </div>

      {/* 策略详情弹窗 Modal */}
      {viewingStrategyId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 relative animate-in zoom-in-95 duration-200 border border-slate-100">
            <button 
              onClick={() => setViewingStrategyId(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition"
            >
              <X size={20} />
            </button>
            
            <div className="mb-4">
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 mb-4">
                <BookOpen size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-900">
                {INVESTORS.find(i => i.id === viewingStrategyId)?.name} 的交易策略
              </h3>
              <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider font-bold">Strategy Logic</p>
            </div>
            
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-slate-700 text-sm leading-relaxed font-medium">
              {STRATEGY_DESCRIPTIONS[viewingStrategyId] || "暂无策略说明"}
            </div>

            <div className="mt-6 flex justify-end">
              <button 
                onClick={() => setViewingStrategyId(null)}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}