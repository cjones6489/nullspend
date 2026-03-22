"use client";

import { useEffect, useState } from "react";

// Animated counter component
function AnimatedNumber({ 
  value, 
  prefix = "", 
  suffix = "",
  duration = 2000 
}: { 
  value: number; 
  prefix?: string; 
  suffix?: string;
  duration?: number;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  
  useEffect(() => {
    const startTime = Date.now();
    const startValue = displayValue;
    
    const animate = () => {
      const now = Date.now();
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
      
      setDisplayValue(Math.floor(startValue + (value - startValue) * eased));
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    requestAnimationFrame(animate);
  }, [value, duration]);
  
  return (
    <span className="tabular-nums">
      {prefix}{displayValue.toLocaleString()}{suffix}
    </span>
  );
}

// Individual transaction row
function TransactionRow({ 
  model, 
  tokens, 
  cost, 
  time, 
  delay 
}: { 
  model: string; 
  tokens: number; 
  cost: number; 
  time: string;
  delay: number;
}) {
  const [visible, setVisible] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  
  return (
    <div 
      className={`flex items-center justify-between border-b border-primary/10 py-3 transition-all duration-500 ${
        visible ? "translate-x-0 opacity-100" : "-translate-x-4 opacity-0"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
        <span className="font-mono text-sm text-foreground">{model}</span>
      </div>
      <div className="flex items-center gap-6">
        <span className="font-mono text-xs text-muted-foreground">{tokens.toLocaleString()} tokens</span>
        <span className="font-mono text-sm font-medium text-primary">${cost.toFixed(4)}</span>
        <span className="font-mono text-xs text-muted-foreground">{time}</span>
      </div>
    </div>
  );
}

// Animated mini bar chart
function MiniBarChart() {
  const [bars, setBars] = useState([40, 65, 45, 80, 55, 70, 90]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setBars(prev => prev.map(bar => 
        Math.max(20, Math.min(95, bar + (Math.random() - 0.5) * 20))
      ));
    }, 1500);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="flex h-16 items-end gap-1">
      {bars.map((height, i) => (
        <div
          key={i}
          className="w-4 rounded-t bg-gradient-to-t from-primary/60 to-primary transition-all duration-700"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

// Main dashboard preview component
function DashboardPreview() {
  const [totalSpend, setTotalSpend] = useState(12847);
  const [requestCount, setRequestCount] = useState(847293);
  
  const transactions = [
    { model: "gpt-4o", tokens: 2847, cost: 0.0854, time: "2ms ago" },
    { model: "claude-3-opus", tokens: 1293, cost: 0.0387, time: "15ms ago" },
    { model: "gpt-4o-mini", tokens: 8472, cost: 0.0127, time: "48ms ago" },
    { model: "claude-3-sonnet", tokens: 3918, cost: 0.0235, time: "102ms ago" },
    { model: "gpt-4o", tokens: 1847, cost: 0.0554, time: "156ms ago" },
  ];
  
  // Simulate live updates
  useEffect(() => {
    const interval = setInterval(() => {
      setTotalSpend(prev => prev + Math.random() * 2);
      setRequestCount(prev => prev + Math.floor(Math.random() * 50));
    }, 3000);
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="relative">
      {/* Glow effect behind dashboard */}
      <div className="absolute -inset-4 rounded-3xl bg-primary/20 blur-3xl" />
      <div className="absolute -inset-8 rounded-3xl bg-cyan-500/10 blur-[60px]" />
      
      {/* Main dashboard card */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-background/80 p-6 shadow-2xl shadow-primary/10 backdrop-blur-xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full bg-red-500/80" />
            <div className="h-3 w-3 rounded-full bg-yellow-500/80" />
            <div className="h-3 w-3 rounded-full bg-green-500/80" />
          </div>
          <div className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1">
            <span className="flex items-center gap-2 text-xs font-medium text-primary">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Live
            </span>
          </div>
        </div>
        
        {/* Stats row */}
        <div className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <p className="mb-1 text-xs text-muted-foreground">Total Spend (24h)</p>
            <p className="text-2xl font-bold text-foreground">
              <AnimatedNumber value={Math.floor(totalSpend)} prefix="$" />
            </p>
            <p className="mt-1 text-xs text-primary">+12.4% from yesterday</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <p className="mb-1 text-xs text-muted-foreground">API Requests</p>
            <p className="text-2xl font-bold text-foreground">
              <AnimatedNumber value={requestCount} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">847K total</p>
          </div>
          <div className="rounded-xl border border-border/50 bg-card/50 p-4">
            <p className="mb-1 text-xs text-muted-foreground">Avg Cost/Request</p>
            <p className="text-2xl font-bold text-foreground">$0.015</p>
            <p className="mt-1 text-xs text-green-400">-8.2% optimized</p>
          </div>
        </div>
        
        {/* Chart section */}
        <div className="mb-6 rounded-xl border border-border/50 bg-card/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Spend by Model</p>
            <p className="text-xs text-muted-foreground">Last 7 days</p>
          </div>
          <MiniBarChart />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>Mon</span>
            <span>Tue</span>
            <span>Wed</span>
            <span>Thu</span>
            <span>Fri</span>
            <span>Sat</span>
            <span>Sun</span>
          </div>
        </div>
        
        {/* Live transactions */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-foreground">Live Transactions</p>
            <p className="text-xs text-muted-foreground">Streaming...</p>
          </div>
          <div className="space-y-0">
            {transactions.map((tx, i) => (
              <TransactionRow key={i} {...tx} delay={i * 200} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Floating particles in background
function FloatingParticles() {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {Array.from({ length: 20 }).map((_, i) => (
        <div
          key={i}
          className="absolute h-1 w-1 rounded-full bg-primary/30"
          style={{
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            animation: `float ${10 + Math.random() * 20}s ease-in-out infinite`,
            animationDelay: `${Math.random() * 10}s`,
          }}
        />
      ))}
    </div>
  );
}

export function AnimatedHeroBg() {
  return (
    <div className="absolute inset-0 h-full w-full overflow-hidden">
      {/* Base gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />
      
      {/* Animated gradient orbs */}
      <div className="absolute right-0 top-0 h-[800px] w-[800px] -translate-y-1/4 translate-x-1/4">
        <div className="absolute inset-0 animate-pulse rounded-full bg-primary/10 blur-[120px]" />
      </div>
      <div className="absolute bottom-0 left-1/4 h-[600px] w-[600px] translate-y-1/2">
        <div className="absolute inset-0 animate-pulse rounded-full bg-cyan-500/10 blur-[100px]" style={{ animationDelay: "1s" }} />
      </div>
      
      {/* Grid pattern */}
      <div 
        className="absolute inset-0 opacity-[0.02]"
        style={{
          backgroundImage: `linear-gradient(to right, currentColor 1px, transparent 1px),
                           linear-gradient(to bottom, currentColor 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />
      
      {/* Floating particles */}
      <FloatingParticles />
      
      {/* Dashboard preview - positioned right */}
      <div className="absolute right-4 top-1/2 z-10 hidden w-[480px] -translate-y-1/2 lg:block xl:right-12 xl:w-[540px] 2xl:right-24 2xl:w-[580px]">
        <DashboardPreview />
      </div>
      
      {/* Gradient overlays for text readability */}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/95 to-transparent lg:via-background/80" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/60" />
    </div>
  );
}
