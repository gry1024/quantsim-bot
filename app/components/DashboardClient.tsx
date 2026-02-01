'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/config'; 
import { STOCK_NAMES } from '../../lib/constants';
import { 
  TrendingUp, TrendingDown, Activity, Wallet, 
  Clock, RefreshCcw, Layers, BarChart3, PieChart,
  LayoutDashboard, Trophy // 👈 引入奖杯图标
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import EquityChart from './EquityChart';
import MiniCandleChart from './MiniCandleChart';
import AssetDonut from './AssetDonut';
import LeaderboardView from './LeaderboardView'; // 👈 替换 StrategyView
import InvestorSelector from './InvestorSelector';

// ... (Trade 和 Position 接口定义保持不变，此处省略以节省空间) ...
interface Trade {
  id: number;
  symbol: string;
  action: 'BUY' | 'SELL';
  price: number;
  shares: number;   
  amount: number;
  reason: string;
  created_at: string;
  quantity?: number; 
}
interface Position {
  id: number;
  symbol: string;
  shares: number;      
  avg_price: number;   
  last_buy_price: number;
  updated_at?: string;
  created_at?: string;
  quantity?: number;
  average_cost?: number;
  last_action_price?: number;
}

interface DashboardClientProps {
  defaultInvestorId: string;
  initialAllPortfolios: any[]; // 👈 新增
  initialPortfolio: any;
  initialPositions: any[];
  initialTrades: any[];
  initialChartData: { time: string; value: number }[];
  historyMap: Record<string, any[]>;
}

export default function DashboardClient({ 
    defaultInvestorId,
    initialAllPortfolios, 
    initialPortfolio, 
    initialPositions, 
    initialTrades, 
    initialChartData,
    historyMap: initialHistoryMap 
  }: DashboardClientProps) {
    
    const [currentInvestorId, setCurrentInvestorId] = useState(defaultInvestorId);
    const [activeView, setActiveView] = useState<'monitor' | 'leaderboard'>('monitor');
    
    // 🔧 修复：增加 || [] 默认值，防止传入 undefined 导致崩溃
    const [allPortfolios, setAllPortfolios] = useState(initialAllPortfolios || []); 
    const [portfolio, setPortfolio] = useState(initialPortfolio || {});
    const [positions, setPositions] = useState<Position[]>(initialPositions || []);
    const [trades, setTrades] = useState<Trade[]>(initialTrades || []); 
    const [equityData, setEquityData] = useState(initialChartData || []);
    const [historyMap, setHistoryMap] = useState(initialHistoryMap || {});
    const [isLive, setIsLive] = useState(false);

  // 切换投资者
  const fetchInvestorData = async (id: string) => {
    setIsLive(false);
    
    // 1. 获取当前视角的持仓、交易、曲线
    const [posRes, trdRes, snapRes] = await Promise.all([
      supabase.from('positions').select('*').eq('investor_id', id),
      supabase.from('trades').select('*').eq('investor_id', id).order('created_at', { ascending: false }).limit(50),
      supabase.from('equity_snapshots').select('*').eq('investor_id', id).order('created_at', { ascending: true }).limit(100)
    ]);

    // 2. 更新状态
    // 注意：Portfolio 数据我们从 allPortfolios 里直接拿最新的，不用重新 fetch 单条
    const targetPortfolio = allPortfolios.find(p => p.investor_id === id);
    if (targetPortfolio) setPortfolio(targetPortfolio);

    if (posRes.data) setPositions(posRes.data);
    if (trdRes.data) setTrades(trdRes.data);
    if (snapRes.data) {
        setEquityData(snapRes.data.map((s: any) => ({
            time: s.created_at.split('T')[0],
            value: s.total_equity
        })));
    }
    
    setIsLive(true);
  };

  const handleInvestorChange = (id: string) => {
    setCurrentInvestorId(id);
    fetchInvestorData(id);
  };

  // 处理排行榜点击跳转
  const handleLeaderboardSelect = (id: string) => {
    setCurrentInvestorId(id);
    fetchInvestorData(id);
    setActiveView('monitor'); // 自动切回控制台看详情
  };

  const initialCapital = portfolio?.initial_capital || 1000000;
  const currentEquity = portfolio?.total_equity || initialCapital;
  const cashBalance = portfolio?.cash_balance || 0;
  const pnl = currentEquity - initialCapital;
  const pnlPercent = (pnl / initialCapital) * 100;
  const isProfit = pnl >= 0;

  useEffect(() => {
    // 订阅全局数据
    const channel = supabase.channel(`dashboard-global`);
    
    channel
      // 1. 监听【所有】Portfolio 更新，以驱动排行榜实时跳动
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'portfolio' }, (payload: any) => {
          const updated = payload.new;
          // 更新总表
          setAllPortfolios(prev => prev.map(p => p.investor_id === updated.investor_id ? updated : p));
          // 如果更新的是当前视角，同步更新当前 portfolio
          if (updated.investor_id === currentInvestorId) {
             setPortfolio(updated);
          }
      })
      // 2. 下面的表需要过滤 investor_id，否则会收到别人的交易推送
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'equity_snapshots', filter: `investor_id=eq.${currentInvestorId}` }, (payload: any) => {
          const newPoint = { time: payload.new.created_at.split('T')[0], value: payload.new.total_equity };
          setEquityData(prev => [...prev, newPoint]);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'positions', filter: `investor_id=eq.${currentInvestorId}` }, () => {
          supabase.from('positions').select('*').eq('investor_id', currentInvestorId).then(({ data }: { data: any }) => {
              if (data) setPositions(data);
          });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades', filter: `investor_id=eq.${currentInvestorId}` }, (payload: any) => {
          setTrades((prev) => [payload.new, ...prev]);
      })
      // K线是公用的
      .on('postgres_changes', { event: '*', schema: 'public', table: 'market_candles' }, (payload: any) => {
          // ... (K线更新逻辑保持不变) ...
          const newCandle = payload.new as any;
          if (!newCandle || !newCandle.symbol) return;
          setHistoryMap((prevMap) => {
            const symbol = newCandle.symbol;
            const oldList = prevMap[symbol] || [];
            const newList = [...oldList];
            const lastIndex = newList.length - 1;
            const chartCandle = { time: newCandle.date, open: newCandle.open, high: newCandle.high, low: newCandle.low, close: newCandle.close };
            if (newList[lastIndex] && newList[lastIndex].time === newCandle.date) {
              newList[lastIndex] = chartCandle;
            } else {
              newList.push(chartCandle);
            }
            return { ...prevMap, [symbol]: newList };
          });
      })
      .subscribe((status: string) => { if (status === 'SUBSCRIBED') setIsLive(true); });

    return () => { supabase.removeChannel(channel); };
  }, [currentInvestorId]); // 当 currentInvestorId 变化时，重新订阅专属频道

  // ... (图表数据构造逻辑保持不变) ...
  const finalChartData = [...(equityData || [])];
  const todayStr = new Date().toISOString().split('T')[0];
  if (finalChartData.length > 0) {
    const lastPoint = finalChartData[finalChartData.length - 1];
    if (lastPoint.time !== todayStr) {
      finalChartData.push({ time: todayStr, value: currentEquity });
    } else {
      finalChartData[finalChartData.length - 1].value = currentEquity;
    }
  } else {
    finalChartData.push({ time: todayStr, value: currentEquity });
  }

  // ... (Position 标准化逻辑保持不变) ...
  const normalizedPositions = positions.map(p => ({
      ...p,
      quantity: p.shares ?? p.quantity ?? 0,
      average_cost: p.avg_price ?? p.average_cost ?? 0,
      last_action_price: p.last_buy_price ?? p.last_action_price ?? 0
  }));

  return (
    <div className="flex h-screen bg-[#F8FAFC] font-sans text-slate-800 overflow-hidden">
      
      {/* Sidebar */}
      <aside className="w-72 bg-white border-r border-slate-200 flex-col shadow-sm z-20 hidden md:flex h-full">
        <div className="p-6 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white">
              <Activity size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">QuantSim</h1>
              <p className="text-xs text-slate-400 font-medium">全自动量化终端</p>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 space-y-1 border-b border-slate-100 shrink-0">
          <button onClick={() => setActiveView('monitor')} className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeView === 'monitor' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>
            <LayoutDashboard size={18} /> 控制台
          </button>
          {/* 👇 修改按钮：策略说明 -> 排行榜 */}
          <button onClick={() => setActiveView('leaderboard')} className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeView === 'leaderboard' ? 'bg-yellow-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>
            <Trophy size={18} /> 资产排行榜
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
          <InvestorSelector current={currentInvestorId} onChange={handleInvestorChange} />
          {/* ... (侧边栏底部信息保持不变) ... */}
           <div>
            <div className="text-xs font-semibold text-slate-400 uppercase mb-2 flex items-center gap-1">
              <Wallet size={14} /> 账户总净值 (USD)
            </div>
            <div className="text-3xl font-light tracking-tight text-slate-900">
              ${currentEquity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`mt-2 flex items-center gap-1 text-sm font-medium ${isProfit ? 'text-red-500' : 'text-green-500'}`}>
              {isProfit ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
              <span>{Math.abs(pnl).toLocaleString('en-US', { style: 'currency', currency: 'USD' })} ({Math.abs(pnlPercent).toFixed(2)}%)</span>
            </div>
          </div>
          <hr className="border-slate-100" />
          <div className="min-h-[200px] pb-6">
            <div className="text-xs font-semibold text-slate-400 uppercase mb-2 flex items-center gap-1"><PieChart size={14} /> 仓位分布</div>
            <AssetDonut positions={normalizedPositions} cash={cashBalance} total={currentEquity} />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[#F8FAFC] relative">
        <header className="px-4 md:px-8 py-4 md:py-5 bg-white border-b border-slate-200 flex justify-between items-center z-10 shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <span className="hidden md:flex items-center gap-2">
                {activeView === 'monitor' ? <Layers size={18} className="text-slate-500" /> : <Trophy size={18} className="text-yellow-500" />}
                {activeView === 'monitor' ? '控制仪表盘' : '资产排行榜'}
              </span>
            </h2>
          </div>
          
          <div className="flex gap-2 md:gap-4 items-center">
            <div className="flex items-center gap-1.5 px-2 md:px-3 py-1 bg-slate-50 rounded-full border border-slate-100">
                <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${isLive ? 'bg-green-500 animate-pulse' : 'bg-slate-300'}`}></div>
                <span className="text-[9px] md:text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                    {isLive ? 'LIVE' : 'CONNECTING'}
                </span>
            </div>
            <button onClick={() => fetchInvestorData(currentInvestorId)} className="p-2 md:px-3 md:py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition flex items-center gap-2 shadow-sm">
              <RefreshCcw size={14} /> <span className="hidden md:inline">刷新</span>
            </button>
          </div>
        </header>

        {/* Mobile Header Info */}
        <div className="md:hidden bg-white border-b border-slate-100 px-4 py-3 shrink-0">
            <InvestorSelector current={currentInvestorId} onChange={handleInvestorChange} />
             <div className="flex justify-between items-end mt-2">
             <div>
               <div className="text-2xl font-light tracking-tight text-slate-900 leading-none">
                 ${currentEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
               </div>
             </div>
             <div className={`text-sm font-medium ${isProfit ? 'text-red-500' : 'text-green-500'} flex items-center gap-1 mb-0.5`}>
                {Math.abs(pnlPercent).toFixed(2)}%
             </div>
           </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 scroll-smooth pb-24 md:pb-8">
          {activeView === 'leaderboard' ? (
            // 👇 替换为排行榜组件
            <LeaderboardView 
                portfolios={allPortfolios} 
                currentInvestorId={currentInvestorId}
                onSelect={handleLeaderboardSelect} 
            />
          ) : (
            // 控制台视图保持不变
            <>
              <section className="mb-6 md:mb-8 hidden md:block"><EquityChart data={finalChartData} /></section>
              <section className="mb-8">
                {/* ... (持仓列表代码保持不变) ... */}
                <div className="flex items-center justify-between mb-4 px-1">
                  <h3 className="font-bold text-slate-700 flex items-center gap-2 text-sm md:text-base">
                    <BarChart3 size={18} /> 持仓监控 ({normalizedPositions.length})
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-6">
                  {normalizedPositions?.map((pos: any) => {
                    const avgCost = pos.average_cost || 0;
                    const quantity = pos.quantity || 0;
                    const investedPrincipal = avgCost * quantity;
                    
                    const realHistory = historyMap[pos.symbol] || [];
                    let currentPrice = pos.last_action_price || avgCost;

                    if (realHistory.length > 0) {
                        const lastCandle = realHistory[realHistory.length - 1];
                        currentPrice = lastCandle.close; 
                    }

                    const marketValue = currentPrice * quantity;
                    const totalReturn = marketValue - investedPrincipal;
                    const totalReturnPercent = avgCost > 0 ? (totalReturn / investedPrincipal) * 100 : 0;
                    const cnName = STOCK_NAMES[pos.symbol] || pos.symbol;

                    return (
                      <div key={pos.symbol} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                        <div className="p-4 md:p-5 border-b border-slate-50">
                          <div className="flex justify-between items-start mb-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-lg md:text-xl font-bold text-slate-900">{pos.symbol}</h4>
                                <span className="text-xs text-slate-500 font-medium px-1.5 py-0.5 bg-slate-100 rounded">{cnName}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xl md:text-2xl font-bold text-slate-800 transition-colors duration-300 font-mono">
                                ${Number(currentPrice).toFixed(2)}
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 py-2 bg-slate-50/50 rounded-lg px-2">
                            <div className="flex flex-col">
                                <span className="text-[10px] text-slate-400 mb-0.5">持仓成本</span>
                                <span className="text-xs md:text-sm font-semibold text-slate-700">
                                    ${Math.round(investedPrincipal).toLocaleString()} <span className="text-slate-400 font-normal">(@{Number(avgCost).toFixed(1)})</span>
                                </span>
                            </div>
                            <div className="flex flex-col text-right">
                                <span className="text-[10px] text-slate-400 mb-0.5">总收益</span>
                                <div className={`text-xs md:text-sm font-semibold ${totalReturn >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                                    {totalReturn >= 0 ? '+' : ''}{Math.round(totalReturn).toLocaleString()}
                                    <span className="text-[9px] ml-0.5 opacity-70">({totalReturnPercent.toFixed(1)}%)</span>
                                </div>
                            </div>
                          </div>
                        </div>
                        <div className="h-40 md:h-48 w-full relative bg-white pt-2">
                           {realHistory.length > 0 ? <MiniCandleChart data={realHistory} /> : <div className="flex items-center justify-center h-full text-slate-400 text-xs">等待行情数据...</div>}
                        </div>
                      </div>
                    );
                  })}
                  {(!positions || positions.length === 0) && (
                    <div className="col-span-full py-8 md:py-12 text-center bg-white rounded-xl border border-dashed border-slate-300 text-slate-400 text-sm">该投资者当前空仓 (Keep Cash)</div>
                  )}
                </div>
              </section>

              {/* 交易日志部分保持不变 */}
              <section>
                 <div className="flex items-center justify-between mb-4 px-1"><h3 className="font-bold text-slate-700 flex items-center gap-2 text-sm md:text-base"><Clock size={18} /> 交易日志</h3></div>
                 <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="hidden md:grid grid-cols-6 px-6 py-3 bg-slate-50 border-b border-slate-100 text-xs font-bold text-slate-500">
                    <div className="col-span-1">时间</div>
                    <div className="col-span-1">标的</div>
                    <div className="col-span-1">操作</div>
                    <div className="col-span-1 text-right">成交价</div>
                    <div className="col-span-1 text-right">成交金额</div>
                    <div className="col-span-1 text-right">策略理由</div>
                  </div>
                  <div className="divide-y divide-slate-50">
                    {trades?.map((trade: any) => {
                      const qty = trade.shares ?? trade.quantity ?? 0;
                      const tradeAmount = trade.amount ?? (trade.price * qty);
                      
                      return (
                        <div key={trade.id} className="grid grid-cols-2 md:grid-cols-6 px-4 md:px-6 py-3 md:py-3.5 items-center hover:bg-slate-50/80 transition-colors text-sm">
                          {/* Mobile */}
                          <div className="md:hidden col-span-2 flex justify-between items-center mb-1">
                              <span className="font-bold text-slate-800">{trade.symbol}</span>
                              <span className="text-xs text-slate-400">{formatDistanceToNow(new Date(trade.created_at), { addSuffix: true, locale: zhCN })}</span>
                          </div>
                          <div className="md:hidden col-span-2 flex justify-between items-center text-xs">
                               <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${trade.action === 'BUY' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}`}>{trade.action === 'BUY' ? '买入' : '卖出'}</span>
                                  <span className="font-mono">${Number(trade.price).toFixed(2)}</span>
                                  <span className="text-slate-300">|</span>
                                  <span className="font-semibold text-slate-700">${Math.round(tradeAmount).toLocaleString()}</span>
                                </div>
                          </div>
                          {/* Desktop */}
                          <div className="hidden md:block col-span-1 text-slate-400 text-xs">{formatDistanceToNow(new Date(trade.created_at), { addSuffix: true, locale: zhCN })}</div>
                          <div className="hidden md:block col-span-1 font-bold text-slate-800">{trade.symbol}</div>
                          <div className="hidden md:block col-span-1"><span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${trade.action === 'BUY' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}`}>{trade.action === 'BUY' ? '买入' : '卖出'}</span></div>
                          <div className="hidden md:block col-span-1 text-right font-medium text-slate-700 font-mono">${Number(trade.price).toFixed(2)}</div>
                          <div className="hidden md:block col-span-1 text-right font-bold text-slate-800">${Math.round(tradeAmount).toLocaleString()}</div>
                          <div className="hidden md:block col-span-1 text-right text-xs text-slate-400 truncate pl-4" title={trade.reason}>{trade.reason}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
        
        {/* Mobile Navbar - Updated Buttons */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-6 py-2 flex justify-between items-center z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] pb-safe">
          <button onClick={() => setActiveView('monitor')} className={`flex flex-col items-center gap-1 p-2 rounded-lg transition ${activeView === 'monitor' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}>
            <LayoutDashboard size={20} className={activeView === 'monitor' ? 'fill-slate-900/10' : ''} />
            <span className="text-[10px] font-medium">控制台</span>
          </button>
          <div className="w-px h-8 bg-slate-100"></div>
          <button onClick={() => setActiveView('leaderboard')} className={`flex flex-col items-center gap-1 p-2 rounded-lg transition ${activeView === 'leaderboard' ? 'text-yellow-500' : 'text-slate-400 hover:text-slate-600'}`}>
            <Trophy size={20} className={activeView === 'leaderboard' ? 'fill-yellow-500/10' : ''} />
            <span className="text-[10px] font-medium">排行榜</span>
          </button>
        </div>
      </main>
    </div>
  );
}