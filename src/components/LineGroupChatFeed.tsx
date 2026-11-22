import React from 'react';
import { Crown, Lock, Moon, Skull, Sun, Users } from 'lucide-react';
import { ChatMessage, PhaseType, Player } from '../data/werewolfEngine';

export interface LineGroupChatFeedProps {
  messages: ChatMessage[];
  players: Player[];
  myPlayer: Player | null;
  phase: PhaseType;
  dayCount: number;
  lineDarkMode: boolean;
  onToggleLineDarkMode: () => void;
  isGeneratingAI: boolean;
  typingBotName: string | null;
  typingBotPlayer?: Player | null;
  aiError: string | null;
  isPendingVoteRetry: boolean;
  onRetryAI: () => void;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
  showHeader?: boolean;
}

const GMHoodIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <path
      d="M12 2.5L4.5 9.5C3.5 11.8 3.2 15.2 3.8 19.5C6.5 21 9.2 21.5 12 21.5C14.8 21.5 17.5 21 20.2 19.5C20.8 15.2 20.5 11.8 19.5 9.5L12 2.5Z"
      fill="currentColor"
      fillOpacity="0.22"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
    <path
      d="M7.5 13C7.5 10.2 9.5 8 12 8C14.5 8 16.5 10.2 16.5 13C16.5 15.4 14.8 17.5 12 18.2C9.2 17.5 7.5 15.4 7.5 13Z"
      fill="#0F172A"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <circle cx="10.2" cy="12.6" r="1.05" fill="#FBBF24" />
    <circle cx="13.8" cy="12.6" r="1.05" fill="#FBBF24" />
    <path
      d="M8.8 5.2L10.3 3.4L12 4.9L13.7 3.4L15.2 5.2"
      stroke="#FBBF24"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const LineGroupChatFeed: React.FC<LineGroupChatFeedProps> = ({
  messages,
  players,
  myPlayer,
  phase,
  dayCount,
  lineDarkMode,
  onToggleLineDarkMode,
  isGeneratingAI,
  typingBotName,
  typingBotPlayer,
  aiError,
  isPendingVoteRetry,
  onRetryAI,
  chatEndRef,
  showHeader = true,
}) => {
  const aliveCount = players.filter((p) => p.alive).length;
  const readReceiptCount = Math.max(0, aliveCount - 1);

  const playerLookup = React.useMemo(() => {
    const map = new Map<string, { player: Player; seatIndex: number }>();
    players.forEach((p, idx) => {
      map.set(p.id, { player: p, seatIndex: idx + 1 });
    });
    return map;
  }, [players]);

  const phaseShortText =
    phase === 'NIGHT_ACTION'
      ? `คืนที่ ${dayCount}`
      : phase === 'DAY_DISCUSSION'
      ? `วันที่ ${dayCount} · ถกเถียง`
      : phase === 'DAY_VOTING'
      ? `วันที่ ${dayCount} · โหวตประหาร`
      : phase === 'DAY_RESULT'
      ? `วันที่ ${dayCount} · หลังโหวต`
      : 'จบเกม';

  const getInitialGlyph = (name: string): string => {
    const clean = name.replace(/^(ไอ้|อี|คุณ)\s*/, '').trim();
    const chars = Array.from(clean);
    return chars[0] || '?';
  };

  return (
    <div
      className={`flex-1 min-h-0 flex flex-col overflow-hidden transition-colors duration-200 ${
        lineDarkMode ? 'bg-[#192231]' : 'bg-[#7494C0]'
      }`}
    >
      {/* Authentic LINE Group Chat Top Bar */}
      {showHeader && (
        <div
          className={`shrink-0 px-3 py-2 flex items-center justify-between gap-2 border-b transition-colors ${
            lineDarkMode
              ? 'bg-[#111827] border-slate-800 text-slate-100'
              : 'bg-[#6383AF] border-[#5977A1] text-white'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                lineDarkMode
                  ? 'bg-[#06C755]/20 text-[#06C755]'
                  : 'bg-white/20 text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs md:text-[13px] font-bold leading-tight truncate">
                <span className="truncate">หมู่บ้านจันทร์ทมิฬ</span>
                <span className="font-mono tabular-nums opacity-85 shrink-0">
                  ({aliveCount}/{players.length})
                </span>
              </div>
              <div className="text-[10px] opacity-85 truncate flex items-center gap-1">
                <span>ผู้คุมเกม (GM) ดูแลห้อง</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{phaseShortText}</span>
              </div>
            </div>
          </div>

          {/* Subtle Light/Dark LINE Mode Toggle */}
          <button
            type="button"
            onClick={onToggleLineDarkMode}
            className={`min-h-[32px] px-2.5 py-1 rounded-full text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer shrink-0 whitespace-nowrap ${
              lineDarkMode
                ? 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700'
                : 'bg-black/20 hover:bg-black/30 text-white border border-white/15'
            }`}
            title={
              lineDarkMode
                ? 'สลับเป็นธีม LINE คลาสสิกสีฟ้า'
                : 'สลับเป็นธีม LINE โหมดมืด'
            }
          >
            {lineDarkMode ? (
              <>
                <Sun className="w-3 h-3 text-amber-300" />
                <span>LINE ฟ้า</span>
              </>
            ) : (
              <>
                <Moon className="w-3 h-3 text-white" />
                <span>โหมดมืด</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Scrollable LINE Chat Stream */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-2.5 py-3 md:px-3.5 md:py-3.5 space-y-2.5"
        style={
          lineDarkMode
            ? undefined
            : {
                backgroundImage:
                  'linear-gradient(180deg, #82A1CC 0%, #7494C0 42%, #6D8EB9 100%)',
              }
        }
      >
        {messages.map((m) => {
          const isMod = m.senderId === 'moderator';
          const isSecret = m.senderId === 'secret' || m.isSecret;
          const isMe = Boolean(myPlayer && m.senderId === myPlayer.id);

          // 1. Official Game Master ("ผู้คุมเกม (GM)") & Secret GM Banners — Centered LINE System Pills
          if (isMod || isSecret) {
            const isCompactReady = m.gmType === 'READY';
            const isTease = m.gmType === 'TEASE';

            if (isCompactReady) {
              return (
                <div key={m.id} className="flex justify-center my-1 px-2">
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-black/40 backdrop-blur-[2px] px-3.5 py-1 text-[11.5px] font-medium text-white/95 shadow-sm max-w-[92%] text-center">
                    <span className="truncate">{m.text}</span>
                    <span className="text-[9.5px] text-white/60 font-mono tabular-nums shrink-0">
                      {m.timestamp}
                    </span>
                  </div>
                </div>
              );
            }

            return (
              <div key={m.id} className="flex justify-center my-2 px-1">
                <div
                  className={`w-full max-w-[94%] rounded-2xl px-3.5 py-2.5 text-[12.5px] md:text-[13px] leading-relaxed shadow-sm backdrop-blur-[3px] ${
                    isSecret
                      ? 'bg-[#261704]/85 border border-amber-400/50 text-amber-50'
                      : isTease
                      ? 'bg-[#111827]/72 border border-amber-300/35 text-white'
                      : 'bg-black/42 border border-white/12 text-white'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="inline-flex items-center gap-1.5 min-w-0">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                          isSecret
                            ? 'bg-amber-400/20 text-amber-300'
                            : 'bg-amber-400/20 text-amber-300'
                        }`}
                      >
                        {isSecret ? (
                          <Lock className="w-3 h-3" />
                        ) : isTease ? (
                          <Crown className="w-3 h-3" />
                        ) : (
                          <GMHoodIcon className="w-3.5 h-3.5" />
                        )}
                      </span>
                      <span className="font-bold text-[11.5px] text-amber-300 truncate">
                        {isSecret
                          ? `ผู้คุมเกม (GM) · กระซิบลับเฉพาะคุณ`
                          : m.senderName === 'ผู้ดำเนินเกม (Moderator)'
                          ? 'ผู้คุมเกม (GM)'
                          : m.senderName}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono tabular-nums text-white/70 shrink-0">
                      {m.phaseLabel} · {m.timestamp}
                    </span>
                  </div>
                  <div className="whitespace-pre-line select-text text-white/95">
                    {m.text}
                  </div>
                </div>
              </div>
            );
          }

          // 2. Human Player's Own Message — Right Side Classic LINE Bright Green Bubble (#8CE66B) + Tail
          if (isMe) {
            return (
              <div key={m.id} className="flex items-end justify-end gap-1.5 pl-8">
                {/* Tiny Read Receipt + Timestamp on the bottom-left of the green bubble */}
                <div className="flex flex-col items-end justify-end text-[9.5px] leading-[1.15] font-mono tabular-nums shrink-0 pb-0.5 select-none">
                  {readReceiptCount > 0 && (
                    <span
                      className={
                        lineDarkMode ? 'text-slate-400' : 'text-white/85'
                      }
                    >
                      อ่านแล้ว {readReceiptCount}
                    </span>
                  )}
                  <span
                    className={
                      lineDarkMode ? 'text-slate-400' : 'text-white/85'
                    }
                  >
                    {m.timestamp}
                  </span>
                </div>

                {/* Bright LINE Green Bubble with Right-Pointing Tail */}
                <div className="relative max-w-[78%] mr-1.5">
                  {/* Right Tail SVG */}
                  <svg
                    viewBox="0 0 10 14"
                    className="absolute top-[5px] -right-[7px] w-[10px] h-[14px] pointer-events-none"
                    aria-hidden="true"
                  >
                    <path
                      d="M0 0 C4 1 8 2 10 0 C7 5 5 10 0 12 Z"
                      fill={lineDarkMode ? '#06C755' : '#8CE66B'}
                    />
                  </svg>
                  <div
                    className={`relative px-3.5 py-2 rounded-[18px] rounded-tr-[5px] text-[13.5px] md:text-[14px] leading-[1.48] whitespace-pre-line break-words select-text shadow-[0_1px_2px_rgba(0,0,0,0.14)] ${
                      lineDarkMode
                        ? 'bg-[#06C755] text-[#051B0D] font-medium'
                        : 'bg-[#8CE66B] text-[#111111]'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              </div>
            );
          }

          // 3. Other Players' Messages (AI Bots & Other Humans) — Left Side Circular Avatar + Nickname + White Bubble (#FFFFFF) + Tail + Timestamp
          const matched = playerLookup.get(m.senderId);
          const speakerPlayer = matched?.player;
          const seatNum = matched?.seatIndex;
          const avatarBg = speakerPlayer?.avatarColor || '#64748B';
          const displayNickname = speakerPlayer?.shortName || m.senderName;
          const genderSymbol =
            m.senderGender === 'M' || speakerPlayer?.gender === 'M'
              ? '♂'
              : m.senderGender === 'F' || speakerPlayer?.gender === 'F'
              ? '♀'
              : null;
          const isDeadNow = speakerPlayer ? !speakerPlayer.alive : false;

          return (
            <div key={m.id} className="flex items-start gap-2 pr-4">
              {/* Circular Avatar on Top-Left */}
              <div className="relative shrink-0 mt-0.5">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-sm border-2 ${
                    lineDarkMode ? 'border-slate-700' : 'border-white/70'
                  } ${isDeadNow ? 'opacity-65 grayscale-[35%]' : ''}`}
                  style={{ backgroundColor: avatarBg }}
                  title={m.senderName}
                >
                  {getInitialGlyph(displayNickname)}
                </div>
                {seatNum && (
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-slate-900/90 text-white text-[9px] font-mono font-bold tabular-nums flex items-center justify-center border border-white/70">
                    {seatNum}
                  </span>
                )}
                {isDeadNow && (
                  <span
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white flex items-center justify-center border border-white"
                    title="เสียชีวิตแล้ว"
                  >
                    <Skull className="w-2.5 h-2.5" />
                  </span>
                )}
              </div>

              {/* Nickname + Bubble + Timestamp */}
              <div className="flex flex-col items-start min-w-0 max-w-[82%]">
                {/* Nickname & Gender / Seat Label above bubble */}
                <div
                  className={`flex items-center flex-wrap gap-1 px-1 mb-0.5 text-[11px] leading-tight ${
                    lineDarkMode
                      ? 'text-slate-200'
                      : 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.28)]'
                  }`}
                >
                  <span className="font-bold">{displayNickname}</span>
                  {genderSymbol && (
                    <span
                      className={`text-[10px] font-bold ${
                        genderSymbol === '♂'
                          ? lineDarkMode
                            ? 'text-sky-300'
                            : 'text-[#DCEEFF]'
                          : lineDarkMode
                          ? 'text-pink-300'
                          : 'text-[#FFE0EF]'
                      }`}
                    >
                      {genderSymbol}
                    </span>
                  )}
                  {m.senderPersona && (
                    <span className="text-[10px] opacity-85">
                      · {m.senderPersona}
                    </span>
                  )}
                </div>

                {/* White Speech Bubble with Left Tail + Timestamp at bottom-right */}
                <div className="flex items-end gap-1.5 max-w-full">
                  <div className="relative ml-1.5 min-w-0">
                    {/* Left Tail SVG */}
                    <svg
                      viewBox="0 0 10 14"
                      className="absolute top-[5px] -left-[7px] w-[10px] h-[14px] pointer-events-none"
                      aria-hidden="true"
                    >
                      <path
                        d="M10 0 C6 1 2 2 0 0 C3 5 5 10 10 12 Z"
                        fill={lineDarkMode ? '#293548' : '#FFFFFF'}
                      />
                    </svg>
                    <div
                      className={`relative px-3.5 py-2 rounded-[18px] rounded-tl-[5px] text-[13.5px] md:text-[14px] leading-[1.48] whitespace-pre-line break-words select-text shadow-[0_1px_2px_rgba(0,0,0,0.12)] ${
                        lineDarkMode
                          ? 'bg-[#293548] text-slate-100'
                          : 'bg-white text-[#111111]'
                      }`}
                    >
                      {m.text}
                    </div>
                  </div>

                  {/* Tiny Timestamp next to bottom of bubble */}
                  <span
                    className={`text-[9.5px] font-mono tabular-nums shrink-0 pb-0.5 select-none ${
                      lineDarkMode ? 'text-slate-400' : 'text-white/85'
                    }`}
                  >
                    {m.timestamp}
                  </span>
                </div>
              </div>
            </div>
          );
        })}

        {/* LINE-Style Typing Indicator when AI Bot is generating via LLM */}
        {isGeneratingAI && (
          <div className="flex items-start gap-2 pr-6 pt-0.5">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shadow-sm border-2 shrink-0 ${
                lineDarkMode ? 'border-slate-700' : 'border-white/70'
              }`}
              style={{
                backgroundColor: typingBotPlayer?.avatarColor || '#475569',
              }}
            >
              {typingBotPlayer
                ? getInitialGlyph(typingBotPlayer.shortName)
                : 'AI'}
            </div>
            <div className="flex flex-col items-start">
              <span
                className={`text-[11px] font-semibold px-1 mb-0.5 ${
                  lineDarkMode
                    ? 'text-slate-300'
                    : 'text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.28)]'
                }`}
              >
                {typingBotName
                  ? `${typingBotName} กำลังพิมพ์...`
                  : 'เพื่อนในวงกำลังพิมพ์...'}
              </span>
              <div
                className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-[18px] rounded-tl-[5px] shadow-sm ${
                  lineDarkMode ? 'bg-[#293548]' : 'bg-white'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full animate-bounce ${
                    lineDarkMode ? 'bg-slate-300' : 'bg-slate-500'
                  }`}
                  style={{ animationDelay: '0ms' }}
                />
                <span
                  className={`w-1.5 h-1.5 rounded-full animate-bounce ${
                    lineDarkMode ? 'bg-slate-300' : 'bg-slate-500'
                  }`}
                  style={{ animationDelay: '150ms' }}
                />
                <span
                  className={`w-1.5 h-1.5 rounded-full animate-bounce ${
                    lineDarkMode ? 'bg-slate-300' : 'bg-slate-500'
                  }`}
                  style={{ animationDelay: '300ms' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Inline LLM Retry Alert (never falls back to hardcoded scripts) */}
        {aiError && !isGeneratingAI && (
          <div className="flex justify-center px-1 pt-1">
            <div className="w-full max-w-[94%] rounded-2xl px-3.5 py-2.5 bg-red-950/85 border border-red-400/50 text-xs text-red-100 flex flex-wrap items-center justify-between gap-2 shadow-md">
              <span>⚠️ {aiError}</span>
              <button
                type="button"
                onClick={onRetryAI}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-[11px] cursor-pointer shrink-0"
              >
                {isPendingVoteRetry
                  ? 'ลองนับโหวต AI ใหม่'
                  : 'ลองเรียกบอทคุยใหม่'}
              </button>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>
    </div>
  );
};
