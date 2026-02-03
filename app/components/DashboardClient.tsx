// components/DashboardClient.tsx
'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../../lib/config'; 
import { STOCK_NAMES } from '../../lib/constants';
import { 
  TrendingUp, TrendingDown, Activity, Wallet, 
  Clock, RefreshCcw, Layers, BarChart3, PieChart,
  LayoutDashboard, Trophy
} from 'lucide-react';
import { format } from 'date-fns'; 
import EquityChart from './EquityChart';
import MiniCandleChart from './MiniCandleChart';
import AssetDonut from './AssetDonut';
import LeaderboardView from './LeaderboardView';
import InvestorSelector from './InvestorSelector';

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
  initialAllPortfolios: any[];
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
    
    const [allPortfolios, setAllPortfolios] = useState(initialAllPortfolios || []); 
    const [portfolio, setPortfolio] = useState(initialPortfolio || {});
    const [positions, setPositions] = useState<Position[]>(initialPositions || []);
    const [trades, setTrades] = useState<Trade[]>(initialTrades || []); 
    const [equityData, setEquityData] = useState(initialChartData || []);
    const [historyMap, setHistoryMap] = useState(initialHistoryMap || {});
    const [isLive, setIsLive] = useState(false);

    // ✨ 修改 1: 增加 changeValue 字段定义
    const [quotes, setQuotes] = useState<Record<string, { price: number, change: number, changeValue: number }>>({});

  const fetchInvestorData = async (id: string) => {
    setIsLive(false);
    
    const [posRes, trdRes, snapRes] = await Promise.all([
      supabase.from('positions').select('*').eq('investor_id', id),
      supabase.from('trades').select('*').eq('investor_id', id).order('created_at', { ascending: false }).limit(50),
      supabase.from('equity_snapshots').select('*').eq('investor_id', id).order('created_at', { ascending: true }).limit(100)
    ]);

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

  const handleLeaderboardSelect = (id: string) => {
    setCurrentInvestorId(id);
    fetchInvestorData(id);
    setActiveView('monitor');
  };

  const initialCapital = portfolio?.initial_capital || 1000000;
  const currentEquity = portfolio?.total_equity || initialCapital;
  const cashBalance = portfolio?.cash_balance ?? initialCapital; 

  const pnl = currentEquity - initialCapital;
  const pnlPercent = (pnl / initialCapital) * 100;
  const isProfit = pnl >= 0;

  useEffect(() => {
    const channel = supabase.channel(`dashboard-global`);
    
    channel
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'portfolio' }, (payload: any) => {
          const updated = payload.new;
          setAllPortfolios(prev => prev.map(p => p.investor_id === updated.investor_id ? updated : p));
          if (updated.investor_id === currentInvestorId) {
             setPortfolio(updated);
          }
      })
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'market_candles' }, (payload: any) => {
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
      // ✨ 修改 2: 监听 change_value 变更
      .on('postgres_changes', { event: '*', schema: 'public', table: 'market_quotes' }, (payload: any) => {
        const newQuote = payload.new;
        if (newQuote) {
          setQuotes(prev => ({
            ...prev,
            [newQuote.symbol]: { 
              price: Number(newQuote.price), 
              change: Number(newQuote.change_percent),
              changeValue: Number(newQuote.change_value) // 新增读取
            }
          }));
        }
      })
      .subscribe((status: string) => { if (status === 'SUBSCRIBED') setIsLive(true); });

    supabase.from('market_quotes').select('*').then(({ data }) => {
      if (data) {
        const initialQuotes: Record<string, any> = {};
        data.forEach((q: any) => {
          initialQuotes[q.symbol] = { 
            price: Number(q.price), 
            change: Number(q.change_percent),
            changeValue: Number(q.change_value) // ✨ 新增初始化读取
          };
        });
        setQuotes(initialQuotes);
      }
    });

    return () => { supabase.removeChannel(channel); };
  }, [currentInvestorId]);

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

  const normalizedPositions = positions.map(p => ({
      ...p,
      quantity: p.shares ?? p.quantity ?? 0,
      average_cost: p.avg_price ?? p.average_cost ?? 0,
      last_action_price: p.last_buy_price ?? p.last_action_price ?? 0
  }));

  const posSymbols = normalizedPositions.map(p => p.symbol);
  const tradeSymbolsToday = trades
    .filter(t => t.created_at.startsWith(todayStr))
    .map(t => t.symbol);
  
  const allActiveSymbols = Array.from(new Set([...posSymbols, ...tradeSymbolsToday]));

  const displayList = allActiveSymbols.map(symbol => {
    const pos = normalizedPositions.find(p => p.symbol === symbol);
    const symbolTrades = trades.filter(t => t.symbol === symbol && t.created_at.startsWith(todayStr));
    
    // 纽约时间
    const nyDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    let realHistory = historyMap[symbol] || [];
    const quote = quotes[symbol];

    // 强行用实时价格更新 K 线
    if (quote && realHistory.length > 0) {
       const lastIdx = realHistory.length - 1;
       const lastCandle = realHistory[lastIdx];
       
       if (lastCandle.time === nyDate) {
         realHistory = [...realHistory];
         realHistory[lastIdx] = {
           ...lastCandle,
           close: quote.price,
           high: Math.max(lastCandle.high, quote.price),
           low: Math.min(lastCandle.low, quote.price)
         };
       }
    }

    const currentShares = pos?.quantity || 0; 
    let todayBuyQty = 0;
    let todaySellQty = 0;
    let lastSellPrice = 0;

    const sortedTodayTrades = [...symbolTrades].sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    
    symbolTrades.forEach(t => {
        const q = t.shares ?? t.quantity ?? 0;
        if (t.action === 'BUY') todayBuyQty += q;
        if (t.action === 'SELL') todaySellQty += q;
    });

    if (sortedTodayTrades.length > 0) {
        const lastSell = sortedTodayTrades.find(t => t.action === 'SELL');
        lastSellPrice = lastSell?.price || 0;
    }

    const yesterdayShares = currentShares - todayBuyQty + todaySellQty;

    let yesterdayClose = 0;
    if (realHistory.length > 0) {
        const lastIdx = realHistory.length - 1;
        if (realHistory[lastIdx].time === nyDate) {
            yesterdayClose = realHistory.length >= 2 ? realHistory[lastIdx - 1].close : realHistory[lastIdx].open;
        } else {
            yesterdayClose = realHistory[lastIdx].close;
        }
    }

    let currentPrice = quote?.price ?? (pos?.last_action_price || yesterdayClose);
    
    if (currentShares === 0 && lastSellPrice > 0) {
        currentPrice = lastSellPrice;
    }

    let dailyPnL = 0;
    if (yesterdayShares > 0 && yesterdayClose > 0) {
        dailyPnL = yesterdayShares * (currentPrice - yesterdayClose);
    }

    // ✨ 修改 3: 优先使用 API 原值，否则回退到计算值
    let dailyChangeValue = 0;
    const dailyChangePercent = quote ? quote.change * 100 : 0;

    if (quote && quote.changeValue !== undefined && quote.changeValue !== null && !isNaN(quote.changeValue)) {
        // 1. 优先：直接用数据库存的 API 原值
        dailyChangeValue = quote.changeValue;
    } else if (yesterdayClose > 0) {
        // 2. 兜底：如果还没存入新数据，用昨收计算
        dailyChangeValue = currentPrice - yesterdayClose;
    }

    const investedPrincipal = (pos?.average_cost || 0) * currentShares;
    
    const marketValue = currentPrice * currentShares; 
    const totalReturn = marketValue - investedPrincipal;

    const cnName = STOCK_NAMES[symbol] || symbol;
    const isLiquidated = currentShares === 0;

    return {
        symbol,
        cnName,
        currentShares,
        currentPrice,
        yesterdayShares,
        dailyPnL,
        dailyChangePercent,
        dailyChangeValue, // 返回该值
        totalReturn,
        investedPrincipal,
        marketValue,
        realHistory,
        isLiquidated 
    };
  })
  .filter(item => item.yesterdayShares > 0 || item.currentShares > 0) 
  .sort((a, b) => b.dailyPnL - a.dailyPnL); 

  return (
    <div className="flex h-screen bg-[#F8FAFC] font-sans text-slate-800 overflow-hidden">
      
      {/* Sidebar - Desktop Only */}
      <aside className="w-72 bg-white border-r border-slate-200 flex-col shadow-sm z-20 hidden md:flex h-full">
        <div className="p-6 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center text-white">
              <Activity size={20} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">QuantSim</h1>
              <p className="text-xs text-slate-400 font-medium">全自动量化模拟终端</p>
            </div>
          </div>
        </div>

        <div className="px-4 py-4 space-y-1 border-b border-slate-100 shrink-0">
          <button onClick={() => setActiveView('monitor')} className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeView === 'monitor' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>
            <LayoutDashboard size={18} /> 控制台
          </button>
          <button onClick={() => setActiveView('leaderboard')} className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeView === 'leaderboard' ? 'bg-yellow-500 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50'}`}>
            <Trophy size={18} /> 资产排行榜
          </button>
        </div>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto custom-scrollbar">
          <InvestorSelector current={currentInvestorId} onChange={handleInvestorChange} />
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
            <AssetDonut positions={normalizedPositions} cash={cashBalance} total={currentEquity} quotes={quotes} />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[#F8FAFC] relative">
        <header className="px-4 md:px-8 py-4 md:py-5 bg-white border-b border-slate-200 flex justify-between items-center z-10 shrink-0">
          <div className="flex items-center gap-3">
            {/* Desktop Only Title */}
            <h2 className="hidden md:flex text-lg font-bold text-slate-800 items-center gap-2">
              <span className="flex items-center gap-2">
                {activeView === 'monitor' ? <Layers size={18} className="text-slate-500" /> : <Trophy size={18} className="text-yellow-500" />}
                {activeView === 'monitor' ? '控制仪表盘' : '资产排行榜'}
              </span>
            </h2>

            {/* ✨ 移动端置顶：全自动量化终端 branding */}
            <div className="md:hidden flex items-center gap-2">
              <div className="w-7 h-7 bg-slate-900 rounded-md flex items-center justify-center text-white">
                <Activity size={14} />
              </div>
              <div>
                <h1 className="text-[13px] font-bold text-slate-900 tracking-tight leading-none">QuantSim</h1>
                <p className="text-[9px] text-slate-400 font-medium mt-0.5 leading-none">全自动量化模拟终端</p>
              </div>
            </div>
          </div>
          
          <div className="flex gap-2 md:gap-4 items-center">
            <div className="flex items-center gap-1.5 px-2 md:px-3 py-1 bg-slate-50 rounded-full border border-slate-100">
                <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${isLive ? 'bg-green-50 animate-pulse' : 'bg-slate-300'}`}></div>
                <span className="text-[9px] md:text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                    {isLive ? 'LIVE' : 'CONNECTING'}
                </span>
            </div>
            <button onClick={() => fetchInvestorData(currentInvestorId)} className="p-2 md:px-3 md:py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition flex items-center gap-2 shadow-sm">
              <RefreshCcw size={14} /> <span className="hidden md:inline">刷新</span>
            </button>
          </div>
        </header>

        {/* Mobile Info Section */}
        {activeView === 'monitor' && (
          <div className="md:hidden bg-white border-b border-slate-100 px-4 py-3 shrink-0">
              {/* 视角切换控件 */}
              <InvestorSelector current={currentInvestorId} onChange={handleInvestorChange} />

               {/* 总资产数字显示 */}
               <div className="flex justify-between items-end mt-2">
                 <div>
                   <div className="text-[9px] text-slate-400 uppercase font-bold tracking-tighter mb-1">Net Worth</div>
                   <div className="text-base font-bold tracking-tight text-slate-900 leading-none font-mono">
                     ${currentEquity.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                   </div>
                 </div>
                 <div className="text-right">
                    <div className="text-[9px] text-slate-400 uppercase font-bold tracking-tighter mb-1">PnL %</div>
                    <div className={`text-[11px] font-bold ${isProfit ? 'text-red-500' : 'text-green-500'} flex items-center justify-end gap-1`}>
                        {isProfit ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                        {Math.abs(pnlPercent).toFixed(2)}%
                    </div>
                 </div>
               </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 md:p-8 scroll-smooth pb-24 md:pb-8">
          {activeView === 'leaderboard' ? (
            <LeaderboardView 
                portfolios={allPortfolios} 
                currentInvestorId={currentInvestorId}
                onSelect={handleLeaderboardSelect} 
            />
          ) : (
            <>
              {/* Equity Chart */}
              <section className="mb-4 md:mb-8">
                <EquityChart data={finalChartData} />
              </section>

              {/* Mobile Only: Asset Distribution */}
              <section className="md:hidden mb-6 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                 <div className="text-[9px] font-bold text-slate-400 uppercase mb-3 flex items-center gap-1">
                    <PieChart size={12} /> 资产分布
                 </div>
                 <AssetDonut positions={normalizedPositions} cash={cashBalance} total={currentEquity} quotes={quotes} />
              </section>

              <section className="mb-8">
                <div className="flex items-center justify-between mb-4 px-1">
                  <h3 className="font-bold text-slate-700 flex items-center gap-2 text-[12px] md:text-base">
                    <BarChart3 size={15} /> 持仓监控 (Live)
                  </h3>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-6">
                  {displayList.map((item) => (
                    <div 
                        key={item.symbol} 
                        className={`bg-white rounded-xl border ${item.isLiquidated ? 'border-dashed border-slate-300 opacity-80' : 'border-slate-200'} shadow-sm overflow-hidden flex flex-col`}
                    >
                      <div className="p-3.5 md:p-5 border-b border-slate-50">
                        <div className="flex justify-between items-start mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-[14px] md:text-xl font-bold text-slate-900">{item.symbol}</h4>
                              <span className={`text-[8px] md:text-xs font-medium px-1 py-0.5 rounded ${item.isLiquidated ? 'bg-slate-200 text-slate-600' : 'bg-slate-100 text-slate-500'}`}>
                                {item.isLiquidated ? '已清仓' : item.cnName}
                              </span>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-base md:text-2xl font-bold text-slate-800 font-mono">
                              ${Number(item.currentPrice).toFixed(2)}
                            </div>
                            {/* ✨ 修改 4: 在百分比后追加具体的涨跌数值 */}
                            <div className={`text-[9px] md:text-xs font-medium mt-0.5 ${item.dailyChangePercent >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                                {item.dailyChangePercent >= 0 ? '+' : ''}{item.dailyChangePercent.toFixed(2)}%
                                <span className="ml-1 opacity-80">
                                  ({item.dailyChangeValue >= 0 ? '+' : ''}{item.dailyChangeValue.toFixed(2)})
                                </span>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-1 py-2 bg-slate-50/50 rounded-lg px-2">
                          <div className="flex flex-col">
                              <span className="text-[8px] text-slate-400 mb-0.5">市值</span>
                              <span className="text-[10px] md:text-sm font-bold text-slate-700 font-mono">${Math.round(item.marketValue).toLocaleString()}</span>
                          </div>
                          <div className="flex flex-col text-center">
                              <span className="text-[8px] text-slate-400 mb-0.5">当日盈亏</span>
                              <div className={`text-[10px] md:text-sm font-bold font-mono ${item.dailyPnL >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                                 {item.dailyPnL >= 0 ? '+' : ''}{Math.round(item.dailyPnL).toLocaleString()}
                              </div>
                          </div>
                          <div className="flex flex-col text-right">
                              <span className="text-[8px] text-slate-400 mb-0.5">总收益</span>
                              <div className={`text-[10px] md:text-sm font-bold font-mono ${item.totalReturn >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                                  {item.isLiquidated ? '-' : (item.totalReturn >= 0 ? '+' : '') + Math.round(item.totalReturn).toLocaleString()}
                              </div>
                          </div>
                        </div>
                      </div>
                      
                      <div className="h-32 md:h-48 w-full relative bg-white pt-1">
                         {item.realHistory.length > 0 ? <MiniCandleChart data={item.realHistory} /> : <div className="flex items-center justify-center h-full text-slate-400 text-[10px]">等待数据...</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* 交易日志 */}
              <section>
                 <div className="flex items-center justify-between mb-4 px-1"><h3 className="font-bold text-slate-700 flex items-center gap-2 text-[12px] md:text-base"><Clock size={15} /> 交易日志</h3></div>
                 <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="divide-y divide-slate-50">
                    {trades?.map((trade: any) => {
                      const qty = trade.shares ?? trade.quantity ?? 0;
                      const tradeAmount = trade.amount ?? (trade.price * qty);
                      
                      return (
                        <div key={trade.id} className="grid grid-cols-2 md:grid-cols-6 px-4 md:px-6 py-3 md:py-3.5 items-center hover:bg-slate-50/80 transition-colors text-sm">
                          {/* Mobile Layout for Logs */}
                          <div className="md:hidden col-span-2 flex justify-between items-center mb-1">
                              <span className="font-bold text-slate-800 text-[10px]">{trade.symbol}</span>
                              <span className="text-[8px] text-slate-400 font-mono">{format(new Date(trade.created_at), 'MM-dd HH:mm')}</span>
                          </div>
                          <div className="md:hidden col-span-2 flex justify-between items-center text-[10px]">
                               <div className="flex items-center gap-1.5">
                                  <span className={`px-1 py-0.5 rounded text-[8px] font-bold border ${trade.action === 'BUY' ? 'bg-red-50 text-red-700 border-red-100' : 'bg-green-50 text-green-700 border-green-100'}`}>{trade.action === 'BUY' ? '买入' : '卖出'}</span>
                                  <span className="font-mono text-[9px]">${Number(trade.price).toFixed(2)}</span>
                                  <span className="font-bold text-slate-700 text-[9px]">${Math.round(tradeAmount).toLocaleString()}</span>
                                </div>
                                <div className="text-[8px] text-slate-400 italic truncate max-w-[100px]">{trade.reason}</div>
                          </div>
                          
                          {/* Desktop Layout (No changes) */}
                          <div className="hidden md:block col-span-1 text-slate-400 text-xs font-mono">{format(new Date(trade.created_at), 'yyyy-MM-dd HH:mm:ss')}</div>
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
        
        {/* Mobile Navbar */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 py-1 flex items-center z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] pb-safe">
          <div className="flex-1 flex justify-center">
            <button onClick={() => setActiveView('monitor')} className={`flex flex-col items-center gap-1 px-6 py-2 rounded-lg transition ${activeView === 'monitor' ? 'text-slate-900' : 'text-slate-400'}`}>
              <LayoutDashboard size={18} className={activeView === 'monitor' ? 'fill-slate-900/10' : ''} />
              <span className="text-[10px] font-bold">控制台</span>
            </button>
          </div>
          <div className="w-px h-6 bg-slate-100 shrink-0"></div>
          <div className="flex-1 flex justify-center">
            <button onClick={() => setActiveView('leaderboard')} className={`flex flex-col items-center gap-1 px-6 py-2 rounded-lg transition ${activeView === 'leaderboard' ? 'text-yellow-500' : 'text-slate-400'}`}>
              <Trophy size={18} className={activeView === 'leaderboard' ? 'fill-yellow-500/10' : ''} />
              <span className="text-[10px] font-bold">排行榜</span>
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}