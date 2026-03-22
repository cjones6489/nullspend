"use client";

import { useEffect, useRef, useState } from "react";

// ============================================================================
// SECTION 1: Cost Tracking - Streaming cost ticker with live API calls
// ============================================================================
function CostTrackingVisual() {
  const [calls, setCalls] = useState<Array<{
    id: number;
    model: string;
    tokens: number;
    cost: number;
    status: "streaming" | "complete";
  }>>([]);
  const [totalCost, setTotalCost] = useState(0);
  const idRef = useRef(0);

  const models = [
    { name: "gpt-5.4", costPer1k: 0.03 },
    { name: "claude-opus-4.6", costPer1k: 0.075 },
    { name: "gpt-5.4-mini", costPer1k: 0.0015 },
    { name: "claude-sonnet-4.6", costPer1k: 0.015 },
  ];

  useEffect(() => {
    const addCall = () => {
      const model = models[Math.floor(Math.random() * models.length)];
      const tokens = Math.floor(Math.random() * 2000) + 500;
      const cost = (tokens / 1000) * model.costPer1k;
      const id = idRef.current++;

      setCalls(prev => [...prev.slice(-4), { id, model: model.name, tokens, cost, status: "streaming" }]);

      setTimeout(() => {
        setCalls(prev => prev.map(c => c.id === id ? { ...c, status: "complete" } : c));
        setTotalCost(prev => prev + cost);
      }, 800 + Math.random() * 400);
    };

    addCall();
    const interval = setInterval(addCall, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative h-[400px] w-full">
      {/* Glowing backdrop */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/10 via-transparent to-cyan-500/10" />
      
      {/* Main container */}
      <div className="relative h-full rounded-2xl border border-border/40 bg-card/50 backdrop-blur-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
            <span className="font-mono text-sm text-muted-foreground">Live Cost Stream</span>
          </div>
          <div className="font-mono text-2xl font-bold text-foreground">
            ${totalCost.toFixed(4)}
          </div>
        </div>

        {/* Streaming calls */}
        <div className="p-4 space-y-3">
          {calls.map((call, i) => (
            <div
              key={call.id}
              className="flex items-center justify-between rounded-lg border border-border/30 bg-background/50 px-4 py-3 transition-all duration-300"
              style={{
                opacity: call.status === "streaming" ? 0.7 : 1,
                transform: `translateX(${call.status === "streaming" ? "10px" : "0"})`,
              }}
            >
              <div className="flex items-center gap-4">
                <div className={`h-2 w-2 rounded-full ${call.status === "streaming" ? "bg-amber-500 animate-pulse" : "bg-primary"}`} />
                <span className="font-mono text-sm text-foreground">{call.model}</span>
              </div>
              <div className="flex items-center gap-6">
                <span className="font-mono text-xs text-muted-foreground">{call.tokens.toLocaleString()} tokens</span>
                <span className={`font-mono text-sm font-medium ${call.status === "streaming" ? "text-amber-500" : "text-primary"}`}>
                  ${call.cost.toFixed(4)}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom gradient fade */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-card to-transparent pointer-events-none" />
      </div>
    </div>
  );
}

export function CostTrackingSection() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-transparent to-transparent" />
      
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary mb-6">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Real-time tracking
            </div>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Every token.
              <span className="block text-muted-foreground">Every cent.</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground max-w-md">
              Watch costs stream in real-time as your agents work. Input, output, cached, and reasoning tokens - all tracked automatically with latest provider pricing.
            </p>
          </div>
          <CostTrackingVisual />
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// SECTION 2: Budget Enforcement - Animated shield with blocking
// ============================================================================
function BudgetShieldVisual() {
  const [spending, setSpending] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [requests, setRequests] = useState<Array<{ id: number; blocked: boolean; y: number }>>([]);
  const budget = 100;
  const idRef = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      if (blocked) return;
      
      const newSpend = Math.random() * 8;
      setSpending(prev => {
        const next = prev + newSpend;
        if (next >= budget) {
          setBlocked(true);
          return budget;
        }
        return next;
      });

      // Add request particle
      const id = idRef.current++;
      setRequests(prev => [...prev, { id, blocked: false, y: Math.random() * 80 + 10 }]);
      setTimeout(() => {
        setRequests(prev => prev.filter(r => r.id !== id));
      }, 1000);
    }, 300);

    return () => clearInterval(interval);
  }, [blocked]);

  // Reset after blocked
  useEffect(() => {
    if (blocked) {
      // Show blocked requests
      const blockInterval = setInterval(() => {
        const id = idRef.current++;
        setRequests(prev => [...prev, { id, blocked: true, y: Math.random() * 80 + 10 }]);
        setTimeout(() => {
          setRequests(prev => prev.filter(r => r.id !== id));
        }, 600);
      }, 200);

      const timeout = setTimeout(() => {
        clearInterval(blockInterval);
        setBlocked(false);
        setSpending(0);
      }, 3000);

      return () => {
        clearInterval(blockInterval);
        clearTimeout(timeout);
      };
    }
  }, [blocked]);

  const percentage = (spending / budget) * 100;

  return (
    <div className="relative h-[400px] w-full">
      {/* Shield glow */}
      <div className={`absolute inset-0 rounded-2xl blur-3xl transition-colors duration-500 ${blocked ? "bg-destructive/20" : "bg-primary/10"}`} />
      
      <div className={`relative h-full rounded-2xl border backdrop-blur-xl overflow-hidden transition-colors duration-300 ${blocked ? "border-destructive/50 bg-destructive/5" : "border-border/40 bg-card/50"}`}>
        {/* Animated requests */}
        <div className="absolute inset-0 overflow-hidden">
          {requests.map(req => (
            <div
              key={req.id}
              className={`absolute left-0 h-1 rounded-full transition-all duration-500 ${req.blocked ? "bg-destructive" : "bg-primary"}`}
              style={{
                top: `${req.y}%`,
                width: req.blocked ? "45%" : "100%",
                opacity: req.blocked ? 0.8 : 0.4,
                animation: req.blocked ? "none" : "requestFlow 1s linear forwards",
              }}
            />
          ))}
        </div>

        {/* Shield line */}
        <div className={`absolute left-1/2 top-0 bottom-0 w-1 transition-colors duration-300 ${blocked ? "bg-destructive shadow-[0_0_20px_rgba(239,68,68,0.5)]" : "bg-border/30"}`} />

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className={`text-7xl font-bold font-mono transition-colors duration-300 ${blocked ? "text-destructive" : "text-foreground"}`}>
            ${Math.floor(spending)}
          </div>
          <div className="text-muted-foreground mt-2">/ ${budget} budget</div>
          
          {/* Progress bar */}
          <div className="w-48 h-2 rounded-full bg-border/30 mt-6 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${percentage > 80 ? "bg-destructive" : percentage > 50 ? "bg-amber-500" : "bg-primary"}`}
              style={{ width: `${percentage}%` }}
            />
          </div>

          {blocked && (
            <div className="mt-6 px-4 py-2 rounded-lg bg-destructive/20 border border-destructive/30">
              <span className="font-mono text-sm text-destructive font-medium">429 - BUDGET EXCEEDED</span>
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes requestFlow {
          from { transform: translateX(-100%); opacity: 0; }
          to { transform: translateX(0); opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

export function BudgetEnforcementSection() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,_var(--tw-gradient-stops))] from-amber-500/5 via-transparent to-transparent" />
      
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <BudgetShieldVisual />
          </div>
          <div className="order-1 lg:order-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-sm font-medium text-amber-500 mb-6">
              Hard limits
            </div>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Budget walls.
              <span className="block text-muted-foreground">Not suggestions.</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground max-w-md">
              Set hard spending limits per key, team, or project. Requests are blocked at the proxy before they ever reach OpenAI or Anthropic. Zero overages guaranteed.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// SECTION 3: Velocity Limits - EKG-style heartbeat monitor
// ============================================================================
function VelocityMonitorVisual() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [alert, setAlert] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let offset = 0;
    let spikeCountdown = 0;
    let inSpike = false;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;

      // Clear with dark background
      ctx.fillStyle = "#030712";
      ctx.fillRect(0, 0, width, height);

      // Draw subtle grid
      ctx.strokeStyle = "rgba(16, 185, 129, 0.06)";
      ctx.lineWidth = 1;
      for (let i = 0; i < width; i += 40) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, height);
        ctx.stroke();
      }
      for (let i = 0; i < height; i += 40) {
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(width, i);
        ctx.stroke();
      }

      // Danger zone
      const dangerY = height * 0.25;
      ctx.fillStyle = "rgba(239, 68, 68, 0.05)";
      ctx.fillRect(0, 0, width, dangerY);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.3)";
      ctx.setLineDash([8, 8]);
      ctx.beginPath();
      ctx.moveTo(0, dangerY);
      ctx.lineTo(width, dangerY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Generate EKG-style line
      ctx.beginPath();
      const baseY = height * 0.65;

      for (let x = 0; x < width; x++) {
        const t = (x + offset) * 0.02;
        let y = baseY;

        // Normal small variations
        y += Math.sin(t * 3) * 5;
        y += Math.sin(t * 7) * 3;

        // Periodic heartbeat spikes
        const beatPhase = (t % 4);
        if (beatPhase < 0.3) {
          // Sharp spike up
          const spikeProgress = beatPhase / 0.3;
          const spikeHeight = inSpike ? height * 0.5 : height * 0.2;
          y -= Math.sin(spikeProgress * Math.PI) * spikeHeight;
        } else if (beatPhase < 0.5) {
          // Small dip down
          const dipProgress = (beatPhase - 0.3) / 0.2;
          y += Math.sin(dipProgress * Math.PI) * 15;
        }

        if (x === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        // Check if we're hitting danger zone
        if (y < dangerY && !alert && inSpike) {
          setAlert(true);
          setTimeout(() => setAlert(false), 2000);
        }
      }

      // Glow effect
      ctx.strokeStyle = "rgba(16, 185, 129, 0.15)";
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.strokeStyle = "rgba(16, 185, 129, 0.3)";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = alert ? "#ef4444" : "#10b981";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Scanline effect
      const scanX = (offset * 2) % width;
      const gradient = ctx.createLinearGradient(scanX - 100, 0, scanX, 0);
      gradient.addColorStop(0, "transparent");
      gradient.addColorStop(1, "rgba(16, 185, 129, 0.1)");
      ctx.fillStyle = gradient;
      ctx.fillRect(scanX - 100, 0, 100, height);

      offset += 2;

      // Randomly trigger spike mode
      if (!inSpike && Math.random() < 0.003) {
        inSpike = true;
        spikeCountdown = 150;
      }
      if (inSpike) {
        spikeCountdown--;
        if (spikeCountdown <= 0) {
          inSpike = false;
        }
      }

      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [alert]);

  return (
    <div className="relative h-[400px] w-full">
      <div className={`absolute inset-0 rounded-2xl blur-3xl transition-colors duration-500 ${alert ? "bg-destructive/20" : "bg-cyan-500/10"}`} />
      
      <div className={`relative h-full rounded-2xl border backdrop-blur-xl overflow-hidden transition-colors duration-300 ${alert ? "border-destructive/50" : "border-border/40"} bg-[#030712]`}>
        {/* Header */}
        <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${alert ? "bg-destructive animate-pulse" : "bg-cyan-500"}`} />
            <span className="font-mono text-sm text-cyan-500">$/min VELOCITY</span>
          </div>
          {alert && (
            <div className="px-3 py-1 rounded bg-destructive/20 border border-destructive/30">
              <span className="font-mono text-xs text-destructive font-medium">RUNAWAY DETECTED</span>
            </div>
          )}
        </div>

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          width={600}
          height={400}
          className="w-full h-full"
        />

        {/* Stats overlay */}
        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
          <span className="font-mono text-xs text-muted-foreground">Threshold: $5.00/min</span>
          <span className={`font-mono text-xs ${alert ? "text-destructive" : "text-cyan-500"}`}>
            {alert ? "Circuit breaker active" : "Monitoring"}
          </span>
        </div>
      </div>
    </div>
  );
}

export function VelocityLimitsSection() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-cyan-500/5 via-transparent to-transparent" />
      
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-sm font-medium text-cyan-500 mb-6">
              Auto-protection
            </div>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Catch runaways.
              <span className="block text-muted-foreground">Instantly.</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground max-w-md">
              Set velocity thresholds on $/minute spend rates. When an agent enters an infinite loop, the circuit breaker trips before your bill explodes.
            </p>
          </div>
          <VelocityMonitorVisual />
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// SECTION 4: Tags & Attribution - Visual flow diagram
// ============================================================================
function TagsFlowVisual() {
  const [activeTag, setActiveTag] = useState(0);
  const tags = [
    { name: "production", color: "bg-primary", borderColor: "border-primary/50" },
    { name: "team:ml", color: "bg-violet-500", borderColor: "border-violet-500/50" },
    { name: "feature:chat", color: "bg-cyan-500", borderColor: "border-cyan-500/50" },
    { name: "cost-center:eng", color: "bg-amber-500", borderColor: "border-amber-500/50" },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveTag(prev => (prev + 1) % tags.length);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative h-[400px] w-full">
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500/10 via-transparent to-primary/10" />
      
      <div className="relative h-full rounded-2xl border border-border/40 bg-card/50 backdrop-blur-xl overflow-hidden p-8">
        {/* Flow visualization */}
        <div className="flex flex-col items-center justify-center h-full gap-8">
          {/* Request */}
          <div className="flex items-center gap-4">
            <div className="px-4 py-3 rounded-lg border border-border/50 bg-background/50">
              <span className="font-mono text-sm text-foreground">API Request</span>
            </div>
            <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>

          {/* Tags being applied */}
          <div className="flex flex-wrap justify-center gap-3">
            {tags.map((tag, i) => (
              <div
                key={tag.name}
                className={`px-4 py-2 rounded-full border transition-all duration-500 ${tag.borderColor} ${i === activeTag ? `${tag.color} text-white scale-110` : "bg-background/50 text-muted-foreground"}`}
              >
                <span className="font-mono text-sm">{tag.name}</span>
              </div>
            ))}
          </div>

          {/* Arrow down */}
          <svg className="w-8 h-8 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>

          {/* Attribution result */}
          <div className="px-6 py-4 rounded-xl border border-primary/30 bg-primary/5">
            <div className="text-center">
              <div className="text-sm text-muted-foreground mb-1">Attributed to</div>
              <div className="font-mono text-lg text-foreground font-medium">
                {tags[activeTag].name}
              </div>
              <div className="text-primary font-mono text-2xl font-bold mt-2">
                $0.0847
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TagsAttributionSection() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-violet-500/5 via-transparent to-transparent" />
      
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <TagsFlowVisual />
          </div>
          <div className="order-1 lg:order-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-4 py-1.5 text-sm font-medium text-violet-500 mb-6">
              Cost allocation
            </div>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Tag everything.
              <span className="block text-muted-foreground">Bill anyone.</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground max-w-md">
              Attach custom metadata to every request. Filter costs by team, feature, environment, or customer. Finally know exactly where your AI budget goes.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// SECTION 5: Webhooks - Event stream visualization
// ============================================================================
function WebhooksStreamVisual() {
  const [events, setEvents] = useState<Array<{
    id: number;
    type: string;
    status: "pending" | "sent" | "delivered";
  }>>([]);
  const idRef = useRef(0);

  const eventTypes = [
    "budget.warning",
    "budget.exceeded",
    "velocity.alert",
    "spend.threshold",
    "request.blocked",
  ];

  useEffect(() => {
    const addEvent = () => {
      const id = idRef.current++;
      const type = eventTypes[Math.floor(Math.random() * eventTypes.length)];
      
      setEvents(prev => [...prev.slice(-5), { id, type, status: "pending" }]);

      setTimeout(() => {
        setEvents(prev => prev.map(e => e.id === id ? { ...e, status: "sent" } : e));
      }, 300);

      setTimeout(() => {
        setEvents(prev => prev.map(e => e.id === id ? { ...e, status: "delivered" } : e));
      }, 800);
    };

    addEvent();
    const interval = setInterval(addEvent, 1800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative h-[400px] w-full">
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-orange-500/10 via-transparent to-pink-500/10" />
      
      <div className="relative h-full rounded-2xl border border-border/40 bg-card/50 backdrop-blur-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/40 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="h-3 w-3 rounded-full bg-orange-500 animate-pulse" />
            <span className="font-mono text-sm text-muted-foreground">Webhook Events</span>
          </div>
          <span className="font-mono text-xs text-muted-foreground">https://your-app.com/webhooks</span>
        </div>

        {/* Events stream */}
        <div className="p-4 space-y-2">
          {events.map(event => (
            <div
              key={event.id}
              className="flex items-center justify-between rounded-lg border border-border/30 bg-background/50 px-4 py-3 transition-all duration-300"
            >
              <div className="flex items-center gap-4">
                <div className={`h-2 w-2 rounded-full transition-colors duration-300 ${
                  event.status === "pending" ? "bg-amber-500" :
                  event.status === "sent" ? "bg-cyan-500" : "bg-primary"
                }`} />
                <code className="text-sm text-orange-400">{event.type}</code>
              </div>
              <div className="flex items-center gap-2">
                {event.status === "delivered" && (
                  <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span className={`font-mono text-xs ${
                  event.status === "pending" ? "text-amber-500" :
                  event.status === "sent" ? "text-cyan-500" : "text-primary"
                }`}>
                  {event.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Connection lines animation */}
        <div className="absolute right-8 top-1/2 -translate-y-1/2 flex flex-col gap-2">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-16 h-0.5 bg-gradient-to-r from-orange-500/50 to-transparent animate-pulse"
              style={{ animationDelay: `${i * 200}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function WebhooksSection() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,_var(--tw-gradient-stops))] from-orange-500/5 via-transparent to-transparent" />
      
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/30 bg-orange-500/10 px-4 py-1.5 text-sm font-medium text-orange-500 mb-6">
              Integrations
            </div>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Real-time webhooks.
              <span className="block text-muted-foreground">Instant alerts.</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground max-w-md">
              Push events to Slack, PagerDuty, or your own endpoints. Get notified the moment spend anomalies occur - not at the end of the month.
            </p>
          </div>
          <WebhooksStreamVisual />
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// SECTION 6: Human in the Loop - Approval flow
// ============================================================================
function ApprovalFlowVisual() {
  const [stage, setStage] = useState<"request" | "pending" | "approved" | "executing">("request");

  useEffect(() => {
    const cycle = () => {
      setStage("request");
      setTimeout(() => setStage("pending"), 1000);
      setTimeout(() => setStage("approved"), 3000);
      setTimeout(() => setStage("executing"), 4000);
    };

    cycle();
    const interval = setInterval(cycle, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative h-[400px] w-full">
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-pink-500/10 via-transparent to-primary/10" />
      
      <div className="relative h-full rounded-2xl border border-border/40 bg-card/50 backdrop-blur-xl overflow-hidden p-8">
        <div className="flex flex-col items-center justify-center h-full gap-6">
          {/* Request card */}
          <div className={`w-full max-w-sm p-6 rounded-xl border transition-all duration-500 ${
            stage === "request" ? "border-pink-500/50 bg-pink-500/10 scale-105" : "border-border/30 bg-background/30"
          }`}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-mono text-sm text-muted-foreground">Expensive Request</span>
              <span className="font-mono text-lg text-pink-500 font-bold">$47.00</span>
            </div>
            <div className="text-xs text-muted-foreground font-mono">
              gpt-5.4 • 150k tokens • batch analysis
            </div>
          </div>

          {/* Flow indicator */}
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full transition-colors duration-300 ${stage !== "request" ? "bg-primary" : "bg-border"}`} />
            <div className={`w-12 h-0.5 transition-colors duration-300 ${stage === "pending" || stage === "approved" || stage === "executing" ? "bg-primary" : "bg-border"}`} />
            <div className={`w-3 h-3 rounded-full transition-colors duration-300 ${stage === "approved" || stage === "executing" ? "bg-primary" : "bg-border"}`} />
            <div className={`w-12 h-0.5 transition-colors duration-300 ${stage === "executing" ? "bg-primary" : "bg-border"}`} />
            <div className={`w-3 h-3 rounded-full transition-colors duration-300 ${stage === "executing" ? "bg-primary" : "bg-border"}`} />
          </div>

          {/* Status */}
          <div className={`px-6 py-3 rounded-xl border transition-all duration-500 ${
            stage === "pending" ? "border-amber-500/50 bg-amber-500/10" :
            stage === "approved" ? "border-primary/50 bg-primary/10" :
            stage === "executing" ? "border-cyan-500/50 bg-cyan-500/10" :
            "border-border/30 bg-background/30"
          }`}>
            <span className={`font-mono text-sm font-medium ${
              stage === "pending" ? "text-amber-500" :
              stage === "approved" ? "text-primary" :
              stage === "executing" ? "text-cyan-500" :
              "text-muted-foreground"
            }`}>
              {stage === "request" && "Intercepting..."}
              {stage === "pending" && "Awaiting approval..."}
              {stage === "approved" && "Approved by @sarah"}
              {stage === "executing" && "Executing request"}
            </span>
          </div>

          {/* Approval buttons (shown during pending) */}
          {stage === "pending" && (
            <div className="flex items-center gap-3 animate-pulse">
              <div className="px-4 py-2 rounded-lg bg-primary/20 border border-primary/30">
                <span className="text-sm text-primary">Approve</span>
              </div>
              <div className="px-4 py-2 rounded-lg bg-destructive/20 border border-destructive/30">
                <span className="text-sm text-destructive">Reject</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function HumanInLoopSection() {
  return (
    <section className="relative py-32 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center_right,_var(--tw-gradient-stops))] from-pink-500/5 via-transparent to-transparent" />
      
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div className="order-2 lg:order-1">
            <ApprovalFlowVisual />
          </div>
          <div className="order-1 lg:order-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-pink-500/30 bg-pink-500/10 px-4 py-1.5 text-sm font-medium text-pink-500 mb-6">
              Approval flows
            </div>
            <h2 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Human in the loop.
              <span className="block text-muted-foreground">When it matters.</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground max-w-md">
              Require approval for requests above a threshold. Agents pause, humans approve via Slack or dashboard, then execution continues. Full control when you need it.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================================
// MAIN EXPORT - All sections combined
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
