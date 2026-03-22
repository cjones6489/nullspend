"use client";

import { useEffect, useRef } from "react";

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pulsePhase: number;
  pulseSpeed: number;
  connections: number[];
}

interface DataPacket {
  fromNode: number;
  toNode: number;
  progress: number;
  speed: number;
  opacity: number;
}

/**
 * Network-style animated hero background for NullSpend.
 * Renders connected nodes with flowing data packets representing
 * financial data being tracked across AI services.
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
    let width = 0;
    let height = 0;

    // Colors from the design system
    const primaryColor = { r: 52, g: 211, b: 153 }; // emerald-400
    const accentColor = { r: 16, g: 185, b: 129 }; // emerald-500

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx!.scale(dpr, dpr);
    }

    resize();
    window.addEventListener("resize", resize);

    // Initialize nodes
    const nodeCount = 18;
    const nodes: Node[] = [];
    
    for (let i = 0; i < nodeCount; i++) {
      nodes.push({
        x: 0.1 + Math.random() * 0.8,
        y: 0.1 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 0.00015,
        vy: (Math.random() - 0.5) * 0.00015,
        radius: 2 + Math.random() * 3,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.02 + Math.random() * 0.02,
        connections: [],
      });
    }

    // Create connections (each node connects to 2-4 nearby nodes)
    for (let i = 0; i < nodes.length; i++) {
      const distances: { index: number; dist: number }[] = [];
      for (let j = 0; j < nodes.length; j++) {
        if (i !== j) {
          const dx = nodes[j].x - nodes[i].x;
          const dy = nodes[j].y - nodes[i].y;
          distances.push({ index: j, dist: Math.sqrt(dx * dx + dy * dy) });
        }
      }
      distances.sort((a, b) => a.dist - b.dist);
      const connectionCount = 2 + Math.floor(Math.random() * 3);
      for (let c = 0; c < connectionCount && c < distances.length; c++) {
        if (!nodes[i].connections.includes(distances[c].index)) {
          nodes[i].connections.push(distances[c].index);
        }
      }
    }

    // Data packets traveling along connections
    const packets: DataPacket[] = [];
    const maxPackets = 12;

    function spawnPacket() {
      if (packets.length >= maxPackets) return;
      const fromNode = Math.floor(Math.random() * nodes.length);
      if (nodes[fromNode].connections.length === 0) return;
      const toNode = nodes[fromNode].connections[
        Math.floor(Math.random() * nodes[fromNode].connections.length)
      ];
      packets.push({
        fromNode,
        toNode,
        progress: 0,
        speed: 0.003 + Math.random() * 0.004,
        opacity: 0.6 + Math.random() * 0.4,
      });
    }

    // Initial packets
    for (let i = 0; i < 6; i++) {
      spawnPacket();
    }

    function draw() {
      if (!canvas || !ctx) return;

      ctx.clearRect(0, 0, width, height);
      time += 1;

      // Spawn new packets occasionally
      if (Math.random() < 0.03) {
        spawnPacket();
      }

      // --- Aurora glow background ---
      const auroraY = height * 0.25 + Math.sin(time * 0.006) * 40;
      const gradient = ctx.createRadialGradient(
        width * 0.5,
        auroraY,
        0,
        width * 0.5,
        auroraY,
        width * 0.7
      );
      gradient.addColorStop(0, `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0.08)`);
      gradient.addColorStop(0.5, `rgba(${accentColor.r}, ${accentColor.g}, ${accentColor.b}, 0.03)`);
      gradient.addColorStop(1, "transparent");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      // Secondary aurora
      const aurora2X = width * 0.3 + Math.sin(time * 0.004) * 60;
      const aurora2Y = height * 0.4 + Math.cos(time * 0.005) * 30;
      const gradient2 = ctx.createRadialGradient(
        aurora2X,
        aurora2Y,
        0,
        aurora2X,
        aurora2Y,
        width * 0.35
      );
      gradient2.addColorStop(0, `rgba(${accentColor.r}, ${accentColor.g}, ${accentColor.b}, 0.05)`);
      gradient2.addColorStop(1, "transparent");
      ctx.fillStyle = gradient2;
      ctx.fillRect(0, 0, width, height);

      // Update node positions (gentle drift)
      for (const node of nodes) {
        node.x += node.vx;
        node.y += node.vy;

        // Bounce off edges
        if (node.x < 0.05 || node.x > 0.95) node.vx *= -1;
        if (node.y < 0.05 || node.y > 0.85) node.vy *= -1;

        // Clamp
        node.x = Math.max(0.05, Math.min(0.95, node.x));
        node.y = Math.max(0.05, Math.min(0.85, node.y));
      }

      // --- Draw connections ---
      ctx.lineCap = "round";
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const x1 = node.x * width;
        const y1 = node.y * height;

        for (const connIndex of node.connections) {
          const other = nodes[connIndex];
          const x2 = other.x * width;
          const y2 = other.y * height;

          const dx = x2 - x1;
          const dy = y2 - y1;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const maxDist = width * 0.4;

          if (dist < maxDist) {
            const alpha = 0.06 * (1 - dist / maxDist);
            ctx.strokeStyle = `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
          }
        }
      }

      // --- Draw data packets ---
      for (let i = packets.length - 1; i >= 0; i--) {
        const packet = packets[i];
        packet.progress += packet.speed;

        if (packet.progress >= 1) {
          packets.splice(i, 1);
          continue;
        }

        const from = nodes[packet.fromNode];
        const to = nodes[packet.toNode];
        const x = (from.x + (to.x - from.x) * packet.progress) * width;
        const y = (from.y + (to.y - from.y) * packet.progress) * height;

        // Packet glow
        const glowGradient = ctx.createRadialGradient(x, y, 0, x, y, 12);
        glowGradient.addColorStop(
          0,
          `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${packet.opacity * 0.4})`
        );
        glowGradient.addColorStop(1, "transparent");
        ctx.fillStyle = glowGradient;
        ctx.fillRect(x - 12, y - 12, 24, 24);

        // Packet core
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${packet.opacity})`;
        ctx.fill();
      }

      // --- Draw nodes ---
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const x = node.x * width;
        const y = node.y * height;
        const pulse = 1 + 0.3 * Math.sin(time * node.pulseSpeed + node.pulsePhase);
        const radius = node.radius * pulse;

        // Outer glow
        const glowGradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 6);
        glowGradient.addColorStop(
          0,
          `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0.15)`
        );
        glowGradient.addColorStop(1, "transparent");
        ctx.fillStyle = glowGradient;
        ctx.beginPath();
        ctx.arc(x, y, radius * 6, 0, Math.PI * 2);
        ctx.fill();

        // Node core
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, 0.7)`;
        ctx.fill();

        // Inner highlight
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, 0.4)`;
        ctx.fill();
      }

      // --- Floating particles (ambient) ---
      for (let i = 0; i < 20; i++) {
        const px = ((time * 0.1 + i * 137.5) % width);
        const py = ((time * 0.05 + i * 97.3) % height);
        const flicker = 0.1 + 0.1 * Math.sin(time * 0.03 + i);
        
        ctx.beginPath();
        ctx.arc(px, py, 0.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${primaryColor.r}, ${primaryColor.g}, ${primaryColor.b}, ${flicker})`;
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
      style={{ opacity: 0.9 }}
    />
  );
}
