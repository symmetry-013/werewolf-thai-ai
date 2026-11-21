import React, { useEffect, useRef } from 'react';
import { Eye, Flame, Skull } from 'lucide-react';
import { soundFX } from '../utils/sound';

export type DeathAnimationType = 'WOLF_KILL' | 'DAY_EXECUTION';

interface DeathAnimationOverlayProps {
  type: DeathAnimationType;
  playerName?: string;
  onClose: () => void;
}

interface BloodDrop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  gravity: number;
  isStreak: boolean;
  length: number;
}

interface FireParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  kind: 'flame' | 'ember' | 'smoke';
  hue: number;
  wobbleSeed: number;
}

export const DeathAnimationOverlay: React.FC<DeathAnimationOverlayProps> = ({
  type,
  playerName,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Trigger dramatic impact audio when overlay mounts
  useEffect(() => {
    soundFX.playExecutionImpact();
  }, [type]);

  // Allow Esc key to dismiss overlay cleanly
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // Pure HTML5 Canvas particle layer:
  // - WOLF_KILL: Crimson blood splatter burst + dripping blood streaks along the 3 claw slashes
  // - DAY_EXECUTION: Roaring flames rising from bottom, swirling fiery embers, and dark rising smoke/ash
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let width = window.innerWidth;
    let height = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const startTime = performance.now();

    if (type === 'WOLF_KILL') {
      const drops: BloodDrop[] = [];
      const staticSplatters: { x: number; y: number; r: number; alpha: number }[] = [];

      // Spawn splatter bursts along 3 diagonal slash lines (top-right -> bottom-left)
      const spawnSlashBurst = (offsetIndex: number) => {
        const offsetX = (offsetIndex - 1) * Math.min(width * 0.085, 85);
        const offsetY = (offsetIndex - 1) * Math.min(height * 0.065, 55);

        for (let i = 0; i < 42; i++) {
          const t = Math.random();
          const sx = width * (0.82 - t * 0.64) + offsetX + (Math.random() - 0.5) * 32;
          const sy = height * (0.14 + t * 0.72) + offsetY + (Math.random() - 0.5) * 32;

          // Mist / splatter droplets flying outward from the claw tear
          const angle = Math.random() * Math.PI * 2;
          const speed = 1.5 + Math.random() * 8.5;
          drops.push({
            x: sx,
            y: sy,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 1.5,
            radius: 2 + Math.random() * 6.5,
            alpha: 0.75 + Math.random() * 0.25,
            gravity: 0.14 + Math.random() * 0.12,
            isStreak: false,
            length: 0,
          });

          // Persistent blood stain dots around the slash
          if (i % 2 === 0) {
            staticSplatters.push({
              x: sx + (Math.random() - 0.5) * 90,
              y: sy + (Math.random() - 0.5) * 90,
              r: 1.8 + Math.random() * 6,
              alpha: 0.35 + Math.random() * 0.5,
            });
          }

          // Slow heavy dripping blood streaks running down screen
          if (i % 4 === 0) {
            drops.push({
              x: sx,
              y: sy,
              vx: (Math.random() - 0.5) * 0.12,
              vy: 0.55 + Math.random() * 1.4,
              radius: 2.5 + Math.random() * 3.8,
              alpha: 0.9,
              gravity: 0.016 + Math.random() * 0.012,
              isStreak: true,
              length: 12 + Math.random() * 44,
            });
          }
        }
      };

      const burstFired = [false, false, false];
      let lastDripSpawn = 0;

      const renderWolf = (now: number) => {
        const elapsed = now - startTime;

        if (!burstFired[0] && elapsed >= 60) {
          burstFired[0] = true;
          spawnSlashBurst(0);
        }
        if (!burstFired[1] && elapsed >= 150) {
          burstFired[1] = true;
          spawnSlashBurst(1);
        }
        if (!burstFired[2] && elapsed >= 240) {
          burstFired[2] = true;
          spawnSlashBurst(2);
        }

        // Ongoing eerie blood drips from upper slash wounds
        if (elapsed > 350 && now - lastDripSpawn > 160 && drops.length < 220) {
          lastDripSpawn = now;
          const t = 0.15 + Math.random() * 0.7;
          const lane = Math.floor(Math.random() * 3) - 1;
          const sx =
            width * (0.82 - t * 0.64) +
            lane * Math.min(width * 0.085, 85) +
            (Math.random() - 0.5) * 20;
          const sy =
            height * (0.14 + t * 0.72) +
            lane * Math.min(height * 0.065, 55) +
            (Math.random() - 0.5) * 20;
          drops.push({
            x: sx,
            y: sy,
            vx: 0,
            vy: 0.4 + Math.random() * 0.9,
            radius: 2 + Math.random() * 3,
            alpha: 0.85,
            gravity: 0.014,
            isStreak: true,
            length: 16 + Math.random() * 36,
          });
        }

        ctx.clearRect(0, 0, width, height);

        // Draw static splatter spots
        for (let i = 0; i < staticSplatters.length; i++) {
          const sp = staticSplatters[i];
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(153, 12, 24, ${sp.alpha})`;
          ctx.fill();
        }

        // Update & render dynamic blood drops and streaks
        for (let i = drops.length - 1; i >= 0; i--) {
          const d = drops[i];
          d.x += d.vx;
          d.y += d.vy;
          d.vy += d.gravity;

          if (d.isStreak) {
            d.length = Math.min(d.length + d.vy * 0.45, 130);
            const grad = ctx.createLinearGradient(d.x, d.y - d.length, d.x, d.y);
            grad.addColorStop(0, `rgba(127, 10, 18, 0)`);
            grad.addColorStop(0.5, `rgba(168, 12, 24, ${d.alpha * 0.7})`);
            grad.addColorStop(1, `rgba(215, 22, 36, ${d.alpha})`);
            ctx.strokeStyle = grad;
            ctx.lineWidth = d.radius * 1.35;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(d.x, d.y - d.length);
            ctx.lineTo(d.x, d.y);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(220, 24, 38, ${d.alpha})`;
            ctx.fill();

            if (d.y - d.length > height + 20) {
              drops.splice(i, 1);
            }
          } else {
            d.vx *= 0.96;
            d.alpha -= 0.0055;
            if (d.alpha <= 0 || d.y > height + 30) {
              drops.splice(i, 1);
              continue;
            }
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(198, 18, 30, ${d.alpha})`;
            ctx.fill();
          }
        }

        animId = requestAnimationFrame(renderWolf);
      };

      animId = requestAnimationFrame(renderWolf);
    } else {
      // DAY_EXECUTION: Roaring flames rising from bottom, swirling embers, dark ash smoke
      const particles: FireParticle[] = [];

      const spawnBatch = (progress: number) => {
        // Dense roaring flames at the bottom engulfing upward
        const flameCount = Math.floor(8 + progress * 10);
        for (let i = 0; i < flameCount; i++) {
          particles.push({
            x: Math.random() * width,
            y: height + 10 + Math.random() * 40,
            vx: (Math.random() - 0.5) * 1.4,
            vy: -(3.2 + Math.random() * 5.2 + progress * 2.5),
            size: 26 + Math.random() * 56,
            life: 0,
            maxLife: 45 + Math.random() * 48,
            kind: 'flame',
            hue: 12 + Math.random() * 34, // deep red-orange to bright gold
            wobbleSeed: Math.random() * Math.PI * 2,
          });
        }

        // Glowing hot sparks / embers floating high across the entire screen
        for (let i = 0; i < 6; i++) {
          particles.push({
            x: Math.random() * width,
            y: height * (0.65 + Math.random() * 0.4),
            vx: (Math.random() - 0.5) * 2.4,
            vy: -(2.4 + Math.random() * 4.5),
            size: 1.8 + Math.random() * 3.8,
            life: 0,
            maxLife: 85 + Math.random() * 85,
            kind: 'ember',
            hue: 28 + Math.random() * 24,
            wobbleSeed: Math.random() * Math.PI * 2,
          });
        }

        // Billowing dark ash / smoke rising toward top
        for (let i = 0; i < 4; i++) {
          particles.push({
            x: Math.random() * width,
            y: height * (0.55 + Math.random() * 0.45),
            vx: (Math.random() - 0.5) * 1.2,
            vy: -(1.6 + Math.random() * 2.4),
            size: 48 + Math.random() * 85,
            life: 0,
            maxLife: 95 + Math.random() * 70,
            kind: 'smoke',
            hue: 0,
            wobbleSeed: Math.random() * Math.PI * 2,
          });
        }
      };

      const renderFire = (now: number) => {
        const elapsed = now - startTime;
        const engulfProgress = Math.min(1, elapsed / 1400);

        if (particles.length < 420) {
          spawnBatch(engulfProgress);
        }

        ctx.clearRect(0, 0, width, height);

        // Ambient rising inferno glow from bottom
        const glowHeight = height * (0.45 + engulfProgress * 0.45);
        const baseGlow = ctx.createLinearGradient(0, height, 0, height - glowHeight);
        baseGlow.addColorStop(0, `rgba(234, 88, 12, ${0.42 + engulfProgress * 0.25})`);
        baseGlow.addColorStop(0.35, `rgba(185, 28, 28, ${0.28 + engulfProgress * 0.16})`);
        baseGlow.addColorStop(0.75, 'rgba(30, 15, 10, 0.12)');
        baseGlow.addColorStop(1, 'rgba(10, 10, 12, 0)');
        ctx.fillStyle = baseGlow;
        ctx.fillRect(0, 0, width, height);

        // 1. Render smoke behind flames
        ctx.globalCompositeOperation = 'source-over';
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          if (p.kind !== 'smoke') continue;
          p.life += 1;
          p.x += p.vx + Math.sin(p.life * 0.04 + p.wobbleSeed) * 0.7;
          p.y += p.vy;
          p.size += 0.65;

          const ratio = p.life / p.maxLife;
          if (ratio >= 1) {
            particles.splice(i, 1);
            continue;
          }
          const alpha = Math.sin(ratio * Math.PI) * 0.28;
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          grad.addColorStop(0, `rgba(28, 24, 24, ${alpha})`);
          grad.addColorStop(1, 'rgba(15, 12, 12, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }

        // 2. Render additive roaring flames & glowing embers
        ctx.globalCompositeOperation = 'lighter';
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          if (p.kind === 'smoke') continue;

          p.life += 1;
          const ratio = p.life / p.maxLife;
          if (ratio >= 1) {
            particles.splice(i, 1);
            continue;
          }

          if (p.kind === 'flame') {
            p.x += p.vx + Math.sin(p.life * 0.12 + p.wobbleSeed) * 1.4;
            p.y += p.vy;
            const currentSize = p.size * (1 - ratio * 0.65);
            const alpha = (1 - ratio) * 0.55;
            const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, currentSize);
            grad.addColorStop(0, `hsla(${p.hue + 18}, 100%, 72%, ${alpha})`);
            grad.addColorStop(0.45, `hsla(${p.hue}, 96%, 52%, ${alpha * 0.75})`);
            grad.addColorStop(1, `hsla(8, 90%, 30%, 0)`);
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, currentSize, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Ember spark
            p.x += p.vx + Math.sin(p.life * 0.09 + p.wobbleSeed) * 1.6;
            p.y += p.vy;
            const alpha = Math.sin(ratio * Math.PI) * 0.95;
            ctx.fillStyle = `hsla(${p.hue}, 100%, 68%, ${alpha})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (1 - ratio * 0.4), 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalCompositeOperation = 'source-over';

        animId = requestAnimationFrame(renderFire);
      };

      animId = requestAnimationFrame(renderFire);
    }

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [type]);

  const isWolfKill = type === 'WOLF_KILL';

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center overflow-hidden select-none ${
        isWolfKill ? 'animate-wolf-shake' : 'animate-fire-rumble'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={
        isWolfKill
          ? 'คุณโดนหมาป่าฆ่าตายแล้ว'
          : 'คุณถูกชาวบ้านโหวตประหารชีวิต'
      }
    >
      {/* Background Backdrop Layer */}
      {isWolfKill ? (
        <>
          <div className="absolute inset-0 bg-[#0B0204]/92" />
          {/* Pulsing dark red vignette */}
          <div
            className="absolute inset-0 pointer-events-none animate-crimson-vignette"
            style={{
              background:
                'radial-gradient(circle at center, rgba(127, 29, 29, 0.14) 22%, rgba(127, 10, 20, 0.72) 72%, rgba(45, 2, 8, 0.98) 100%)',
            }}
          />
          {/* Sudden initial red/white strike flash */}
          <div className="absolute inset-0 bg-red-600/40 pointer-events-none animate-slash-flash" />
        </>
      ) : (
        <>
          {/* Darkening ashy charcoal backdrop */}
          <div className="absolute inset-0 bg-[#120A07]/92 animate-ash-darken" />
          {/* Bottom-up fiery vignette */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                'radial-gradient(ellipse at 50% 100%, rgba(234, 88, 12, 0.55) 0%, rgba(124, 24, 12, 0.42) 45%, rgba(10, 8, 8, 0.94) 90%)',
            }}
          />
        </>
      )}

      {/* Full-Screen Animated Particle Canvas (Blood Splatter & Drips OR Roaring Flames & Embers) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* SVG Foreground Effects */}
      {isWolfKill ? (
        /* 3 Giant Diagonal Beast Claw Slash Marks ripping across the viewport */
        <svg
          viewBox="0 0 1200 800"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="clawGradMain" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#7F1D1D" stopOpacity="0.1" />
              <stop offset="18%" stopColor="#DC2626" stopOpacity="0.98" />
              <stop offset="52%" stopColor="#EF4444" stopOpacity="1" />
              <stop offset="85%" stopColor="#991B1B" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#450A0A" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="clawGradCore" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FCA5A5" stopOpacity="0" />
              <stop offset="30%" stopColor="#FEE2E2" stopOpacity="0.95" />
              <stop offset="70%" stopColor="#FCA5A5" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#EF4444" stopOpacity="0" />
            </linearGradient>
            <filter id="clawGlow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Claw Slash 1 (Top-left parallel) */}
          <g filter="url(#clawGlow)">
            <path
              d="M 940 45 Q 610 270 185 620"
              fill="none"
              stroke="url(#clawGradMain)"
              strokeWidth="34"
              strokeLinecap="round"
              className="claw-slash-path claw-slash-1"
            />
            <path
              d="M 920 60 Q 605 275 215 595"
              fill="none"
              stroke="url(#clawGradCore)"
              strokeWidth="7"
              strokeLinecap="round"
              className="claw-slash-path claw-slash-1"
            />
          </g>

          {/* Claw Slash 2 (Center deepest gash) */}
          <g filter="url(#clawGlow)">
            <path
              d="M 1055 95 Q 645 365 155 725"
              fill="none"
              stroke="url(#clawGradMain)"
              strokeWidth="44"
              strokeLinecap="round"
              className="claw-slash-path claw-slash-2"
            />
            <path
              d="M 1030 112 Q 640 370 190 698"
              fill="none"
              stroke="url(#clawGradCore)"
              strokeWidth="9"
              strokeLinecap="round"
              className="claw-slash-path claw-slash-2"
            />
          </g>

          {/* Claw Slash 3 (Bottom-right parallel) */}
          <g filter="url(#clawGlow)">
            <path
              d="M 1110 210 Q 750 475 300 770"
              fill="none"
              stroke="url(#clawGradMain)"
              strokeWidth="30"
              strokeLinecap="round"
              className="claw-slash-path claw-slash-3"
            />
            <path
              d="M 1085 228 Q 745 480 335 745"
              fill="none"
              stroke="url(#clawGradCore)"
              strokeWidth="6"
              strokeLinecap="round"
              className="claw-slash-path claw-slash-3"
            />
          </g>
        </svg>
      ) : (
        /* Layered Roaring SVG Fire Silhouettes engulfing from bottom edge */
        <svg
          viewBox="0 0 1200 320"
          preserveAspectRatio="none"
          className="absolute bottom-0 inset-x-0 w-full h-[46vh] pointer-events-none animate-flames-rise"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="fireBackGrad" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#991B1B" stopOpacity="0.95" />
              <stop offset="55%" stopColor="#EA580C" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="fireMidGrad" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#EA580C" stopOpacity="0.92" />
              <stop offset="50%" stopColor="#F97316" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#FDE047" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="fireFrontGrad" x1="0%" y1="100%" x2="0%" y2="0%">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.95" />
              <stop offset="60%" stopColor="#FDE047" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#FEF08A" stopOpacity="0" />
            </linearGradient>
          </defs>

          <path
            className="animate-flame-wave-slow"
            fill="url(#fireBackGrad)"
            d="M0,320 L0,160 Q70,40 150,150 Q230,20 310,130 Q400,10 490,140 Q580,5 680,125 Q770,15 860,140 Q950,25 1040,135 Q1130,30 1200,145 L1200,320 Z"
          />
          <path
            className="animate-flame-wave-fast"
            fill="url(#fireMidGrad)"
            d="M0,320 L0,200 Q90,95 190,190 Q280,65 380,185 Q470,70 570,180 Q670,55 770,190 Q870,75 970,185 Q1080,85 1200,195 L1200,320 Z"
          />
          <path
            className="animate-flame-wave-slow"
            fill="url(#fireFrontGrad)"
            d="M0,320 L0,245 Q110,155 230,240 Q350,135 470,235 Q600,145 730,240 Q860,140 990,235 Q1100,160 1200,240 L1200,320 Z"
          />
        </svg>
      )}

      {/* Center Dramatic Message Card */}
      <div className="relative z-10 max-w-2xl w-full mx-4 px-6 py-8 md:px-10 md:py-10 rounded-2xl text-center space-y-6 animate-death-title-pop bg-black/55 backdrop-blur-sm border border-white/10 shadow-[0_25px_70px_rgba(0,0,0,0.85)]">
        {/* Emblem Icon */}
        <div
          className={`w-16 h-16 md:w-20 md:h-20 mx-auto rounded-full flex items-center justify-center border-2 ${
            isWolfKill
              ? 'bg-red-950/80 border-red-500/80 text-red-400 shadow-[0_0_35px_rgba(239,68,68,0.6)]'
              : 'bg-orange-950/80 border-amber-400/80 text-amber-300 shadow-[0_0_35px_rgba(249,115,22,0.65)]'
          }`}
        >
          {isWolfKill ? (
            <Skull className="w-9 h-9 md:w-11 md:h-11" />
          ) : (
            <Flame className="w-9 h-9 md:w-11 md:h-11" />
          )}
        </div>

        {/* Dramatic Headline */}
        <div className="space-y-3">
          {playerName && (
            <p
              className={`text-xs md:text-sm font-bold tracking-widest uppercase ${
                isWolfKill ? 'text-red-300/90' : 'text-amber-300/90'
              }`}
            >
              {isWolfKill
                ? `ชะตากรรมของ ${playerName} ในยามวิกาล`
                : `คำตัดสินสภาหมู่บ้านต่อ ${playerName}`}
            </p>
          )}

          {isWolfKill ? (
            <div className="space-y-2">
              <h1
                className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-red-500 leading-tight"
                style={{
                  textShadow:
                    '0 0 18px rgba(220, 38, 38, 0.95), 0 4px 14px rgba(0, 0, 0, 0.95), 0 0 42px rgba(153, 27, 27, 0.85)',
                }}
              >
                คุณโดนหมาป่าฆ่าตายแล้ว!
              </h1>
              {/* Pure SVG bloody drip underline */}
              <svg
                viewBox="0 0 360 32"
                className="w-64 sm:w-80 h-6 mx-auto overflow-visible"
                aria-hidden="true"
              >
                <path
                  d="M 10 4 L 350 4 Q 310 6 290 8 C 286 15 288 26 283 26 C 278 26 280 14 276 8 L 195 8 C 190 18 193 31 187 31 C 181 31 184 18 179 8 L 95 8 C 91 15 92 23 88 23 C 84 23 85 15 81 8 Q 50 6 10 4 Z"
                  fill="#DC2626"
                  opacity="0.92"
                />
              </svg>
            </div>
          ) : (
            <h1
              className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight bg-gradient-to-b from-yellow-200 via-amber-400 to-red-600 bg-clip-text text-transparent leading-tight"
              style={{
                filter:
                  'drop-shadow(0 0 18px rgba(249, 115, 22, 0.9)) drop-shadow(0 5px 14px rgba(0, 0, 0, 0.95))',
              }}
            >
              คุณถูกชาวบ้านโหวตประหารชีวิต!
            </h1>
          )}

          <p className="text-sm md:text-base text-slate-200/90 max-w-lg mx-auto leading-relaxed">
            {isWolfKill
              ? 'กรงเล็บของฝูงหมาป่าพรากชีวิตคุณไปในความมืดแล้ว... คุณไม่สามารถโหวตหรือใช้ความสามารถได้อีกต่อไป แต่ยังติดตามเกมในโหมดผู้ชมได้'
              : 'เปลวเพลิงแห่งสภาหมู่บ้านได้กลืนกินคุณตามมติเสียงข้างมากแล้ว... คุณสามารถปิดหน้านี้เพื่อเข้าสู่โหมดผู้ชมและลุ้นผลแพ้ชนะต่อได้'}
          </p>
        </div>

        {/* Dismiss & Enter Spectator Mode CTA */}
        <div className="pt-2">
          <button
            type="button"
            onClick={onClose}
            className={`inline-flex items-center justify-center gap-2.5 px-7 py-3.5 rounded-xl font-bold text-sm md:text-base transition-all cursor-pointer active:scale-[0.98] ${
              isWolfKill
                ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_28px_rgba(220,38,38,0.6)] border border-red-400/50'
                : 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 shadow-[0_0_28px_rgba(249,115,22,0.6)] border border-amber-300/60'
            }`}
          >
            <Eye className="w-5 h-5" />
            <span>ปิดหน้าต่าง · เข้าสู่โหมดผู้ชม</span>
          </button>
        </div>
      </div>
    </div>
  );
};
