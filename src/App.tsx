import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ban,
  Check,
  Clock,
  Copy,
  Crosshair,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileCode,
  Flame,
  Link2,
  MessageSquare,
  Moon,
  Pause,
  Play,
  RotateCcw,
  Send,
  Shield,
  Shuffle,
  Skull,
  Sparkles,
  Sun,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  ABSTAIN_VOTE_ID,
  BodyguardRecord,
  ChatMessage,
  HumanParticipant,
  PhaseType,
  Player,
  PostGameReaction,
  ROLE_INFO,
  RoleType,
  SeerRecord,
  VoteRecord,
  checkWinCondition,
  createInitialPlayers,
  generateLocalDayDiscussion,
  generateLocalPostGameDebrief,
  generateLocalReplyToHuman,
  generateLocalVotes,
  generateLocalWolfPartnerReply,
  isWerewolfTeam,
  resolveNightPhase,
} from './data/werewolfEngine';
import { VillageCanvas } from './components/VillageCanvas';
import {
  DeathAnimationOverlay,
  DeathAnimationType,
} from './components/DeathAnimationOverlay';
import {
  BodyguardAnimationOverlay,
  BodyguardAnimationType,
} from './components/BodyguardAnimationOverlay';
import { soundFX } from './utils/sound';

type ShellState =
  | 'FRIEND_JOIN'
  | 'TITLE_SCREEN'
  | 'ROLE_REVEAL'
  | 'PLAYING'
  | 'PAUSED'
  | 'GAME_OVER';

interface RoomPreviewInfo {
  exists: boolean;
  roomId: string;
  totalPlayers: number;
  humanCount: number;
  maxHumans: number;
  participants: { id: string; name: string; isOnline: boolean }[];
  gameStarted: boolean;
  isFull: boolean;
}

function detectInitialRoomSetup(): { roomId: string; isInvitedLink: boolean } {
  if (typeof window === 'undefined') {
    return { roomId: 'WOLF88', isInvitedLink: false };
  }
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('room')?.trim().toUpperCase();
  if (fromUrl && fromUrl.length >= 3) {
    // Check if this browser tab already joined or created this exact room
    try {
      const joinedRoom = window.sessionStorage.getItem('werewolf_joined_room');
      if (joinedRoom === fromUrl) {
        return { roomId: fromUrl, isInvitedLink: false };
      }
    } catch {
      // Ignore storage errors
    }
    return { roomId: fromUrl, isInvitedLink: true };
  }

  const randomCode = 'WOLF' + Math.floor(100 + Math.random() * 900).toString();
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('room', randomCode);
    window.history.replaceState({}, '', url.toString());
    window.sessionStorage.setItem('werewolf_joined_room', randomCode);
  } catch {
    // Ignore history/storage errors in restricted iframes
  }
  return { roomId: randomCode, isInvitedLink: false };
}

function getOrCreateMyClientId(): string {
  if (typeof window === 'undefined') return 'human-1';
  try {
    const existing = window.sessionStorage.getItem('werewolf_client_id');
    if (existing) return existing;
    const created = 'human-' + Math.random().toString(36).substring(2, 8);
    window.sessionStorage.setItem('werewolf_client_id', created);
    return created;
  } catch {
    return 'human-' + Math.random().toString(36).substring(2, 8);
  }
}

function getInitialSavedName(isInvited: boolean): string {
  if (typeof window === 'undefined') return isInvited ? '' : 'ผู้เล่น 1';
  try {
    const saved = window.localStorage.getItem('werewolf_player_name');
    if (saved !== null) return saved;
    return isInvited ? '' : 'ผู้เล่น 1';
  } catch {
    return isInvited ? '' : 'ผู้เล่น 1';
  }
}

