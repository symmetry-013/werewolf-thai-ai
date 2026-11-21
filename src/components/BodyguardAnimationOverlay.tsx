import React, { useEffect, useRef } from 'react';
import { Check, Shield, ShieldAlert, ShieldCheck, ShieldOff } from 'lucide-react';
import { soundFX } from '../utils/sound';

export type BodyguardAnimationType =
  | 'WOLF_BLOCKED'
  | 'VICTIM_SAVED'
  | 'BG_SUCCESS'
  | 'BG_FAILED';

interface BodyguardAnimationOverlayProps {
  type: BodyguardAnimationType;
  playerName?: string;
  onClose: () => void;
}

interface ShieldParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
  maxLife: number;
  color: string;
  kind: 'spark' | 'shard' | 'mote' | 'smoke' | 'ring';
  rotation?: number;
  vRot?: number;
}

const PERSPECTIVE_COPY: Record<
  BodyguardAnimationType,
  {
    eyebrow: string;
    headline: string;
    subtitle: string;
    buttonLabel: string;
  }
> = {
  WOLF_BLOCKED: {
    eyebrow: 'การโจมตีถูกสกัดกั้น!',
    headline: 'มีบอดี้การ์ดช่วยไว้ ไม่สามารถฆ่าเป้าหมายได้!',
    subtitle:
      'โล่พลังงานศักดิ์สิทธิ์พุ่งเข้าปะทะกรงเล็บของฝูงหมาป่าจนแตกกระจาย เหยื่อในคืนนี้รอดชีวิตอย่างหวุดหวิด',
    buttonLabel: 'รับทราบ · กลับสู่หมู่บ้าน',
  },
  VICTIM_SAVED: {
    eyebrow: 'ปาฏิหาริย์แห่งรัตติกาล!',
    headline: 'คุณได้รับการช่วยเหลือจากบอดี้การ์ด คุณเลยรอดชีวิต!',
    subtitle:
      'ฝูงหมาป่าบุกเข้ามาหมายเอาชีวิตคุณในความมืด แต่รัศมีโล่ทองของบอดี้การ์ดช่วยปัดเป่าอันตรายไว้ได้ทันเวลา',
    buttonLabel: 'โล่งอก · เข้าสู่ช่วงเช้า',
  },
  BG_SUCCESS: {
    eyebrow: 'ภารกิจคุ้มกันสำเร็จสมบูรณ์!',
    headline: 'คุณช่วยปกป้องเป้าหมายไว้ได้สำเร็จ!',
    subtitle:
      'สัญชาตญาณของคุณแม่นยำอย่างน่าทึ่ง โล่ของคุณสกัดกั้นการลอบสังหารของฝูงหมาป่าในคืนนี้ได้อย่างเด็ดขาด',
    buttonLabel: 'ยอดเยี่ยม · เข้าสู่ช่วงเช้า',
  },
  BG_FAILED: {
    eyebrow: 'ผลลัพธ์การคุ้มกันยามวิกาล',
    headline: 'คุณปกป้องผิดคน ไม่สามารถช่วยชีวิตคนอื่นได้!',
    subtitle:
      'คืนนี้เป้าหมายที่คุณเฝ้าระวังปลอดภัยดีไม่ได้ถูกโจมตี แต่เงามืดกลับลงมือกับผู้อื่นในหมู่บ้านแทน',
    buttonLabel: 'รับทราบ · เตรียมวิเคราะห์ต่อ',
  },
};

export const BodyguardAnimationOverlay: React.FC<
  BodyguardAnimationOverlayProps
