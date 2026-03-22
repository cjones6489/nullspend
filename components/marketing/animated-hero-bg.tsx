"use client";

import { useEffect, useRef } from "react";

/**
 * Neon-style animated hero background.
 * Renders a canvas with:
 * - Perspective grid lines that pulse
 * - Flowing aurora gradient that shifts
 * - Floating particles that drift upward
 */
export function AnimatedHeroBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;
    let time = 0;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx!.scale(dpr, dpr);
    }

    resize();
    window.addEventListener("resize", resize);

    // Particle pool
    const particles: { x: number; y: number; speed: number; opacity: number; size: number }[] = [];
    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random(),
        y: Math.random(),
        speed: 0.0002 + Math.random() * 0.0004,
        opacity: 0.1 + Math.random() * 0.3,
        size: 0.5 + Math.random() * 1.5,
      });
    }

    function draw() {
      if (!canvas || !ctx) return;
      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;

      ctx.clearRect(0, 0, w, h);
      time += 1;

      // --- Aurora glow ---
      const auroraY = h * 0.3 + Math.sin(time * 0.008) * 30;
      const gradient = ctx.createRadialGradient(
        w * 0.5, auroraY, 0,
        w * 0.5, auroraY, w * 0.6
      );
      gradient.addColorStop(0, "rgba(52, 211, 153, 0.07)");
      gradient.addColorStop(0.4, "rgba(16, 185, 129, 0.03)");
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // Secondary aurora (shifted)
      const aurora2Y = h * 0.25 + Math.cos(time * 0.006) * 40;
      const gradient2 = ctx.createRadialGradient(
        w * 0.35 + Math.sin(time * 0.005) * 50, aurora2Y, 0,
        w * 0.4, aurora2Y, w * 0.4
      );
      gradient2.addColorStop(0, "rgba(16, 185, 129, 0.05)");
      gradient2.addColorStop(0.5, "rgba(52, 211, 153, 0.02)");
      gradient2.addColorStop(1, "transparent");
      ctx.fillStyle = gradient2;
      ctx.fillRect(0, 0, w, h);

      // --- Perspective grid ---
      const gridLines = 12;
      const vanishY = h * 0.15;
      const vanishX = w * 0.5;
      const baseY = h;

      ctx.strokeStyle = "rgba(52, 211, 153, 0.04)";
      ctx.lineWidth = 0.5;

      // Vertical converging lines
      for (let i = 0; i <= gridLines; i++) {
        const t = i / gridLines;
        const baseX = t * w;
        const pulse = 0.03 + Math.sin(time * 0.01 + i * 0.5) * 0.015;
        ctx.globalAlpha = pulse / 0.03;
        ctx.beginPath();
        ctx.moveTo(baseX, baseY);
        ctx.lineTo(vanishX + (baseX - vanishX) * 0.1, vanishY);
        ctx.stroke();
      }

      // Horizontal lines (with perspective spacing)
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const y = vanishY + (baseY - vanishY) * (t * t); // quadratic for perspective
        const spread = t;
        const leftX = vanishX - (vanishX * spread);
        const rightX = vanishX + (vanishX * spread);
        const pulse = 0.03 + Math.sin(time * 0.012 + i * 0.8) * 0.015;
        ctx.globalAlpha = pulse / 0.03 * t; // fade near vanishing point
        ctx.beginPath();
        ctx.moveTo(leftX, y);
        ctx.lineTo(rightX, y);
        ctx.stroke();
      }

      ctx.globalAlpha = 1;

      // --- Particles ---
      for (const p of particles) {
        p.y -= p.speed;
        if (p.y < -0.05) {
          p.y = 1.05;
          p.x = Math.random();
        }

        const px = p.x * w;
        const py = p.y * h;
        const flicker = p.opacity * (0.6 + 0.4 * Math.sin(time * 0.02 + p.x * 20));

        ctx.beginPath();
        ctx.arc(px, py, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(52, 211, 153, ${flicker})`;
        ctx.fill();
      }

      animationId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ opacity: 0.8 }}
    />
  );
}