export default function App() {
  const initialRoomRef = useRef<{ roomId: string; isInvitedLink: boolean } | null>(null);
  if (!initialRoomRef.current) {
    initialRoomRef.current = detectInitialRoomSetup();
  }

  const [roomId, setRoomId] = useState<string>(initialRoomRef.current.roomId);
  const [hasJoinedRoom, setHasJoinedRoom] = useState<boolean>(
    !initialRoomRef.current.isInvitedLink
  );
  const [shellState, setShellState] = useState<ShellState>(
    initialRoomRef.current.isInvitedLink ? 'FRIEND_JOIN' : 'TITLE_SCREEN'
  );
  const [myClientId] = useState<string>(() => getOrCreateMyClientId());
  const [myName, setMyName] = useState<string>(() =>
    getInitialSavedName(initialRoomRef.current!.isInvitedLink)
  );
  const [roomPreview, setRoomPreview] = useState<RoomPreviewInfo | null>(null);
  const [roomFullError, setRoomFullError] = useState<boolean>(false);
  const [hostId, setHostId] = useState<string | null>(
    initialRoomRef.current.isInvitedLink ? null : getOrCreateMyClientId()
  );

  const [totalPlayerCount, setTotalPlayerCount] = useState<number>(10);
  const [humanParticipants, setHumanParticipants] = useState<HumanParticipant[]>(() => [
    {
      id: getOrCreateMyClientId(),
      name: getInitialSavedName(initialRoomRef.current!.isInvitedLink) || 'ผู้เล่น 1',
      isOnline: true,
    },
  ]);
  const [newFriendNameInput, setNewFriendNameInput] = useState<string>('');
  const [copiedInviteLink, setCopiedInviteLink] = useState<boolean>(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  const [players, setPlayers] = useState<Player[]>(() =>
    createInitialPlayers({
      totalPlayers: 10,
      humanParticipants: [
        {
          id: getOrCreateMyClientId(),
          name: getInitialSavedName(initialRoomRef.current!.isInvitedLink) || 'ผู้เล่น 1',
        },
      ],
    })
  );

  const [phase, setPhase] = useState<PhaseType>('NIGHT_ACTION');
  const [dayCount, setDayCount] = useState<number>(1);

  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [secondTargetId, setSecondTargetId] = useState<string | null>(null);
  const [nightReadyIds, setNightReadyIds] = useState<string[]>([]);
  const [voteReadyIds, setVoteReadyIds] = useState<string[]>([]);
  const [phaseReadyIds, setPhaseReadyIds] = useState<string[]>([]);
  const [hasSubmittedNight, setHasSubmittedNight] = useState<boolean>(false);
  const [hasSubmittedVote, setHasSubmittedVote] = useState<boolean>(false);

  const [doubleKillNextNight, setDoubleKillNextNight] = useState<boolean>(false);
  const [lastProtectedId, setLastProtectedId] = useState<string | null>(null);
  const [seerKnowledge, setSeerKnowledge] = useState<SeerRecord[]>([]);
  const [bodyguardKnowledge, setBodyguardKnowledge] = useState<BodyguardRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [votes, setVotes] = useState<VoteRecord[]>([]);

  const [humanInput, setHumanInput] = useState<string>('');
  const [isGeneratingAI, setIsGeneratingAI] = useState<boolean>(false);
  const [postGameReactions, setPostGameReactions] = useState<PostGameReaction[]>([]);
  const [isGeneratingPostGame, setIsGeneratingPostGame] = useState<boolean>(false);

  // Private Werewolf Pack Chat & Target Signaling (ONLY visible to Werewolves)
  const [wolfMessages, setWolfMessages] = useState<ChatMessage[]>([]);
  const [wolfSignals, setWolfSignals] = useState<
    Record<string, { primary: string | null; secondary?: string | null }>
  >({});
  const [wolfChatInput, setWolfChatInput] = useState<string>('');
  const [isGeneratingWolfAI, setIsGeneratingWolfAI] = useState<boolean>(false);
  const [activeChatTab, setActiveChatTab] = useState<'PUBLIC' | 'WOLF'>('PUBLIC');
  const [unreadWolfCount, setUnreadWolfCount] = useState<number>(0);
  const [wolfConsensusError, setWolfConsensusError] = useState<string | null>(null);

  // 5-minute countdown timer before auto-entering Night during DAY_RESULT
  const [phaseDeadlineAt, setPhaseDeadlineAt] = useState<number | null>(null);
  const [dayResultSecondsLeft, setDayResultSecondsLeft] = useState<number>(300);

  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);
  const [showRoleCardModal, setShowRoleCardModal] = useState<boolean>(false);
  const [roleCardImgError, setRoleCardImgError] = useState<boolean>(false);
  const [muted, setMuted] = useState<boolean>(false);
  const [impactTrigger, setImpactTrigger] = useState<number>(0);
  const [winSummary, setWinSummary] = useState<{
    winner: 'VILLAGE' | 'WEREWOLF' | null;
    reasonThai: string;
  }>({ winner: null, reasonThai: '' });

  const [showDownloadModal, setShowDownloadModal] = useState<boolean>(false);
  const [sourceFiles, setSourceFiles] = useState<{ path: string; content: string }[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState<number>(0);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const myNameRef = useRef<string>(myName);
  myNameRef.current = myName;
  const phaseReadyIdsRef = useRef<string[]>(phaseReadyIds);
  phaseReadyIdsRef.current = phaseReadyIds;
  const activeChatTabRef = useRef<'PUBLIC' | 'WOLF'>(activeChatTab);
  activeChatTabRef.current = activeChatTab;
  const aiWolfOpenedNightRef = useRef<number>(0);
  const [deathOverlay, setDeathOverlay] = useState<DeathAnimationType | null>(null);
  const [bodyguardOverlay, setBodyguardOverlay] =
    useState<BodyguardAnimationType | null>(null);
  const lastHandledShieldEventIdRef = useRef<string | null>(null);
  const prevMyAliveRef = useRef<boolean | null>(null);
  const player1NameInputRef = useRef<HTMLInputElement | null>(null);
  const friendNicknameInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const wolfChatEndRef = useRef<HTMLDivElement | null>(null);

  // Refs to hold latest resolve functions for WebSocket server triggers
  const executeNightResolveRef = useRef<
    ((collectedActions: Record<string, { primary: string | null; secondary?: string | null }>) => void) | null
  >(null);
  const executeVoteResolveRef = useRef<
    ((collectedVotes: Record<string, string>) => void) | null
  >(null);
  const executePhaseAdvanceRef = useRef<
    ((targetPhase: 'DAY_VOTING' | 'NIGHT_ACTION', reason?: 'UNANIMOUS' | 'TIMEOUT') => void) | null
  >(null);

  const formatTime = () => {
    const d = new Date();
    return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  };

  // Fetch room status when a friend lands on the FRIEND_JOIN nickname screen
  useEffect(() => {
    if (shellState !== 'FRIEND_JOIN') return;
    let active = true;

    const loadPreview = async () => {
      try {
        const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
        const data: RoomPreviewInfo = await res.json();
        if (active) {
          setRoomPreview(data);
          setRoomFullError(Boolean(data.isFull));
        }
      } catch {
        // Ignore network error
      }
    };

    loadPreview();
    const timer = window.setInterval(loadPreview, 3500);
    setTimeout(() => friendNicknameInputRef.current?.focus(), 120);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [shellState, roomId]);

  const handleFriendJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = myName.trim();
    if (!trimmed) return;
    try {
      window.localStorage.setItem('werewolf_player_name', trimmed);
      window.sessionStorage.setItem('werewolf_joined_room', roomId);
    } catch {
      // Ignore storage errors
    }
    setMyName(trimmed);
    myNameRef.current = trimmed;
    setRoomFullError(false);
    setHasJoinedRoom(true);
    setShellState('TITLE_SCREEN');
  };

  const handleCreateOwnNewRoom = () => {
    const newCode = 'WOLF' + Math.floor(100 + Math.random() * 900).toString();
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', newCode);
      window.history.replaceState({}, '', url.toString());
      window.sessionStorage.setItem('werewolf_joined_room', newCode);
    } catch {
      // Ignore
    }
    setRoomId(newCode);
    setRoomFullError(false);
    setHostId(myClientId);
    setHasJoinedRoom(true);
    setShellState('TITLE_SCREEN');
  };

  // Broadcast helper over WebSocket
  const sendWsMessage = useCallback(
    (payload: Record<string, any>) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ roomId, ...payload }));
      }
    },
    [roomId]
  );

  // Connect to WebSocket room once the player has joined (Host immediately, Friend right after entering nickname)
  useEffect(() => {
    if (!hasJoinedRoom) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws-game`;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let isDisposed = false;

    const connect = () => {
      if (isDisposed) return;
      try {
        socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onopen = () => {
          setWsConnected(true);
          socket?.send(
            JSON.stringify({
              type: 'JOIN_ROOM',
              roomId,
              playerId: myClientId,
              playerName: myNameRef.current.trim() || 'ผู้เล่น 1',
            })
          );
        };

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'ROOM_FULL') {
              setRoomFullError(true);
              setHasJoinedRoom(false);
              setShellState('FRIEND_JOIN');
              return;
            }
            if (data.type === 'ROOM_SYNC' || data.type === 'LOBBY_UPDATED') {
              if (data.hostId) setHostId(data.hostId);
              if (typeof data.totalPlayers === 'number') {
                setTotalPlayerCount(data.totalPlayers);
              }
              if (Array.isArray(data.participants) && data.participants.length > 0) {
                setHumanParticipants(
                  data.participants.map((p: HumanParticipant) =>
                    p.id === myClientId ? { ...p, name: myNameRef.current } : p
                  )
                );
              }
              if (Array.isArray(data.nightReadyIds)) {
                setNightReadyIds(data.nightReadyIds);
              }
              if (Array.isArray(data.voteReadyIds)) {
                setVoteReadyIds(data.voteReadyIds);
              }
              if (Array.isArray(data.phaseReadyIds)) {
                setPhaseReadyIds(data.phaseReadyIds);
              }
              if (data.phaseDeadlineAt !== undefined) {
                setPhaseDeadlineAt(data.phaseDeadlineAt || null);
              }
              if (Array.isArray(data.wolfMessages)) {
                setWolfMessages(data.wolfMessages);
              }
              if (data.wolfSignals && typeof data.wolfSignals === 'object') {
                setWolfSignals(data.wolfSignals);
              }
              if (data.type === 'ROOM_SYNC' && data.gameStarted && data.snapshot) {
                const snap = data.snapshot;
                const snapPlayers: Player[] = Array.isArray(snap.players) ? snap.players : [];
                if (snapPlayers.length > 0) setPlayers(snapPlayers);
                if (snap.phase) setPhase(snap.phase);
                if (typeof snap.dayCount === 'number') setDayCount(snap.dayCount);
                if (typeof snap.doubleKillNextNight === 'boolean') {
                  setDoubleKillNextNight(snap.doubleKillNextNight);
                }
                if (Array.isArray(snap.seerKnowledge)) setSeerKnowledge(snap.seerKnowledge);
                if (Array.isArray(snap.bodyguardKnowledge)) {
                  setBodyguardKnowledge(snap.bodyguardKnowledge);
                }
                if (Array.isArray(snap.messages)) setMessages(snap.messages);
                if (Array.isArray(snap.votes)) setVotes(snap.votes);
                if (snap.winSummary) setWinSummary(snap.winSummary);
                if (Array.isArray(snap.postGameReactions)) {
                  setPostGameReactions(snap.postGameReactions);
                }
                const amInMatch = snapPlayers.some((p) => p.id === myClientId);
                setHasSubmittedNight(
                  snap.phase === 'NIGHT_ACTION' &&
                    Array.isArray(data.nightReadyIds) &&
                    data.nightReadyIds.includes(myClientId)
                );
                setHasSubmittedVote(
                  snap.phase === 'DAY_VOTING' &&
                    Array.isArray(data.voteReadyIds) &&
                    data.voteReadyIds.includes(myClientId)
                );
                setShellState(
                  snap.shellState === 'GAME_OVER'
                    ? 'GAME_OVER'
                    : amInMatch
                    ? 'ROLE_REVEAL'
                    : 'PLAYING'
                );
              }
            } else if (data.type === 'GAME_STARTED' && data.snapshot) {
              const snap = data.snapshot;
              const snapPlayers: Player[] = Array.isArray(snap.players) ? snap.players : [];
              if (data.hostId) setHostId(data.hostId);
              if (Array.isArray(data.participants) && data.participants.length > 0) {
                setHumanParticipants(
                  data.participants.map((p: HumanParticipant) =>
                    p.id === myClientId ? { ...p, name: myNameRef.current } : p
                  )
                );
              }
              if (snapPlayers.length > 0) setPlayers(snapPlayers);
              if (snap.phase) setPhase(snap.phase);
              if (typeof snap.dayCount === 'number') setDayCount(snap.dayCount);
              setDoubleKillNextNight(Boolean(snap.doubleKillNextNight));
              setLastProtectedId(snap.lastProtectedId || null);
              setSeerKnowledge(snap.seerKnowledge || []);
              setBodyguardKnowledge(snap.bodyguardKnowledge || []);
              setMessages(snap.messages || []);
              setVotes(snap.votes || []);
              setWinSummary(snap.winSummary || { winner: null, reasonThai: '' });
              setPostGameReactions([]);
              setIsGeneratingPostGame(false);
              setWolfMessages([]);
              setWolfSignals({});
              setWolfConsensusError(null);
              setActiveChatTab('PUBLIC');
              setUnreadWolfCount(0);
              setPhaseDeadlineAt(null);
              aiWolfOpenedNightRef.current = 0;
              setSelectedTargetId(null);
              setSecondTargetId(null);
              setNightReadyIds([]);
              setVoteReadyIds([]);
              setPhaseReadyIds([]);
              setHasSubmittedNight(false);
              setHasSubmittedVote(false);
              setRoleCardImgError(false);
              setDeathOverlay(null);
              setBodyguardOverlay(null);
              lastHandledShieldEventIdRef.current = null;
              const myStartPlayer = snapPlayers.find((p) => p.id === myClientId);
              prevMyAliveRef.current = myStartPlayer ? myStartPlayer.alive : null;
              const amInMatch = Boolean(myStartPlayer);
              setShellState(amInMatch ? 'ROLE_REVEAL' : 'PLAYING');
              soundFX.playMessagePop(true);
            } else if (data.type === 'GAME_STATE_UPDATED' && data.snapshot) {
              const snap = data.snapshot;
              if (data.hostId) setHostId(data.hostId);
              let diedInThisSync = false;
              if (Array.isArray(snap.players)) {
                const meInSnap = (snap.players as Player[]).find(
                  (p) => p.id === myClientId
                );
                if (meInSnap) {
                  if (prevMyAliveRef.current === true && !meInSnap.alive) {
                    diedInThisSync = true;
                    const elim = snap.lastElimination as
                      | { cause: DeathAnimationType; victimIds?: string[] }
                      | null
                      | undefined;
                    if (
                      elim &&
                      Array.isArray(elim.victimIds) &&
                      elim.victimIds.includes(myClientId)
                    ) {
                      setDeathOverlay(elim.cause);
                    } else {
                      setDeathOverlay(
                        snap.phase === 'DAY_DISCUSSION'
                          ? 'WOLF_KILL'
                          : 'DAY_EXECUTION'
                      );
                    }
                  }
                  prevMyAliveRef.current = meInSnap.alive;
                }
                setPlayers(snap.players);
              }
              const myShieldEv = snap.myShieldEvent as
                | { eventId?: string; type?: BodyguardAnimationType }
                | null
                | undefined;
              if (
                myShieldEv?.eventId &&
                myShieldEv?.type &&
                lastHandledShieldEventIdRef.current !== myShieldEv.eventId
              ) {
                lastHandledShieldEventIdRef.current = myShieldEv.eventId;
                if (!diedInThisSync) {
                  setBodyguardOverlay(myShieldEv.type);
                }
              }
              if (snap.phase) setPhase(snap.phase);
              if (typeof snap.dayCount === 'number') setDayCount(snap.dayCount);
              if (typeof snap.doubleKillNextNight === 'boolean') {
                setDoubleKillNextNight(snap.doubleKillNextNight);
              }
              if (snap.lastProtectedId !== undefined) {
                setLastProtectedId(snap.lastProtectedId);
              }
              if (Array.isArray(snap.seerKnowledge)) setSeerKnowledge(snap.seerKnowledge);
              if (Array.isArray(snap.bodyguardKnowledge)) {
                setBodyguardKnowledge(snap.bodyguardKnowledge);
              }
              if (Array.isArray(snap.messages)) setMessages(snap.messages);
              if (Array.isArray(snap.votes)) setVotes(snap.votes);
              if (snap.winSummary) setWinSummary(snap.winSummary);
              if (Array.isArray(snap.postGameReactions)) {
                setPostGameReactions(snap.postGameReactions);
                if (snap.postGameReactions.length > 0) {
                  setIsGeneratingPostGame(false);
                }
              }
              if (data.phaseDeadlineAt !== undefined) {
                setPhaseDeadlineAt(data.phaseDeadlineAt || null);
              }
              if (Array.isArray(data.wolfMessages) && data.wolfMessages.length > 0) {
                setWolfMessages(data.wolfMessages);
              }
              if (data.wolfSignals && typeof data.wolfSignals === 'object') {
                setWolfSignals(data.wolfSignals);
              }
              if (snap.phase !== 'NIGHT_ACTION') {
                setWolfConsensusError(null);
              }
              const nextNightReady: string[] = Array.isArray(data.nightReadyIds)
                ? data.nightReadyIds
                : [];
              const nextVoteReady: string[] = Array.isArray(data.voteReadyIds)
                ? data.voteReadyIds
                : [];
              const nextPhaseReady: string[] = Array.isArray(data.phaseReadyIds)
                ? data.phaseReadyIds
                : [];
              setNightReadyIds(nextNightReady);
              setVoteReadyIds(nextVoteReady);
              setPhaseReadyIds(nextPhaseReady);
              setHasSubmittedNight(
                snap.phase === 'NIGHT_ACTION' && nextNightReady.includes(myClientId)
              );
              setHasSubmittedVote(
                snap.phase === 'DAY_VOTING' && nextVoteReady.includes(myClientId)
              );
              if (snap.shellState === 'GAME_OVER') {
                setShellState('GAME_OVER');
                if (!Array.isArray(snap.postGameReactions) || snap.postGameReactions.length === 0) {
                  const hasAnyAI = Array.isArray(snap.players) && snap.players.some((p: Player) => !p.isHuman);
                  if (hasAnyAI) setIsGeneratingPostGame(true);
                }
              }
            } else if (data.type === 'HUMAN_CHAT_RECEIVED' && data.chatMessage) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === data.chatMessage.id)) return prev;
                return [...prev, data.chatMessage];
              });
              soundFX.playMessagePop(false);
            } else if (data.type === 'WOLF_CHAT_RECEIVED' && data.wolfMessage) {
              setWolfMessages((prev) => {
                if (prev.some((m) => m.id === data.wolfMessage.id)) return prev;
                return [...prev, data.wolfMessage];
              });
              if (activeChatTabRef.current !== 'WOLF') {
                setUnreadWolfCount((c) => c + 1);
              }
              soundFX.playMessagePop(false);
            } else if (data.type === 'WOLF_SIGNALS_UPDATED') {
              if (data.wolfSignals && typeof data.wolfSignals === 'object') {
                setWolfSignals(data.wolfSignals);
              }
              setWolfConsensusError(null);
            } else if (data.type === 'WOLF_CONSENSUS_MISMATCH') {
              if (data.wolfSignals && typeof data.wolfSignals === 'object') {
                setWolfSignals(data.wolfSignals);
              }
              setHasSubmittedNight(false);
              setWolfConsensusError(
                data.message ||
                  'ความเห็นหมาป่าทั้ง 2 ตัวไม่ตรงกัน! โปรดคุยและกดส่งซิกเลือกเหยื่อคนเดียวกันก่อนยืนยัน'
              );
              soundFX.playMessagePop(true);
            } else if (data.type === 'PHASE_DEADLINE_UPDATED') {
              setPhaseDeadlineAt(data.phaseDeadlineAt || null);
            } else if (data.type === 'NIGHT_READY_UPDATED') {
              if (Array.isArray(data.nightReadyIds)) {
                setNightReadyIds(data.nightReadyIds);
              }
            } else if (data.type === 'VOTE_READY_UPDATED') {
              if (Array.isArray(data.voteReadyIds)) {
                setVoteReadyIds(data.voteReadyIds);
              }
            } else if (data.type === 'PHASE_READY_UPDATED') {
              if (Array.isArray(data.phaseReadyIds)) {
                setPhaseReadyIds(data.phaseReadyIds);
              }
            } else if (data.type === 'EXECUTE_NIGHT_RESOLVE') {
              executeNightResolveRef.current?.(data.humanActions || {});
            } else if (data.type === 'EXECUTE_VOTE_RESOLVE') {
              executeVoteResolveRef.current?.(data.humanVotes || {});
            } else if (data.type === 'EXECUTE_PHASE_ADVANCE') {
              if (data.targetPhase === 'DAY_VOTING' || data.targetPhase === 'NIGHT_ACTION') {
                executePhaseAdvanceRef.current?.(data.targetPhase, data.reason);
              }
            } else if (data.type === 'RETURNED_TO_LOBBY') {
              if (data.hostId) setHostId(data.hostId);
              if (typeof data.totalPlayers === 'number') {
                setTotalPlayerCount(data.totalPlayers);
              }
              if (Array.isArray(data.participants)) {
                setHumanParticipants(data.participants);
              }
              setPhaseDeadlineAt(null);
              setWolfMessages([]);
              setWolfSignals({});
              setShellState('TITLE_SCREEN');
            }
          } catch {
            // Ignore malformed WS message
          }
        };

        socket.onclose = () => {
          setWsConnected(false);
          if (!isDisposed) {
            reconnectTimer = window.setTimeout(connect, 2500);
          }
        };
      } catch {
        setWsConnected(false);
      }
    };

    connect();

    return () => {
      isDisposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (socket) socket.close();
    };
  }, [hasJoinedRoom, roomId, myClientId]);

  // Keep Lobby preview canvas synced with chosen player count and human participants while on TITLE_SCREEN
  useEffect(() => {
    if (shellState === 'TITLE_SCREEN' || shellState === 'FRIEND_JOIN') {
      setPlayers(
        createInitialPlayers({
          totalPlayers: totalPlayerCount,
          humanParticipants: humanParticipants.map((hp, i) => ({
            ...hp,
            name: hp.name.trim() || `ผู้เล่น ${i + 1}`,
          })),
        })
      );
    }
  }, [shellState, totalPlayerCount, humanParticipants]);

  // Handle changing Player 1 / own nickname smoothly
  const handleMyNameChange = (newName: string) => {
    setMyName(newName);
    myNameRef.current = newName;
    try {
      window.localStorage.setItem('werewolf_player_name', newName);
    } catch {
      // Ignore storage error
    }

    setHumanParticipants((prev) => {
      const hasMe = prev.some((p) => p.id === myClientId);
      const nextList = hasMe
        ? prev.map((p) => (p.id === myClientId ? { ...p, name: newName } : p))
        : [{ id: myClientId, name: newName, isOnline: true }, ...prev];
      sendWsMessage({
        type: 'UPDATE_NAME',
        playerId: myClientId,
        playerName: newName,
      });
      return nextList;
    });
  };

  // Handle changing total player count (6 - 10)
  const handleSelectTotalPlayers = (count: number) => {
    const clamped = Math.max(
      6,
      Math.min(10, Math.max(count, humanParticipants.length))
    );
    setTotalPlayerCount(clamped);
    sendWsMessage({
      type: 'UPDATE_LOBBY',
      totalPlayers: clamped,
      participants: humanParticipants,
    });
  };

  // Add another human player directly in the lobby (up to 10 real humans max)
  const handleAddHumanFriend = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newFriendNameInput.trim();
    if (!trimmed) return;
    if (humanParticipants.length >= 10) return;

    const newFriend: HumanParticipant = {
      id: `human-friend-${Date.now().toString(36)}`,
      name: trimmed,
      isOnline: false, // Local hotseat friend (not separate WS device)
    };
    const updatedParticipants = [...humanParticipants, newFriend];
    const updatedTotal = Math.max(totalPlayerCount, updatedParticipants.length);
    setHumanParticipants(updatedParticipants);
    setTotalPlayerCount(updatedTotal);
    setNewFriendNameInput('');

    sendWsMessage({
      type: 'UPDATE_LOBBY',
      totalPlayers: updatedTotal,
      participants: updatedParticipants,
    });
  };

  // Edit any participant's name in the lobby
  const handleEditParticipantName = (id: string, nameVal: string) => {
    if (id === myClientId) {
      handleMyNameChange(nameVal);
      return;
    }
    const updated = humanParticipants.map((p) =>
      p.id === id ? { ...p, name: nameVal } : p
    );
    setHumanParticipants(updated);
    sendWsMessage({
      type: 'UPDATE_LOBBY',
      totalPlayers: totalPlayerCount,
      participants: updated,
    });
  };

  const handleRemoveParticipant = (id: string) => {
    if (humanParticipants.length <= 1) return;
    const updated = humanParticipants.filter((p) => p.id !== id);
    setHumanParticipants(updated);
    sendWsMessage({
      type: 'UPDATE_LOBBY',
      totalPlayers: totalPlayerCount,
      participants: updated,
    });
  };

  const inviteUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  }, [roomId]);

  const handleCopyInviteLink = () => {
    navigator.clipboard.writeText(inviteUrl).catch(() => {});
    setCopiedInviteLink(true);
    setTimeout(() => setCopiedInviteLink(false), 2500);
  };

  const openDownloadModal = async () => {
    setShowDownloadModal(true);
    if (sourceFiles.length === 0) {
      try {
        const res = await fetch('/api/project-files');
        const data = await res.json();
        if (Array.isArray(data.files)) {
          setSourceFiles(data.files);
        }
      } catch {
        // Ignore
      }
    }
  };

  const handleCopyFileContent = (pathStr: string, content: string) => {
    navigator.clipboard.writeText(content).catch(() => {});
    setCopiedFile(pathStr);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const handleDownloadSingleFile = (pathStr: string, content: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = pathStr.replace(/\//g, '_');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Number of real humans currently connected online via separate browsers/devices
  const onlineHumansList = useMemo(
    () => humanParticipants.filter((hp) => hp.isOnline),
    [humanParticipants]
  );
  const isMultiDeviceOnline = wsConnected && onlineHumansList.length > 1;
  const isHost = !hostId || hostId === myClientId;

  // STRICT PRIVACY: Each device/browser ONLY EVER sees its own player (by myClientId) — zero fallback to Host/other players!
  const myPlayer = useMemo(
    () => players.find((p) => p.id === myClientId) || null,
    [players, myClientId]
  );

  const fellowWolves = useMemo(() => {
    if (!myPlayer || !isWerewolfTeam(myPlayer.role)) return [];
    return players.filter(
      (p) => p.id !== myPlayer.id && isWerewolfTeam(p.role)
    );
  }, [myPlayer, players]);

  const amWerewolf = Boolean(myPlayer && isWerewolfTeam(myPlayer.role));
  const livingWolves = useMemo(
    () => players.filter((p) => p.alive && isWerewolfTeam(p.role)),
    [players]
  );
  const livingFellowWolf = useMemo(
    () =>
      myPlayer && isWerewolfTeam(myPlayer.role)
        ? livingWolves.find((w) => w.id !== myPlayer.id) || null
        : null,
    [myPlayer, livingWolves]
  );
  const requiresWolfConsensus = Boolean(
    amWerewolf &&
      myPlayer?.alive &&
      livingWolves.length === 2 &&
      !doubleKillNextNight
  );
  const myWolfSignalTargetId =
    (myPlayer && wolfSignals[myPlayer.id]?.primary) || selectedTargetId;
  const fellowWolfSignalTargetId = livingFellowWolf
    ? wolfSignals[livingFellowWolf.id]?.primary || null
    : null;
  const wolvesAgreedOnTarget =
    !requiresWolfConsensus ||
    Boolean(
      myWolfSignalTargetId &&
        fellowWolfSignalTargetId &&
        myWolfSignalTargetId === fellowWolfSignalTargetId
    );

  const seerKnownMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (myPlayer && myPlayer.role === 'SEER') {
      seerKnowledge.forEach((rec) => {
        map[rec.targetId] = rec.isWerewolf;
      });
    }
    return map;
  }, [myPlayer, seerKnowledge]);

  const alivePlayers = useMemo(() => players.filter((p) => p.alive), [players]);
  const aliveAICount = useMemo(
    () => alivePlayers.filter((p) => !p.isHuman).length,
    [alivePlayers]
  );

  const onlineAliveHumans = useMemo(() => {
    const onlineIds = new Set(onlineHumansList.map((hp) => hp.id));
    return players.filter((p) => p.isHuman && p.alive && onlineIds.has(p.id));
  }, [players, onlineHumansList]);

  const onlineEligibleHumanVoters = useMemo(
    () => onlineAliveHumans.filter((p) => p.canVote),
    [onlineAliveHumans]
  );

  // Every living AI + every living online human must press Ready to move to Voting / next Night!
  const requiredPhaseReadyPlayers = useMemo(() => {
    if (wsConnected && onlineHumansList.length > 0) {
      const onlineIds = new Set(onlineHumansList.map((hp) => hp.id));
      return players.filter(
        (p) => p.alive && (!p.isHuman || onlineIds.has(p.id))
      );
    }
    return players.filter((p) => p.alive);
  }, [players, wsConnected, onlineHumansList]);

  const readyCountInPhase = useMemo(
    () =>
      requiredPhaseReadyPlayers.filter((p) => phaseReadyIds.includes(p.id))
        .length,
    [requiredPhaseReadyPlayers, phaseReadyIds]
  );

  const isMyPhaseReady = Boolean(myPlayer && phaseReadyIds.includes(myPlayer.id));

  const allLivingHumansReady = useMemo(() => {
    const reqHumans = requiredPhaseReadyPlayers.filter((p) => p.isHuman);
    return (
      reqHumans.length > 0 &&
      reqHumans.every((p) => phaseReadyIds.includes(p.id))
    );
  }, [requiredPhaseReadyPlayers, phaseReadyIds]);

  const rolePoolPreview = useMemo(() => {
    const effectiveTotal = Math.max(totalPlayerCount, humanParticipants.length);
    const hasBeggar = effectiveTotal >= 7;
    const villagerCount = Math.max(0, effectiveTotal - 4 - (hasBeggar ? 1 : 0));
    return {
      WOLVES_TOTAL: 2,
      SEER: 1,
      BODYGUARD: 1,
      BEGGAR: hasBeggar ? 1 : 0,
      VILLAGER: villagerCount,
    };
  }, [totalPlayerCount, humanParticipants.length]);

  const aiSeatsRemaining = Math.max(0, totalPlayerCount - humanParticipants.length);

  // Start a new game: 100% Pure Random Role Assignment + Random AI reduction -> Show ROLE_REVEAL screen
  const startNewRandomGame = useCallback(() => {
    const sanitizedParticipants = humanParticipants.slice(0, 10).map((hp, i) => ({
      ...hp,
      name: hp.name.trim() || `ผู้เล่น ${i + 1}`,
    }));

    const effectiveTotal = Math.max(
      6,
      Math.min(10, Math.max(totalPlayerCount, sanitizedParticipants.length))
    );

    setHumanParticipants(sanitizedParticipants);
    setTotalPlayerCount(effectiveTotal);

    const meEntry = sanitizedParticipants.find((p) => p.id === myClientId);
    if (meEntry) {
      setMyName(meEntry.name);
      myNameRef.current = meEntry.name;
    }

    const freshPlayers = createInitialPlayers({
      totalPlayers: effectiveTotal,
      humanParticipants: sanitizedParticipants,
    });

    const humansInGame = freshPlayers.filter((p) => p.isHuman);
    const aiList = freshPlayers.filter((p) => !p.isHuman);
    const hasBeggar = freshPlayers.some((p) => p.role === 'BEGGAR');
    const villagerCount = freshPlayers.filter((p) => p.role === 'VILLAGER').length;

    const introText =
      `สวัสดีครับ! ยินดีต้อนรับเข้าสู่ "หมู่บ้านจันทร์ทมิฬ — Ultimate Werewolf" ผมรับหน้าที่เป็น Game Master (ผู้ดำเนินเกม) ของพวกคุณในค่ำคืนนี้\n` +
      `ในกระดานนี้มีผู้เล่นทั้งหมด ${freshPlayers.length} คน (ผู้เล่นคนจริง ${humansInGame.length} คน${
        aiList.length > 0 ? ` และผู้เล่น AI สุ่มเสริม ${aiList.length} คน` : ' · เล่นด้วยคนจริงครบทุกคน!'
      }) โดยระบบได้ทำการสุ่มบทบาทลับให้ทุกคนเรียบร้อยแล้ว:\n` +
      `• ฝ่ายหมาป่า (2 ตน): สุ่ม 2 ตนจาก 3 สายพันธุ์ ได้แก่ พ่อหมาป่า · ลูกหมาป่า (ถ้าตาย คืนถัดไปหมาป่าฆ่าได้ 2 ศพ!) · หมาป่ามนุษย์ (หมอดูส่องเห็นเป็นชาวบ้าน!)\n` +
      `• ฝ่ายชาวบ้าน (${freshPlayers.length - 2} คน): เทพพยากรณ์ (Seer) 1 คน · บอดี้การ์ด 1 คน${
        hasBeggar ? ' · ยาจก/คนงี่เง่า 1 คน' : ''
      } · ชาวบ้าน ${villagerCount} คน\n` +
      `• กติกาการโหวตประหาร: สามารถเลือก "งดออกเสียง" ได้ และหากผลโหวตประหารมีคะแนนสูงสุดเสมอกัน จะไม่มีใครถูกประหารในวันนั้น`;

    const rosterText =
      `รายชื่อผู้เข้าร่วมโต๊ะสภาทั้ง ${freshPlayers.length} คน:\n` +
      freshPlayers
        .map(
          (p, idx) =>
            `${idx + 1}. ${p.name}${p.isHuman ? ' (ผู้เล่นคนจริง)' : ''}`
        )
        .join('\n');

    const secretRoleMessages: ChatMessage[] = humansInGame.map((hu, idx) => {
      const partnerWolves = isWerewolfTeam(hu.role)
        ? freshPlayers.filter((p) => p.id !== hu.id && isWerewolfTeam(p.role))
        : [];
      const secretText =
        `[สารลับเฉพาะ ${hu.name}] บทบาทที่คุณสุ่มได้ในเกมนี้คือ "${ROLE_INFO[hu.role].thaiName} (${ROLE_INFO[hu.role].englishName})" · ${ROLE_INFO[hu.role].teamThai}\n` +
        `${ROLE_INFO[hu.role].summary}` +
        (partnerWolves.length > 0
          ? `\n🐺 เพื่อนร่วมฝูงหมาป่าของคุณคือ: ${partnerWolves
              .map((w) => `${w.name} [${ROLE_INFO[w.role].thaiName}]`)
              .join(' และ ')}!`
          : '');

      return {
        id: `msg-secret-${Date.now()}-${idx}`,
        senderId: 'secret',
        senderName: `ความลับประจำตัว (${hu.name})`,
        text: secretText,
        phaseLabel: 'บทบาทลับที่สุ่มได้',
        isSecret: true,
        visibleToPlayerId: hu.id,
        timestamp: formatTime(),
      };
    });

    const night1PromptText =
      `เข้าสู่ คืนที่ 1 (Night 1): ความมืดมิดเข้าปกคลุมหมู่บ้านจันทร์ทมิฬ ขอให้ทุกคนหลับตาลง...\n` +
      `โปรดเลือกแอ็กชันประจำบทบาทของคุณในยามวิกาล`;

    const initialMsgs: ChatMessage[] = [
      {
        id: `msg-intro-${Date.now()}-1`,
        senderId: 'moderator',
        senderName: 'ผู้ดำเนินเกม (Moderator)',
        text: introText,
        phaseLabel: `เริ่มเกม · ${freshPlayers.length} ผู้เล่น`,
        timestamp: formatTime(),
      },
      {
        id: `msg-intro-${Date.now()}-2`,
        senderId: 'moderator',
        senderName: 'ผู้ดำเนินเกม (Moderator)',
        text: rosterText,
        phaseLabel: 'รายชื่อผู้เล่นในสภา',
        timestamp: formatTime(),
      },
      ...secretRoleMessages,
      {
        id: `msg-night1-${Date.now()}-4`,
        senderId: 'moderator',
        senderName: 'ผู้ดำเนินเกม (Moderator)',
        text: night1PromptText,
        phaseLabel: 'คืนที่ 1 · ยามวิกาล',
        timestamp: formatTime(),
      },
    ];

    setPlayers(freshPlayers);
    setPhase('NIGHT_ACTION');
    setDayCount(1);
    setSelectedTargetId(null);
    setSecondTargetId(null);
    setNightReadyIds([]);
    setVoteReadyIds([]);
    setPhaseReadyIds([]);
    setHasSubmittedNight(false);
    setHasSubmittedVote(false);
    setDoubleKillNextNight(false);
    setLastProtectedId(null);
    setSeerKnowledge([]);
    setBodyguardKnowledge([]);
    setVotes([]);
    setWinSummary({ winner: null, reasonThai: '' });
    setPostGameReactions([]);
    setIsGeneratingPostGame(false);
    setWolfMessages([]);
    setWolfSignals({});
    setWolfConsensusError(null);
    setActiveChatTab('PUBLIC');
    setUnreadWolfCount(0);
    setPhaseDeadlineAt(null);
    aiWolfOpenedNightRef.current = 0;
    setDeathOverlay(null);
    setBodyguardOverlay(null);
    lastHandledShieldEventIdRef.current = null;
    prevMyAliveRef.current = true;
    setRoleCardImgError(false);
    setMessages(initialMsgs);

    setShellState('ROLE_REVEAL');
    soundFX.playMessagePop(true);

    sendWsMessage({
      type: 'START_GAME',
      snapshot: {
        players: freshPlayers,
        phase: 'NIGHT_ACTION',
        dayCount: 1,
        doubleKillNextNight: false,
        lastProtectedId: null,
        seerKnowledge: [],
        bodyguardKnowledge: [],
        messages: initialMsgs,
        votes: [],
        winSummary: { winner: null, reasonThai: '' },
        postGameReactions: [],
        shellState: 'ROLE_REVEAL',
      },
    });
  }, [humanParticipants, totalPlayerCount, myClientId, sendWsMessage]);

  const broadcastGameState = useCallback(
    (nextState: {
      players: Player[];
      phase: PhaseType;
      dayCount: number;
      doubleKillNextNight: boolean;
      lastProtectedId: string | null;
      seerKnowledge: SeerRecord[];
      bodyguardKnowledge: BodyguardRecord[];
      messages: ChatMessage[];
      votes: VoteRecord[];
      winSummary: { winner: 'VILLAGE' | 'WEREWOLF' | null; reasonThai: string };
      postGameReactions?: PostGameReaction[];
      shellState?: ShellState;
      lastElimination?: { cause: DeathAnimationType; victimIds: string[] } | null;
      nightShieldEvents?: {
        eventId: string;
        byPlayer: Record<string, BodyguardAnimationType>;
      } | null;
    }) => {
      sendWsMessage({
        type: 'SYNC_GAME_STATE',
        snapshot: nextState,
      });
    },
    [sendWsMessage]
  );

  // Trigger Post-Game AI Debrief (candid Thai praise, roasting, shock after all roles are revealed!)
  const triggerPostGameDebrief = useCallback(
    async (params: {
      winner: 'VILLAGE' | 'WEREWOLF';
      reasonThai: string;
      finalDayCount: number;
      finalPlayers: Player[];
      finalMessages: ChatMessage[];
      finalVotes: VoteRecord[];
      finalDoubleKill: boolean;
      finalLastProtected: string | null;
      finalSeer: SeerRecord[];
      finalBg: BodyguardRecord[];
    }) => {
      const aiList = params.finalPlayers.filter((p) => !p.isHuman);
      if (aiList.length === 0) {
        setPostGameReactions([]);
        setIsGeneratingPostGame(false);
        return;
      }

      setIsGeneratingPostGame(true);
      setPostGameReactions([]);

      let reactions: PostGameReaction[] = [];

      try {
        const recentTranscript = params.finalMessages
          .filter((m) => !m.isSecret && m.senderId !== 'secret')
          .slice(-18)
          .map((m) => `${m.senderName}: ${m.text}`);

        const res = await fetch('/api/werewolf/postgame', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            winner: params.winner,
            reasonThai: params.reasonThai,
            dayCount: params.finalDayCount,
            players: params.finalPlayers,
            recentTranscript,
            seerKnowledge: params.finalSeer,
            bodyguardKnowledge: params.finalBg,
          }),
        });
        const json = await res.json();
        if (
          !json.fallback &&
          Array.isArray(json.data?.reactions) &&
          json.data.reactions.length > 0
        ) {
          const validSentiments = new Set(['praise', 'roast', 'shock', 'proud']);
          reactions = json.data.reactions
            .map((item: any) => {
              const matched = params.finalPlayers.find(
                (p) =>
                  !p.isHuman &&
                  (p.id === item.speakerId || p.name.includes(item.speakerName))
              );
              if (!matched) return null;
              const sentiment = validSentiments.has(item.sentiment)
                ? (item.sentiment as PostGameReaction['sentiment'])
                : 'praise';
              return {
                speakerId: matched.id,
                speakerName: matched.name,
                role: matched.role,
                alive: matched.alive,
                moodTag: item.moodTag || 'เปิดใจหลังเกม',
                sentiment,
                text: item.text,
              } as PostGameReaction;
            })
            .filter(Boolean) as PostGameReaction[];
        }
      } catch {
        // Fallback to local engine
      }

      // Ensure every AI player gets a reaction (fill any missing or use local fallback)
      const fallbackAll = generateLocalPostGameDebrief({
        winner: params.winner,
        players: params.finalPlayers,
        dayCount: params.finalDayCount,
        seerKnowledge: params.finalSeer,
        bodyguardKnowledge: params.finalBg,
      });

      if (reactions.length === 0) {
        reactions = fallbackAll;
      } else {
        const existingIds = new Set(reactions.map((r) => r.speakerId));
        for (const fb of fallbackAll) {
          if (!existingIds.has(fb.speakerId)) {
            reactions.push(fb);
          }
        }
      }

      setPostGameReactions(reactions);
      setIsGeneratingPostGame(false);

      const debriefChatMsg: ChatMessage = {
        id: `postgame-debrief-${Date.now()}`,
        senderId: 'moderator',
        senderName: 'วงเม้าท์หลังเปิดการ์ด (AI Debrief)',
        text: reactions
          .map(
            (r) =>
              `• ${r.speakerName} [${ROLE_INFO[r.role].thaiName} · ${r.moodTag}]: "${r.text}"`
          )
          .join('\n'),
        phaseLabel: 'ความในใจหลังจบเกม',
        timestamp: formatTime(),
      };

      const msgsWithDebrief = [...params.finalMessages, debriefChatMsg];
      setMessages(msgsWithDebrief);

      broadcastGameState({
        players: params.finalPlayers,
        phase: 'GAME_OVER',
        dayCount: params.finalDayCount,
        doubleKillNextNight: params.finalDoubleKill,
        lastProtectedId: params.finalLastProtected,
        seerKnowledge: params.finalSeer,
        bodyguardKnowledge: params.finalBg,
        messages: msgsWithDebrief,
        votes: params.finalVotes,
        winSummary: { winner: params.winner, reasonThai: params.reasonThai },
        postGameReactions: reactions,
        shellState: 'GAME_OVER',
      });
    },
    [roomId, broadcastGameState]
  );

  const visibleMessages = useMemo(() => {
    return messages.filter((m) => {
      if (m.isSecret || m.senderId === 'secret') {
        return Boolean(myPlayer && m.visibleToPlayerId === myPlayer.id);
      }
      return true;
    });
  }, [messages, myPlayer]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages, isGeneratingAI]);

  useEffect(() => {
    if (activeChatTab === 'WOLF') {
      wolfChatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadWolfCount(0);
    }
  }, [wolfMessages, isGeneratingWolfAI, activeChatTab]);

  // 5-minute countdown clock during DAY_RESULT (auto-enters Night at 00:00 if not skipped early by unanimous Ready)
  useEffect(() => {
    if (shellState !== 'PLAYING' || phase !== 'DAY_RESULT') {
      return;
    }
    const effectiveDeadline = phaseDeadlineAt ?? Date.now() + 5 * 60 * 1000;
    if (!phaseDeadlineAt) {
      setPhaseDeadlineAt(effectiveDeadline);
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((effectiveDeadline - Date.now()) / 1000));
      setDayResultSecondsLeft(remaining);
      if (remaining === 0 && !wsConnected) {
        executePhaseAdvanceRef.current?.('NIGHT_ACTION', 'TIMEOUT');
      } else if (remaining === 0 && wsConnected && isHost && Date.now() - effectiveDeadline > 2500) {
        executePhaseAdvanceRef.current?.('NIGHT_ACTION', 'TIMEOUT');
      }
    };

    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [shellState, phase, phaseDeadlineAt, wsConnected, isHost]);

  const formatCountdown = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (shellState !== 'PLAYING' || !myPlayer || !myPlayer.alive) return;

    if (
      phase === 'NIGHT_ACTION' &&
      (isWerewolfTeam(myPlayer.role) ||
        myPlayer.role === 'SEER' ||
        myPlayer.role === 'BODYGUARD')
    ) {
      const validList = players.filter((p) => {
        if (!p.alive) return false;
        if (isWerewolfTeam(myPlayer.role)) return !isWerewolfTeam(p.role);
        if (myPlayer.role === 'SEER') return p.id !== myPlayer.id;
        if (myPlayer.role === 'BODYGUARD') return p.id !== lastProtectedId;
        return false;
      });
      // For non-wolves (or solo surviving wolf), auto-highlight first valid target
      if (!isWerewolfTeam(myPlayer.role) && !selectedTargetId && validList[0]) {
        setSelectedTargetId(validList[0].id);
      }
      if (
        doubleKillNextNight &&
        isWerewolfTeam(myPlayer.role) &&
        !selectedTargetId &&
        validList[0]
      ) {
        setSelectedTargetId(validList[0].id);
      }
      if (
        doubleKillNextNight &&
        isWerewolfTeam(myPlayer.role) &&
        !secondTargetId &&
        validList.length > 1
      ) {
        const second = validList.find(
          (p) => p.id !== (selectedTargetId || validList[0].id)
        );
        if (second) setSecondTargetId(second.id);
      }
    }
  }, [
    shellState,
    phase,
    myPlayer,
    players,
    selectedTargetId,
    secondTargetId,
    doubleKillNextNight,
    lastProtectedId,
  ]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInputFocused =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (shellState === 'FRIEND_JOIN') return;

      if (shellState === 'TITLE_SCREEN') {
        if (!isInputFocused && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          startNewRandomGame();
        }
        return;
      }

      if (shellState === 'ROLE_REVEAL') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setShellState('PLAYING');
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        if (showRoleCardModal) {
          setShowRoleCardModal(false);
        } else if (showDownloadModal) {
          setShowDownloadModal(false);
        } else if (shellState === 'PLAYING') {
          setShellState('PAUSED');
        } else if (shellState === 'PAUSED') {
          setShellState('PLAYING');
        }
        return;
      }

      if (!isInputFocused && e.key === 'Tab' && myPlayer) {
        e.preventDefault();
        setShowRoleCardModal((prev) => !prev);
      }
    };

    const handleBlur = () => {
      setActiveSpeakerId(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [shellState, startNewRandomGame, showRoleCardModal, showDownloadModal, myPlayer]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundFX.muted = next;
  };

  const isTargetSelectable = useCallback(
    (target: Player): boolean => {
      if (!target.alive) return false;
      if (!myPlayer || !myPlayer.alive) return false;

      if (phase === 'NIGHT_ACTION') {
        if (myPlayer.role === 'VILLAGER' || myPlayer.role === 'BEGGAR') {
          return false;
        }
        if (isWerewolfTeam(myPlayer.role)) {
          return !isWerewolfTeam(target.role);
        }
        if (myPlayer.role === 'SEER') {
          return target.id !== myPlayer.id;
        }
        if (myPlayer.role === 'BODYGUARD') {
          return target.id !== lastProtectedId;
        }
      }

      if (phase === 'DAY_VOTING') {
        if (!myPlayer.canVote) return false;
        return target.id !== myPlayer.id;
      }

      return true;
    },
    [myPlayer, phase, lastProtectedId]
  );

  // AI fellow wolf response in Private Wolf Chat + target signal alignment (when 1 wolf is Human & 1 is AI)
  const triggerAIWolfPartnerReply = useCallback(
    async (
      mode: 'OPEN_NIGHT' | 'HUMAN_SIGNAL' | 'HUMAN_CHAT',
      humanMsgText: string,
      humanTargetId: string | null
    ) => {
      if (!myPlayer || !livingFellowWolf || livingFellowWolf.isHuman) return;

      if (mode === 'OPEN_NIGHT') {
        const localOpen = generateLocalWolfPartnerReply({
          aiWolf: livingFellowWolf,
          humanWolfName: myPlayer.shortName,
          players,
          nightNumber: dayCount,
          mode: 'OPEN_NIGHT',
        });
        const aiWolfMsg: ChatMessage = {
          id: `wolf-open-${dayCount}-${Date.now()}`,
          senderId: livingFellowWolf.id,
          senderName: `${livingFellowWolf.name} (${ROLE_INFO[livingFellowWolf.role].thaiName})`,
          text: localOpen.text,
          tone: 'กระซิบในฝูงหมาป่า',
          phaseLabel: `คืนที่ ${dayCount} · ฝูงหมาป่า`,
          timestamp: formatTime(),
        };
        setWolfMessages((prev) => [...prev, aiWolfMsg]);
        if (activeChatTabRef.current !== 'WOLF') {
          setUnreadWolfCount((c) => c + 1);
        }
        if (localOpen.suggestedTargetId) {
          setWolfSignals((prev) => ({
            ...prev,
            [livingFellowWolf.id]: { primary: localOpen.suggestedTargetId },
          }));
          sendWsMessage({
            type: 'WOLF_SIGNAL',
            playerId: livingFellowWolf.id,
            wolfSignal: { primary: localOpen.suggestedTargetId },
          });
        }
        sendWsMessage({
          type: 'WOLF_CHAT',
          playerId: livingFellowWolf.id,
          wolfMessage: aiWolfMsg,
        });
        return;
      }

      setIsGeneratingWolfAI(true);
      let replyText = '';
      let suggestedTargetId: string | null = humanTargetId;

      try {
        const res = await fetch('/api/werewolf/wolf-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            nightNumber: dayCount,
            aiWolfId: livingFellowWolf.id,
            humanWolfName: myPlayer.shortName,
            humanMessage: humanMsgText,
            humanSignaledTargetId: humanTargetId,
            players,
            recentWolfTranscript: wolfMessages
              .slice(-6)
              .map((m) => `${m.senderName}: ${m.text}`),
            recentPublicTranscript: messages
              .filter((m) => !m.isSecret)
              .slice(-6)
              .map((m) => `${m.senderName}: ${m.text}`),
          }),
        });
        const json = await res.json();
        if (!json.fallback && json.data?.text) {
          replyText = json.data.text;
          const validTarget = players.find(
            (p) =>
              p.alive &&
              !isWerewolfTeam(p.role) &&
              p.id === json.data.suggestedTargetId
          );
          if (validTarget) {
            suggestedTargetId = validTarget.id;
          }
        }
      } catch {
        // Fallback below
      }

      if (!replyText) {
        const localRes = generateLocalWolfPartnerReply({
          aiWolf: livingFellowWolf,
          humanWolfName: myPlayer.shortName,
          players,
          humanMessage: humanMsgText,
          humanSignaledTargetId: humanTargetId,
          nightNumber: dayCount,
          mode,
        });
        replyText = localRes.text;
        suggestedTargetId = localRes.suggestedTargetId;
      }

      // If human explicitly signaled a target at Night, ensure AI partner aligns when agreeing
      if (mode === 'HUMAN_SIGNAL' && humanTargetId) {
        suggestedTargetId = humanTargetId;
      }

      setIsGeneratingWolfAI(false);

      const aiMsg: ChatMessage = {
        id: `wolf-ai-${Date.now()}`,
        senderId: livingFellowWolf.id,
        senderName: `${livingFellowWolf.name} (${ROLE_INFO[livingFellowWolf.role].thaiName})`,
        text: replyText,
        tone: 'กระซิบในฝูงหมาป่า',
        phaseLabel:
          phase === 'NIGHT_ACTION'
            ? `คืนที่ ${dayCount} · ฝูงหมาป่า`
            : `วันที่ ${dayCount} · ฝูงหมาป่า`,
        timestamp: formatTime(),
      };
      setWolfMessages((prev) => [...prev, aiMsg]);
      if (activeChatTabRef.current !== 'WOLF') {
        setUnreadWolfCount((c) => c + 1);
      }
      soundFX.playMessagePop(false);

      if (suggestedTargetId && phase === 'NIGHT_ACTION') {
        setWolfSignals((prev) => ({
          ...prev,
          [livingFellowWolf.id]: { primary: suggestedTargetId },
        }));
        sendWsMessage({
          type: 'WOLF_SIGNAL',
          playerId: livingFellowWolf.id,
          wolfSignal: { primary: suggestedTargetId },
        });
      }
      sendWsMessage({
        type: 'WOLF_CHAT',
        playerId: livingFellowWolf.id,
        wolfMessage: aiMsg,
      });
    },
    [
      myPlayer,
      livingFellowWolf,
      players,
      dayCount,
      roomId,
      wolfMessages,
      messages,
      phase,
      sendWsMessage,
    ]
  );

  // When entering NIGHT_ACTION with an AI wolf partner, AI wolf sends its initial kill signal + whisper automatically
  useEffect(() => {
    if (
      shellState !== 'PLAYING' ||
      phase !== 'NIGHT_ACTION' ||
      !myPlayer ||
      !myPlayer.alive ||
      !isWerewolfTeam(myPlayer.role) ||
      !livingFellowWolf ||
      livingFellowWolf.isHuman
    ) {
      return;
    }
    if (aiWolfOpenedNightRef.current === dayCount) return;
    aiWolfOpenedNightRef.current = dayCount;

    const timer = window.setTimeout(() => {
      void triggerAIWolfPartnerReply('OPEN_NIGHT', '', null);
    }, 550);
    return () => window.clearTimeout(timer);
  }, [shellState, phase, dayCount, myPlayer, livingFellowWolf, triggerAIWolfPartnerReply]);

  const sendWolfSignal = useCallback(
    (primary: string | null, secondary?: string | null) => {
      if (!myPlayer || !myPlayer.alive || !isWerewolfTeam(myPlayer.role)) return;
      setWolfConsensusError(null);
      setWolfSignals((prev) => ({
        ...prev,
        [myPlayer.id]: { primary, secondary: secondary ?? null },
      }));
      sendWsMessage({
        type: 'WOLF_SIGNAL',
        playerId: myPlayer.id,
        wolfSignal: { primary, secondary: secondary ?? null },
      });

      // If partner is AI and currently signaling someone else, notify AI wolf to react & align!
      if (
        primary &&
        livingFellowWolf &&
        !livingFellowWolf.isHuman &&
        wolfSignals[livingFellowWolf.id]?.primary !== primary
      ) {
        void triggerAIWolfPartnerReply('HUMAN_SIGNAL', '', primary);
      }
    },
    [myPlayer, livingFellowWolf, wolfSignals, sendWsMessage, triggerAIWolfPartnerReply]
  );

  const handleSendWolfMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!myPlayer || !isWerewolfTeam(myPlayer.role)) return;
    const textToSend = wolfChatInput.trim();
    if (!textToSend || isGeneratingWolfAI) return;
    setWolfChatInput('');

    const myWolfMsg: ChatMessage = {
      id: `wolf-human-${myPlayer.id}-${Date.now()}`,
      senderId: myPlayer.id,
      senderName: `${myPlayer.name} (${ROLE_INFO[myPlayer.role].thaiName})`,
      text: textToSend,
      tone: 'แชทลับฝูงหมาป่า',
      phaseLabel:
        phase === 'NIGHT_ACTION'
          ? `คืนที่ ${dayCount} · ฝูงหมาป่า`
          : `วันที่ ${dayCount} · ฝูงหมาป่า`,
      timestamp: formatTime(),
    };

    setWolfMessages((prev) => [...prev, myWolfMsg]);
    soundFX.playMessagePop(false);

    sendWsMessage({
      type: 'WOLF_CHAT',
      playerId: myPlayer.id,
      wolfMessage: myWolfMsg,
    });

    if (livingFellowWolf && !livingFellowWolf.isHuman) {
      await triggerAIWolfPartnerReply('HUMAN_CHAT', textToSend, selectedTargetId);
    }
  };

  const handleSelectPlayerOnCanvas = useCallback(
    (playerId: string) => {
      if (!myPlayer) return;
      const target = players.find((p) => p.id === playerId);
      if (!target) return;
      if (!isTargetSelectable(target) && phase !== 'DAY_DISCUSSION') return;

      if (
        phase === 'NIGHT_ACTION' &&
        doubleKillNextNight &&
        isWerewolfTeam(myPlayer.role)
      ) {
        if (selectedTargetId === playerId) return;
        if (!selectedTargetId) {
          setSelectedTargetId(playerId);
          sendWolfSignal(playerId, secondTargetId);
        } else if (secondTargetId === playerId) {
          setSecondTargetId(null);
          sendWolfSignal(selectedTargetId, null);
        } else {
          setSecondTargetId(playerId);
          sendWolfSignal(selectedTargetId, playerId);
        }
      } else {
        setSelectedTargetId(playerId);
        if (phase === 'NIGHT_ACTION' && isWerewolfTeam(myPlayer.role)) {
          sendWolfSignal(playerId, null);
        }
      }
      soundFX.playMessagePop(false);
    },
    [
      myPlayer,
      players,
      isTargetSelectable,
      phase,
      doubleKillNextNight,
      selectedTargetId,
      secondTargetId,
      sendWolfSignal,
    ]
  );

  // Trigger AI Day Discussion (skips cleanly if 0 living AI players)
  const triggerDayDiscussion = useCallback(
    async (
      currentDay: number,
      updatedPlayers: Player[],
      victimPlayers: Player[],
      updatedSeer: SeerRecord[],
      updatedBg: BodyguardRecord[],
      cubRageWasUsed: boolean,
      baseMessages: ChatMessage[],
      currentDoubleKill: boolean,
      currentLastProtected: string | null,
      lastRoundVotes: VoteRecord[]
    ) => {
      const remainingAliveAI = updatedPlayers.filter((p) => p.alive && !p.isHuman);
      if (remainingAliveAI.length === 0) {
        broadcastGameState({
          players: updatedPlayers,
          phase: 'DAY_DISCUSSION',
          dayCount: currentDay,
          doubleKillNextNight: currentDoubleKill,
          lastProtectedId: currentLastProtected,
          seerKnowledge: updatedSeer,
          bodyguardKnowledge: updatedBg,
          messages: baseMessages,
          votes: lastRoundVotes,
          winSummary: { winner: null, reasonThai: '' },
          shellState: 'PLAYING',
        });
        return;
      }

      setIsGeneratingAI(true);
      let aiLines: {
        speakerId: string;
        speakerName: string;
        text: string;
        tone: string;
      }[] = [];

      try {
        const res = await fetch('/api/werewolf/discuss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId,
            dayNumber: currentDay,
            players: updatedPlayers,
            nightVictimNames: victimPlayers.map((v) => v.name),
            seerKnowledge: updatedSeer,
            bodyguardKnowledge: updatedBg,
            previousVotes: lastRoundVotes,
            mode: 'INITIAL_DAY',
          }),
        });
        const json = await res.json();
        if (
          !json.fallback &&
          Array.isArray(json.data?.messages) &&
          json.data.messages.length > 0
        ) {
          aiLines = json.data.messages;
        }
      } catch {
        // Fallback to local analytical engine
      }

      if (aiLines.length === 0) {
        aiLines = generateLocalDayDiscussion({
          dayNumber: currentDay,
          players: updatedPlayers,
          victimPlayers,
          seerKnowledge: updatedSeer,
          bodyguardKnowledge: updatedBg,
          cubRageTriggeredLastRound: cubRageWasUsed,
          previousVotes: lastRoundVotes,
        });
      }

      setIsGeneratingAI(false);

      const generatedMsgs: ChatMessage[] = [];
      aiLines.forEach((line, idx) => {
        const speaker = updatedPlayers.find(
          (p) => p.id === line.speakerId || p.name.includes(line.speakerName)
        );
        if (speaker && (!speaker.alive || speaker.isHuman)) return;

        const msgObj: ChatMessage = {
          id: `msg-day-${currentDay}-${idx}-${Date.now()}`,
          senderId: speaker?.id || line.speakerId,
          senderName: speaker?.name || line.speakerName,
          text: line.text,
          tone: line.tone,
          phaseLabel: `วันที่ ${currentDay} · ถกเถียง`,
          timestamp: formatTime(),
        };
        generatedMsgs.push(msgObj);

        setTimeout(() => {
          setActiveSpeakerId(speaker?.id || line.speakerId);
          soundFX.playMessagePop(false);
          setMessages((prev) => [...prev, msgObj]);
        }, idx * 180);
      });

      setTimeout(() => {
        setActiveSpeakerId(null);
        broadcastGameState({
          players: updatedPlayers,
          phase: 'DAY_DISCUSSION',
          dayCount: currentDay,
          doubleKillNextNight: currentDoubleKill,
          lastProtectedId: currentLastProtected,
          seerKnowledge: updatedSeer,
          bodyguardKnowledge: updatedBg,
          messages: [...baseMessages, ...generatedMsgs],
          votes: lastRoundVotes,
          winSummary: { winner: null, reasonThai: '' },
          shellState: 'PLAYING',
        });
      }, aiLines.length * 180 + 180);
    },
    [broadcastGameState, roomId]
  );

  // Let AI players continue analyzing and debating among themselves
  const handleContinueAIDebate = async () => {
    if (isGeneratingAI || aliveAICount === 0) return;
    setIsGeneratingAI(true);

    let aiLines: {
      speakerId: string;
      speakerName: string;
      text: string;
      tone: string;
    }[] = [];

    try {
      const recentTranscript = messages
        .filter((m) => !m.isSecret)
        .slice(-12)
        .map((m) => `${m.senderName}: ${m.text}`);

      const res = await fetch('/api/werewolf/discuss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          dayNumber: dayCount,
          players,
          seerKnowledge,
          bodyguardKnowledge,
          recentTranscript,
          previousVotes: votes,
          mode: 'CONTINUE_DEBATE',
        }),
      });
      const json = await res.json();
      if (
        !json.fallback &&
        Array.isArray(json.data?.messages) &&
        json.data.messages.length > 0
      ) {
        aiLines = json.data.messages;
      }
    } catch {
      // Fallback
    }

    if (aiLines.length === 0) {
      aiLines = generateLocalDayDiscussion({
        dayNumber: dayCount,
        players,
        victimPlayers: [],
        seerKnowledge,
        bodyguardKnowledge,
        cubRageTriggeredLastRound: false,
        previousVotes: votes,
      }).slice(0, 3);
    }

    setIsGeneratingAI(false);

    const newMsgs: ChatMessage[] = [];
    aiLines.forEach((line, idx) => {
      const speaker = players.find(
        (p) => p.id === line.speakerId || p.name.includes(line.speakerName)
      );
      if (speaker && (!speaker.alive || speaker.isHuman)) return;

      const msgObj: ChatMessage = {
        id: `msg-cont-${dayCount}-${idx}-${Date.now()}`,
        senderId: speaker?.id || line.speakerId,
        senderName: speaker?.name || line.speakerName,
        text: line.text,
        tone: line.tone,
        phaseLabel: `วันที่ ${dayCount} · วิเคราะห์ต่อ`,
        timestamp: formatTime(),
      };
      newMsgs.push(msgObj);

      setTimeout(() => {
        setActiveSpeakerId(speaker?.id || line.speakerId);
        soundFX.playMessagePop(false);
        setMessages((prev) => [...prev, msgObj]);
      }, idx * 180);
    });

    setTimeout(() => {
      setActiveSpeakerId(null);
      broadcastGameState({
        players,
        phase,
        dayCount,
        doubleKillNextNight,
        lastProtectedId,
        seerKnowledge,
        bodyguardKnowledge,
        messages: [...messages, ...newMsgs],
        votes,
        winSummary,
        shellState: 'PLAYING',
      });
    }, aiLines.length * 180 + 180);
  };

  // Core Night Resolution (called immediately in solo mode, or when all online friends submit)
  const executeNightResolution = useCallback(
    async (
      collectedHumanActions: Record<
        string,
        { primary: string | null; secondary?: string | null }
      >
    ) => {
      const wasDoubleKill = doubleKillNextNight;
      const outcome = resolveNightPhase({
        nightNumber: dayCount,
        players,
        humanActions: collectedHumanActions,
        doubleKillActive: wasDoubleKill,
        seerKnowledge,
        bodyguardKnowledge,
        lastProtectedId,
      });

      const nextSeer = outcome.newSeerRecord
        ? [...seerKnowledge, outcome.newSeerRecord]
        : seerKnowledge;
      const nextBg = outcome.newBodyguardRecord
        ? [...bodyguardKnowledge, outcome.newBodyguardRecord]
        : bodyguardKnowledge;

      setSeerKnowledge(nextSeer);
      setBodyguardKnowledge(nextBg);
      const nextLastProtected = outcome.protectedId || lastProtectedId;
      if (outcome.protectedId) {
        setLastProtectedId(outcome.protectedId);
      }

      const victimIds = new Set(outcome.victimPlayers.map((v) => v.id));
      const updatedPlayers = players.map((p) =>
        victimIds.has(p.id) ? { ...p, alive: false } : p
      );

      // Trigger dramatic Werewolf Night Kill overlay if the local human player was killed tonight
      const myBeforeNight = players.find((p) => p.id === myClientId);
      if (myBeforeNight?.alive && victimIds.has(myClientId)) {
        prevMyAliveRef.current = false;
        setDeathOverlay('WOLF_KILL');
      }

      // Compute per-player Bodyguard Shield Perspective Animations (strictly privacy-filtered per player on server)
      const shieldByPlayer: Record<string, BodyguardAnimationType> = {};
      // 1) Saved Victim's Perspective (non-Bodyguard player attacked by wolves and saved by BG)
      for (const sv of outcome.savedPlayers) {
        if (sv.role !== 'BODYGUARD') {
          shieldByPlayer[sv.id] = 'VICTIM_SAVED';
        }
      }
      // 2) Werewolf's Perspective — Kill Blocked (living Werewolves when BG blocked a kill tonight)
      if (outcome.savedPlayers.length > 0) {
        for (const p of players) {
          if (p.alive && isWerewolfTeam(p.role) && !victimIds.has(p.id)) {
            shieldByPlayer[p.id] = 'WOLF_BLOCKED';
          }
        }
      }
      // 3) Bodyguard's Perspective — Successful Protection (including self-save) or Wrong Target
      const livingBgBeforeNight = players.find(
        (p) => p.alive && p.role === 'BODYGUARD'
      );
      if (
        livingBgBeforeNight &&
        !victimIds.has(livingBgBeforeNight.id) &&
        outcome.protectedId
      ) {
        const bgSavedTarget = outcome.savedPlayers.some(
          (s) => s.id === outcome.protectedId
        );
        shieldByPlayer[livingBgBeforeNight.id] = bgSavedTarget
          ? 'BG_SUCCESS'
          : 'BG_FAILED';
      }

      const nightShieldEventsPayload =
        Object.keys(shieldByPlayer).length > 0
          ? {
              eventId: `shield-n${dayCount}-${Date.now()}`,
              byPlayer: shieldByPlayer,
            }
          : null;

      if (
        nightShieldEventsPayload &&
        shieldByPlayer[myClientId] &&
        !victimIds.has(myClientId)
      ) {
        lastHandledShieldEventIdRef.current = nightShieldEventsPayload.eventId;
        setBodyguardOverlay(shieldByPlayer[myClientId]);
      }

      const nightEliminationPayload =
        victimIds.size > 0
          ? { cause: 'WOLF_KILL' as const, victimIds: Array.from(victimIds) }
          : null;

      setPlayers(updatedPlayers);
      setSelectedTargetId(null);
      setSecondTargetId(null);
      setNightReadyIds([]);
      setHasSubmittedNight(false);
      setDoubleKillNextNight(outcome.cubDiedTonight);

      const newSecretMsgs: ChatMessage[] = outcome.secretMessages.map((sm, i) => ({
        id: `secret-n${dayCount}-${i}-${Date.now()}`,
        senderId: 'secret',
        senderName: 'บันทึกความลับยามวิกาล',
        text: sm.text,
        tone: sm.tone,
        phaseLabel: `คืนที่ ${dayCount} · ความลับ`,
        isSecret: true,
        visibleToPlayerId: sm.visibleToPlayerId,
        timestamp: formatTime(),
      }));

      let dawnAnnouncement = '';
      if (outcome.victimPlayers.length > 0) {
        setImpactTrigger((c) => c + 1);
        const victimNames = outcome.victimPlayers.map((v) => `"${v.name}"`).join(' และ ');
        dawnAnnouncement =
          `รุ่งอรุณของวันที่ ${dayCount} มาถึงแล้ว... เมื่อคืนมีเสียงกรีดร้องดังขึ้นในหมู่บ้าน ผู้ที่ถูกสังหารเมื่อคืนนี้คือ ${victimNames}! ` +
          `(ตามกฎของเกม เราจะไม่เปิดเผยบทบาทของผู้เสียชีวิตในตอนกลางคืน)` +
          (outcome.cubDiedTonight
            ? `\n⚠️ มีเสียงหอนด้วยความพิโรธดังก้องจากป่า! "ลูกหมาป่า (Wolf Cub)" เสียชีวิตลงแล้ว ส่งผลให้คืนถัดไปหมาป่าที่เหลืออยู่จะสามารถสังหารเหยื่อได้ถึง 2 คน!`
            : '');
      } else {
        dawnAnnouncement = `รุ่งอรุณของวันที่ ${dayCount} มาถึงแล้ว... เมื่อคืนนี้เป็นคืนที่เงียบสงบ "ไม่มีใครเสียชีวิต!" (ดูเหมือนบอดี้การ์ดจะคุ้มกันได้ถูกจุดพอดี)`;
      }

      const dawnMsg: ChatMessage = {
        id: `dawn-${dayCount}-${Date.now()}`,
        senderId: 'moderator',
        senderName: 'ผู้ดำเนินเกม (Moderator)',
        text: dawnAnnouncement,
        phaseLabel: `เช้าวันที่ ${dayCount}`,
        timestamp: formatTime(),
      };

      const nextMessages = [...messages, ...newSecretMsgs, dawnMsg];
      setMessages(nextMessages);

      const winCheck = checkWinCondition(updatedPlayers);
      if (winCheck.isOver) {
        const winMsg: ChatMessage = {
          id: `win-${Date.now()}`,
          senderId: 'moderator',
          senderName: 'ผู้ดำเนินเกม (Moderator)',
          text: `จบเกม! ${winCheck.reasonThai}`,
          phaseLabel: 'สรุปผลแพ้ชนะ',
          timestamp: formatTime(),
        };
        const finalMsgs = [...nextMessages, winMsg];
        setPhase('GAME_OVER');
        setWinSummary({ winner: winCheck.winner, reasonThai: winCheck.reasonThai });
        setShellState('GAME_OVER');
        setMessages(finalMsgs);
        soundFX.playVictory(winCheck.winner === 'VILLAGE');

        broadcastGameState({
          players: updatedPlayers,
          phase: 'GAME_OVER',
          dayCount,
          doubleKillNextNight: outcome.cubDiedTonight,
          lastProtectedId: nextLastProtected,
          seerKnowledge: nextSeer,
          bodyguardKnowledge: nextBg,
          messages: finalMsgs,
          votes: [],
          winSummary: { winner: winCheck.winner, reasonThai: winCheck.reasonThai },
          postGameReactions: [],
          shellState: 'GAME_OVER',
          lastElimination: nightEliminationPayload,
          nightShieldEvents: nightShieldEventsPayload,
        });

        if (winCheck.winner) {
          void triggerPostGameDebrief({
            winner: winCheck.winner,
            reasonThai: winCheck.reasonThai,
            finalDayCount: dayCount,
            finalPlayers: updatedPlayers,
            finalMessages: finalMsgs,
            finalVotes: [],
            finalDoubleKill: outcome.cubDiedTonight,
            finalLastProtected: nextLastProtected,
            finalSeer: nextSeer,
            finalBg: nextBg,
          });
        }
        return;
      }

      setPhase('DAY_DISCUSSION');
      soundFX.playDayTransition();

      // INSTANT DAWN BROADCAST: Move ALL connected friends to Day Discussion immediately (<100ms)
      // instead of blocking them on the Night screen while AI generates dialogue!
      broadcastGameState({
        players: updatedPlayers,
        phase: 'DAY_DISCUSSION',
        dayCount,
        doubleKillNextNight: outcome.cubDiedTonight,
        lastProtectedId: nextLastProtected,
        seerKnowledge: nextSeer,
        bodyguardKnowledge: nextBg,
        messages: nextMessages,
        votes,
        winSummary: { winner: null, reasonThai: '' },
        shellState: 'PLAYING',
        lastElimination: nightEliminationPayload,
        nightShieldEvents: nightShieldEventsPayload,
      });

      await triggerDayDiscussion(
        dayCount,
        updatedPlayers,
        outcome.victimPlayers,
        nextSeer,
        nextBg,
        wasDoubleKill,
        nextMessages,
        outcome.cubDiedTonight,
        nextLastProtected,
        votes
      );
    },
    [
      doubleKillNextNight,
      dayCount,
      players,
      myClientId,
      seerKnowledge,
      bodyguardKnowledge,
      lastProtectedId,
      messages,
      votes,
      broadcastGameState,
      triggerDayDiscussion,
      triggerPostGameDebrief,
    ]
  );

  executeNightResolveRef.current = executeNightResolution;

  // Player clicks Confirm Night Action
  const handleConfirmNightAction = async () => {
    if (!myPlayer) return;
    const needsTarget =
      myPlayer.alive &&
      (isWerewolfTeam(myPlayer.role) ||
        myPlayer.role === 'SEER' ||
        myPlayer.role === 'BODYGUARD');

    if (needsTarget && !selectedTargetId) return;

    // Enforce 2-wolf consensus: BOTH living wolves must agree on the same victim before killing!
    if (requiresWolfConsensus && !wolvesAgreedOnTarget) {
      setWolfConsensusError(
        'ความเห็นหมาป่าทั้ง 2 ตัวต้องตรงกัน! โปรดคุยในแชทลับฝูงหมาป่าและส่งซิกเลือกเหยื่อคนเดียวกันก่อนยืนยัน'
      );
      soundFX.playMessagePop(true);
      return;
    }

    setWolfConsensusError(null);
    soundFX.playNightAction(myPlayer.role);

    const myAction = {
      primary: selectedTargetId,
      secondary: secondTargetId,
    };

    if (isMultiDeviceOnline && onlineAliveHumans.length > 1) {
      setHasSubmittedNight(true);
      sendWsMessage({
        type: 'SUBMIT_NIGHT_ACTION',
        playerId: myPlayer.id,
        nightAction: myAction,
      });
      return;
    }

    setWolfSignals({});
    await executeNightResolution({
      [myPlayer.id]: myAction,
    });
  };

  // Human sends a message during Day Discussion -> Broadcast to real friends + AI replies (if any AI alive)
  const handleSendHumanStatement = async (customText?: string) => {
    if (!myPlayer) return;
    const textToSend = (customText ?? humanInput).trim();
    if (!textToSend || isGeneratingAI) return;
    if (!customText) setHumanInput('');

    const myMsg: ChatMessage = {
      id: `human-msg-${myPlayer.id}-${Date.now()}`,
      senderId: myPlayer.id,
      senderName: myPlayer.name,
      text: textToSend,
      phaseLabel:
        phase === 'DAY_RESULT'
          ? `วันที่ ${dayCount} · คุยต่อก่อนกลางคืน`
          : `วันที่ ${dayCount} · ถกเถียง`,
      timestamp: formatTime(),
    };

    const nextMessages = [...messages, myMsg];
    setMessages(nextMessages);
    soundFX.playMessagePop(false);

    // Immediately broadcast human chat message to all connected friends
    sendWsMessage({
      type: 'HUMAN_CHAT',
      chatMessage: myMsg,
    });

    // If 0 living AI players (e.g., 10 real humans playing together), no AI reply needed!
    if (aliveAICount === 0) return;

    setIsGeneratingAI(true);
    let replies: {
      speakerId: string;
      speakerName: string;
      text: string;
      tone: string;
    }[] = [];

    try {
      const recentTranscript = nextMessages
        .filter((m) => !m.isSecret)
        .slice(-12)
        .map((m) => `${m.senderName}: ${m.text}`);

      const res = await fetch('/api/werewolf/discuss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          dayNumber: dayCount,
          players,
          seerKnowledge,
          bodyguardKnowledge,
          recentTranscript,
          previousVotes: votes,
          humanMessage: textToSend,
          speakerName: myPlayer.name,
          mode: 'REPLY_TO_HUMAN',
        }),
      });
      const json = await res.json();
      if (
        !json.fallback &&
        Array.isArray(json.data?.messages) &&
        json.data.messages.length > 0
      ) {
        replies = json.data.messages;
      }
    } catch {
      // Fallback
    }

    if (replies.length === 0) {
      replies = generateLocalReplyToHuman({
        players,
        speakerName: myPlayer.shortName,
        humanMessage: textToSend,
        seerKnowledge,
      });
    }

    setIsGeneratingAI(false);

    const replyMsgs: ChatMessage[] = [];
    replies.forEach((rep, idx) => {
      const speaker = players.find(
        (p) => p.id === rep.speakerId || p.name.includes(rep.speakerName)
      );
      if (speaker && (!speaker.alive || speaker.isHuman)) return;

      const msgObj: ChatMessage = {
        id: `reply-${Date.now()}-${idx}`,
        senderId: speaker?.id || rep.speakerId,
        senderName: speaker?.name || rep.speakerName,
        text: rep.text,
        tone: rep.tone,
        phaseLabel: `วันที่ ${dayCount} · โต้ตอบ`,
        timestamp: formatTime(),
      };
      replyMsgs.push(msgObj);

      setTimeout(() => {
        setActiveSpeakerId(speaker?.id || rep.speakerId);
        soundFX.playMessagePop(false);
        setMessages((prev) => [...prev, msgObj]);
      }, idx * 180);
    });

    setTimeout(() => {
      setActiveSpeakerId(null);
      broadcastGameState({
        players,
        phase,
        dayCount,
        doubleKillNextNight,
        lastProtectedId,
        seerKnowledge,
        bodyguardKnowledge,
        messages: [...nextMessages, ...replyMsgs],
        votes,
        winSummary,
        shellState: 'PLAYING',
      });
    }, replies.length * 180 + 180);
  };

  // Enter Day Voting Phase (triggered ONLY when ALL living players — humans + AI — confirm ready!)
  const enterVotingPhase = useCallback(() => {
    setPhase('DAY_VOTING');
    setPhaseReadyIds([]);
    setSelectedTargetId(null);
    setVotes([]);
    setVoteReadyIds([]);
    setHasSubmittedVote(false);
    soundFX.playMessagePop(true);
    const votePromptMsg: ChatMessage = {
      id: `vote-prompt-${dayCount}-${Date.now()}`,
      senderId: 'moderator',
      senderName: 'ผู้ดำเนินเกม (Moderator)',
      text: `ผู้รอดชีวิตทุกคน (ทั้งคนจริงและ AI) กดพร้อมครบแล้ว! เข้าสู่ "ช่วงโหวตประหาร" วันที่ ${dayCount} โปรดเลือกผู้เล่น 1 คนที่คุณต้องการโหวตออกจากหมู่บ้าน (หากผลโหวตสูงสุดเสมอกัน จะไม่มีใครถูกประหาร)`,
      phaseLabel: `วันที่ ${dayCount} · โหวตประหาร`,
      timestamp: formatTime(),
    };
    const nextMsgs = [...messages, votePromptMsg];
    setMessages(nextMsgs);
    broadcastGameState({
      players,
      phase: 'DAY_VOTING',
      dayCount,
      doubleKillNextNight,
      lastProtectedId,
      seerKnowledge,
      bodyguardKnowledge,
      messages: nextMsgs,
      votes: [],
      winSummary,
      shellState: 'PLAYING',
    });
  }, [
    dayCount,
    messages,
    players,
    doubleKillNextNight,
    lastProtectedId,
    seerKnowledge,
    bodyguardKnowledge,
    winSummary,
    broadcastGameState,
  ]);

  // Advance to Next Night (Case 1: 5-min timer expires OR Case 2: ALL living players — humans + AI — press ready!)
  const advanceToNextNight = useCallback(
    (reason: 'UNANIMOUS' | 'TIMEOUT' = 'UNANIMOUS') => {
      const nextNight = dayCount + 1;
      setDayCount(nextNight);
      setPhase('NIGHT_ACTION');
      setPhaseReadyIds([]);
      setPhaseDeadlineAt(null);
      setNightReadyIds([]);
      setWolfSignals({});
      setWolfConsensusError(null);
      setHasSubmittedNight(false);
      setSelectedTargetId(null);
      setSecondTargetId(null);
      setVotes([]);
      soundFX.playNightTransition();

      const triggerReasonPrefix =
        reason === 'TIMEOUT'
          ? `ครบเวลาพูดคุย 5 นาทีแล้ว! ระบบตัดเข้าสู่ คืนที่ ${nextNight}:`
          : `ผู้รอดชีวิตทุกคนกดยืนยันพร้อมครบแล้ว! ข้ามเข้าสู่ คืนที่ ${nextNight} ทันที:`;

      const nightStartMsg: ChatMessage = {
        id: `night-start-${nextNight}-${Date.now()}`,
        senderId: 'moderator',
        senderName: 'ผู้ดำเนินเกม (Moderator)',
        text:
          `${triggerReasonPrefix} ความมืดกลับมาปกคลุมหมู่บ้านจันทร์ทมิฬอีกครั้ง...\n` +
          `ขอให้ทุกคนหลับตาลง และเลือกแอ็กชันประจำบทบาทของคุณในยามวิกาล` +
          (doubleKillNextNight
            ? `\n🔥 [คำสาปลูกหมาป่าทำงาน] คืนนี้หมาป่าที่เหลืออยู่สามารถสังหารเหยื่อได้ถึง 2 คน!`
            : ''),
        phaseLabel: `คืนที่ ${nextNight} · ยามวิกาล`,
        timestamp: formatTime(),
      };

      const nextNightMsgs = [...messages, nightStartMsg];
      setMessages(nextNightMsgs);

      broadcastGameState({
        players,
        phase: 'NIGHT_ACTION',
        dayCount: nextNight,
        doubleKillNextNight,
        lastProtectedId,
        seerKnowledge,
        bodyguardKnowledge,
        messages: nextNightMsgs,
        votes: [],
        winSummary,
        shellState: 'PLAYING',
      });
    },
    [
      dayCount,
      doubleKillNextNight,
      messages,
      players,
      lastProtectedId,
      seerKnowledge,
      bodyguardKnowledge,
      winSummary,
      broadcastGameState,
    ]
  );

  executePhaseAdvanceRef.current = (targetPhase, reason) => {
    if (targetPhase === 'DAY_VOTING') {
      enterVotingPhase();
    } else if (targetPhase === 'NIGHT_ACTION') {
      advanceToNextNight(reason);
    }
  };

  // Toggle Ready status for a human OR AI player during DAY_DISCUSSION or DAY_RESULT
  const togglePhaseReady = useCallback(
    (
      targetPlayerId: string,
      ready: boolean,
      targetPhase: 'DAY_VOTING' | 'NIGHT_ACTION'
    ) => {
      if (wsConnected) {
        setPhaseReadyIds((prev) => {
          const nextSet = new Set(prev);
          if (ready) nextSet.add(targetPlayerId);
          else nextSet.delete(targetPlayerId);
          return Array.from(nextSet);
        });
        sendWsMessage({
          type: 'TOGGLE_PHASE_READY',
          playerId: targetPlayerId,
          ready,
          targetPhase,
        });
        return;
      }

      // Local offline/solo fallback: check unanimous living readiness directly
      setPhaseReadyIds((prev) => {
        const nextSet = new Set(prev);
        if (ready) nextSet.add(targetPlayerId);
        else nextSet.delete(targetPlayerId);
        const nextArr = Array.from(nextSet);
        const allReady =
          requiredPhaseReadyPlayers.length > 0 &&
          requiredPhaseReadyPlayers.every((p) => nextSet.has(p.id));
        if (allReady) {
          setTimeout(() => {
            executePhaseAdvanceRef.current?.(targetPhase);
          }, 260);
        }
        return nextArr;
      });
    },
    [wsConnected, sendWsMessage, requiredPhaseReadyPlayers]
  );

  // Automatic staggered AI readiness: each living AI decides when they are ready for Voting / Next Night!
  useEffect(() => {
    if (shellState !== 'PLAYING' || !isHost || isGeneratingAI) return;
    if (phase !== 'DAY_DISCUSSION' && phase !== 'DAY_RESULT') return;

    const targetPhase: 'DAY_VOTING' | 'NIGHT_ACTION' =
      phase === 'DAY_DISCUSSION' ? 'DAY_VOTING' : 'NIGHT_ACTION';

    const unreadyLivingAIs = players.filter(
      (p) => p.alive && !p.isHuman && !phaseReadyIdsRef.current.includes(p.id)
    );
    if (unreadyLivingAIs.length === 0) return;

    // Shuffle AI order so different AIs confirm ready in natural varied sequence
    const shuffled = [...unreadyLivingAIs].sort(() => Math.random() - 0.5);
    const timers: number[] = [];

    shuffled.forEach((ai, idx) => {
      let delayMs: number;
      if (allLivingHumansReady) {
        // Once all real humans have pressed ready, remaining AIs wrap up briskly
        delayMs = 380 + idx * 240 + Math.floor(Math.random() * 220);
      } else if (phase === 'DAY_RESULT') {
        // After vote results, AIs read and confirm ready for night naturally over 1.2s - 4.8s
        delayMs = 1100 + idx * 480 + Math.floor(Math.random() * 500);
      } else {
        // During Day Discussion, AIs press ready for voting naturally over 2.6s - 9.5s
        delayMs = 2400 + idx * 950 + Math.floor(Math.random() * 800);
      }

      const t = window.setTimeout(() => {
        if (!phaseReadyIdsRef.current.includes(ai.id)) {
          togglePhaseReady(ai.id, true, targetPhase);
        }
      }, delayMs);
      timers.push(t);
    });

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [
    shellState,
    phase,
    dayCount,
    isHost,
    isGeneratingAI,
    allLivingHumansReady,
    players,
    togglePhaseReady,
  ]);

  // Core Day Vote Resolution (Independent AI Votes + Tie = No Execution + Beggar + Wolf Cub)
  const executeVoteResolution = useCallback(
    async (collectedHumanVotes: Record<string, string>) => {
      setIsGeneratingAI(true);
      let resolvedVotes: VoteRecord[] = [];

      const recentTranscript = messages
        .filter((m) => !m.isSecret)
        .slice(-16)
        .map((m) => `${m.senderName}: ${m.text}`);

      const eligibleAI = players.filter(
        (p) => p.alive && !p.isHuman && p.canVote
      );

      // Record all submitted human votes first (including explicit Abstain / ไม่โหวต)
      const humanVoteRecords: VoteRecord[] = [];
      for (const hp of players.filter((p) => p.isHuman && p.alive && p.canVote)) {
        const tId = collectedHumanVotes[hp.id];
        if (!tId || tId === ABSTAIN_VOTE_ID) {
          humanVoteRecords.push({
            voterId: hp.id,
            voterName: hp.name,
            targetId: ABSTAIN_VOTE_ID,
            targetName: 'งดออกเสียง (ไม่โหวต)',
            reason: 'เลือกงดออกเสียงเพื่อเก็บไว้ตัดสินใจในวันถัดไป',
          });
          continue;
        }
        const hTarget = players.find((p) => p.id === tId);
        if (hTarget) {
          humanVoteRecords.push({
            voterId: hp.id,
            voterName: hp.name,
            targetId: hTarget.id,
            targetName: hTarget.name,
            reason: 'ตัดสินใจลงคะแนนโหวตจากการวิเคราะห์ในสภา',
          });
        }
      }

      if (eligibleAI.length === 0) {
        // All voters are real humans (e.g., 10 real human players)
        resolvedVotes = humanVoteRecords;
      } else {
        try {
          const res = await fetch('/api/werewolf/vote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roomId,
              dayNumber: dayCount,
              players,
              seerKnowledge,
              bodyguardKnowledge,
              recentTranscript,
            }),
          });
          const json = await res.json();
          if (
            !json.fallback &&
            Array.isArray(json.data?.votes) &&
            json.data.votes.length > 0
          ) {
            const aiVoteRecords: VoteRecord[] = [];
            for (const v of json.data.votes) {
              const voter = players.find(
                (p) => p.id === v.voterId || p.name.includes(v.voterId)
              );
              if (!voter || voter.isHuman || !voter.alive || !voter.canVote) {
                continue;
              }
              if (v.targetId === ABSTAIN_VOTE_ID) {
                aiVoteRecords.push({
                  voterId: voter.id,
                  voterName: voter.name,
                  targetId: ABSTAIN_VOTE_ID,
                  targetName: 'งดออกเสียง (ไม่โหวต)',
                  reason: v.reason || 'ข้อมูลยังไม่ชัด ขอเก็บไว้ตัดสินใจวันอื่น',
                });
                continue;
              }
              const target = players.find(
                (p) => p.id === v.targetId || p.name.includes(v.targetId)
              );
              if (target && target.alive) {
                aiVoteRecords.push({
                  voterId: voter.id,
                  voterName: voter.name,
                  targetId: target.id,
                  targetName: target.name,
                  reason: v.reason,
                });
              }
            }
            if (aiVoteRecords.length >= Math.max(1, eligibleAI.length - 1)) {
              resolvedVotes = [...humanVoteRecords, ...aiVoteRecords];
            }
          }
        } catch {
          // Fallback
        }

        if (resolvedVotes.length === 0) {
          resolvedVotes = generateLocalVotes({
            players,
            humanVotesMap: collectedHumanVotes,
            seerKnowledge,
            bodyguardKnowledge,
            recentTranscript,
          });
        }
      }

      setIsGeneratingAI(false);
      setVotes(resolvedVotes);
      setVoteReadyIds([]);
      setHasSubmittedVote(false);

      const tally: Record<string, number> = {};
      let abstainCount = 0;
      resolvedVotes.forEach((v) => {
        if (v.targetId === ABSTAIN_VOTE_ID) {
          abstainCount += 1;
        } else {
          tally[v.targetId] = (tally[v.targetId] || 0) + 1;
        }
      });

      let maxVotes = 0;
      let topTargetIds: string[] = [];
      Object.entries(tally).forEach(([tId, count]) => {
        if (count > maxVotes) {
          maxVotes = count;
          topTargetIds = [tId];
        } else if (count === maxVotes) {
          topTargetIds.push(tId);
        }
      });

      let updatedPlayers = [...players];
      let specialResultText = '';
      let nextDoubleKill = doubleKillNextNight;

      // ABSTAIN / TIE RULE:
      // - If nobody voted against a player (maxVotes === 0), OR
      // - If abstain count >= highest suspect's votes, OR
      // - If top suspects are tied -> NOBODY is executed!
      let executedVictimId: string | null = null;
      if (maxVotes === 0) {
        soundFX.playMessagePop(true);
        specialResultText = `\n\n✋ มติสภาหมู่บ้าน: ทุกคนเลือก "ไม่โหวต / งดออกเสียง" (${abstainCount} เสียง) จึงไม่มีใครถูกประหารในวันนี้ เพื่อเก็บไว้ตัดสินใจในวันถัดไป`;
      } else if (abstainCount >= maxVotes) {
        soundFX.playMessagePop(true);
        specialResultText = `\n\n✋ มติสภาหมู่บ้าน: เสียงงดออกเสียง (ไม่โหวต ${abstainCount} เสียง) เท่ากับหรือมากกว่าผู้ที่มีคะแนนสูงสุด (${maxVotes} เสียง) จึงไม่มีใครถูกประหารในวันนี้ เพื่อเก็บไว้ตัดสินใจในวันถัดไป`;
      } else if (topTargetIds.length !== 1) {
        const tiedNames = topTargetIds
          .map((id) => players.find((p) => p.id === id)?.name)
          .filter(Boolean)
          .join(' และ ');
        soundFX.playMessagePop(true);
        specialResultText =
          `\n\n⚖️ มติสภาหมู่บ้าน: ผลโหวตสูงสุดเสมอกันที่ ${maxVotes} เสียง (${tiedNames})! ` +
          `ตามกติกาจึงไม่มีใครถูกประหารในวันนี้`;
      } else {
        const executedId = topTargetIds[0];
        const executedPlayer = players.find((p) => p.id === executedId)!;

        soundFX.playExecutionImpact();
        setImpactTrigger((c) => c + 1);

        if (executedPlayer.role === 'BEGGAR' && !executedPlayer.revealedBeggar) {
          // Beggar/Idiot survives execution — do NOT trigger death animation!
          updatedPlayers = players.map((p) =>
            p.id === executedPlayer.id
              ? { ...p, alive: true, canVote: false, revealedBeggar: true }
              : p
          );
          specialResultText =
            `\n\n🎭 [กติกาพิเศษ: ยาจก / คนงี่เง่า (Beggar / Idiot)] ทันทีที่เพชฌฆาตกำลังจะลงมือ "${executedPlayer.name}" ก็หงายการ์ดเปิดเผยตัวตนว่าเป็น "ยาจก / คนงี่เง่า"! ` +
            `เขารอดชีวิตจากการถูกประหารในวันนี้! แต่จะสูญเสียสิทธิ์ในการลงคะแนนโหวตไปตลอดทั้งเกมที่เหลือ`;
        } else {
          executedVictimId = executedPlayer.id;
          updatedPlayers = players.map((p) =>
            p.id === executedPlayer.id ? { ...p, alive: false } : p
          );

          if (executedPlayer.role === 'WOLF_CUB') {
            nextDoubleKill = true;
            setDoubleKillNextNight(true);
            specialResultText =
              `\n\n🐺🔥 [กติกาพิเศษ: คำสาปลูกหมาป่า (Wolf Cub)] เสียงหอนโหยหวนดังกึกก้องไปทั่วหมู่บ้านเมื่อร่างของ "${executedPlayer.name}" ล้มลง! ` +
              `ในคืนถัดไป หมาป่าที่เหลืออยู่จะคลั่งและสังหารเหยื่อได้ถึง 2 คน!`;
          } else {
            specialResultText = `\n\nมติสภาหมู่บ้าน: "${executedPlayer.name}" ได้รับคะแนนโหวตสูงสุด (${maxVotes} เสียง) และถูกประหารออกจากหมู่บ้าน! (ไม่เปิดเผยบทบาทที่แท้จริง)`;
          }
        }
      }

      // Trigger dramatic Villager Execution animation ONLY if the local human player was actually executed (not Beggar survival)
      const myBeforeVote = players.find((p) => p.id === myClientId);
      if (myBeforeVote?.alive && executedVictimId === myClientId) {
        prevMyAliveRef.current = false;
        setDeathOverlay('DAY_EXECUTION');
      }

      const dayEliminationPayload = executedVictimId
        ? { cause: 'DAY_EXECUTION' as const, victimIds: [executedVictimId] }
        : null;

      const voteBreakdownText =
        `สรุปผลการลงคะแนนโหวตประจำวันที่ ${dayCount}:\n` +
        resolvedVotes
          .map((v) =>
            v.targetId === ABSTAIN_VOTE_ID
              ? `• ${v.voterName} ➔ งดออกเสียง / ไม่โหวต ("${v.reason}")`
              : `• ${v.voterName} โหวต ➔ ${v.targetName} ("${v.reason}")`
          )
          .join('\n') +
        (abstainCount > 0 ? `\n(รวมผู้เลือกไม่โหวต/งดออกเสียง: ${abstainCount} คน)` : '') +
        specialResultText;

      setPlayers(updatedPlayers);
      setSelectedTargetId(null);
      setSecondTargetId(null);

      const voteResultMsg: ChatMessage = {
        id: `vote-result-${dayCount}-${Date.now()}`,
        senderId: 'moderator',
        senderName: 'ผู้ดำเนินเกม (Moderator)',
        text: voteBreakdownText,
        phaseLabel: `วันที่ ${dayCount} · ผลโหวต`,
        timestamp: formatTime(),
      };

      const afterVoteMsgs = [...messages, voteResultMsg];
      setMessages(afterVoteMsgs);

      const winCheck = checkWinCondition(updatedPlayers);
      if (winCheck.isOver) {
        const winMsg: ChatMessage = {
          id: `win-exec-${Date.now()}`,
          senderId: 'moderator',
          senderName: 'ผู้ดำเนินเกม (Moderator)',
          text: `จบเกม! ${winCheck.reasonThai}`,
          phaseLabel: 'สรุปผลแพ้ชนะ',
          timestamp: formatTime(),
        };
        const finalMsgs = [...afterVoteMsgs, winMsg];
        setPhase('GAME_OVER');
        setWinSummary({ winner: winCheck.winner, reasonThai: winCheck.reasonThai });
        setShellState('GAME_OVER');
        setMessages(finalMsgs);
        soundFX.playVictory(winCheck.winner === 'VILLAGE');

        broadcastGameState({
          players: updatedPlayers,
          phase: 'GAME_OVER',
          dayCount,
          doubleKillNextNight: nextDoubleKill,
          lastProtectedId,
          seerKnowledge,
          bodyguardKnowledge,
          messages: finalMsgs,
          votes: resolvedVotes,
          winSummary: { winner: winCheck.winner, reasonThai: winCheck.reasonThai },
          postGameReactions: [],
          shellState: 'GAME_OVER',
          lastElimination: dayEliminationPayload,
        });

        if (winCheck.winner) {
          void triggerPostGameDebrief({
            winner: winCheck.winner,
            reasonThai: winCheck.reasonThai,
            finalDayCount: dayCount,
            finalPlayers: updatedPlayers,
            finalMessages: finalMsgs,
            finalVotes: resolvedVotes,
            finalDoubleKill: nextDoubleKill,
            finalLastProtected: lastProtectedId,
            finalSeer: seerKnowledge,
            finalBg: bodyguardKnowledge,
          });
        }
        return;
      }

      // Transition to DAY_RESULT: Case 1 = up to 5-min discussion timer auto-enters Night; Case 2 = all living players (humans + AIs) press Ready to skip into Night immediately!
      const nextNight = dayCount + 1;
      setPhase('DAY_RESULT');
      setPhaseReadyIds([]);
      setPhaseDeadlineAt(Date.now() + 5 * 60 * 1000);
      setDayResultSecondsLeft(300);
      soundFX.playMessagePop(true);

      const readyForNightMsg: ChatMessage = {
        id: `day-result-ready-${dayCount}-${Date.now()}`,
        senderId: 'moderator',
        senderName: 'ผู้ดำเนินเกม (Moderator)',
        text:
          `สรุปผลโหวตวันที่ ${dayCount} เสร็จสิ้นแล้ว · สามารถพูดคุยกันต่อได้สูงสุด 5 นาทีก่อนระบบตัดเข้าสู่คืนที่ ${nextNight} อัตโนมัติ ` +
          `หรือหากผู้รอดชีวิตทุกคน (ทั้งคนจริงและ AI) กด "พร้อมเข้าสู่คืนที่ ${nextNight}" ครบทุกคนจะข้ามเข้ากลางคืนทันที!`,
        phaseLabel: `วันที่ ${dayCount} · คุยต่อ / รอเข้าคืนที่ ${nextNight}`,
        timestamp: formatTime(),
      };

      const afterResultMsgs = [...afterVoteMsgs, readyForNightMsg];
      setMessages(afterResultMsgs);

      broadcastGameState({
        players: updatedPlayers,
        phase: 'DAY_RESULT',
        dayCount,
        doubleKillNextNight: nextDoubleKill,
        lastProtectedId,
        seerKnowledge,
        bodyguardKnowledge,
        messages: afterResultMsgs,
        votes: resolvedVotes,
        winSummary,
        shellState: 'PLAYING',
        lastElimination: dayEliminationPayload,
      });
    },
    [
      messages,
      players,
      dayCount,
      seerKnowledge,
      bodyguardKnowledge,
      doubleKillNextNight,
      lastProtectedId,
      winSummary,
      roomId,
      broadcastGameState,
      triggerPostGameDebrief,
    ]
  );

  executeVoteResolveRef.current = executeVoteResolution;

  const handleConfirmVote = async () => {
    if (!myPlayer) return;
    if (myPlayer.alive && myPlayer.canVote && !selectedTargetId) return;

    if (isMultiDeviceOnline && onlineEligibleHumanVoters.length > 1) {
      setHasSubmittedVote(true);
      sendWsMessage({
        type: 'SUBMIT_DAY_VOTE',
        playerId: myPlayer.id,
        voteTargetId:
          myPlayer.alive && myPlayer.canVote ? selectedTargetId : null,
      });
      return;
    }

    const soloVotes: Record<string, string> = {};
    if (myPlayer.alive && myPlayer.canVote && selectedTargetId) {
      soloVotes[myPlayer.id] = selectedTargetId;
    }
    await executeVoteResolution(soloVotes);
  };

  return (
    <div className="relative w-full max-w-[100vw] h-[100dvh] overflow-hidden bg-[#070C18] text-slate-100 select-none">
      {/* 1. Isolated 60fps Canvas World Layer */}
      <div className="absolute inset-0 z-0">
        <VillageCanvas
          phase={phase}
          dayCount={dayCount}
          players={players}
          viewerPlayerId={myPlayer?.id || ''}
          selectedTargetId={selectedTargetId}
          secondTargetId={secondTargetId}
          activeSpeakerId={activeSpeakerId}
          votes={votes}
          showTrueRoles={shellState === 'GAME_OVER'}
          fellowWolfIds={fellowWolves.map((w) => w.id)}
          seerKnownMap={seerKnownMap}
          impactTrigger={impactTrigger}
          onSelectPlayer={handleSelectPlayerOnCanvas}
        />
      </div>

      {/* 1B. INVITED FRIEND NICKNAME SCREEN (?room=XXXX) */}
      {shellState === 'FRIEND_JOIN' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-gradient-to-t from-[#050811]/95 via-[#070C18]/90 to-[#050811]/95 pointer-events-auto overflow-y-auto">
          <div className="bg-[#0B1324] border-2 border-amber-500/60 rounded-2xl max-w-md w-full p-6 md:p-7 space-y-5 shadow-[0_0_50px_rgba(245,158,11,0.2)]">
            <div className="text-center space-y-1.5">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wider text-amber-400">
                <Users className="w-4 h-4" />
                <span>คำเชิญเข้าร่วมโต๊ะสภา · ห้อง #{roomId}</span>
              </div>
              <h1 className="text-2xl md:text-3xl font-bold text-white font-display">
                หมู่บ้านจันทร์ทมิฬ
              </h1>
              <p className="text-xs md:text-sm text-slate-300">
                คุณได้รับลิงก์ชวนเข้าร่วมเกม Ultimate Werewolf ตั้งชื่อเล่นของคุณเพื่อเข้าเป็น{' '}
                <span className="text-amber-300 font-semibold">ผู้เล่นคนจริง</span> ในห้องนี้ได้ทันที!
              </p>
            </div>

            {/* Live Room Info */}
            <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">ผู้เล่นคนจริงในห้องขณะนี้:</span>
                <span className="font-mono font-bold text-amber-300">
                  {roomPreview ? `${roomPreview.humanCount} / 10 คน` : 'กำลังเชื่อมต่อห้อง...'}
                </span>
              </div>
              {roomPreview && roomPreview.exists && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">AI ที่จะสุ่มลดจำนวนลงเมื่อคุณเข้า:</span>
                    <span className="font-mono font-semibold text-emerald-300">
                      เหลือ AI{' '}
                      {Math.max(
                        0,
                        Math.max(roomPreview.totalPlayers, roomPreview.humanCount + 1) -
                          (roomPreview.humanCount + 1)
                      )}{' '}
                      คน
                    </span>
                  </div>
                  {roomPreview.participants.length > 0 && (
                    <div className="pt-1.5 border-t border-slate-800 text-slate-300">
                      <span className="text-slate-400">เพื่อนที่รออยู่ในห้อง: </span>
                      <span className="font-semibold text-white">
                        {roomPreview.participants.map((p) => p.name).join(', ')}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            {roomFullError ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-red-950/50 border border-red-500/50 text-xs text-red-200 text-center leading-relaxed">
                  ห้อง #{roomId} มีผู้เล่นคนจริงเข้าร่วมครบจำนวนสูงสุด 10/10 คนแล้วครับ
                </div>
                <button
                  type="button"
                  onClick={handleCreateOwnNewRoom}
                  className="w-full py-3 px-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm cursor-pointer transition-colors"
                >
                  สร้างห้องใหม่ของตัวเอง
                </button>
              </div>
            ) : (
              <form onSubmit={handleFriendJoinSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="friend-nickname-input"
                    className="block text-xs font-bold text-amber-300 mb-1.5"
                  >
                    ตั้งชื่อเล่นของคุณสำหรับเล่นเกมนี้:
                  </label>
                  <input
                    id="friend-nickname-input"
                    ref={friendNicknameInputRef}
                    type="text"
                    value={myName}
                    onChange={(e) => setMyName(e.target.value)}
                    placeholder="พิมพ์ชื่อเล่นของคุณ เช่น แบงค์, มิว, โจ้..."
                    maxLength={24}
                    required
                    className="w-full min-h-[48px] bg-[#0F172A] border-2 border-amber-500/60 focus:border-amber-400 rounded-xl px-4 py-3 text-base font-bold text-white placeholder:text-slate-500 outline-none select-text"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!myName.trim()}
                  className="w-full min-h-[48px] py-3.5 px-6 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-bold text-base shadow-[0_0_25px_rgba(245,158,11,0.3)] transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Play className="w-5 h-5 fill-current" />
                  <span>เข้าห้อง #{roomId} เป็นผู้เล่นคนจริง</span>
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* 2. TITLE SCREEN / MULTIPLAYER LOBBY & SETUP OVERLAY */}
      {shellState === 'TITLE_SCREEN' && (
        <div className="absolute inset-0 z-30 flex flex-col justify-between p-4 md:p-8 bg-gradient-to-t from-[#050811]/95 via-[#070C18]/85 to-[#050811]/90 pointer-events-auto overflow-y-auto">
          {/* Top Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-2 font-mono tabular-nums">
              <span className="text-amber-400 font-semibold">ULTIMATE WEREWOLF THAI</span>
              <span aria-hidden="true">·</span>
              <span>ห้อง #{roomId}</span>
              <span aria-hidden="true">·</span>
              <span className={wsConnected ? 'text-emerald-400' : 'text-slate-400'}>
                {wsConnected
                  ? `ออนไลน์ ${onlineHumansList.length} เครื่อง`
                  : 'โหมดเล่นทันที'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openDownloadModal}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/50 text-amber-300 hover:bg-amber-500/30 transition-colors cursor-pointer font-semibold"
              >
                <Download className="w-4 h-4" />
                <span>ดาวน์โหลดไฟล์ทั้งหมด</span>
              </button>
              <button
                onClick={toggleMute}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F172A] border border-slate-800 text-slate-300 hover:text-white hover:border-amber-500/50 transition-colors cursor-pointer"
              >
                {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                <span>{muted ? 'ปิดเสียง' : 'เปิดเสียง'}</span>
              </button>
            </div>
          </div>

          {/* Center Lobby Setup Card */}
          <div className="my-auto max-w-4xl w-full mx-auto space-y-5 py-4">
            <div className="text-center space-y-1.5">
              <p className="text-xs md:text-sm tracking-widest text-amber-400 font-semibold">
                รองรับเพื่อนออนไลน์สูงสุด 10 คนจริง · AI สุ่มลดจำนวนอัตโนมัติเมื่อเพื่อนเข้าห้อง
              </p>
              <h1 className="text-3xl md:text-5xl font-bold tracking-tight text-white font-display">
                หมู่บ้านจันทร์ทมิฬ
              </h1>
              <p className="text-xs md:text-sm text-slate-300 max-w-2xl mx-auto">
                ส่งลิงก์ให้เพื่อนเปิดตั้งชื่อเล่นเข้าร่วมได้ทันที (สูงสุด 10 คนจริง) ที่นั่งที่เหลือระบบจะสุ่ม AI มาเล่นและวิเคราะห์ร่วมโต๊ะให้อย่างเป็นธรรมชาติ
              </p>
            </div>

            {/* 2-Column Lobby Configuration */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#0B1324]/95 border border-slate-800 rounded-2xl p-5 shadow-2xl">
              {/* Left Column: Player Name, Player Count & Role Deck Breakdown */}
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="player-1-name-input"
                      className="text-xs font-bold text-amber-300 flex items-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>1. ชื่อเล่นของคุณในห้องนี้:</span>
                    </label>
                    {myName && (
                      <button
                        type="button"
                        onClick={() => {
                          handleMyNameChange('');
                          player1NameInputRef.current?.focus();
                        }}
                        className="text-[11px] text-slate-400 hover:text-amber-300 cursor-pointer"
                      >
                        ล้างชื่อเพื่อพิมพ์ใหม่
                      </button>
                    )}
                  </div>
                  <input
                    id="player-1-name-input"
                    ref={player1NameInputRef}
                    type="text"
                    value={myName}
                    onChange={(e) => handleMyNameChange(e.target.value)}
                    placeholder="พิมพ์ชื่อเล่นของคุณที่นี่ เช่น นัท, บอส, มิน..."
                    maxLength={24}
                    className="w-full min-h-[44px] bg-[#0F172A] border-2 border-amber-500/60 focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-base md:text-sm font-bold text-white placeholder:text-slate-500 outline-none select-text"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-bold text-amber-300">
                      2. จำนวนผู้เล่นทั้งหมดในกระดาน
                    </label>
                    <span className="text-xs font-mono text-slate-300">
                      คนจริง {humanParticipants.length} + AI สุ่ม {aiSeatsRemaining} คน
                    </span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {[6, 7, 8, 9, 10].map((cnt) => {
                      const disabled = cnt < humanParticipants.length;
                      const active = totalPlayerCount === cnt;
                      return (
                        <button
                          key={cnt}
                          type="button"
                          disabled={disabled}
                          onClick={() => handleSelectTotalPlayers(cnt)}
                          className={`py-2.5 rounded-xl font-bold text-xs md:text-sm border transition-all cursor-pointer ${
                            active
                              ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.3)]'
                              : disabled
                              ? 'bg-slate-900/40 text-slate-600 border-slate-800 cursor-not-allowed'
                              : 'bg-[#0F172A] text-slate-200 border-slate-800 hover:border-amber-500/50'
                          }`}
                        >
                          {cnt} คน
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Role Pool Summary */}
                <div className="bg-[#0F172A] border border-slate-800/90 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Shuffle className="w-3.5 h-3.5 text-amber-400" />
                      <span>การ์ดบทบาทที่จะสุ่มในวง ({totalPlayerCount} ใบ)</span>
                    </span>
                    <span className="text-[11px] text-amber-300 font-semibold">
                      สุ่ม 100% ตอนเริ่มเกม
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    <div className="col-span-2 px-2.5 py-2 rounded-lg bg-red-950/30 border border-red-900/60 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-red-300 font-bold">
                          🐺 ฝ่ายหมาป่า (สุ่ม 2 จาก 3 ตัว)
                        </span>
                        <span className="font-mono font-bold text-white">
                          {rolePoolPreview.WOLVES_TOTAL} ใบ
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300 flex flex-wrap gap-x-2 gap-y-0.5">
                        <span className="text-red-400 font-semibold">1. พ่อหมาป่า</span>
                        <span className="text-slate-600">·</span>
                        <span className="text-orange-400 font-semibold">2. ลูกหมาป่า</span>
                        <span className="text-slate-600">·</span>
                        <span className="text-rose-400 font-semibold">
                          3. หมาป่ามนุษย์ (หมอดูส่องเห็นเป็นชาวบ้าน)
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-amber-300 font-semibold">เทพพยากรณ์</span>
                      <span className="font-mono font-bold text-white">
                        {rolePoolPreview.SEER} ใบ
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-emerald-400 font-semibold">บอดี้การ์ด</span>
                      <span className="font-mono font-bold text-white">
                        {rolePoolPreview.BODYGUARD} ใบ
                      </span>
                    </div>
                    {rolePoolPreview.BEGGAR > 0 && (
                      <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                        <span className="text-yellow-300 font-semibold">ยาจก / คนงี่เง่า</span>
                        <span className="font-mono font-bold text-white">
                          {rolePoolPreview.BEGGAR} ใบ
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-sky-300 font-semibold">ชาวบ้าน</span>
                      <span className="font-mono font-bold text-white">
                        {rolePoolPreview.VILLAGER} ใบ
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Invite Friends via Link & Editable Human Roster */}
              <div className="space-y-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-amber-300 mb-1.5">
                      3. ส่งลิงก์ให้เพื่อนตั้งชื่อเล่นเข้ามาเล่นด้วยกัน (สูงสุด 10 คนจริง)
                    </label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-[#0F172A] border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 font-mono truncate select-text">
                        {inviteUrl}
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyInviteLink}
                        className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 font-bold text-xs flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors"
                      >
                        {copiedInviteLink ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-300">คัดลอกลิงก์แล้ว!</span>
                          </>
                        ) : (
                          <>
                            <Link2 className="w-3.5 h-3.5" />
                            <span>คัดลอกลิงก์ชวนเพื่อน</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      เมื่อเพื่อนกดลิงก์นี้ จะขึ้นหน้าให้ตั้งชื่อเล่นแล้วเข้าห้องทันที และระบบจะสุ่มลด AI ลงให้อัตโนมัติ
                    </p>
                  </div>

                  {/* Add Local Friend Input */}
                  <form onSubmit={handleAddHumanFriend} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newFriendNameInput}
                      onChange={(e) => setNewFriendNameInput(e.target.value)}
                      placeholder="หรือพิมพ์ชื่อเพื่อนที่นั่งข้างๆ เพื่อเพิ่มเก้าอี้คนจริง..."
                      maxLength={24}
                      className="flex-1 min-w-0 min-h-[44px] bg-[#0F172A] border border-slate-700 focus:border-amber-400 rounded-xl px-3 py-2 text-base md:text-xs text-white placeholder:text-slate-500 outline-none select-text"
                    />
                    <button
                      type="submit"
                      disabled={!newFriendNameInput.trim() || humanParticipants.length >= 10}
                      className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold text-amber-300 flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>เพิ่มเพื่อน</span>
                    </button>
                  </form>

                  {/* Live Human Roster */}
                  <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-3 space-y-2 max-h-44 overflow-y-auto">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                        <Users className="w-3.5 h-3.5 text-amber-400" />
                        <span>ผู้เล่นคนจริง ({humanParticipants.length}/10 คน)</span>
                      </span>
                      <span className="text-emerald-300 font-semibold">
                        {aiSeatsRemaining === 0
                          ? 'ครบคนจริงแล้ว (AI 0 คน)'
                          : `AI สุ่มเสริม ${aiSeatsRemaining} คน`}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {humanParticipants.map((hp, idx) => {
                        const isMe = hp.id === myClientId;
                        const isRoomHost = hp.id === hostId;
                        return (
                          <div
                            key={hp.id}
                            className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 focus-within:border-amber-400 rounded-lg px-2.5 py-1.5"
                          >
                            <span className="text-xs font-mono text-amber-400 font-bold w-6">
                              #{idx + 1}
                            </span>
                            <input
                              type="text"
                              value={isMe ? myName : hp.name}
                              onChange={(e) =>
                                handleEditParticipantName(hp.id, e.target.value)
                              }
                              disabled={!isMe && !isHost}
                              className="flex-1 min-w-0 bg-transparent text-base md:text-xs font-bold text-white outline-none border-b border-slate-700 focus:border-amber-400 py-0.5 select-text disabled:border-transparent"
                              placeholder={`พิมพ์ชื่อผู้เล่น ${idx + 1}...`}
                            />
                            <span className="text-[10px] text-emerald-400 font-medium shrink-0">
                              {isMe
                                ? isRoomHost
                                  ? 'คุณ (หัวห้อง)'
                                  : 'คุณ'
                                : hp.isOnline
                                ? 'ออนไลน์'
                                : 'เครื่องเดียวกัน'}
                            </span>
                            {humanParticipants.length > 1 && isHost && !isMe && (
                              <button
                                type="button"
                                onClick={() => handleRemoveParticipant(hp.id)}
                                className="p-1 text-slate-500 hover:text-red-400 cursor-pointer"
                                title="ลบผู้เล่นนี้"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Primary Start CTA */}
                <button
                  type="button"
                  onClick={startNewRandomGame}
                  className="w-full min-h-[48px] py-3.5 px-6 text-sm md:text-base font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 active:scale-[0.99] rounded-xl shadow-[0_0_30px_rgba(245,158,11,0.35)] transition-all cursor-pointer flex items-center justify-center gap-2.5"
                >
                  <Play className="w-5 h-5 fill-current" />
                  <span>
                    สุ่มบทบาททั้งหมดและเริ่มเกม ({totalPlayerCount} ผู้เล่น)
                  </span>
                </button>
              </div>
            </div>
          </div>

          <div className="text-center text-xs text-slate-400 font-mono">
            กติกาสภา: เพื่อนกดลิงก์เข้าห้องตั้งชื่อได้สูงสุด 10 คนจริง · AI สุ่มลดจำนวนอัตโนมัติ · โหวตประหารเสมอกันไม่มีใครตายและเริ่มคืนถัดไปทันที
          </div>
        </div>
      )}

      {/* 2B. ROLE CARD REVEAL SCREEN (STRICTLY SHOWS ONLY THIS DEVICE'S OWN ROLE CARD) */}
      {shellState === 'ROLE_REVEAL' && myPlayer && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/85 pointer-events-auto overflow-y-auto">
          <div className="bg-[#0B1324] border-2 border-amber-500/60 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-[0_0_50px_rgba(245,158,11,0.25)] my-auto">
            <div className="text-center space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wider text-amber-400 uppercase">
                <Sparkles className="w-4 h-4" />
                <span>ผลการสุ่มการ์ดบทบาทประจำตัวของคุณ</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white">
                ผู้เล่น: <span className="text-amber-300">{myPlayer.name}</span>
              </h2>
              <p className="text-xs text-slate-400">
                โปรดจำบทบาทของคุณไว้เป็นความลับ ห้ามให้ผู้เล่นคนอื่นล่วงรู้เด็ดขาด!
              </p>
            </div>

            {/* Dealt Role Card Artwork & Frame */}
            <div className="relative aspect-[3/4] w-60 md:w-64 mx-auto rounded-2xl overflow-hidden border-2 border-amber-400/70 bg-slate-900 shadow-[0_12px_35px_rgba(0,0,0,0.75)]">
              {!roleCardImgError ? (
                <img
                  src={ROLE_INFO[myPlayer.role].image}
                  alt={`การ์ดบทบาท ${ROLE_INFO[myPlayer.role].thaiName}`}
                  referrerPolicy="no-referrer"
                  onError={() => setRoleCardImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-slate-800 to-slate-950">
                  <Shield className="w-14 h-14 text-amber-400 mb-3" />
                  <span className="font-bold text-xl text-white">
                    {ROLE_INFO[myPlayer.role].thaiName}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">
                    {ROLE_INFO[myPlayer.role].teamThai}
                  </span>
                </div>
              )}

              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/80 to-transparent p-4 text-center">
                <p
                  className="text-xs font-bold tracking-wider uppercase"
                  style={{ color: ROLE_INFO[myPlayer.role].accentColor }}
                >
                  {ROLE_INFO[myPlayer.role].teamThai}
                </p>
                <h3 className="text-xl font-bold text-white">
                  {ROLE_INFO[myPlayer.role].thaiName}
                </h3>
                <p className="text-[11px] text-slate-300 font-mono">
                  {ROLE_INFO[myPlayer.role].englishName}
                </p>
              </div>
            </div>

            <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4 space-y-2 text-xs md:text-sm text-slate-200 leading-relaxed">
              <div className="font-bold text-amber-300">
                ความสามารถและหน้าที่ของคุณ:
              </div>
              <p>{ROLE_INFO[myPlayer.role].summary}</p>
              {fellowWolves.length > 0 && (
                <div className="pt-2 border-t border-slate-800 text-red-400 font-bold">
                  🐺 เพื่อนร่วมฝูงหมาป่าของคุณในกระดานนี้คือ:{' '}
                  {fellowWolves
                    .map((w) => `${w.name} (${ROLE_INFO[w.role].thaiName})`)
                    .join(', ')}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setShellState('PLAYING');
                soundFX.playNightTransition();
              }}
              className="w-full py-3.5 px-6 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-base shadow-[0_0_25px_rgba(245,158,11,0.35)] transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Check className="w-5 h-5 stroke-[2.5]" />
              <span>รับทราบบทบาท · เข้าสู่คืนที่ 1</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. ACTIVE GAME HUD & MODERATOR PANEL */}
      {shellState !== 'TITLE_SCREEN' &&
        shellState !== 'FRIEND_JOIN' &&
        shellState !== 'ROLE_REVEAL' && (
          <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-2 pb-12 sm:p-3 sm:pb-12 md:p-5 md:pb-14">
            {/* Top Perimeter Status Bar */}
            <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 md:gap-3 pointer-events-auto bg-[#0B1324]/95 border border-slate-800/90 rounded-xl px-3 py-2 md:px-4 md:py-2.5 shadow-lg">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  {phase === 'NIGHT_ACTION' ? (
                    <Moon className="w-4 h-4 text-red-400 shrink-0" />
                  ) : (
                    <Sun className="w-4 h-4 text-amber-400 shrink-0" />
                  )}
                  <span className="font-bold text-sm md:text-base text-white whitespace-nowrap">
                    หมู่บ้านจันทร์ทมิฬ
                  </span>
                </div>
                <span className="text-slate-600" aria-hidden="true">
                  ·
                </span>
                <div className="text-xs md:text-sm text-amber-300 font-medium font-mono tabular-nums whitespace-nowrap">
                  {phase === 'NIGHT_ACTION' && `คืนที่ ${dayCount} · ยามวิกาล`}
                  {phase === 'DAY_DISCUSSION' && `วันที่ ${dayCount} · ช่วงถกเถียง`}
                  {phase === 'DAY_VOTING' && `วันที่ ${dayCount} · ช่วงโหวตประหาร`}
                  {phase === 'DAY_RESULT' && (
                    <span className="inline-flex items-center gap-2">
                      <span>วันที่ {dayCount} · รอเข้าคืนที่ {dayCount + 1}</span>
                      {dayResultSecondsLeft !== null && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/50 text-amber-200 font-bold">
                          <Clock className="w-3 h-3" />
                          <span>{formatCountdown(dayResultSecondsLeft)}</span>
                        </span>
                      )}
                    </span>
                  )}
                  {phase === 'GAME_OVER' && `จบเกม · สรุปผล`}
                </div>
                <span className="hidden sm:inline text-slate-600" aria-hidden="true">
                  ·
                </span>
                <div className="hidden sm:flex items-center gap-2 text-xs text-slate-300 font-mono tabular-nums">
                  <span>
                    ผู้รอดชีวิต {alivePlayers.length}/{players.length} คน
                  </span>
                  {doubleKillNextNight && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-red-400 font-semibold flex items-center gap-1">
                        <Flame className="w-3.5 h-3.5" />
                        คำสาปลูกหมาป่าทำงาน (หมาป่าฆ่าได้ 2 ศพ!)
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {myPlayer ? (
                  <button
                    onClick={() => {
                      setRoleCardImgError(false);
                      setShowRoleCardModal(true);
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>
                      การ์ดของ {myPlayer.shortName}:{' '}
                      {ROLE_INFO[myPlayer.role].thaiName}
                    </span>
                  </button>
                ) : (
                  <span className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-slate-300 border border-slate-700 whitespace-nowrap shrink-0">
                    โหมดผู้ชม (รอจบรอบนี้)
                  </span>
                )}

                <button
                  onClick={handleCopyInviteLink}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  title="คัดลอกลิงก์ชวนเพื่อนเข้าห้อง"
                >
                  {copiedInviteLink ? (
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Link2 className="w-3.5 h-3.5 text-amber-400" />
                  )}
                  <span className="hidden xl:inline">
                    {copiedInviteLink ? 'คัดลอกลิงก์แล้ว' : `ลิงก์ห้อง #${roomId}`}
                  </span>
                </button>

                <button
                  onClick={() => {
                    setShellState('TITLE_SCREEN');
                    sendWsMessage({ type: 'RETURN_TO_LOBBY' });
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  title="ตั้งค่าจำนวนผู้เล่น / เปลี่ยนชื่อ / สุ่มเกมใหม่"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden xl:inline">ตั้งค่าห้อง / เริ่มใหม่</span>
                </button>

                <button
                  onClick={toggleMute}
                  className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors cursor-pointer"
                  title={muted ? 'เปิดเสียง' : 'ปิดเสียง'}
                >
                  {muted ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>

                <button
                  onClick={openDownloadModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  title="ดาวน์โหลดไฟล์โปรเจกต์"
                >
                  <Download className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden md:inline">ดาวน์โหลดโค้ด</span>
                </button>

                <button
                  onClick={() => setShellState('PAUSED')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Pause className="w-3.5 h-3.5" />
                  <span className="hidden md:inline">กติกา / เมนู</span>
                </button>
              </div>
            </div>

            {/* Main Split Playfield */}
            <div className="flex-1 min-h-0 flex flex-col md:flex-row items-stretch justify-between gap-2 md:gap-4 mt-2 md:mt-3">
              {/* Left Side: Player Roster Strip (Horizontal swipe bar on mobile/tablet, bottom grid on desktop) */}
              <div className="shrink-0 md:flex-1 flex flex-col md:justify-end pointer-events-none">
                <div className="pointer-events-auto bg-[#0B1324]/95 border border-slate-800/90 rounded-xl p-2 md:p-3 shadow-lg">
                  <div className="flex items-center justify-between gap-2 mb-1.5 md:mb-2">
                    <span className="text-[11px] md:text-xs font-semibold text-slate-300 truncate">
                      ผู้เล่น {players.length} คน{' '}
                      <span className="hidden md:inline">
                        รอบโต๊ะสภา (คลิกเลือกเป้าหมายได้ทั้งบนโต๊ะหรือปุ่มด้านล่าง)
                      </span>
                      <span className="md:hidden text-slate-400">
                        (เลื่อนซ้าย-ขวาเพื่อดู)
                      </span>
                    </span>
                    <span className="text-[11px] md:text-xs text-amber-300 font-mono tabular-nums truncate shrink-0 max-w-[52%]">
                      {selectedTargetId === ABSTAIN_VOTE_ID
                        ? 'งดออกเสียง'
                        : selectedTargetId
                        ? `เป้าหมาย: ${players.find((p) => p.id === selectedTargetId)?.shortName}${
                            secondTargetId
                              ? ` + ${players.find((p) => p.id === secondTargetId)?.shortName}`
                              : ''
                          }`
                        : 'ยังไม่เลือกเป้าหมาย'}
                    </span>
                  </div>

                  <div className="flex md:grid md:grid-cols-2 lg:grid-cols-5 gap-1.5 overflow-x-auto md:overflow-visible no-scrollbar pb-0.5 md:pb-0">
                    {players.map((p, index) => {
                      const selectable = isTargetSelectable(p);
                      const isSelected =
                        selectedTargetId === p.id || secondTargetId === p.id;
                      const isFellow = fellowWolves.some((w) => w.id === p.id);
                      const seerStat = seerKnownMap[p.id];
                      const isCurrentViewer = Boolean(myPlayer && p.id === myPlayer.id);
                      const signaledByMe =
                        amWerewolf &&
                        phase === 'NIGHT_ACTION' &&
                        myWolfSignalTargetId === p.id;
                      const signaledByPartner =
                        amWerewolf &&
                        phase === 'NIGHT_ACTION' &&
                        fellowWolfSignalTargetId === p.id;

                      return (
                        <button
                          key={p.id}
                          onClick={() => handleSelectPlayerOnCanvas(p.id)}
                          disabled={!p.alive}
                          className={`min-w-[116px] md:min-w-0 shrink-0 min-h-[44px] text-left px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                            !p.alive
                              ? 'bg-slate-950/60 border-slate-900 opacity-45 cursor-not-allowed'
                              : signaledByMe && signaledByPartner
                              ? 'bg-red-950/50 border-red-400 shadow-[0_0_14px_rgba(239,68,68,0.35)]'
                              : isSelected
                              ? 'bg-amber-500/20 border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
                              : signaledByPartner
                              ? 'bg-red-950/30 border-red-500/60 hover:border-red-400'
                              : selectable
                              ? 'bg-slate-900/90 border-slate-800 hover:border-slate-600'
                              : 'bg-slate-900/50 border-slate-800/60'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs font-bold text-white truncate">
                            <span className="truncate">
                              {index + 1}. {p.shortName}
                            </span>
                            {!p.alive ? (
                              <Skull className="w-3 h-3 text-red-400 shrink-0" />
                            ) : isSelected ? (
                              <Check className="w-3 h-3 text-amber-400 shrink-0" />
                            ) : null}
                          </div>
                          <div className="text-[10px] text-slate-400 truncate flex items-center justify-between gap-1">
                            <span className="truncate">
                              {p.alive
                                ? p.revealedBeggar
                                  ? 'ยาจก (งดโหวต)'
                                  : 'มีชีวิตอยู่'
                                : 'เสียชีวิตแล้ว'}
                            </span>
                            {p.alive &&
                              (phase === 'DAY_DISCUSSION' || phase === 'DAY_RESULT') &&
                              phaseReadyIds.includes(p.id) && (
                                <span className="text-emerald-400 font-bold shrink-0">
                                  ✓ พร้อม
                                </span>
                              )}
                          </div>
                          {isCurrentViewer && (
                            <div className="text-[10px] text-amber-300 font-semibold truncate">
                              คุณ ({ROLE_INFO[p.role].thaiName})
                            </div>
                          )}
                          {!isCurrentViewer && p.isHuman && (
                            <div className="text-[10px] text-sky-300 font-semibold truncate">
                              ผู้เล่นคนจริง
                            </div>
                          )}
                          {isFellow && (
                            <div className="text-[10px] text-red-400 font-semibold truncate">
                              {ROLE_INFO[p.role].thaiName} (ฝูงเรา)
                            </div>
                          )}
                          {(signaledByMe || signaledByPartner) && (
                            <div
                              className={`text-[10px] font-bold truncate ${
                                signaledByMe && signaledByPartner
                                  ? 'text-emerald-300'
                                  : 'text-red-300'
                              }`}
                            >
                              {signaledByMe && signaledByPartner
                                ? '🐺 เห็นตรงกันทั้งฝูง!'
                                : signaledByMe
                                ? '🐺 คุณเล็งอยู่'
                                : '🐺 เพื่อนหมาป่าเล็ง'}
                            </div>
                          )}
                          {seerStat !== undefined && (
                            <div
                              className={`text-[10px] font-semibold truncate ${
                                seerStat ? 'text-red-400' : 'text-emerald-400'
                              }`}
                            >
                              {seerStat ? 'ผลส่อง: หมาป่า!' : 'ผลส่อง: ชาวบ้าน'}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Right Side: Thai Moderator & Natural Player Discussion Console (+ Secret Wolf Chat Tab for Werewolves ONLY) */}
              <div className="w-full md:w-[400px] lg:w-[470px] xl:w-[530px] flex-1 min-h-0 md:flex-none md:h-full flex flex-col pointer-events-auto bg-[#0B1324]/95 border border-slate-800/90 rounded-xl shadow-2xl overflow-hidden">
                {amWerewolf ? (
                  <div className="shrink-0 px-2.5 md:px-3 py-2 border-b border-slate-800 flex items-center gap-2 bg-[#0F172A]">
                    <button
                      type="button"
                      onClick={() => setActiveChatTab('PUBLIC')}
                      className={`flex-1 min-h-[40px] py-1.5 px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                        activeChatTab === 'PUBLIC'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-400/50'
                          : 'bg-slate-900/80 text-slate-400 border border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      <MessageSquare className="w-3.5 h-3.5" />
                      <span>สภาหมู่บ้าน ({visibleMessages.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveChatTab('WOLF');
                        setUnreadWolfCount(0);
                      }}
                      className={`flex-1 min-h-[40px] py-1.5 px-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer relative ${
                        activeChatTab === 'WOLF'
                          ? 'bg-red-950/80 text-red-200 border border-red-500/60 shadow-[0_0_12px_rgba(239,68,68,0.2)]'
                          : 'bg-slate-900/80 text-red-300/80 border border-red-900/40 hover:border-red-500/50'
                      }`}
                    >
                      <Flame className="w-3.5 h-3.5 text-red-400" />
                      <span>แชทลับฝูงหมาป่า</span>
                      {unreadWolfCount > 0 && activeChatTab !== 'WOLF' && (
                        <span className="ml-1 px-1.5 py-0.2 rounded bg-red-500 text-white text-[10px] font-mono">
                          {unreadWolfCount}
                        </span>
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="shrink-0 px-3.5 md:px-4 py-2.5 md:py-3 border-b border-slate-800 flex items-center justify-between bg-[#0F172A]">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-amber-400" />
                      <h2 className="text-sm font-bold text-white">
                        วงสนทนาสภาหมู่บ้านและผู้ดำเนินเกม (Moderator)
                      </h2>
                    </div>
                    <span className="text-xs text-slate-400 font-mono tabular-nums">
                      {visibleMessages.length} ข้อความ
                    </span>
                  </div>
                )}

                {amWerewolf && activeChatTab === 'WOLF' ? (
                  <div className="flex-1 min-h-0 flex flex-col bg-[#140A10]/90">
                    <div className="px-3.5 py-2 bg-red-950/60 border-b border-red-900/60 text-[11px] text-red-200 flex items-center justify-between gap-2">
                      <span>
                        🐺 ช่องกระซิบลับเฉพาะฝูงหมาป่า · ชาวบ้านและบทบาทอื่นไม่มีทางเห็น
                      </span>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5">
                      {wolfMessages.length === 0 ? (
                        <div className="rounded-xl p-4 bg-red-950/25 border border-red-900/40 text-xs text-red-200/80 leading-relaxed text-center space-y-1">
                          <p className="font-bold text-red-300">
                            ยังไม่มีข้อความในช่องลับฝูงหมาป่า
                          </p>
                          <p>
                            คุณสามารถพิมพ์วางแผนกับเพื่อนหมาป่าได้ทั้งกลางคืนและกลางวัน รวมถึงกดเลือกเหยื่อด้านล่างเพื่อส่งซิกให้เห็นตรงกันทั้ง 2 ตัว
                          </p>
                        </div>
                      ) : (
                        wolfMessages.map((wm) => {
                          const isMe = Boolean(myPlayer && wm.senderId === myPlayer.id);
                          return (
                            <div
                              key={wm.id}
                              className={`rounded-xl p-3 text-xs md:text-sm leading-relaxed border ${
                                isMe
                                  ? 'bg-red-900/40 border-red-500/50 text-red-50 ml-5'
                                  : 'bg-[#1F0E16] border-red-900/70 text-red-100 mr-5'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2 text-[11px] mb-1">
                                <span className="font-bold text-red-300">
                                  🐺 {wm.senderName}
                                </span>
                                <span className="font-mono text-[10px] text-red-400/70">
                                  {wm.phaseLabel} · {wm.timestamp}
                                </span>
                              </div>
                              <div className="whitespace-pre-line select-text">
                                {wm.text}
                              </div>
                            </div>
                          );
                        })
                      )}

                      {isGeneratingWolfAI && (
                        <div className="rounded-xl p-2.5 bg-red-950/50 border border-red-800/60 text-xs text-red-200 flex items-center gap-2">
                          <Sparkles className="w-3.5 h-3.5 animate-spin text-red-400" />
                          <span>เพื่อนร่วมฝูงหมาป่ากำลังกระซิบตอบ...</span>
                        </div>
                      )}
                      <div ref={wolfChatEndRef} />
                    </div>

                    {myPlayer?.alive && phase !== 'GAME_OVER' && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSendWolfMessage();
                        }}
                        className="shrink-0 p-2.5 border-t border-red-900/60 bg-[#1B0B12] flex items-center gap-2"
                      >
                        <input
                          type="text"
                          value={wolfChatInput}
                          onChange={(e) => setWolfChatInput(e.target.value)}
                          placeholder="กระซิบวางแผนกับเพื่อนหมาป่า (ชาวบ้านไม่เห็น)..."
                          disabled={isGeneratingWolfAI}
                          className="flex-1 min-w-0 min-h-[44px] bg-slate-950/90 border border-red-900/70 focus:border-red-400 rounded-lg px-3 py-2 text-base md:text-xs text-white placeholder:text-red-300/40 outline-none select-text"
                        />
                        <button
                          type="submit"
                          disabled={!wolfChatInput.trim() || isGeneratingWolfAI}
                          className="min-h-[44px] px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white font-bold text-xs flex items-center gap-1 cursor-pointer shrink-0"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>กระซิบ</span>
                        </button>
                      </form>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4 space-y-2.5 md:space-y-3">
                    {visibleMessages.map((m) => {
                      const isMod = m.senderId === 'moderator';
                      const isSecret = m.senderId === 'secret' || m.isSecret;
                      const isMe = Boolean(myPlayer && m.senderId === myPlayer.id);

                      return (
                        <div
                          key={m.id}
                          className={`rounded-xl p-3.5 text-sm leading-relaxed border ${
                            isSecret
                              ? 'bg-amber-950/35 border-amber-500/40 text-amber-100'
                              : isMod
                              ? 'bg-slate-900/95 border-slate-700/80 text-slate-100'
                              : isMe
                              ? 'bg-sky-950/40 border-sky-500/40 text-sky-100 ml-4'
                              : 'bg-[#131D33] border-slate-800 text-slate-200'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-400 mb-1">
                            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                              <span
                                className={
                                  isSecret
                                    ? 'text-amber-300'
                                    : isMod
                                    ? 'text-amber-400'
                                    : isMe
                                    ? 'text-sky-300'
                                    : 'text-white'
                                }
                              >
                                {m.senderName}
                              </span>
                              {m.tone && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="text-amber-300/90 font-normal">
                                    {m.tone}
                                  </span>
                                </>
                              )}
                            </div>
                            <span className="font-mono tabular-nums text-[11px] text-slate-500 shrink-0">
                              {m.phaseLabel}
                            </span>
                          </div>
                          <div className="whitespace-pre-line text-xs md:text-sm select-text">
                            {m.text}
                          </div>
                        </div>
                      );
                    })}

                    {isGeneratingAI && (
                      <div className="rounded-xl p-3 bg-slate-900/80 border border-slate-800 text-xs text-amber-300 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 animate-spin" />
                        <span>ผู้เล่นในวงกำลังคิดวิเคราะห์และพิมพ์ตอบ...</span>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                )}

                {/* Phase Action Footer */}
                <div className="shrink-0 max-h-[44dvh] md:max-h-none overflow-y-auto p-2.5 sm:p-3.5 border-t border-slate-800 bg-[#0F172A] space-y-2">
                  {/* PHASE 1: NIGHT ACTION CONTROLS */}
                  {phase === 'NIGHT_ACTION' && (
                    <div className="space-y-2.5">
                      {!myPlayer ? (
                        <div className="p-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 text-center">
                          โหมดผู้ชม — เกมรอบนี้กำลังดำเนินอยู่ คุณจะเข้าร่วมเป็นผู้เล่นคนจริงอัตโนมัติในรอบถัดไป
                        </div>
                      ) : hasSubmittedNight && isMultiDeviceOnline ? (
                        <div className="space-y-2">
                          <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/40 text-xs text-emerald-200 text-center">
                            บันทึกแอ็กชันคืนที่ {dayCount} ของคุณแล้ว · รอเพื่อนในห้องยืนยัน ({nightReadyIds.length}/{onlineAliveHumans.length} คน)
                          </div>
                          {isHost && (
                            <button
                              type="button"
                              onClick={() =>
                                sendWsMessage({
                                  type: 'FORCE_RESOLVE_NIGHT',
                                  playerId: myPlayer.id,
                                  nightAction: {
                                    primary: selectedTargetId,
                                    secondary: secondTargetId,
                                  },
                                })
                              }
                              className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs transition-colors cursor-pointer"
                            >
                              หัวห้อง: ดำเนินการจบคืนที่ {dayCount} ทันที
                            </button>
                          )}
                        </div>
                      ) : !myPlayer.alive ? (
                        <button
                          onClick={handleConfirmNightAction}
                          className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition-colors cursor-pointer"
                        >
                          ดำเนินการผ่านคืนที่ {dayCount} ({myPlayer.name} เสียชีวิตแล้ว)
                        </button>
                      ) : myPlayer.role === 'VILLAGER' ||
                        myPlayer.role === 'BEGGAR' ? (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-300">
                            {myPlayer.name} คือ{' '}
                            <span className="text-amber-300 font-semibold">
                              {ROLE_INFO[myPlayer.role].thaiName}
                            </span>{' '}
                            ในยามวิกาลไม่มีแอ็กชันพิเศษ กดเข้านอนเพื่อรอฟังผลในเช้าวันพรุ่งนี้
                          </p>
                          <button
                            onClick={handleConfirmNightAction}
                            className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                          >
                            <Moon className="w-4 h-4" />
                            <span>เข้านอนและรอจนถึงรุ่งสาง (จบคืนที่ {dayCount})</span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {isWerewolfTeam(myPlayer.role) && (
                            <div className="rounded-lg bg-red-950/40 border border-red-800/60 p-2.5 space-y-1.5">
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="font-bold text-red-300 flex items-center gap-1.5">
                                  <Crosshair className="w-3.5 h-3.5 text-red-400" />
                                  <span>
                                    {requiresWolfConsensus
                                      ? 'ส่งซิกฝูงหมาป่า (ต้องเห็นตรงกันทั้ง 2 ตัว)'
                                      : 'สัญญาณล่าของฝูงหมาป่า'}
                                  </span>
                                </span>
                                {activeChatTab !== 'WOLF' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setActiveChatTab('WOLF');
                                      setUnreadWolfCount(0);
                                    }}
                                    className="px-2 py-0.5 rounded bg-red-600/80 hover:bg-red-500 text-white text-[10px] font-bold cursor-pointer shrink-0"
                                  >
                                    เปิดแชทลับ 🐺
                                  </button>
                                )}
                              </div>

                              {livingFellowWolf && (
                                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                                  <div className="text-slate-200 space-x-2">
                                    <span>
                                      คุณ:{' '}
                                      <strong className="text-amber-300">
                                        {myWolfSignalTargetId
                                          ? players.find(
                                              (p) => p.id === myWolfSignalTargetId
                                            )?.shortName || '-'
                                          : 'ยังไม่เล็ง'}
                                      </strong>
                                    </span>
                                    <span className="text-slate-500">|</span>
                                    <span>
                                      {livingFellowWolf.shortName} (
                                      {ROLE_INFO[livingFellowWolf.role].thaiName}):{' '}
                                      <strong className="text-red-300">
                                        {fellowWolfSignalTargetId
                                          ? players.find(
                                              (p) => p.id === fellowWolfSignalTargetId
                                            )?.shortName || '-'
                                          : 'รอส่งซิก...'}
                                      </strong>
                                    </span>
                                  </div>

                                  {fellowWolfSignalTargetId &&
                                    fellowWolfSignalTargetId !== selectedTargetId && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedTargetId(fellowWolfSignalTargetId);
                                          sendWolfSignal(fellowWolfSignalTargetId);
                                        }}
                                        className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold cursor-pointer"
                                      >
                                        เห็นด้วย! เล็ง{' '}
                                        {
                                          players.find(
                                            (p) => p.id === fellowWolfSignalTargetId
                                          )?.shortName
                                        }{' '}
                                        ตามเพื่อน
                                      </button>
                                    )}
                                </div>
                              )}

                              {requiresWolfConsensus && (
                                <div
                                  className={`text-[11px] font-semibold ${
                                    wolvesAgreedOnTarget
                                      ? 'text-emerald-300'
                                      : 'text-amber-300'
                                  }`}
                                >
                                  {wolvesAgreedOnTarget
                                    ? `✓ หมาป่าทั้ง 2 ตัวเห็นตรงกันแล้ว! พร้อมยืนยันสังหาร "${
                                        players.find((p) => p.id === selectedTargetId)
                                          ?.shortName
                                      }"`
                                    : '⚠️ ต้องเลือกเหยื่อคนเดียวกันทั้ง 2 ตัวก่อนจึงจะกดยืนยันสังหารได้ (คลิกเลือกเป้าหมายเพื่อส่งซิก)'}
                                </div>
                              )}

                              {wolfConsensusError && (
                                <div className="text-[11px] text-red-300 font-bold">
                                  {wolfConsensusError}
                                </div>
                              )}
                            </div>
                          )}

                          <div className="flex items-center justify-between text-xs">
                            <span className="text-amber-300 font-semibold">
                              {isWerewolfTeam(myPlayer.role) &&
                                (doubleKillNextNight
                                  ? '🔥 คืนล้างแค้นลูกหมาป่า! คลิกเลือกเหยื่อ 2 คนที่ต้องการสังหาร:'
                                  : 'เลือกเหยื่อ 1 คนที่ฝูงหมาป่าต้องการสังหารในคืนนี้:')}
                              {myPlayer.role === 'SEER' &&
                                'เลือกผู้เล่น 1 คนที่เทพพยากรณ์ต้องการส่องดูบทบาท:'}
                              {myPlayer.role === 'BODYGUARD' &&
                                'เลือกผู้เล่น 1 คนที่บอดี้การ์ดต้องการคุ้มกันในคืนนี้:'}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {players
                              .filter((p) => isTargetSelectable(p))
                              .map((p) => {
                                const isChosen =
                                  selectedTargetId === p.id ||
                                  secondTargetId === p.id;
                                const partnerPointing =
                                  isWerewolfTeam(myPlayer.role) &&
                                  fellowWolfSignalTargetId === p.id;
                                return (
                                  <button
                                    key={p.id}
                                    onClick={() => handleSelectPlayerOnCanvas(p.id)}
                                    className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                                      isChosen && partnerPointing
                                        ? 'bg-emerald-400 text-slate-950 ring-2 ring-emerald-300'
                                        : isChosen
                                        ? 'bg-amber-400 text-slate-950'
                                        : partnerPointing
                                        ? 'bg-red-900/70 text-red-100 border border-red-400 hover:bg-red-800/80'
                                        : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                                    }`}
                                  >
                                    {p.name}
                                    {partnerPointing ? ' 🐺' : ''}
                                  </button>
                                );
                              })}
                          </div>
                          <button
                            onClick={handleConfirmNightAction}
                            disabled={
                              !selectedTargetId ||
                              (requiresWolfConsensus && !wolvesAgreedOnTarget)
                            }
                            className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                          >
                            <Shield className="w-4 h-4" />
                            <span>
                              {!selectedTargetId
                                ? 'โปรดคลิกเลือกเป้าหมายก่อน'
                                : requiresWolfConsensus && !wolvesAgreedOnTarget
                                ? 'รอความเห็นหมาป่าทั้ง 2 ตัวให้ตรงกันก่อน'
                                : `ยืนยันแอ็กชันคืนที่ ${dayCount} กับ ${
                                    players.find((p) => p.id === selectedTargetId)
                                      ?.shortName
                                  }${
                                    secondTargetId
                                      ? ` และ ${
                                          players.find((p) => p.id === secondTargetId)
                                            ?.shortName
                                        }`
                                      : ''
                                  }`}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* PHASE 2: DAY DISCUSSION CONTROLS (UNANIMOUS READY TO VOTE) */}
                  {phase === 'DAY_DISCUSSION' && (
                    <div className="space-y-2">
                      {/* Live unanimous readiness bar (humans + AI) */}
                      <div className="rounded-lg bg-slate-900/90 border border-slate-800 px-3 py-2 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-300 font-semibold">
                            ความพร้อมเข้าสู่ช่วงโหวต (ต้องครบทุกคนทั้งคนจริงและ AI):
                          </span>
                          <span className="font-mono font-bold text-amber-300 tabular-nums">
                            {readyCountInPhase}/{requiredPhaseReadyPlayers.length} คน
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {requiredPhaseReadyPlayers.map((rp) => {
                            const ready = phaseReadyIds.includes(rp.id);
                            return (
                              <span
                                key={rp.id}
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                                  ready
                                    ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300'
                                    : 'bg-slate-800/80 border-slate-700 text-slate-400'
                                }`}
                              >
                                {ready ? '✓ ' : ''}
                                {rp.shortName}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {!myPlayer ? (
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 text-center">
                          โหมดผู้ชม — กำลังรับชมวงสนทนาของสภาหมู่บ้าน (คุณจะได้เข้าร่วมในรอบถัดไป)
                        </div>
                      ) : (
                        <>
                          {myPlayer.alive && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                handleSendHumanStatement();
                              }}
                              className="flex items-center gap-2"
                            >
                              <input
                                type="text"
                                value={humanInput}
                                onChange={(e) => setHumanInput(e.target.value)}
                                placeholder={`พิมพ์พูดคุย ถามจี้ หรือวิเคราะห์ในชื่อ "${myPlayer.name}"...`}
                                disabled={isGeneratingAI}
                                className="flex-1 min-w-0 min-h-[44px] bg-slate-900 border border-slate-700 focus:border-amber-400 rounded-lg px-3 py-2 text-base md:text-sm text-white placeholder:text-slate-500 outline-none select-text"
                              />
                              <button
                                type="submit"
                                disabled={!humanInput.trim() || isGeneratingAI}
                                className="min-h-[44px] px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-amber-300 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                              >
                                <Send className="w-3.5 h-3.5" />
                                <span>ส่งข้อความ</span>
                              </button>
                            </form>
                          )}

                          <div
                            className={`grid gap-2 ${
                              aliveAICount > 0 && myPlayer.alive
                                ? 'grid-cols-1 sm:grid-cols-2'
                                : 'grid-cols-1'
                            }`}
                          >
                            {aliveAICount > 0 && (
                              <button
                                type="button"
                                onClick={handleContinueAIDebate}
                                disabled={isGeneratingAI}
                                className="min-h-[44px] py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-semibold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 border border-slate-700"
                              >
                                <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                                <span>ฟังคนในวงวิเคราะห์กันต่อ</span>
                              </button>
                            )}

                            {myPlayer.alive ? (
                              <button
                                type="button"
                                onClick={() =>
                                  togglePhaseReady(
                                    myPlayer.id,
                                    !isMyPhaseReady,
                                    'DAY_VOTING'
                                  )
                                }
                                disabled={isGeneratingAI}
                                className={`min-h-[44px] py-2 px-3 rounded-lg font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
                                  isMyPhaseReady
                                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                    : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                                }`}
                              >
                                {isMyPhaseReady ? (
                                  <>
                                    <Check className="w-4 h-4 stroke-[2.5]" />
                                    <span>
                                      พร้อมโหวตแล้ว ({readyCountInPhase}/
                                      {requiredPhaseReadyPlayers.length}) · คลิกเพื่อยกเลิก
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <UserCheck className="w-4 h-4" />
                                    <span>
                                      กดพร้อมเข้าสู่ช่วงโหวต ({readyCountInPhase}/
                                      {requiredPhaseReadyPlayers.length})
                                    </span>
                                  </>
                                )}
                              </button>
                            ) : (
                              <div className="py-2 px-3 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 text-center">
                                คุณเสียชีวิตแล้ว · รอผู้รอดชีวิตกดพร้อมเข้าสู่ช่วงโหวตให้ครบทุกคน
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* PHASE 3: DAY VOTING CONTROLS */}
                  {phase === 'DAY_VOTING' && (
                    <div className="space-y-2.5">
                      {!myPlayer ? (
                        <div className="p-3 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 text-center">
                          โหมดผู้ชม — รอผู้เล่นในสภาลงคะแนนโหวตประหาร
                        </div>
                      ) : hasSubmittedVote && isMultiDeviceOnline ? (
                        <div className="space-y-2">
                          <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 text-center">
                            ส่งคะแนนโหวตของคุณแล้ว · รอเพื่อนในห้องลงคะแนน ({voteReadyIds.length}/{onlineEligibleHumanVoters.length} คน)
                          </div>
                          {isHost && (
                            <button
                              type="button"
                              onClick={() =>
                                sendWsMessage({
                                  type: 'FORCE_RESOLVE_VOTE',
                                  playerId: myPlayer.id,
                                  voteTargetId: selectedTargetId,
                                })
                              }
                              className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition-colors cursor-pointer"
                            >
                              หัวห้อง: สรุปผลโหวตประหารทันที
                            </button>
                          )}
                        </div>
                      ) : myPlayer.alive && myPlayer.canVote ? (
                        <>
                          <p className="text-xs text-amber-300 font-semibold">
                            เลือกผู้เล่น 1 คนที่ {myPlayer.name} ต้องการโหวตประหาร หรือเลือก &quot;งดออกเสียง (ไม่โหวต)&quot; เพื่อเก็บไว้ตัดสินใจวันหลัง:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {players
                              .filter((p) => p.alive && p.id !== myPlayer.id)
                              .map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => setSelectedTargetId(p.id)}
                                  className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                                    selectedTargetId === p.id
                                      ? 'bg-red-500 text-white'
                                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                                  }`}
                                >
                                  โหวต {p.shortName}
                                </button>
                              ))}
                            <button
                              type="button"
                              onClick={() => setSelectedTargetId(ABSTAIN_VOTE_ID)}
                              className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center gap-1 border ${
                                selectedTargetId === ABSTAIN_VOTE_ID
                                  ? 'bg-amber-400 text-slate-950 border-amber-300'
                                  : 'bg-slate-900 text-amber-200 border-amber-500/40 hover:bg-slate-800'
                              }`}
                            >
                              <Ban className="w-3.5 h-3.5" />
                              <span>งดออกเสียง (ไม่โหวตวันนี้)</span>
                            </button>
                          </div>
                          <button
                            onClick={handleConfirmVote}
                            disabled={!selectedTargetId || isGeneratingAI}
                            className={`w-full min-h-[44px] py-2.5 px-4 rounded-lg disabled:bg-slate-800 disabled:text-slate-500 font-bold text-sm transition-colors cursor-pointer ${
                              selectedTargetId === ABSTAIN_VOTE_ID
                                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                                : 'bg-red-600 hover:bg-red-500 text-white'
                            }`}
                          >
                            {selectedTargetId === ABSTAIN_VOTE_ID
                              ? 'ยืนยัน: งดออกเสียง (ไม่โหวตประหารใครในวันนี้)'
                              : selectedTargetId
                              ? `ยืนยันโหวตประหาร "${
                                  players.find((p) => p.id === selectedTargetId)?.name
                                }"`
                              : 'โปรดเลือกผู้เล่นที่ต้องการโหวต หรือเลือก "งดออกเสียง"'}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={handleConfirmVote}
                          disabled={isGeneratingAI}
                          className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-sm transition-colors cursor-pointer"
                        >
                          {!myPlayer.alive
                            ? 'ดูผลการโหวตของผู้เล่นที่เหลืออยู่'
                            : 'คุณเสียสิทธิ์โหวตแล้ว (ยาจก) · กดเพื่อดูผลโหวตของสภา'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* PHASE 3B: DAY RESULT — CASE 1: 5-MIN TIMER + CHAT OR CASE 2: UNANIMOUS READY TO ENTER NEXT NIGHT */}
                  {phase === 'DAY_RESULT' && (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-slate-900/90 border border-amber-500/30 px-3 py-2 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="text-amber-300 font-bold flex items-center gap-1.5">
                            <Moon className="w-3.5 h-3.5" />
                            <span>
                              พร้อมเข้าสู่คืนที่ {dayCount + 1} (ครบทุกคนข้ามทันที / คุยต่อได้สูงสุด 5 นาที)
                            </span>
                          </span>
                          <div className="flex items-center gap-2 font-mono font-bold tabular-nums">
                            {dayResultSecondsLeft !== null && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/50 text-amber-200">
                                <Clock className="w-3 h-3" />
                                <span>{formatCountdown(dayResultSecondsLeft)}</span>
                              </span>
                            )}
                            <span className="text-emerald-300">
                              {readyCountInPhase}/{requiredPhaseReadyPlayers.length} คน
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {requiredPhaseReadyPlayers.map((rp) => {
                            const ready = phaseReadyIds.includes(rp.id);
                            return (
                              <span
                                key={rp.id}
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                                  ready
                                    ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300'
                                    : 'bg-slate-800/80 border-slate-700 text-slate-400'
                                }`}
                              >
                                {ready ? '✓ ' : ''}
                                {rp.shortName}
                              </span>
                            );
                          })}
                        </div>
                      </div>

                      {myPlayer?.alive && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleSendHumanStatement();
                          }}
                          className="flex items-center gap-2"
                        >
                          <input
                            type="text"
                            value={humanInput}
                            onChange={(e) => setHumanInput(e.target.value)}
                            placeholder={`คุยวิเคราะห์ต่อก่อนหมดเวลา 5 นาที ในชื่อ "${myPlayer.name}"...`}
                            disabled={isGeneratingAI}
                            className="flex-1 min-w-0 min-h-[44px] bg-slate-900 border border-slate-700 focus:border-amber-400 rounded-lg px-3 py-2 text-base md:text-sm text-white placeholder:text-slate-500 outline-none select-text"
                          />
                          <button
                            type="submit"
                            disabled={!humanInput.trim() || isGeneratingAI}
                            className="min-h-[44px] px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-amber-300 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>ส่ง</span>
                          </button>
                        </form>
                      )}

                      {!myPlayer ? (
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300 text-center">
                          โหมดผู้ชม — รอผู้รอดชีวิตกดพร้อมเข้าสู่คืนที่ {dayCount + 1} ครบทุกคน หรือหมดเวลา 5 นาที
                        </div>
                      ) : myPlayer.alive ? (
                        <button
                          type="button"
                          onClick={() =>
                            togglePhaseReady(
                              myPlayer.id,
                              !isMyPhaseReady,
                              'NIGHT_ACTION'
                            )
                          }
                          className={`w-full min-h-[44px] py-2.5 px-4 rounded-lg font-bold text-sm transition-colors cursor-pointer flex items-center justify-center gap-2 ${
                            isMyPhaseReady
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                              : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                          }`}
                        >
                          {isMyPhaseReady ? (
                            <>
                              <Check className="w-4 h-4 stroke-[2.5]" />
                              <span>
                                คุณกดพร้อมเข้าสู่คืนที่ {dayCount + 1} แล้ว · รอครบ ({readyCountInPhase}/{requiredPhaseReadyPlayers.length})
                              </span>
                            </>
                          ) : (
                            <>
                              <Moon className="w-4 h-4" />
                              <span>
                                ยืนยันพร้อมเข้าสู่คืนที่ {dayCount + 1} ทันที ({readyCountInPhase}/{requiredPhaseReadyPlayers.length} คน)
                              </span>
                            </>
                          )}
                        </button>
                      ) : (
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400 text-center">
                          คุณเสียชีวิตแล้ว · รอผู้รอดชีวิตยืนยันพร้อมครบทุกคน หรือครบเวลา 5 นาทีเพื่อเข้าสู่คืนที่ {dayCount + 1}
                        </div>
                      )}
                    </div>
                  )}

                  {/* PHASE 4: GAME OVER QUICK RESTART */}
                  {phase === 'GAME_OVER' && (
                    <button
                      onClick={startNewRandomGame}
                      className="w-full min-h-[44px] py-2.5 px-4 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>สุ่มบทบาทใหม่และเริ่มเกมรอบต่อไปทันที</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

      {/* 4. IN-GAME SECRET ROLE CARD MODAL (STRICTLY ONLY MY OWN CARD) */}
      {showRoleCardModal && myPlayer && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/80 pointer-events-auto">
          <div className="bg-[#0F172A] border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-amber-400 font-semibold">
                  การ์ดบทบาทลับของ {myPlayer.name} · ห้ามให้ผู้อื่นล่วงรู้
                </p>
                <h3 className="text-xl font-bold text-white">
                  {ROLE_INFO[myPlayer.role].thaiName} (
                  {ROLE_INFO[myPlayer.role].englishName})
                </h3>
              </div>
              <button
                onClick={() => setShowRoleCardModal(false)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
              >
                <EyeOff className="w-3.5 h-3.5" />
                <span>ซ่อนการ์ด</span>
              </button>
            </div>

            <div className="relative aspect-[3/4] w-56 mx-auto rounded-xl overflow-hidden border border-amber-500/30 bg-slate-900">
              {!roleCardImgError ? (
                <img
                  src={ROLE_INFO[myPlayer.role].image}
                  alt={`การ์ดบทบาท ${ROLE_INFO[myPlayer.role].thaiName}`}
                  referrerPolicy="no-referrer"
                  onError={() => setRoleCardImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-slate-800 to-slate-950">
                  <Shield className="w-12 h-12 text-amber-400 mb-3" />
                  <span className="font-bold text-lg text-white">
                    {ROLE_INFO[myPlayer.role].thaiName}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">
                    {ROLE_INFO[myPlayer.role].teamThai}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2 text-xs md:text-sm text-slate-300 leading-relaxed">
              <div className="text-amber-300 font-semibold">
                สังกัด: {ROLE_INFO[myPlayer.role].teamThai}
              </div>
              <p>{ROLE_INFO[myPlayer.role].summary}</p>
              {fellowWolves.length > 0 && (
                <p className="text-red-300 font-semibold">
                  เพื่อนร่วมฝูงหมาป่าของคุณคือ:{' '}
                  {fellowWolves
                    .map((w) => `${w.name} (${ROLE_INFO[w.role].thaiName})`)
                    .join(', ')}
                </p>
              )}
              {myPlayer.role === 'SEER' && seerKnowledge.length > 0 && (
                <div className="pt-1 border-t border-slate-800">
                  <p className="font-semibold text-amber-300 mb-1">
                    ประวัติการส่องของเทพพยากรณ์:
                  </p>
                  {seerKnowledge.map((k) => (
                    <div key={k.night} className="text-xs">
                      • คืนที่ {k.night}: {k.targetName} ➔{' '}
                      <span
                        className={
                          k.isWerewolf ? 'text-red-400 font-bold' : 'text-emerald-400'
                        }
                      >
                        {k.isWerewolf ? 'ฝ่ายมนุษย์หมาป่า' : 'ฝ่ายชาวบ้าน'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. PAUSE / RULES MODAL */}
      {shellState === 'PAUSED' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/80 pointer-events-auto">
          <div className="bg-[#0F172A] border border-slate-700 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-white">
                พักเกม · กติกาสภาหมู่บ้านจันทร์ทมิฬ ({players.length} คน)
              </h3>
              <span className="text-xs text-slate-400 font-mono">
                กด Esc เพื่อกลับสู่เกม
              </span>
            </div>

            <div className="space-y-2.5 text-xs md:text-sm text-slate-300 leading-relaxed">
              <p>
                • <strong className="text-white">บทบาทในกระดาน ({players.length} คน):</strong>{' '}
                มีฝ่ายหมาป่า 2 ตนเสมอ โดยสุ่มเลือก 2 ตนจาก 3 สายพันธุ์ ได้แก่ พ่อหมาป่า, ลูกหมาป่า (Wolf Cub) และ หมาป่ามนุษย์ (Human Werewolf)
                ส่วนฝ่ายชาวบ้านประกอบด้วย เทพพยากรณ์ 1 คน, บอดี้การ์ด 1 คน, ยาจก/คนงี่เง่า (เมื่อเล่น 7 คนขึ้นไป) และชาวบ้าน
              </p>
              <p>
                • <strong className="text-rose-300">หมาป่ามนุษย์ (Human Werewolf):</strong>{' '}
                เป็นฝ่ายหมาป่าที่แฝงตัวแนบเนียน หากเทพพยากรณ์ (หมอดู) ส่องดูตัวตน จะสแกนเห็นเป็น &quot;ฝ่ายชาวบ้าน&quot; ไม่สามารถจับด้วยลูกแก้วได้!
              </p>
              <p>
                • <strong className="text-red-300">แชทลับฝูงหมาป่า & มติเอกฉันท์ 2 ตัว:</strong>{' '}
                ฝูงหมาป่ามีแท็บแชทลับคุยกันได้เฉพาะพวกเดียวกัน (ชาวบ้านไม่เห็น) และช่วงกลางคืนเมื่อยังมีชีวิตครบ 2 ตัว ต้องส่งซิกเลือกเหยื่อคนเดียวกันให้ตรงกันทั้งคู่จึงจะยืนยันฆ่าได้
              </p>
              <p>
                • <strong className="text-emerald-300">งดออกเสียง & ผลโหวตเสมอกัน:</strong>{' '}
                ในช่วงโหวตสามารถเลือก &quot;งดออกเสียง (ไม่โหวต)&quot; เพื่อเก็บไว้ตัดสินใจวันหลังได้ และหากคะแนนโหวตสูงสุดเสมอกันหรือเสียงงดออกเสียงมากที่สุด จะไม่มีใครถูกประหาร
              </p>
              <p>
                • <strong className="text-sky-300">การข้ามเข้าช่วงกลางคืน (2 กรณี):</strong>{' '}
                หลังโหวตจบสามารถคุยต่อได้สูงสุด 5 นาทีแล้วระบบจะตัดเข้ากลางคืนอัตโนมัติ หรือหากผู้รอดชีวิตทุกคน (ทั้งคนจริงและ AI) กดพร้อมครบ 100% จะข้ามเข้ากลางคืนทันที
              </p>
              <p>
                • <strong className="text-orange-300">ลูกหมาป่า (Wolf Cub):</strong>{' '}
                หากลูกหมาป่าถูกประหารหรือตาย คืนถัดไปหมาป่าที่เหลืออยู่จะได้สิทธิ์ฆ่าเหยื่อ 2 คน!
              </p>
              <p>
                • <strong className="text-amber-300">ยาจก / คนงี่เง่า (Beggar / Idiot):</strong>{' '}
                หากถูกโหวตประหารด้วยเสียงข้างมากเดี่ยว การ์ดจะถูกเปิดเผยและรอดชีวิตไม่ตาย แต่จะเสียสิทธิ์โหวตไปตลอดทั้งเกม
              </p>
              <p>
                • <strong className="text-white">เงื่อนไขการชนะ:</strong>{' '}
                ฝ่ายชาวบ้านชนะเมื่อกำจัดฝ่ายหมาป่าได้ครบทั้ง 2 ตน /
                ฝ่ายหมาป่าชนะทันทีเมื่อจำนวนฝ่ายหมาป่าที่รอดชีวิตเท่ากับหรือมากกว่าชาวบ้านที่เหลืออยู่
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setShellState('TITLE_SCREEN');
                  sendWsMessage({ type: 'RETURN_TO_LOBBY' });
                }}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 cursor-pointer"
              >
                ตั้งค่าผู้เล่น / เปลี่ยนชื่อ
              </button>
              <button
                onClick={startNewRandomGame}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 cursor-pointer flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>สุ่มบทบาทเริ่มเกมใหม่</span>
              </button>
              <button
                onClick={() => setShellState('PLAYING')}
                className="px-5 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 text-xs font-bold text-slate-950 cursor-pointer"
              >
                เล่นต่อ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. VICTORY / GAME OVER MODAL WITH POST-GAME AI DEBRIEF */}
      {shellState === 'GAME_OVER' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-3 md:p-5 bg-black/85 pointer-events-auto">
          <div className="bg-[#0F172A] border border-slate-700 rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-800 bg-[#0B1324] space-y-1 shrink-0">
              <p className="text-xs font-semibold tracking-wider text-amber-400">
                บทสรุปแห่งหมู่บ้านจันทร์ทมิฬ · จบเกมในวันที่ {dayCount}
              </p>
              <h2 className="text-2xl md:text-3xl font-bold text-white">
                {winSummary.winner === 'VILLAGE'
                  ? 'ฝ่ายชาวบ้านเป็นฝ่ายชนะ!'
                  : 'ฝ่ายมนุษย์หมาป่าเป็นฝ่ายชนะ!'}
              </h2>
              <p className="text-xs md:text-sm text-slate-300 leading-relaxed pt-0.5">
                {winSummary.reasonThai}
              </p>
            </div>

            {/* Scrollable Body: Role Reveal + Candid AI Post-Game Thoughts */}
            <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6 space-y-5">
              {/* Revealed Roles Grid */}
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-300">
                  เฉลยบทบาทลับของผู้เล่นทั้ง {players.length} คน:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {players.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs"
                    >
                      <div className="truncate">
                        <span className="font-bold text-white">{p.name}</span>
                        <span className="text-slate-500 mx-1.5" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-400">
                          {p.alive ? 'รอดชีวิต' : 'เสียชีวิต'}
                        </span>
                      </div>
                      <span
                        className="font-bold shrink-0 ml-2"
                        style={{ color: ROLE_INFO[p.role].accentColor }}
                      >
                        {ROLE_INFO[p.role].thaiName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Post-Game AI Debrief Section */}
              {players.some((p) => !p.isHuman) && (
                <div className="space-y-2.5 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-amber-400" />
                      <h3 className="text-sm font-bold text-amber-300">
                        เปิดใจหลังเฉลยบทบาท · ผู้เล่น AI คิดยังไงกันบ้าง (ชม / บ่น / แซว)
                      </h3>
                    </div>
                    {!isGeneratingPostGame && postGameReactions.length > 0 && (
                      <span className="text-[11px] font-mono text-slate-400">
                        {postGameReactions.length} ความเห็น
                      </span>
                    )}
                  </div>

                  {isGeneratingPostGame ? (
                    <div className="p-4 rounded-xl bg-slate-900/90 border border-amber-500/30 flex items-center justify-center gap-2.5 text-xs md:text-sm text-amber-200">
                      <Sparkles className="w-4 h-4 animate-spin text-amber-400" />
                      <span>ผู้เล่น AI กำลังเปิดการ์ดดูบทบาททุกคนและพิมพ์เม้าท์หลังจบเกม...</span>
                    </div>
                  ) : postGameReactions.length > 0 ? (
                    <div className="space-y-2.5">
                      {postGameReactions.map((r) => {
                        const badgeClass =
                          r.sentiment === 'roast'
                            ? 'bg-red-950/70 text-red-300 border-red-500/40'
                            : r.sentiment === 'shock'
                            ? 'bg-amber-950/70 text-amber-300 border-amber-500/40'
                            : r.sentiment === 'proud'
                            ? 'bg-indigo-950/70 text-indigo-300 border-indigo-500/40'
                            : 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40';

                        return (
                          <div
                            key={r.speakerId}
                            className="p-3.5 rounded-xl bg-[#131D33] border border-slate-800 space-y-1.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white">
                                  {r.speakerName}
                                </span>
                                <span
                                  className="font-semibold text-[11px]"
                                  style={{ color: ROLE_INFO[r.role].accentColor }}
                                >
                                  ({ROLE_INFO[r.role].thaiName})
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  · {r.alive ? 'รอดชีวิต' : 'เสียชีวิต'}
                                </span>
                              </div>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${badgeClass}`}
                              >
                                {r.moodTag}
                              </span>
                            </div>
                            <p className="text-xs md:text-sm text-slate-200 leading-relaxed select-text">
                              “{r.text}”
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Footer Controls */}
            <div className="px-6 py-4 border-t border-slate-800 bg-[#0B1324] flex flex-wrap items-center justify-end gap-3 shrink-0">
              <button
                onClick={() => setShellState('PLAYING')}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
              >
                ดูบันทึกการสนทนาย้อนหลัง
              </button>
              <button
                onClick={() => {
                  setShellState('TITLE_SCREEN');
                  sendWsMessage({ type: 'RETURN_TO_LOBBY' });
                }}
                className="px-4 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-amber-300 cursor-pointer"
              >
                ตั้งค่าห้อง / เปลี่ยนจำนวนคน
              </button>
              <button
                onClick={startNewRandomGame}
                className="px-6 py-2.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-xs md:text-sm font-bold text-slate-950 cursor-pointer flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>สุ่มบทบาทเล่นอีกครั้ง</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. PROJECT DOWNLOAD & SOURCE CODE VIEWER MODAL */}
      {showDownloadModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 pointer-events-auto">
          <div className="bg-[#0F172A] border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#0B1324]">
              <div className="flex items-center gap-2.5">
                <FileCode className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-base md:text-lg font-bold text-white">
                    ดาวน์โหลดไฟล์โปรเจกต์ทั้งหมด (พร้อมไฟล์ render.yaml สำหรับ Render.com)
                  </h3>
                  <p className="text-xs text-slate-400">
                    คลิกปุ่มด้านล่างเพื่อดาวน์โหลดไฟล์รวมทั้งโปรเจกต์ หรือเลือกคัดลอก/ดาวน์โหลดแยกทีละไฟล์
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDownloadModal(false)}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="px-6 py-4 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1 text-xs text-slate-300">
                <p className="font-semibold text-amber-300">
                  พร้อมอัปขึ้น GitHub & Deploy บน Render.com ได้ทันที (มี render.yaml และ .env.example ครบ)
                </p>
                <p className="text-slate-400">
                  Build Command: <code className="text-amber-300">npm install --include=dev --legacy-peer-deps && npm run build</code> · Start Command:{' '}
                  <code className="text-amber-300">npm start</code>
                </p>
              </div>
              <a
                href="/api/project-archive"
                download="ultimate-werewolf-thai.tar.gz"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs md:text-sm shadow-lg transition-colors cursor-pointer shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>ดาวน์โหลดไฟล์ทั้งหมด (.tar.gz)</span>
              </a>
            </div>

            <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
              <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-slate-800 bg-[#0B1324] overflow-y-auto p-3 space-y-1">
                <p className="text-[11px] font-semibold text-slate-400 px-2 pb-1">
                  รายการไฟล์โค้ดในโปรเจกต์ ({sourceFiles.length} ไฟล์)
                </p>
                {sourceFiles.map((f, idx) => (
                  <button
                    key={f.path}
                    onClick={() => setSelectedFileIndex(idx)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition-colors cursor-pointer flex items-center justify-between ${
                      selectedFileIndex === idx
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold'
                        : 'text-slate-300 hover:bg-slate-800/70'
                    }`}
                  >
                    <span className="truncate">{f.path}</span>
                  </button>
                ))}
              </div>

              <div className="flex-1 flex flex-col min-w-0 bg-slate-950 overflow-hidden">
                {sourceFiles[selectedFileIndex] ? (
                  <>
                    <div className="px-4 py-2.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/70">
                      <span className="text-xs font-mono text-amber-300 font-semibold">
                        {sourceFiles[selectedFileIndex].path}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() =>
                            handleCopyFileContent(
                              sourceFiles[selectedFileIndex].path,
                              sourceFiles[selectedFileIndex].content
                            )
                          }
                          className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          <span>
                            {copiedFile === sourceFiles[selectedFileIndex].path
                              ? 'คัดลอกแล้ว!'
                              : 'คัดลอกโค้ด'}
                          </span>
                        </button>
                        <button
                          onClick={() =>
                            handleDownloadSingleFile(
                              sourceFiles[selectedFileIndex].path,
                              sourceFiles[selectedFileIndex].content
                            )
                          }
                          className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>ดาวน์โหลดไฟล์นี้</span>
                        </button>
                      </div>
                    </div>
                    <pre className="flex-1 p-4 text-xs font-mono text-slate-200 overflow-auto leading-relaxed select-text">
                      {sourceFiles[selectedFileIndex].content}
                    </pre>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-slate-400">
                    กำลังโหลดรายการไฟล์...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 8. DRAMATIC FULL-SCREEN DEATH ANIMATIONS (NIGHT WOLF KILL & DAY EXECUTION) */}
      {deathOverlay && (
        <DeathAnimationOverlay
          type={deathOverlay}
          playerName={myPlayer?.name || myName}
          onClose={() => setDeathOverlay(null)}
        />
      )}

      {/* 8B. FULL-SCREEN BODYGUARD SHIELD PERSPECTIVE ANIMATIONS */}
      {bodyguardOverlay && !deathOverlay && (
        <BodyguardAnimationOverlay
          type={bodyguardOverlay}
          playerName={myPlayer?.name || myName}
          onClose={() => setBodyguardOverlay(null)}
        />
      )}

      {/* 9. TEMPORARY CORNER ANIMATION PREVIEW BUTTONS */}
      <div className="fixed bottom-1.5 left-2 right-2 md:right-auto z-[60] flex items-center gap-1.5 overflow-x-auto no-scrollbar md:flex-wrap pointer-events-auto">
        <button
          type="button"
          onClick={() => {
            setBodyguardOverlay(null);
            setDeathOverlay('WOLF_KILL');
          }}
          className="shrink-0 px-2.5 py-1.5 rounded-lg bg-red-950/90 hover:bg-red-800/95 text-red-200 border border-red-500/50 text-[11px] font-semibold shadow-lg backdrop-blur-sm transition-colors cursor-pointer flex items-center gap-1"
          title="ทดสอบแอนิเมชันโดนหมาป่าฆ่าตอนกลางคืน"
        >
          <Skull className="w-3 h-3 text-red-400" />
          <span>Test Wolf Kill</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setBodyguardOverlay(null);
            setDeathOverlay('DAY_EXECUTION');
          }}
          className="shrink-0 px-2.5 py-1.5 rounded-lg bg-orange-950/90 hover:bg-orange-800/95 text-amber-200 border border-amber-500/50 text-[11px] font-semibold shadow-lg backdrop-blur-sm transition-colors cursor-pointer flex items-center gap-1"
          title="ทดสอบแอนิเมชันโดนชาวบ้านโหวตประหารตอนกลางวัน"
        >
          <Flame className="w-3 h-3 text-amber-400" />
          <span>Test Execution</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setDeathOverlay(null);
            setBodyguardOverlay('WOLF_BLOCKED');
          }}
          className="shrink-0 px-2.5 py-1.5 rounded-lg bg-sky-950/90 hover:bg-sky-800/95 text-sky-200 border border-sky-400/50 text-[11px] font-semibold shadow-lg backdrop-blur-sm transition-colors cursor-pointer flex items-center gap-1"
          title="ทดสอบมุมมองหมาป่าเมื่อโดนบอดี้การ์ดบล็อก"
        >
          <Shield className="w-3 h-3 text-sky-300" />
          <span>Test: Wolf Blocked</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setDeathOverlay(null);
            setBodyguardOverlay('VICTIM_SAVED');
          }}
          className="shrink-0 px-2.5 py-1.5 rounded-lg bg-amber-950/90 hover:bg-amber-800/95 text-amber-200 border border-amber-400/50 text-[11px] font-semibold shadow-lg backdrop-blur-sm transition-colors cursor-pointer flex items-center gap-1"
          title="ทดสอบมุมมองเหยื่อที่รอดชีวิตเพราะบอดี้การ์ดช่วยไว้"
        >
          <Shield className="w-3 h-3 text-amber-300" />
          <span>Test: Victim Saved</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setDeathOverlay(null);
            setBodyguardOverlay('BG_SUCCESS');
          }}
          className="shrink-0 px-2.5 py-1.5 rounded-lg bg-emerald-950/90 hover:bg-emerald-800/95 text-emerald-200 border border-emerald-400/50 text-[11px] font-semibold shadow-lg backdrop-blur-sm transition-colors cursor-pointer flex items-center gap-1"
          title="ทดสอบมุมมองบอดี้การ์ดเมื่อปกป้องเป้าหมายสำเร็จ"
        >
          <Shield className="w-3 h-3 text-emerald-300" />
          <span>Test: BG Success</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setDeathOverlay(null);
            setBodyguardOverlay('BG_FAILED');
          }}
          className="shrink-0 px-2.5 py-1.5 rounded-lg bg-slate-900/95 hover:bg-slate-800 text-slate-300 border border-slate-500/50 text-[11px] font-semibold shadow-lg backdrop-blur-sm transition-colors cursor-pointer flex items-center gap-1"
          title="ทดสอบมุมมองบอดี้การ์ดเมื่อปกป้องผิดคน"
        >
          <Shield className="w-3 h-3 text-slate-400" />
          <span>Test: BG Failed</span>
        </button>
      </div>
    </div>
  );
}