> = ({ type, playerName, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Play matching procedural Web Audio API sound on mount
  useEffect(() => {
    if (type === 'WOLF_BLOCKED') {
      soundFX.playShieldBlock();
    } else if (type === 'VICTIM_SAVED') {
      soundFX.playShieldSaved();
    } else if (type === 'BG_SUCCESS') {
      soundFX.playBodyguardSuccess();
    } else {
      soundFX.playBodyguardFailed();
    }
  }, [type]);

  // Esc key dismiss
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

  // Full-screen Canvas particle physics tailored per perspective
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

    const particles: ShieldParticle[] = [];
    const cx = () => width / 2;
    const cy = () => height / 2;

    if (type === 'WOLF_BLOCKED') {
      // Initial explosive deflection burst: shattered red claw shards + blue/gold metallic sparks
      for (let i = 0; i < 65; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 11;
        const isRedShard = i < 26;
        particles.push({
          x: cx() + (Math.random() - 0.5) * 40,
          y: cy() + (Math.random() - 0.5) * 40,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.5,
          size: isRedShard ? 5 + Math.random() * 9 : 2 + Math.random() * 4,
          life: 0,
          maxLife: 45 + Math.random() * 45,
          color: isRedShard
            ? '#EF4444'
            : Math.random() > 0.45
            ? '#38BDF8'
            : '#FBBF24',
          kind: isRedShard ? 'shard' : 'spark',
          rotation: Math.random() * Math.PI * 2,
          vRot: (Math.random() - 0.5) * 0.25,
        });
      }
      // Expanding shockwave ring
      particles.push({
        x: cx(),
        y: cy(),
        vx: 0,
        vy: 0,
        size: 30,
        life: 0,
        maxLife: 40,
        color: '#60A5FA',
        kind: 'ring',
      });
    } else if (type === 'VICTIM_SAVED') {
      // Outward golden protective aura rings + dark shadow fragments pushed away
      for (let r = 0; r < 3; r++) {
        particles.push({
          x: cx(),
          y: cy(),
          vx: 0,
          vy: 0,
          size: 20 + r * 32,
          life: -r * 8,
          maxLife: 58,
          color: '#FBBF24',
          kind: 'ring',
        });
      }
      for (let i = 0; i < 55; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.5 + Math.random() * 7;
        const isDarkRepelled = i < 20;
        particles.push({
          x: cx() + Math.cos(angle) * (isDarkRepelled ? 75 : 20),
          y: cy() + Math.sin(angle) * (isDarkRepelled ? 75 : 20),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: isDarkRepelled ? 12 + Math.random() * 18 : 2.5 + Math.random() * 4.5,
          life: 0,
          maxLife: 55 + Math.random() * 45,
          color: isDarkRepelled ? '#450A0A' : '#FDE047',
          kind: isDarkRepelled ? 'smoke' : 'mote',
        });
      }
    }

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      // Ongoing ambient particles per type
      if (type === 'WOLF_BLOCKED' && particles.length < 130 && Math.random() < 0.45) {
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.min(width, height) * 0.16;
        particles.push({
          x: cx() + Math.cos(angle) * radius,
          y: cy() + Math.sin(angle) * radius,
          vx: Math.cos(angle) * (1.2 + Math.random() * 2.4),
          vy: Math.sin(angle) * (1.2 + Math.random() * 2.4),
          size: 1.8 + Math.random() * 2.8,
          life: 0,
          maxLife: 38 + Math.random() * 24,
          color: Math.random() > 0.5 ? '#38BDF8' : '#FCD34D',
          kind: 'spark',
        });
      } else if (
        (type === 'VICTIM_SAVED' || type === 'BG_SUCCESS') &&
        particles.length < 160
      ) {
        const spawnCount = type === 'BG_SUCCESS' ? 3 : 2;
        for (let i = 0; i < spawnCount; i++) {
          particles.push({
            x: Math.random() * width,
            y: height + 10,
            vx: (Math.random() - 0.5) * 0.9,
            vy: -(1.4 + Math.random() * 3.1),
            size: 2 + Math.random() * 4.5,
            life: 0,
            maxLife: 90 + Math.random() * 75,
            color:
              type === 'BG_SUCCESS'
                ? Math.random() > 0.35
                  ? '#FBBF24'
                  : '#FEF08A'
                : Math.random() > 0.4
                ? '#FDE047'
                : '#34D399',
            kind: 'mote',
          });
        }
      } else if (type === 'BG_FAILED' && particles.length < 110) {
        // Somber slow-rising smoke + falling blue shield fragments
        if (Math.random() < 0.6) {
          particles.push({
            x: cx() + (Math.random() - 0.5) * Math.min(width * 0.7, 460),
            y: height * 0.65 + Math.random() * height * 0.35,
            vx: (Math.random() - 0.5) * 0.65,
            vy: -(0.7 + Math.random() * 1.4),
            size: 32 + Math.random() * 68,
            life: 0,
            maxLife: 110 + Math.random() * 60,
            color: '#1E293B',
            kind: 'smoke',
          });
        }
        if (Math.random() < 0.25) {
          particles.push({
            x: cx() + (Math.random() - 0.5) * 140,
            y: cy() - 40 + (Math.random() - 0.5) * 80,
            vx: (Math.random() - 0.5) * 1.2,
            vy: 0.9 + Math.random() * 1.8,
            size: 3.5 + Math.random() * 5,
            life: 0,
            maxLife: 75,
            color: '#60A5FA',
            kind: 'shard',
            rotation: Math.random() * Math.PI,
            vRot: (Math.random() - 0.5) * 0.12,
          });
        }
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += 1;
        if (p.life < 0) continue;
        const ratio = p.life / p.maxLife;
        if (ratio >= 1) {
          particles.splice(i, 1);
          continue;
        }

        if (p.kind === 'ring') {
          const maxR = Math.min(width, height) * 0.58;
          const r = p.size + ratio * maxR;
          ctx.save();
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = (1 - ratio) * 0.75;
          ctx.lineWidth = Math.max(1.5, (1 - ratio) * 9);
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } else if (p.kind === 'smoke') {
          p.x += p.vx;
          p.y += p.vy;
          p.size += 0.4;
          const alpha = Math.sin(ratio * Math.PI) * 0.34;
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          grad.addColorStop(0, p.color);
          grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        } else if (p.kind === 'shard') {
          p.x += p.vx;
          p.y += p.vy;
          p.vy += 0.16;
          p.rotation = (p.rotation || 0) + (p.vRot || 0);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.globalAlpha = (1 - ratio) * 0.9;
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.lineTo(p.size * 0.7, p.size * 0.5);
          ctx.lineTo(-p.size * 0.6, p.size * 0.8);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else {
          // Spark or rising golden mote
          p.x += p.vx;
          p.y += p.vy;
          if (p.kind === 'spark') {
            p.vx *= 0.96;
            p.vy = p.vy * 0.96 + 0.08;
          }
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.sin(ratio * Math.PI) * 0.92;
          const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2.2);
          grad.addColorStop(0, '#FFFFFF');
          grad.addColorStop(0.35, p.color);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, [type]);

  const copy = PERSPECTIVE_COPY[type];

  const renderCenterShieldSVG = () => {
    if (type === 'WOLF_BLOCKED') {
      return (
        <div className="relative mx-auto w-[min(42vw,160px)] h-[min(42vw,160px)] flex items-center justify-center">
          {/* Shattered red claw marks being deflected behind the shield */}
          <svg
            viewBox="0 0 220 220"
            className="absolute inset-0 w-full h-full overflow-visible pointer-events-none animate-claw-shatter"
            aria-hidden="true"
          >
            <path
              d="M 195 25 L 130 82 M 205 55 L 140 105 M 185 90 L 135 130"
              stroke="#EF4444"
              strokeWidth="8"
              strokeLinecap="round"
            />
            <path
              d="M 25 185 L 85 130 M 35 150 L 90 105"
              stroke="#DC2626"
              strokeWidth="6"
              strokeLinecap="round"
              opacity="0.7"
            />
          </svg>
          {/* Glowing Blue/Golden Energy Shield slamming into center */}
          <svg
            viewBox="0 0 180 200"
            className="w-[82%] h-[82%] animate-shield-slam drop-shadow-[0_0_28px_rgba(56,189,248,0.85)]"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="blockShieldFill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.92" />
                <stop offset="50%" stopColor="#1D4ED8" stopOpacity="0.95" />
                <stop offset="100%" stopColor="#0F172A" stopOpacity="0.95" />
              </linearGradient>
              <linearGradient id="blockShieldRim" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FEF08A" />
                <stop offset="50%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#38BDF8" />
              </linearGradient>
            </defs>
            <path
              d="M90 12 L160 40 L152 112 C148 152 118 176 90 190 C62 176 32 152 28 112 L20 40 Z"
              fill="url(#blockShieldFill)"
              stroke="url(#blockShieldRim)"
              strokeWidth="7"
            />
            <path
              d="M90 34 L138 54 L132 108 C129 137 109 156 90 166 C71 156 51 137 48 108 L42 54 Z"
              fill="none"
              stroke="#E0F2FE"
              strokeOpacity="0.6"
              strokeWidth="2.5"
            />
            <path
              d="M90 54 L90 144 M56 92 L124 92"
              stroke="#FDE047"
              strokeWidth="7"
              strokeLinecap="round"
            />
          </svg>
        </div>
      );
    }

    if (type === 'VICTIM_SAVED') {
      return (
        <div className="relative mx-auto w-[min(42vw,160px)] h-[min(42vw,160px)] flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-amber-400/25 blur-xl animate-aura-burst" />
          <svg
            viewBox="0 0 180 200"
            className="w-[82%] h-[82%] animate-heroic-shield-rise drop-shadow-[0_0_32px_rgba(251,191,36,0.85)]"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="savedGoldFill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#FEF08A" />
                <stop offset="48%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#B45309" />
              </linearGradient>
            </defs>
            <circle
              cx="90"
              cy="100"
              r="84"
              fill="none"
              stroke="#FDE047"
              strokeWidth="3"
              strokeDasharray="10 8"
              opacity="0.7"
            />
            <path
              d="M90 16 L154 44 L146 112 C142 149 116 172 90 184 C64 172 38 149 34 112 L26 44 Z"
              fill="url(#savedGoldFill)"
              stroke="#FFFBEB"
              strokeWidth="5"
            />
            <path
              d="M64 102 L83 122 L120 78"
              fill="none"
              stroke="#1E293B"
              strokeWidth="11"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      );
    }

    if (type === 'BG_SUCCESS') {
      return (
        <div className="relative mx-auto w-[min(44vw,168px)] h-[min(44vw,168px)] flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-gradient-to-tr from-amber-500/35 via-yellow-300/35 to-emerald-400/25 blur-xl animate-aura-burst" />
          <svg
            viewBox="0 0 180 200"
            className="w-[84%] h-[84%] animate-heroic-shield-rise drop-shadow-[0_0_36px_rgba(245,158,11,0.9)]"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="heroShieldGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FEF9C3" />
                <stop offset="35%" stopColor="#FBBF24" />
                <stop offset="80%" stopColor="#D97706" />
                <stop offset="100%" stopColor="#78350F" />
              </linearGradient>
            </defs>
            {/* Radiant sun rays behind emblem */}
            <path
              d="M90 2 L96 28 L90 22 L84 28 Z M172 60 L148 72 L152 64 L144 60 Z M8 60 L32 72 L28 64 L36 60 Z"
              fill="#FDE047"
              opacity="0.85"
            />
            <path
              d="M90 14 L158 42 L150 112 C145 152 117 176 90 190 C63 176 35 152 30 112 L22 42 Z"
              fill="url(#heroShieldGrad)"
              stroke="#FEF08A"
              strokeWidth="6"
            />
            <path
              d="M90 36 L136 56 L130 108 C126 136 108 154 90 164 C72 154 54 136 50 108 L44 56 Z"
              fill="#0F172A"
              fillOpacity="0.32"
              stroke="#FEF9C3"
              strokeWidth="2.5"
            />
            <polygon
              points="90,56 100,82 128,84 106,102 113,129 90,114 67,129 74,102 52,84 80,82"
              fill="#FEF9C3"
            />
          </svg>
        </div>
      );
    }

    // BG_FAILED: Dimmed cracked blue shield fading into somber smoke
    return (
      <div className="relative mx-auto w-[min(42vw,160px)] h-[min(42vw,160px)] flex items-center justify-center">
        <svg
          viewBox="0 0 180 200"
          className="w-[82%] h-[82%] animate-shield-crack-fade drop-shadow-[0_0_20px_rgba(59,130,246,0.35)]"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id="crackedBlueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60A5FA" stopOpacity="0.65" />
              <stop offset="55%" stopColor="#1E3A8A" stopOpacity="0.72" />
              <stop offset="100%" stopColor="#0F172A" stopOpacity="0.88" />
            </linearGradient>
          </defs>
          <path
            d="M90 16 L154 44 L146 112 C142 149 116 172 90 184 C64 172 38 149 34 112 L26 44 Z"
            fill="url(#crackedBlueGrad)"
            stroke="#93C5FD"
            strokeOpacity="0.6"
            strokeWidth="5"
          />
          {/* Deep jagged fracture lines */}
          <path
            d="M92 22 L80 62 L106 86 L74 122 L98 154 L88 182"
            fill="none"
            stroke="#020617"
            strokeWidth="6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M80 62 L52 78 M106 86 L136 96 M74 122 L48 134"
            fill="none"
            stroke="#020617"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <path
            d="M92 22 L80 62 L106 86 L74 122 L98 154 L88 182"
            fill="none"
            stroke="#93C5FD"
            strokeOpacity="0.65"
            strokeWidth="1.5"
          />
        </svg>
      </div>
    );
  };

  const backdropStyle =
    type === 'WOLF_BLOCKED'
      ? 'radial-gradient(circle at center, rgba(37, 99, 235, 0.28) 0%, rgba(15, 23, 42, 0.88) 60%, rgba(4, 9, 20, 0.97) 100%)'
      : type === 'VICTIM_SAVED'
      ? 'radial-gradient(circle at center, rgba(245, 158, 11, 0.32) 0%, rgba(15, 23, 42, 0.86) 62%, rgba(5, 10, 18, 0.96) 100%)'
      : type === 'BG_SUCCESS'
      ? 'radial-gradient(circle at center, rgba(234, 179, 8, 0.34) 0%, rgba(12, 24, 38, 0.88) 62%, rgba(5, 10, 18, 0.96) 100%)'
      : 'radial-gradient(circle at center, rgba(51, 65, 85, 0.35) 0%, rgba(15, 23, 42, 0.92) 60%, rgba(2, 6, 23, 0.98) 100%)';

  const headlineClass =
    type === 'WOLF_BLOCKED'
      ? 'bg-gradient-to-b from-sky-200 via-blue-300 to-amber-300 bg-clip-text text-transparent'
      : type === 'VICTIM_SAVED' || type === 'BG_SUCCESS'
      ? 'bg-gradient-to-b from-yellow-100 via-amber-300 to-amber-500 bg-clip-text text-transparent'
      : 'text-slate-300';

  const buttonClass =
    type === 'WOLF_BLOCKED'
      ? 'bg-sky-500 hover:bg-sky-400 text-slate-950 border border-sky-300/60 shadow-[0_0_24px_rgba(56,189,248,0.5)]'
      : type === 'VICTIM_SAVED' || type === 'BG_SUCCESS'
      ? 'bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-slate-950 border border-yellow-200/70 shadow-[0_0_26px_rgba(245,158,11,0.55)]'
      : 'bg-slate-700 hover:bg-slate-600 text-slate-100 border border-slate-500/60';

  const badgeIcon =
    type === 'WOLF_BLOCKED' ? (
      <ShieldAlert className="w-4 h-4 text-sky-300 shrink-0" />
    ) : type === 'VICTIM_SAVED' ? (
      <Shield className="w-4 h-4 text-amber-300 shrink-0" />
    ) : type === 'BG_SUCCESS' ? (
      <ShieldCheck className="w-4 h-4 text-yellow-300 shrink-0" />
    ) : (
      <ShieldOff className="w-4 h-4 text-slate-400 shrink-0" />
    );

  return (
    <div
      className={`fixed inset-0 z-[72] h-[100dvh] w-full flex items-center justify-center overflow-hidden select-none p-4 ${
        type === 'WOLF_BLOCKED' ? 'animate-wolf-shake' : ''
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={copy.headline}
    >
      {/* Atmospheric Radial Backdrop */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: backdropStyle }}
      />

      {/* Full-Viewport Particle Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />

      {/* Responsive Centered Card */}
      <div className="relative z-10 w-full max-w-[min(92vw,42rem)] px-5 py-6 sm:px-8 sm:py-8 rounded-2xl text-center space-y-5 animate-death-title-pop bg-[#070E1D]/75 backdrop-blur-md border border-white/15 shadow-[0_25px_70px_rgba(0,0,0,0.85)]">
        {renderCenterShieldSVG()}

        <div className="space-y-2.5">
          <div className="inline-flex items-center justify-center gap-1.5 text-xs sm:text-sm font-bold tracking-wider uppercase text-slate-200/90">
            {badgeIcon}
            <span>
              {copy.eyebrow}
              {playerName ? ` · ${playerName}` : ''}
            </span>
          </div>

          <h1
            className={`font-extrabold leading-tight tracking-tight ${headlineClass}`}
            style={{
              fontSize: 'clamp(1.45rem, 4.6vw, 2.65rem)',
              filter:
                type === 'BG_FAILED'
                  ? 'drop-shadow(0 3px 10px rgba(0,0,0,0.85))'
                  : 'drop-shadow(0 0 18px rgba(245,158,11,0.45)) drop-shadow(0 4px 12px rgba(0,0,0,0.9))',
            }}
          >
            {copy.headline}
          </h1>

          <p
            className="text-slate-200/90 max-w-lg mx-auto leading-relaxed"
            style={{ fontSize: 'clamp(0.85rem, 2.3vw, 1rem)' }}
          >
            {copy.subtitle}
          </p>
        </div>

        <div className="pt-1">
          <button
            type="button"
            onClick={onClose}
            className={`min-h-[44px] w-full sm:w-auto inline-flex items-center justify-center gap-2 px-7 py-3 rounded-xl font-bold text-sm sm:text-base transition-all cursor-pointer active:scale-[0.98] ${buttonClass}`}
          >
            <Check className="w-5 h-5 stroke-[2.5]" />
            <span>{copy.buttonLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
