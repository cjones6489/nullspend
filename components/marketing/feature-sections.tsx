"use client";

import { useEffect, useRef, useState } from "react";

// ============================================================================
// SECTION 1: Cost Tracking - Animated cost counter with token breakdown
// ============================================================================
function CostTrackingVisual() {
  const [totalCost, setTotalCost] = useState(0);
  const [inputTokens, setInputTokens] = useState(0);
  const [outputTokens, setOutputTokens] = useState(0);
  const [cachedTokens, setCachedTokens] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setTotalCost((prev) => prev + Math.random() * 0.003);
      setInputTokens((prev) => prev + Math.floor(Math.random() * 50));
      setOutputTokens((prev) => prev + Math.floor(Math.random() * 120));
      setCachedTokens((prev) => prev + Math.floor(Math.random() * 30));
    }, 100);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative">
      {/* Glow effect */}
      <div className="absolute -inset-4 rounded-2xl bg-gradient-to-r from-primary/20 via-cyan-500/10 to-primary/20 blur-2xl" />
      
      <div className="relative rounded-xl border border-border/50 bg-card/80 p-8 backdrop-blur-sm">
        {/* Main cost display */}
        <div className="mb-8 text-center">
          <p className="mb-2 text-sm font-medium text-muted-foreground">Total Spend</p>
          <div className="font-mono text-5xl font-bold tabular-nums tracking-tight text-foreground md:text-6xl">
            ${totalCost.toFixed(4)}
          </div>
        </div>

        {/* Token breakdown */}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-center">
            <p className="mb-1 text-xs text-muted-foreground">Input</p>
            <p className="font-mono text-lg font-semibold text-primary">{inputTokens.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-4 text-center">
            <p className="mb-1 text-xs text-muted-foreground">Output</p>
            <p className="font-mono text-lg font-semibold text-cyan-400">{outputTokens.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-center">
            <p className="mb-1 text-xs text-muted-foreground">Cached</p>
            <p className="font-mono text-lg font-semibold text-amber-400">{cachedTokens.toLocaleString()}</p>
          </div>
        </div>

        {/* Animated pulse line */}
        <div className="mt-6 h-1 overflow-hidden rounded-full bg-border/30">
          <div className="h-full w-1/3 animate-[pulse-line_2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-primary to-transparent" />
        </div>
      </div>
    </div>
  );
}

export function CostTrackingSection() {
  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-background via-primary/[0.02] to-background" />
      
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Content */}
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Real-time tracking
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              Per-request cost tracking.
              <span className="mt-2 block text-muted-foreground">Down to the token.</span>
            </h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Every request logged with input, output, cached, and reasoning tokens. Costs calculated automatically using the latest provider pricing. No estimation, no surprises.
            </p>
          </div>

          {/* Visual */}
          <div className="lg:pl-8">
            <CostTrackingVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// SECTION 2: Budget Enforcement - Animated budget gauge with limit
