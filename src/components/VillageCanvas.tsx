import React, { useEffect, useRef } from 'react';
import {
  PhaseType,
  Player,
  ROLE_INFO,
  VILLAGE_BACKDROP_IMAGE,
  VoteRecord,
} from '../data/werewolfEngine';

interface VillageCanvasProps {
  phase: PhaseType;
  dayCount: number;
  players: Player[];
  viewerPlayerId: string;
  selectedTargetId: string | null;
  secondTargetId?: string | null;
  activeSpeakerId: string | null;
  votes: VoteRecord[];
  showTrueRoles: boolean;
  fellowWolfIds: string[];
  seerKnownMap: Record<string, boolean>;
  impactTrigger: number;
  onSelectPlayer: (playerId: string) => void;
}

interface EmberParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  life: number;
  maxLife: number;
  color: string;
}

interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
}

export const VillageCanvas: React.FC<VillageCanvasProps> = ({
  phase,
  dayCount,
  players,
  viewerPlayerId,
  selectedTargetId,
  secondTargetId = null,
  activeSpeakerId,
  votes,
  showTrueRoles,
  fellowWolfIds,
  seerKnownMap,
  impactTrigger,
  onSelectPlayer,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({
    phase,
    dayCount,
    players,
    viewerPlayerId,
    selectedTargetId,
    secondTargetId,
    activeSpeakerId,
    votes,
    showTrueRoles,
    fellowWolfIds,
    seerKnownMap,
    hoveredId: null as string | null,
    shakeTime: 0,
    shakeIntensity: 0,
    hitFlash: 0,
    nightBlend: 1, // 1 = night, 0 = day
  });

  // Sync latest React props into mutable ref so 60fps canvas loop never re-mounts
  useEffect(() => {
    stateRef.current.phase = phase;
    stateRef.current.dayCount = dayCount;
    stateRef.current.players = players;
    stateRef.current.viewerPlayerId = viewerPlayerId;
    stateRef.current.selectedTargetId = selectedTargetId;
    stateRef.current.secondTargetId = secondTargetId;
    stateRef.current.activeSpeakerId = activeSpeakerId;
    stateRef.current.votes = votes;
    stateRef.current.showTrueRoles = showTrueRoles;
    stateRef.current.fellowWolfIds = fellowWolfIds;
    stateRef.current.seerKnownMap = seerKnownMap;
  }, [
    phase,
    dayCount,
    players,
    viewerPlayerId,
    selectedTargetId,
    secondTargetId,
    activeSpeakerId,
    votes,
    showTrueRoles,
    fellowWolfIds,
    seerKnownMap,
  ]);

  useEffect(() => {
    if (impactTrigger > 0) {
      stateRef.current.shakeTime = 0.45;
      stateRef.current.shakeIntensity = 12;
      stateRef.current.hitFlash = 0.55;
    }
  }, [impactTrigger]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bgImg = new Image();
    bgImg.src = VILLAGE_BACKDROP_IMAGE;

    // Pooled ambient ember/firefly particles
    const embers: EmberParticle[] = Array.from({ length: 42 }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.03,
      vy: -0.02 - Math.random() * 0.04,
      size: 1.5 + Math.random() * 2.5,
      alpha: 0.2 + Math.random() * 0.6,
      life: Math.random() * 4,
      maxLife: 3 + Math.random() * 4,
      color: Math.random() > 0.35 ? '#F59E0B' : '#EF4444',
    }));

    const bursts: BurstParticle[] = [];

    const spawnBurst = (cx: number, cy: number, color: string) => {
      for (let i = 0; i < 22; i++) {
        const angle = (Math.PI * 2 * i) / 22 + (Math.random() - 0.5) * 0.3;
        const speed = 45 + Math.random() * 110;
        bursts.push({
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 2.5 + Math.random() * 3.5,
          color,
          life: 0,
          maxLife: 0.45 + Math.random() * 0.3,
        });
      }
    };

    const getSeatPositions = (width: number, height: number) => {
      // Shift council table slightly left on wide screens so the right-hand chat drawer never occludes any player seat
      const isWide = width >= 1024;
      const centerX = isWide ? width * 0.31 : width * 0.5;
      const centerY = isWide ? height * 0.48 : height * 0.34;
      const radiusX = isWide
        ? Math.min(width * 0.23, 275)
        : Math.min(width * 0.36, 170);
      const radiusY = isWide
        ? Math.min(height * 0.29, 215)
        : Math.min(height * 0.20, 125);

      return {
        centerX,
        centerY,
        radiusX,
        radiusY,
        seats: stateRef.current.players.map((p) => ({
          player: p,
          x: centerX + Math.cos(p.seatAngle) * radiusX,
          y: centerY + Math.sin(p.seatAngle) * radiusY,
          r: isWide ? 28 : 21,
        })),
      };
    };

    const handlePointerMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { seats } = getSeatPositions(rect.width, rect.height);
      let found: string | null = null;
      for (const s of seats) {
        const dx = mx - s.x;
        const dy = my - s.y;
        if (Math.sqrt(dx * dx + dy * dy) <= s.r + 10) {
          found = s.player.id;
          break;
        }
      }
      stateRef.current.hoveredId = found;
      canvas.style.cursor = found ? 'pointer' : 'default';
    };

    const handlePointerDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const { seats } = getSeatPositions(rect.width, rect.height);
      for (const s of seats) {
        const dx = mx - s.x;
        const dy = my - s.y;
        if (Math.sqrt(dx * dx + dy * dy) <= s.r + 10) {
          spawnBurst(s.x, s.y, s.player.avatarColor);
          onSelectPlayer(s.player.id);
          break;
        }
      }
    };

    canvas.addEventListener('mousemove', handlePointerMove);
    canvas.addEventListener('mousedown', handlePointerDown);

    let lastTime = performance.now();
    let animId = 0;

    const render = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
      lastTime = now;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      const st = stateRef.current;
      const targetNight = st.phase === 'NIGHT_ACTION' ? 1 : 0.18;
      st.nightBlend += (targetNight - st.nightBlend) * Math.min(1, dt * 3.5);

      // Camera shake decay
      let shakeX = 0;
      let shakeY = 0;
      if (st.shakeTime > 0) {
        st.shakeTime = Math.max(0, st.shakeTime - dt);
        const mag = st.shakeIntensity * (st.shakeTime / 0.45);
        shakeX = (Math.random() - 0.5) * mag * 2;
        shakeY = (Math.random() - 0.5) * mag * 2;
      }
      ctx.translate(shakeX, shakeY);

      // 1. Background image + day/night atmospheric grading
      ctx.fillStyle = '#070C18';
      ctx.fillRect(0, 0, width, height);

      if (bgImg.complete && bgImg.naturalWidth > 0) {
        const scale = Math.max(width / bgImg.naturalWidth, height / bgImg.naturalHeight) * 1.03;
        const dw = bgImg.naturalWidth * scale;
        const dh = bgImg.naturalHeight * scale;
        const panX = Math.sin(now * 0.00018) * 10;
        const dx = (width - dw) * 0.5 + panX;
        const dy = (height - dh) * 0.5;
        ctx.globalAlpha = 0.48;
        ctx.drawImage(bgImg, dx, dy, dw, dh);
        ctx.globalAlpha = 1;
      }

      // Vignette & Day/Night sky tint
      const skyGrad = ctx.createRadialGradient(
        width * 0.32,
        height * 0.22,
        20,
        width * 0.5,
        height * 0.5,
        Math.max(width, height) * 0.85
      );
      if (st.nightBlend > 0.5) {
        skyGrad.addColorStop(0, 'rgba(30, 27, 75, 0.45)');
        skyGrad.addColorStop(0.6, 'rgba(10, 17, 32, 0.82)');
        skyGrad.addColorStop(1, 'rgba(4, 7, 15, 0.95)');
      } else {
        skyGrad.addColorStop(0, 'rgba(120, 53, 15, 0.28)');
        skyGrad.addColorStop(0.6, 'rgba(15, 23, 42, 0.78)');
        skyGrad.addColorStop(1, 'rgba(7, 11, 22, 0.94)');
      }
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, width, height);

      const { centerX, centerY, radiusX, radiusY, seats } = getSeatPositions(width, height);

      // 2. Celestial body (Blood/Silver Moon at night, Dawn Sun at day)
      const orbX = centerX;
      const orbY = Math.max(58, centerY - radiusY - 64);
      const orbRadius = 22;
      const orbGlow = ctx.createRadialGradient(orbX, orbY, 2, orbX, orbY, orbRadius * 3.2);
      if (st.phase === 'NIGHT_ACTION') {
        orbGlow.addColorStop(0, 'rgba(248, 113, 113, 0.85)');
        orbGlow.addColorStop(0.4, 'rgba(220, 38, 38, 0.25)');
        orbGlow.addColorStop(1, 'rgba(220, 38, 38, 0)');
      } else {
        orbGlow.addColorStop(0, 'rgba(251, 191, 36, 0.9)');
        orbGlow.addColorStop(0.4, 'rgba(245, 158, 11, 0.25)');
        orbGlow.addColorStop(1, 'rgba(245, 158, 11, 0)');
      }
      ctx.fillStyle = orbGlow;
      ctx.beginPath();
      ctx.arc(orbX, orbY, orbRadius * 3.2, 0, Math.PI * 2);
      ctx.fill();

      // 3. Council Table Surface
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX * 0.72, radiusY * 0.72, 0, 0, Math.PI * 2);
      const tableGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        8,
        centerX,
        centerY,
        radiusX * 0.75
      );
      tableGrad.addColorStop(0, '#451A03');
      tableGrad.addColorStop(0.65, '#1E1B2E');
      tableGrad.addColorStop(1, '#0F172A');
      ctx.fillStyle = tableGrad;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle =
        st.phase === 'NIGHT_ACTION'
          ? 'rgba(220, 38, 38, 0.38)'
          : 'rgba(245, 158, 11, 0.42)';
      ctx.stroke();

      // Inner ritual ring on the table
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX * 0.48, radiusY * 0.48, 0, 0, Math.PI * 2);
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.22)';
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Center Campfire / Lantern Flame
      const flamePulse = 1 + Math.sin(now * 0.008) * 0.14;
      const fireGlow = ctx.createRadialGradient(
        centerX,
        centerY,
        2,
        centerX,
        centerY,
        52 * flamePulse
      );
      fireGlow.addColorStop(0, 'rgba(254, 243, 199, 0.95)');
      fireGlow.addColorStop(0.3, 'rgba(245, 158, 11, 0.55)');
      fireGlow.addColorStop(1, 'rgba(220, 38, 38, 0)');
      ctx.fillStyle = fireGlow;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 52 * flamePulse, 0, Math.PI * 2);
      ctx.fill();

      // Phase label in center of council table
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(254, 243, 199, 0.92)';
      ctx.font = '600 13px "Anuphan", sans-serif';
      const phaseTitle =
        st.phase === 'NIGHT_ACTION'
          ? `คืนที่ ${st.dayCount} · ยามวิกาล`
          : st.phase === 'DAY_DISCUSSION'
          ? `วันที่ ${st.dayCount} · สภาหมู่บ้าน`
          : st.phase === 'DAY_VOTING'
          ? `วันที่ ${st.dayCount} · ลงมติประหาร`
          : 'บทสรุปชะตากรรม';
      ctx.fillText(phaseTitle, centerX, centerY + 34);

      // 4. Draw Vote Arrows if in voting / resolved votes
      if (st.votes.length > 0) {
        for (const v of st.votes) {
          const fromSeat = seats.find((s) => s.player.id === v.voterId);
          const toSeat = seats.find((s) => s.player.id === v.targetId);
          if (fromSeat && toSeat) {
            const dx = toSeat.x - fromSeat.x;
            const dy = toSeat.y - fromSeat.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;
            const startX = fromSeat.x + ux * (fromSeat.r + 6);
            const startY = fromSeat.y + uy * (fromSeat.r + 6);
            const endX = toSeat.x - ux * (toSeat.r + 10);
            const endY = toSeat.y - uy * (toSeat.r + 10);

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
            ctx.lineWidth = 2;
            ctx.stroke();

            // Arrowhead
            const headLen = 8;
            const angle = Math.atan2(dy, dx);
            ctx.beginPath();
            ctx.moveTo(endX, endY);
            ctx.lineTo(
              endX - headLen * Math.cos(angle - Math.PI / 6),
              endY - headLen * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
              endX - headLen * Math.cos(angle + Math.PI / 6),
              endY - headLen * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fillStyle = '#F59E0B';
            ctx.fill();
            ctx.restore();
          }
        }
      }

      // 5. Render each Player Seat around the Council Circle
      for (const seat of seats) {
        const { player, x, y, r } = seat;
        const isSelected =
          st.selectedTargetId === player.id || st.secondTargetId === player.id;
        const isHovered = st.hoveredId === player.id;
        const isSpeaking = st.activeSpeakerId === player.id;
        const isFellowWolf = st.fellowWolfIds.includes(player.id);
        const seerStatus = st.seerKnownMap[player.id]; // true = wolf, false = innocent, undefined = unknown

        ctx.save();

        // Speaking or Selected outer halo
        if (isSpeaking || isSelected || isHovered) {
          const pulseR = r + 7 + Math.sin(now * 0.01) * 2.5;
          ctx.beginPath();
          ctx.arc(x, y, pulseR, 0, Math.PI * 2);
          ctx.strokeStyle = isSelected
            ? st.secondTargetId === player.id
              ? '#EF4444'
              : '#F59E0B'
            : isSpeaking
            ? '#38BDF8'
            : 'rgba(255, 255, 255, 0.45)';
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.stroke();
        }

        // Seat Circle Fill
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = player.alive ? '#1E293B' : '#0F172A';
        ctx.fill();

        // Seat Border
        const isViewer = player.id === st.viewerPlayerId;
        ctx.lineWidth = isViewer ? 3.2 : player.isHuman ? 2.6 : 2.2;
        ctx.strokeStyle = !player.alive
          ? 'rgba(100, 116, 139, 0.35)'
          : isViewer
          ? '#FBBF24'
          : player.avatarColor;
        ctx.stroke();

        // Player Initial / Icon inside seat
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (!player.alive) {
          ctx.fillStyle = '#EF4444';
          ctx.font = '700 16px "Anuphan", sans-serif';
          ctx.fillText('✕', x, y);
        } else {
          ctx.fillStyle = '#F8FAFC';
          ctx.font = `700 ${r >= 26 ? 13 : 11}px "Anuphan", sans-serif`;
          ctx.fillText(player.shortName, x, y);
        }

        // Secret Knowledge or Public Revealed Beggar Indicator (NEVER leak other human friends' secret roles!)
        if (
          st.showTrueRoles ||
          isViewer ||
          player.revealedBeggar ||
          isFellowWolf ||
          seerStatus !== undefined
        ) {
          const badgeY = y - r - 8;
          ctx.font = '600 10px "Anuphan", sans-serif';
          let label = '';
          let color = '#FBBF24';

          if (st.showTrueRoles || isViewer) {
            label = ROLE_INFO[player.role].thaiName;
            color = ROLE_INFO[player.role].accentColor;
          } else if (player.revealedBeggar) {
            label = 'ยาจก (งดโหวต)';
            color = '#EAB308';
          } else if (isFellowWolf) {
            label =
              player.role === 'WOLF_CUB' ? 'ลูกหมาป่า (พวกเรา)' : 'หมาป่า (พวกเรา)';
            color = '#EF4444';
          } else if (seerStatus !== undefined) {
            label = seerStatus ? 'ส่องพบ: หมาป่า!' : 'ส่องพบ: ชาวบ้าน';
            color = seerStatus ? '#EF4444' : '#10B981';
          }

          if (label) {
            ctx.fillStyle = color;
            ctx.fillText(label, x, badgeY);
          }
        }

        // Nameplate & Persona below seat
        ctx.textBaseline = 'alphabetic';
        ctx.font = '600 11px "Anuphan", sans-serif';
        ctx.fillStyle = player.alive ? '#F1F5F9' : '#64748B';
        ctx.fillText(player.name, x, y + r + 14);

        ctx.font = '400 10px "Anuphan", sans-serif';
        ctx.fillStyle = player.alive ? '#94A3B8' : '#475569';
        ctx.fillText(
          player.alive
            ? player.revealedBeggar
              ? 'เปิดเผยการ์ดยาจกแล้ว · ไม่มีสิทธิ์โหวต'
              : player.personaLabel
            : 'เสียชีวิตแล้ว',
          x,
          y + r + 27
        );

        ctx.restore();
      }

      // 6. Update & Draw Ambient Embers
      for (const e of embers) {
        e.life += dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.life >= e.maxLife || e.y < 0) {
          e.x = Math.random();
          e.y = 0.95 + Math.random() * 0.05;
          e.life = 0;
        }
        const px = e.x * width;
        const py = e.y * height;
        const fade = Math.sin((e.life / e.maxLife) * Math.PI);
        ctx.fillStyle = e.color;
        ctx.globalAlpha = Math.max(0, e.alpha * fade * 0.65);
        ctx.beginPath();
        ctx.arc(px, py, e.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 7. Update & Draw Burst Particles
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.life += dt;
        if (b.life >= b.maxLife) {
          bursts.splice(i, 1);
          continue;
        }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vx *= 0.94;
        b.vy *= 0.94;
        const alpha = 1 - b.life / b.maxLife;
        ctx.fillStyle = b.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size * alpha, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 8. Hit flash overlay on dramatic events
      if (st.hitFlash > 0) {
        st.hitFlash = Math.max(0, st.hitFlash - dt * 1.8);
        ctx.fillStyle = `rgba(220, 38, 38, ${st.hitFlash * 0.35})`;
        ctx.fillRect(0, 0, width, height);
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      canvas.removeEventListener('mousemove', handlePointerMove);
      canvas.removeEventListener('mousedown', handlePointerDown);
    };
  }, [onSelectPlayer]);

  return (
    <canvas
      ref={canvasRef}
      className="block w-full h-full select-none"
      aria-label="กระดานสภาหมู่บ้านจันทร์ทมิฬ"
    />
  );
};
