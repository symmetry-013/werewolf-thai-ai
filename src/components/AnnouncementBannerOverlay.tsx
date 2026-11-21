import React, { useEffect, useRef } from 'react';
import { Flame, Moon, ShieldAlert, Skull, Sparkles, Sun, X } from 'lucide-react';
import { soundFX } from '../utils/sound';

export type AnnouncementBannerType =
  | 'OTHER_WOLF_KILL'
  | 'OTHER_EXECUTION'
  | 'BEGGAR_REVEAL'
  | 'PEACEFUL_NIGHT';

export interface AnnouncementBannerData {
  eventId: string;
  type: AnnouncementBannerType;
  victimNames: string[];
  victimIds?: string[];
  cubRageNote?: boolean;
}

interface AnnouncementBannerOverlayProps {
  banner: AnnouncementBannerData;
  onClose: () => void;
  autoDismissMs?: number;
}

interface BannerParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
}

export const AnnouncementBannerOverlay: React.FC<AnnouncementBannerOverlayProps> = ({
  banner,
  onClose,
  autoDismissMs = 4000,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Trigger corresponding Web Audio synth sound & 4s auto-dismiss timer
  useEffect(() => {
    if (banner.type === 'OTHER_WOLF_KILL') {
      soundFX.playOtherWolfKill();
    } else if (banner.type === 'OTHER_EXECUTION') {
      soundFX.playOtherExecution();
    } else if (banner.type === 'BEGGAR_REVEAL') {
      soundFX.playBeggarReveal();
    } else {
      soundFX.playPeacefulNight();
    }

    const timer = window.setTimeout(() => {
      onCloseRef.current();
    }, autoDismissMs);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', handleKey);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [banner.eventId, banner.type, autoDismissMs]);

  // Lightweight ambient canvas particles (blood sparks / rising embers / dawn motes)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: BannerParticle[] = [];
    const count = banner.type === 'OTHER_EXECUTION' ? 42 : 28;
    const palette =
      banner.type === 'OTHER_WOLF_KILL'
        ? ['#ef4444', '#dc2626', '#fca5a5', '#991b1b']
        : banner.type === 'OTHER_EXECUTION'
        ? ['#fb923c', '#f97316', '#facc15', '#ef4444']
        : banner.type === 'BEGGAR_REVEAL'
        ? ['#facc15', '#c084fc', '#fde68a']
        : ['#38bdf8', '#fde68a', '#bae6fd', '#f8fafc'];

    const spawn = (fromBottom = false): BannerParticle => {
      const w = canvas.clientWidth || 400;
      const h = canvas.clientHeight || 200;
      if (banner.type === 'OTHER_EXECUTION') {
        return {
          x: Math.random() * w,
          y: fromBottom ? h + Math.random() * 20 : Math.random() * h,
          vx: (Math.random() - 0.5) * 0.9,
          vy: -(0.9 + Math.random() * 1.9),
          size: 1.5 + Math.random() * 3.2,
          alpha: 0.45 + Math.random() * 0.5,
          color: palette[Math.floor(Math.random() * palette.length)],
        };
      }
      if (banner.type === 'OTHER_WOLF_KILL') {
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: 1.2 + Math.random() * 1.8,
          vy: 0.5 + Math.random() * 1.1,
          size: 1.4 + Math.random() * 2.6,
          alpha: 0.35 + Math.random() * 0.55,
          color: palette[Math.floor(Math.random() * palette.length)],
        };
      }
      return {
        x: Math.random() * w,
        y: fromBottom ? h + 10 : Math.random() * h,
        vx: (Math.random() - 0.5) * 0.45,
        vy: -(0.35 + Math.random() * 0.8),
        size: 1.4 + Math.random() * 2.6,
        alpha: 0.35 + Math.random() * 0.45,
        color: palette[Math.floor(Math.random() * palette.length)],
      };
    };

    for (let i = 0; i < count; i++) {
      particles.push(spawn(false));
    }

    const render = () => {
      const w = canvas.clientWidth || 400;
      const h = canvas.clientHeight || 200;
      ctx.clearRect(0, 0, w, h);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.y < -12 || p.y > h + 24 || p.x < -12 || p.x > w + 24) {
          particles[i] = spawn(true);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 8;
        ctx.shadowColor = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      rafId = window.requestAnimationFrame(render);
    };

    rafId = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    };
  }, [banner.type, banner.eventId]);

  const namesText =
    banner.victimNames.length > 0
      ? banner.victimNames.join(' และ ')
      : 'ผู้เล่นนิรนาม';

  let eyebrow = '';
  let headline = '';
  let subline = '';
  let accentBorder = '';
  let cardBg = '';
  let progressBg = '';
  let iconNode: React.ReactNode = null;

  if (banner.type === 'OTHER_WOLF_KILL') {
    eyebrow =
      banner.victimNames.length >= 2
        ? 'รุ่งอรุณสีเลือด · สังหารคู่ 2 ศพ!'
        : 'ประกาศยามเช้า · ข่าวร้ายจากหมู่บ้าน';
    headline = `เมื่อคืนนี้ ${namesText} โดนหมาป่าฆ่าตายแล้ว!`;
    subline = banner.cubRageNote
      ? '⚠️ เสียงหอนโหยหวนดังก้องป่า — คืนถัดไปหมาป่าคลั่งสังหารได้ถึง 2 ศพ!'
      : 'ไม่เปิดเผยบทบาทลับของผู้เสียชีวิต · จงตามล่าหมาป่าในสภาวันนี้';
    accentBorder = 'border-red-500/75 shadow-[0_0_55px_rgba(220,38,38,0.45)]';
    cardBg = 'from-[#22070B]/96 via-[#14050A]/96 to-[#1D0609]/96';
    progressBg = 'bg-gradient-to-r from-red-600 via-rose-500 to-red-400';
    iconNode = <Skull className="w-7 h-7 sm:w-8 sm:h-8 text-red-400" />;
  } else if (banner.type === 'OTHER_EXECUTION') {
    eyebrow = 'มติสภาหมู่บ้าน · ลานประหารเพลิง';
    headline = `${namesText} ถูกชาวบ้านโหวตประหารชีวิตแล้ว!`;
    subline = banner.cubRageNote
      ? '🐺🔥 คำสาปลูกหมาป่าทำงาน! คืนถัดไปหมาป่าที่เหลือจะฆ่าเหยื่อได้ถึง 2 คน!'
      : 'ไม่เปิดเผยบทบาทลับของผู้ถูกประหาร · ความจริงจะปรากฏเมื่อเกมจบ';
    accentBorder = 'border-orange-500/80 shadow-[0_0_55px_rgba(249,115,22,0.45)]';
    cardBg = 'from-[#271005]/96 via-[#170904]/96 to-[#240D04]/96';
    progressBg = 'bg-gradient-to-r from-orange-600 via-amber-400 to-yellow-300';
    iconNode = <Flame className="w-7 h-7 sm:w-8 sm:h-8 text-orange-400" />;
  } else if (banner.type === 'BEGGAR_REVEAL') {
    eyebrow = 'กติกาพิเศษ · หงายการ์ดกลางลานประหาร!';
    headline = `รอดตาย! ${namesText} คือ ยาจก (หมดสิทธิ์โหวต)`;
    subline = 'ยาจก/คนงี่เง่ารอดชีวิตจากการถูกโหวตประหาร แต่จะเสียสิทธิ์โหวตตลอดทั้งเกมที่เหลือ';
    accentBorder = 'border-amber-400/80 shadow-[0_0_50px_rgba(250,204,21,0.38)]';
    cardBg = 'from-[#221606]/96 via-[#160F24]/96 to-[#1E1407]/96';
    progressBg = 'bg-gradient-to-r from-amber-500 via-yellow-300 to-purple-400';
    iconNode = <ShieldAlert className="w-7 h-7 sm:w-8 sm:h-8 text-amber-300" />;
  } else {
    eyebrow = 'รุ่งอรุณแห่งความหวัง · คืนที่ปลอดภัย';
    headline = 'เมื่อคืนนี้เหตุการณ์สงบสุข ไม่มีใครเสียชีวิต!';
    subline = 'แสงอาทิตย์ยามเช้าสาดส่องทั่วหมู่บ้าน ดูเหมือนบอดี้การ์ดจะคุ้มกันได้ถูกจุดพอดี';
    accentBorder = 'border-sky-400/70 shadow-[0_0_50px_rgba(56,189,248,0.32)]';
    cardBg = 'from-[#081A2E]/96 via-[#0C1F38]/96 to-[#132032]/96';
    progressBg = 'bg-gradient-to-r from-sky-400 via-amber-300 to-emerald-300';
    iconNode = (
      <div className="relative flex items-center justify-center">
        <Sun className="w-7 h-7 sm:w-8 sm:h-8 text-amber-300" />
        <Moon className="w-3.5 h-3.5 text-sky-300 absolute -bottom-0.5 -right-1" />
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-live="assertive"
      onClick={onClose}
      className="fixed inset-0 z-[85] h-[100dvh] w-full flex items-center justify-center p-4 bg-black/55 backdrop-blur-[3px] pointer-events-auto animate-banner-fade-in"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-[min(94vw,38rem)] overflow-hidden rounded-2xl border-2 bg-gradient-to-br ${cardBg} ${accentBorder} animate-banner-slam`}
      >
        {/* Ambient Particles Canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full pointer-events-none opacity-85"
        />

        {/* Decorative SVG Overlay Per Event Type */}
        {banner.type === 'OTHER_WOLF_KILL' && (
          <svg
            viewBox="0 0 600 260"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none opacity-60"
            aria-hidden="true"
          >
            <g
              stroke="#ef4444"
              strokeLinecap="round"
              fill="none"
              className="animate-banner-slash"
            >
              <path d="M 90 12 Q 280 95 495 235" strokeWidth="7" strokeOpacity="0.85" />
              <path d="M 145 8 Q 335 90 540 222" strokeWidth="5.5" strokeOpacity="0.7" />
              <path d="M 55 32 Q 235 120 440 248" strokeWidth="4" strokeOpacity="0.55" />
            </g>
          </svg>
        )}

        {banner.type === 'OTHER_EXECUTION' && (
          <svg
            viewBox="0 0 600 80"
            preserveAspectRatio="none"
            className="absolute inset-x-0 bottom-0 w-full h-16 pointer-events-none opacity-65"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="bannerFireGrad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#ea580c" stopOpacity="0.9" />
                <stop offset="55%" stopColor="#f59e0b" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#fde047" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d="M0,80 L0,44 Q35,12 72,40 Q105,4 148,38 Q195,10 238,42 Q285,2 332,36 Q380,8 426,40 Q475,4 522,36 Q565,14 600,38 L600,80 Z"
              fill="url(#bannerFireGrad)"
            />
          </svg>
        )}

        {banner.type === 'PEACEFUL_NIGHT' && (
          <div
            className="absolute -top-14 left-1/2 -translate-x-1/2 w-64 h-36 rounded-full bg-amber-300/20 blur-2xl pointer-events-none"
            aria-hidden="true"
          />
        )}

        {/* Close Icon Top-Right */}
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดประกาศ"
          className="absolute top-3 right-3 z-20 p-1.5 rounded-lg bg-black/40 hover:bg-black/70 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Main Banner Content */}
        <div className="relative z-10 px-5 py-6 sm:px-7 sm:py-7 text-center space-y-3.5">
          <div className="inline-flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-black/45 border border-white/15 shadow-lg mx-auto">
            {iconNode}
          </div>

          <div className="space-y-1.5">
            <p className="text-[11px] sm:text-xs font-bold tracking-wider text-slate-300/90 flex items-center justify-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span>{eyebrow}</span>
            </p>
            <h2
              className="font-extrabold text-white leading-snug tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.85)]"
              style={{ fontSize: 'clamp(1.25rem, 4.4vw, 1.95rem)' }}
            >
              {headline}
            </h2>
            <p className="text-xs sm:text-sm text-slate-200/90 max-w-md mx-auto leading-relaxed">
              {subline}
            </p>
          </div>

          <div className="pt-1 flex items-center justify-center">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[42px] px-5 py-2 rounded-xl bg-white/12 hover:bg-white/20 text-white border border-white/25 font-bold text-xs sm:text-sm transition-colors cursor-pointer backdrop-blur-sm"
            >
              รับทราบ / ปิด (Close)
            </button>
          </div>
        </div>

        {/* Auto-Dismiss 4s Countdown Progress Bar */}
        <div className="relative z-10 h-1.5 w-full bg-black/45 overflow-hidden">
          <div
            className={`h-full ${progressBg} origin-left animate-banner-countdown`}
            style={{ animationDuration: `${autoDismissMs}ms` }}
          />
        </div>
      </div>
    </div>
  );
};