// ============================================================================
function BudgetGaugeVisual() {
  const [spending, setSpending] = useState(0);
  const [isBlocked, setIsBlocked] = useState(false);
  const budget = 100;
  const percentage = Math.min((spending / budget) * 100, 100);

  useEffect(() => {
    const interval = setInterval(() => {
      setSpending((prev) => {
        const next = prev + Math.random() * 2;
        if (next >= budget) {
          setIsBlocked(true);
          clearInterval(interval);
          return budget;
        }
        return next;
      });
    }, 150);
    return () => clearInterval(interval);
  }, []);

  // Reset animation
  useEffect(() => {
    if (isBlocked) {
      const timeout = setTimeout(() => {
        setSpending(0);
        setIsBlocked(false);
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [isBlocked]);

  return (
    <div className="relative">
      {/* Glow when blocked */}
      {isBlocked && (
        <div className="absolute -inset-4 animate-pulse rounded-2xl bg-destructive/20 blur-2xl" />
      )}
      
      <div className={`relative rounded-xl border bg-card/80 p-8 backdrop-blur-sm transition-colors duration-300 ${isBlocked ? "border-destructive/50" : "border-border/50"}`}>
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Monthly Budget</span>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${isBlocked ? "bg-destructive/20 text-destructive" : "bg-primary/20 text-primary"}`}>
            {isBlocked ? "BLOCKED" : "ACTIVE"}
          </span>
        </div>

        {/* Circular gauge */}
        <div className="relative mx-auto mb-6 h-48 w-48">
          <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100">
            {/* Background circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              className="text-border/30"
            />
            {/* Progress circle */}
            <circle
              cx="50"
              cy="50"
              r="40"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${percentage * 2.51} 251`}
              className={`transition-all duration-300 ${isBlocked ? "text-destructive" : percentage > 80 ? "text-amber-500" : "text-primary"}`}
            />
          </svg>
          {/* Center text */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-3xl font-bold">${spending.toFixed(0)}</span>
            <span className="text-sm text-muted-foreground">/ ${budget}</span>
          </div>
        </div>

        {/* Status message */}
        {isBlocked && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center">
            <p className="text-sm font-medium text-destructive">429 — Budget exceeded</p>
            <p className="mt-1 text-xs text-destructive/70">Request blocked before reaching provider</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function BudgetEnforcementSection() {
  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-destructive/[0.02] to-background" />
      
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Visual - Left on this one */}
          <div className="order-2 lg:order-1 lg:pr-8">
            <BudgetGaugeVisual />
          </div>

          {/* Content */}
          <div className="order-1 lg:order-2">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Hard limits
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              Budget enforcement.
              <span className="mt-2 block text-muted-foreground">Before the request leaves.</span>
            </h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Set hard spending ceilings per key, team, or project. The proxy returns 429 before the request ever reaches OpenAI or Anthropic. No overages, no surprises, no arguments with finance.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// SECTION 3: Velocity Limits - Oscilloscope-style visualization
// ============================================================================
function VelocityChartVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [triggered, setTriggered] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let time = 0;
    let spikeActive = false;
    let spikeStart = 0;
    const threshold = 0.6;

    const draw = () => {
      time += 0.03;
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      // Fade effect for trailing glow
      ctx.fillStyle = "rgba(0, 0, 0, 0.15)";
      ctx.fillRect(0, 0, width, height);

      // Draw grid lines (oscilloscope style)
      ctx.strokeStyle = "rgba(16, 185, 129, 0.1)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const y = (height / 5) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const x = (width / 8) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Trigger spike periodically
      if (Math.floor(time) % 8 === 5 && !spikeActive) {
        spikeActive = true;
        spikeStart = time;
        setTriggered(true);
        setTimeout(() => setTriggered(false), 2000);
      }
      if (spikeActive && time - spikeStart > 2) {
        spikeActive = false;
      }

      // Draw threshold line
      const thresholdY = centerY - threshold * (height / 2);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
      ctx.setLineDash([8, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, thresholdY);
      ctx.lineTo(width, thresholdY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw the oscilloscope waveform
      const baseColor = spikeActive ? "#ef4444" : "#10b981";
      
      // Glow layer
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const progress = x / width;
        const localTime = time - progress * 2;
        
        // Complex waveform with multiple frequencies
        let amplitude = 0.25;
        if (spikeActive) {
          const spikeDist = Math.abs(progress - 0.5);
          amplitude = 0.25 + Math.exp(-spikeDist * 8) * 0.6;
        }
        
        const wave = 
          Math.sin(localTime * 4) * amplitude +
          Math.sin(localTime * 7.3) * (amplitude * 0.4) +
          Math.sin(localTime * 12.7) * (amplitude * 0.2) +
          (Math.random() - 0.5) * 0.03;
        
        const y = centerY - wave * (height / 2);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Main line
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 2;
      ctx.shadowColor = baseColor;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      for (let x = 0; x < width; x++) {
        const progress = x / width;
        const localTime = time - progress * 2;
        
        let amplitude = 0.25;
        if (spikeActive) {
          const spikeDist = Math.abs(progress - 0.5);
          amplitude = 0.25 + Math.exp(-spikeDist * 8) * 0.6;
        }
        
        const wave = 
          Math.sin(localTime * 4) * amplitude +
          Math.sin(localTime * 7.3) * (amplitude * 0.4) +
          Math.sin(localTime * 12.7) * (amplitude * 0.2) +
          (Math.random() - 0.5) * 0.03;
        
        const y = centerY - wave * (height / 2);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Draw scan line (moving vertical line)
      const scanX = ((time * 50) % width);
      ctx.strokeStyle = "rgba(16, 185, 129, 0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(scanX, 0);
      ctx.lineTo(scanX, height);
      ctx.stroke();

      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, []);

  return (
    <div className="relative">
      {triggered && (
        <div className="absolute -inset-4 animate-pulse rounded-2xl bg-destructive/20 blur-2xl" />
      )}
      
      <div className={`relative overflow-hidden rounded-xl border bg-black/90 backdrop-blur-sm transition-colors duration-300 ${triggered ? "border-destructive/50" : "border-primary/30"}`}>
        {/* Header - Oscilloscope style */}
        <div className="flex items-center justify-between border-b border-primary/20 bg-black/50 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className={`h-2 w-2 rounded-full ${triggered ? "animate-pulse bg-destructive" : "bg-primary"}`} />
            <span className="font-mono text-sm font-medium text-primary/80">VELOCITY MONITOR</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="font-mono text-xs text-muted-foreground">THRESH: 60%</span>
            <span className={`font-mono text-xs ${triggered ? "text-destructive" : "text-primary"}`}>
              {triggered ? "ALERT" : "NOMINAL"}
            </span>
          </div>
        </div>

        {/* Oscilloscope display */}
        <div className="p-2">
          <canvas
            ref={canvasRef}
            width={500}
            height={220}
            className="h-[220px] w-full rounded bg-black"
          />
        </div>

        {/* Status bar */}
        <div className={`flex items-center justify-between px-4 py-2 text-xs ${triggered ? "bg-destructive/20" : "bg-primary/5"}`}>
          <span className="font-mono text-muted-foreground">$/min spend rate</span>
          {triggered ? (
            <span className="flex items-center gap-2 font-mono text-destructive">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-destructive" />
              CIRCUIT BREAKER ENGAGED
            </span>
          ) : (
            <span className="font-mono text-primary/60">Monitoring active</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function VelocityLimitsSection() {
  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-cyan-500/[0.02] to-background" />
      
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Content */}
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-400">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-500" />
              Auto-protection
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              Detect runaway loops.
              <span className="mt-2 block text-muted-foreground">Auto-circuit-breaker.</span>
            </h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Set velocity thresholds for $/minute spend rates. When an agent goes haywire, NullSpend automatically trips the circuit breaker before your bill does.
            </p>
          </div>

          {/* Visual */}
          <div className="lg:pl-8">
            <VelocityChartVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// SECTION 4: Tags & Attribution - Visual tag assignment
// ============================================================================
function TagsVisual() {
  const tags = [
    { name: "production", color: "bg-primary text-primary-foreground" },
    { name: "staging", color: "bg-amber-500 text-amber-950" },
    { name: "team:ml", color: "bg-cyan-500 text-cyan-950" },
    { name: "feature:search", color: "bg-violet-500 text-violet-950" },
  ];

  const [activeRequests, setActiveRequests] = useState<Array<{ id: number; tag: typeof tags[0]; x: number }>>([]);
  const [idCounter, setIdCounter] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const tag = tags[Math.floor(Math.random() * tags.length)];
      setActiveRequests((prev) => [
        ...prev.slice(-5),
        { id: idCounter, tag, x: 0 },
      ]);
      setIdCounter((prev) => prev + 1);
    }, 800);
    return () => clearInterval(interval);
  }, [idCounter]);

  return (
    <div className="relative">
      <div className="absolute -inset-4 rounded-2xl bg-gradient-to-r from-violet-500/10 via-cyan-500/10 to-primary/10 blur-2xl" />
      
      <div className="relative rounded-xl border border-border/50 bg-card/80 p-6 backdrop-blur-sm">
        {/* Header */}
        <div className="mb-6 flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">X-NullSpend-Tags:</span>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <span key={tag.name} className={`rounded-full px-2 py-0.5 text-xs font-medium ${tag.color}`}>
                {tag.name}
              </span>
            ))}
          </div>
        </div>

        {/* Animated requests flow */}
        <div className="space-y-2">
          {activeRequests.map((req) => (
            <div
              key={req.id}
              className="flex animate-[slide-in_0.5s_ease-out] items-center gap-3 rounded-lg border border-border/30 bg-background/50 p-3"
            >
              <span className="font-mono text-xs text-muted-foreground">POST /v1/chat/completions</span>
              <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${req.tag.color}`}>
                {req.tag.name}
              </span>
            </div>
          ))}
        </div>

        {/* Cost breakdown by tag */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          {tags.map((tag) => (
            <div key={tag.name} className="rounded-lg border border-border/30 bg-background/30 p-3">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${tag.color.split(" ")[0]}`} />
                <span className="text-xs text-muted-foreground">{tag.name}</span>
              </div>
              <p className="mt-1 font-mono text-sm font-semibold">
                ${(Math.random() * 100 + 10).toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TagsAttributionSection() {
  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-violet-500/[0.02] to-background" />
      
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Visual - Left */}
          <div className="order-2 lg:order-1 lg:pr-8">
            <TagsVisual />
          </div>

          {/* Content */}
          <div className="order-1 lg:order-2">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-400">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
              Attribution
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              Tag everything.
              <span className="mt-2 block text-muted-foreground">Attribute costs anywhere.</span>
            </h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Add a single header to attribute costs to teams, environments, or features. Set default tags on API keys. Finally know where your AI spend is going.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// SECTION 5: Webhooks - Animated event stream
// ============================================================================
function WebhooksVisual() {
  const events = [
    { type: "request.completed", icon: "check", color: "text-primary" },
    { type: "budget.warning", icon: "alert", color: "text-amber-500" },
    { type: "budget.exceeded", icon: "block", color: "text-destructive" },
    { type: "velocity.spike", icon: "trending", color: "text-cyan-400" },
    { type: "approval.requested", icon: "clock", color: "text-violet-400" },
  ];

  const [eventStream, setEventStream] = useState<Array<{ id: number; event: typeof events[0]; timestamp: string }>>([]);
  const [idCounter, setIdCounter] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const event = events[Math.floor(Math.random() * events.length)];
      const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
      setEventStream((prev) => [
        { id: idCounter, event, timestamp },
        ...prev.slice(0, 4),
      ]);
      setIdCounter((prev) => prev + 1);
    }, 1200);
    return () => clearInterval(interval);
  }, [idCounter]);

  return (
    <div className="relative">
      <div className="absolute -inset-4 rounded-2xl bg-gradient-to-b from-primary/10 to-transparent blur-2xl" />
      
      <div className="relative overflow-hidden rounded-xl border border-border/50 bg-card/80 backdrop-blur-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 bg-background/50 p-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
            <span className="text-sm font-medium">Webhook Events</span>
          </div>
          <span className="rounded bg-primary/20 px-2 py-0.5 font-mono text-xs text-primary">LIVE</span>
        </div>

        {/* Event stream */}
        <div className="p-4">
          <div className="space-y-2 font-mono text-xs">
            {eventStream.map((item) => (
              <div
                key={item.id}
                className="flex animate-[fade-in_0.3s_ease-out] items-center gap-3 rounded border border-border/30 bg-background/50 p-2"
              >
                <span className="text-muted-foreground">{item.timestamp}</span>
                <span className={item.event.color}>{item.event.type}</span>
                <span className="ml-auto text-muted-foreground/50">HMAC-SHA256</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-px border-t border-border/50 bg-border/50">
          <div className="bg-card/80 p-3 text-center">
            <p className="text-lg font-semibold">15</p>
            <p className="text-xs text-muted-foreground">Event types</p>
          </div>
          <div className="bg-card/80 p-3 text-center">
            <p className="text-lg font-semibold">99.9%</p>
            <p className="text-xs text-muted-foreground">Delivery</p>
          </div>
          <div className="bg-card/80 p-3 text-center">
            <p className="text-lg font-semibold">&lt;50ms</p>
            <p className="text-xs text-muted-foreground">Latency</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WebhooksSection() {
  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-primary/[0.02] to-background" />
      
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Content */}
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Real-time events
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              15 event types.
              <span className="mt-2 block text-muted-foreground">HMAC-SHA256 signed.</span>
            </h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Cost events, budget warnings, velocity alerts, threshold crossings, approval requests. Signed webhooks delivered in under 50ms. Build the integrations you need.
            </p>
          </div>

          {/* Visual */}
          <div className="lg:pl-8">
            <WebhooksVisual />
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// SECTION 6: Human-in-the-Loop - Approval workflow animation
// ============================================================================
function ApprovalVisual() {
  const [stage, setStage] = useState<"waiting" | "approved" | "denied">("waiting");
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setStage(Math.random() > 0.3 ? "approved" : "denied");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (stage !== "waiting") {
      const timeout = setTimeout(() => {
        setStage("waiting");
        setCountdown(10);
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [stage]);

  return (
    <div className="relative">
      <div className={`absolute -inset-4 rounded-2xl blur-2xl transition-colors duration-500 ${
        stage === "approved" ? "bg-primary/20" : 
        stage === "denied" ? "bg-destructive/20" : 
        "bg-amber-500/10"
      }`} />
      
      <div className="relative rounded-xl border border-border/50 bg-card/80 p-6 backdrop-blur-sm">
        {/* Request details */}
        <div className="mb-6 rounded-lg border border-border/30 bg-background/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Estimated Cost</span>
            <span className="font-mono text-lg font-bold text-amber-400">$24.50</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Model</span>
            <span className="font-mono text-sm">gpt-5.4</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Tokens</span>
            <span className="font-mono text-sm">~128,000</span>
          </div>
        </div>

        {/* Status */}
        <div className={`mb-6 rounded-lg p-4 text-center transition-colors duration-300 ${
          stage === "approved" ? "border border-primary/30 bg-primary/10" :
          stage === "denied" ? "border border-destructive/30 bg-destructive/10" :
          "border border-amber-500/30 bg-amber-500/10"
        }`}>
          {stage === "waiting" ? (
            <>
              <div className="mb-2 flex items-center justify-center gap-2">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
                <span className="font-medium text-amber-400">Awaiting Approval</span>
              </div>
              <p className="text-sm text-muted-foreground">Agent paused. Human decision required.</p>
              <p className="mt-2 font-mono text-2xl font-bold">{countdown}s</p>
            </>
          ) : stage === "approved" ? (
            <>
              <span className="text-lg font-medium text-primary">Approved</span>
              <p className="mt-1 text-sm text-muted-foreground">Request proceeding to provider</p>
            </>
          ) : (
            <>
              <span className="text-lg font-medium text-destructive">Denied</span>
              <p className="mt-1 text-sm text-muted-foreground">Agent notified of rejection</p>
            </>
          )}
        </div>

        {/* Action buttons (decorative) */}
        <div className="flex gap-3">
          <button
            onClick={() => setStage("approved")}
            className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Approve
          </button>
          <button
            onClick={() => setStage("denied")}
            className="flex-1 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}

export function HumanInLoopSection() {
  return (
    <section className="relative overflow-hidden py-24 md:py-32">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-amber-500/[0.02] to-background" />
      
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
          {/* Visual - Left */}
          <div className="order-2 lg:order-1 lg:pr-8">
            <ApprovalVisual />
          </div>

          {/* Content */}
          <div className="order-1 lg:order-2">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Human control
            </div>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              Agents wait.
              <span className="mt-2 block text-muted-foreground">Humans decide.</span>
            </h2>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-muted-foreground">
              Approval workflows for high-cost or sensitive operations. Set cost thresholds, require sign-off for certain models, or flag specific prompt patterns. The agent pauses until a human approves.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// Combined export for all sections
// ============================================================================
export function FeatureSections() {
  return (
    <>
      <CostTrackingSection />
      <BudgetEnforcementSection />
      <VelocityLimitsSection />
      <TagsAttributionSection />
      <WebhooksSection />
      <HumanInLoopSection />
    </>
  );
}
