import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
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
  BodyguardRecord,
  ChatMessage,
  HumanParticipant,
  PhaseType,
  Player,
  ROLE_INFO,
  RoleType,
  SeerRecord,
  VoteRecord,
  buildRolePoolForCount,
  checkWinCondition,
  createInitialPlayers,
  generateLocalDayDiscussion,
  generateLocalReplyToHuman,
  generateLocalVotes,
  isWerewolfTeam,
  resolveNightPhase,
} from './data/werewolfEngine';
import { VillageCanvas } from './components/VillageCanvas';
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

  const [activeHumanId, setActiveHumanId] = useState<string>(() => getOrCreateMyClientId());
  const [revealIndex, setRevealIndex] = useState<number>(0);

  const [phase, setPhase] = useState<PhaseType>('NIGHT_ACTION');
  const [dayCount, setDayCount] = useState<number>(1);

  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [secondTargetId, setSecondTargetId] = useState<string | null>(null);
  const [nightReadyIds, setNightReadyIds] = useState<string[]>([]);
  const [voteReadyIds, setVoteReadyIds] = useState<string[]>([]);
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
  const player1NameInputRef = useRef<HTMLInputElement | null>(null);
  const friendNicknameInputRef = useRef<HTMLInputElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Refs to hold latest resolve functions for WebSocket server triggers
  const executeNightResolveRef = useRef<
    ((collectedActions: Record<string, { primary: string | null; secondary?: string | null }>) => void) | null
  >(null);
  const executeVoteResolveRef = useRef<
    ((collectedVotes: Record<string, string>) => void) | null
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
              if (data.type === 'ROOM_SYNC' && data.gameStarted && data.snapshot) {
                const snap = data.snapshot;
                if (Array.isArray(snap.players)) setPlayers(snap.players);
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
                setShellState(snap.shellState === 'GAME_OVER' ? 'GAME_OVER' : 'ROLE_REVEAL');
              }
            } else if (data.type === 'GAME_STARTED' && data.snapshot) {
              const snap = data.snapshot;
              if (data.hostId) setHostId(data.hostId);
              if (Array.isArray(snap.players)) setPlayers(snap.players);
              if (snap.phase) setPhase(snap.phase);
              if (typeof snap.dayCount === 'number') setDayCount(snap.dayCount);
              setDoubleKillNextNight(Boolean(snap.doubleKillNextNight));
              setLastProtectedId(snap.lastProtectedId || null);
              setSeerKnowledge(snap.seerKnowledge || []);
              setBodyguardKnowledge(snap.bodyguardKnowledge || []);
              setMessages(snap.messages || []);
              setVotes(snap.votes || []);
              setWinSummary(snap.winSummary || { winner: null, reasonThai: '' });
              setSelectedTargetId(null);
              setSecondTargetId(null);
              setNightReadyIds([]);
              setVoteReadyIds([]);
              setHasSubmittedNight(false);
              setHasSubmittedVote(false);
              setRoleCardImgError(false);
              setRevealIndex(0);
              setShellState('ROLE_REVEAL');
              soundFX.playMessagePop(true);
            } else if (data.type === 'GAME_STATE_UPDATED' && data.snapshot) {
              const snap = data.snapshot;
              if (Array.isArray(snap.players)) setPlayers(snap.players);
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
              if (Array.isArray(data.nightReadyIds)) {
                setNightReadyIds(data.nightReadyIds);
              } else {
                setNightReadyIds([]);
              }
              if (Array.isArray(data.voteReadyIds)) {
                setVoteReadyIds(data.voteReadyIds);
              } else {
                setVoteReadyIds([]);
              }
              setHasSubmittedNight(false);
              setHasSubmittedVote(false);
              if (snap.shellState === 'GAME_OVER') {
                setShellState('GAME_OVER');
              }
            } else if (data.type === 'HUMAN_CHAT_RECEIVED' && data.chatMessage) {
              setMessages((prev) => {
                if (prev.some((m) => m.id === data.chatMessage.id)) return prev;
                return [...prev, data.chatMessage];
              });
              soundFX.playMessagePop(false);
            } else if (data.type === 'NIGHT_READY_UPDATED') {
              if (Array.isArray(data.nightReadyIds)) {
                setNightReadyIds(data.nightReadyIds);
              }
            } else if (data.type === 'VOTE_READY_UPDATED') {
              if (Array.isArray(data.voteReadyIds)) {
                setVoteReadyIds(data.voteReadyIds);
              }
            } else if (data.type === 'EXECUTE_NIGHT_RESOLVE') {
              executeNightResolveRef.current?.(data.humanActions || {});
            } else if (data.type === 'EXECUTE_VOTE_RESOLVE') {
              executeVoteResolveRef.current?.(data.humanVotes || {});
            } else if (data.type === 'RETURNED_TO_LOBBY') {
              if (data.hostId) setHostId(data.hostId);
              if (typeof data.totalPlayers === 'number') {
                setTotalPlayerCount(data.totalPlayers);
              }
              if (Array.isArray(data.participants)) {
                setHumanParticipants(data.participants);
              }
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
    if (activeHumanId === id && updated[0]) {
      setActiveHumanId(updated[0].id);
    }
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

  // All human players in the current match
  const humanPlayersList = useMemo(
    () => players.filter((p) => p.isHuman),
    [players]
  );

  // Number of real humans currently connected online via separate browsers/devices
  const onlineHumansList = useMemo(
    () => humanParticipants.filter((hp) => hp.isOnline),
    [humanParticipants]
  );
  const isMultiDeviceOnline = wsConnected && onlineHumansList.length > 1;
  const isHost = !hostId || hostId === myClientId;

  // Currently active/viewing human player
  const humanPlayer = useMemo(() => {
    // In multi-device online mode, ALWAYS lock view to this device's own player so nobody peeks at friends' cards!
    if (isMultiDeviceOnline) {
      return (
        players.find((p) => p.id === myClientId) ||
        players.find((p) => p.isHuman) ||
        players[0]
      );
    }
    return (
      players.find((p) => p.id === activeHumanId) ||
      players.find((p) => p.id === myClientId) ||
      players.find((p) => p.isHuman) ||
      players[0]
    );
  }, [players, activeHumanId, myClientId, isMultiDeviceOnline]);

  useEffect(() => {
    if (!players.some((p) => p.id === activeHumanId && p.isHuman)) {
      const meInGame = players.find((p) => p.id === myClientId && p.isHuman);
      const firstHuman = players.find((p) => p.isHuman);
      if (meInGame) {
        setActiveHumanId(meInGame.id);
      } else if (firstHuman) {
        setActiveHumanId(firstHuman.id);
      }
    }
  }, [players, activeHumanId, myClientId]);

  const fellowWolves = useMemo(() => {
    if (!isWerewolfTeam(humanPlayer.role)) return [];
    return players.filter(
      (p) => p.id !== humanPlayer.id && isWerewolfTeam(p.role)
    );
  }, [humanPlayer, players]);

  const seerKnownMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    if (humanPlayer.role === 'SEER') {
      seerKnowledge.forEach((rec) => {
        map[rec.targetId] = rec.isWerewolf;
      });
    }
    return map;
  }, [humanPlayer.role, seerKnowledge]);

  const alivePlayers = useMemo(() => players.filter((p) => p.alive), [players]);
  const aliveAICount = useMemo(
    () => alivePlayers.filter((p) => !p.isHuman).length,
    [alivePlayers]
  );
  const aliveWolvesCount = useMemo(
    () => alivePlayers.filter((p) => isWerewolfTeam(p.role)).length,
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

  const rolePoolPreview = useMemo(() => {
    const effectiveTotal = Math.max(totalPlayerCount, humanParticipants.length);
    const pool = buildRolePoolForCount(effectiveTotal);
    const counts: Record<RoleType, number> = {
      WEREWOLF: 0,
      WOLF_CUB: 0,
      SEER: 0,
      BODYGUARD: 0,
      BEGGAR: 0,
      VILLAGER: 0,
    };
    pool.forEach((r) => {
      counts[r] += 1;
    });
    return counts;
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
      `• ฝ่ายหมาป่า (2 ตน): พ่อหมาป่า 1 ตน + ลูกหมาป่า (Wolf Cub) 1 ตน (หากลูกหมาป่าตาย คืนถัดไปพ่อหมาป่าจะสังหารเหยื่อได้ถึง 2 คน!)\n` +
      `• ฝ่ายชาวบ้าน (${freshPlayers.length - 2} คน): เทพพยากรณ์ (Seer) 1 คน · บอดี้การ์ด 1 คน${
        hasBeggar ? ' · ยาจก/คนงี่เง่า 1 คน' : ''
      } · ชาวบ้าน ${villagerCount} คน\n` +
      `• กติกาการโหวตประหาร: หากผลโหวตประหารมีคะแนนสูงสุดเสมอกัน จะไม่มีใครถูกประหารในวันนั้น และเข้าสู่คืนถัดไปทันที`;

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
    setHasSubmittedNight(false);
    setHasSubmittedVote(false);
    setDoubleKillNextNight(false);
    setLastProtectedId(null);
    setSeerKnowledge([]);
    setBodyguardKnowledge([]);
    setVotes([]);
    setWinSummary({ winner: null, reasonThai: '' });
    setRoleCardImgError(false);
    setMessages(initialMsgs);
    setRevealIndex(0);

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
      shellState?: ShellState;
    }) => {
      sendWsMessage({
        type: 'SYNC_GAME_STATE',
        snapshot: nextState,
      });
    },
    [sendWsMessage]
  );

  const visibleMessages = useMemo(() => {
    return messages.filter(
      (m) => !m.visibleToPlayerId || m.visibleToPlayerId === humanPlayer.id
    );
  }, [messages, humanPlayer.id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages, isGeneratingAI]);

  useEffect(() => {
    if (shellState !== 'PLAYING' || !humanPlayer.alive) return;

    if (
      phase === 'NIGHT_ACTION' &&
      (isWerewolfTeam(humanPlayer.role) ||
        humanPlayer.role === 'SEER' ||
        humanPlayer.role === 'BODYGUARD')
    ) {
      const validList = players.filter((p) => {
        if (!p.alive) return false;
        if (isWerewolfTeam(humanPlayer.role)) return !isWerewolfTeam(p.role);
        if (humanPlayer.role === 'SEER') return p.id !== humanPlayer.id;
        if (humanPlayer.role === 'BODYGUARD') return p.id !== lastProtectedId;
        return false;
      });
      if (!selectedTargetId && validList[0]) {
        setSelectedTargetId(validList[0].id);
      }
      if (
        doubleKillNextNight &&
        isWerewolfTeam(humanPlayer.role) &&
        !secondTargetId &&
        validList.length > 1
      ) {
        const second = validList.find(
          (p) => p.id !== (selectedTargetId || validList[0].id)
        );
        if (second) setSecondTargetId(second.id);
      }
    } else if (phase === 'DAY_VOTING' && humanPlayer.canVote) {
      if (!selectedTargetId) {
        const firstValidVote = players.find(
          (p) => p.alive && p.id !== humanPlayer.id && !p.revealedBeggar
        );
        if (firstValidVote) {
          setSelectedTargetId(firstValidVote.id);
        }
      }
    }
  }, [
    shellState,
    phase,
    humanPlayer,
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

      if (!isInputFocused && e.key === 'Tab') {
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
  }, [shellState, startNewRandomGame, showRoleCardModal, showDownloadModal]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    soundFX.muted = next;
  };

  const isTargetSelectable = useCallback(
    (target: Player): boolean => {
      if (!target.alive) return false;
      if (!humanPlayer.alive) return false;

      if (phase === 'NIGHT_ACTION') {
        if (humanPlayer.role === 'VILLAGER' || humanPlayer.role === 'BEGGAR') {
          return false;
        }
        if (isWerewolfTeam(humanPlayer.role)) {
          return !isWerewolfTeam(target.role);
        }
        if (humanPlayer.role === 'SEER') {
          return target.id !== humanPlayer.id;
        }
        if (humanPlayer.role === 'BODYGUARD') {
          return target.id !== lastProtectedId;
        }
      }

      if (phase === 'DAY_VOTING') {
        if (!humanPlayer.canVote) return false;
        return target.id !== humanPlayer.id;
      }

      return true;
    },
    [humanPlayer, phase, lastProtectedId]
  );

  const handleSelectPlayerOnCanvas = useCallback(
    (playerId: string) => {
      const target = players.find((p) => p.id === playerId);
      if (!target) return;
      if (!isTargetSelectable(target) && phase !== 'DAY_DISCUSSION') return;

      if (
        phase === 'NIGHT_ACTION' &&
        doubleKillNextNight &&
        isWerewolfTeam(humanPlayer.role)
      ) {
        if (selectedTargetId === playerId) return;
        if (!selectedTargetId) {
          setSelectedTargetId(playerId);
        } else if (secondTargetId === playerId) {
          setSecondTargetId(null);
        } else {
          setSecondTargetId(playerId);
        }
      } else {
        setSelectedTargetId(playerId);
      }
      soundFX.playMessagePop(false);
    },
    [
      players,
      isTargetSelectable,
      phase,
      doubleKillNextNight,
      humanPlayer.role,
      selectedTargetId,
      secondTargetId,
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
        }, idx * 420);
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
      }, aiLines.length * 420 + 400);
    },
    [broadcastGameState]
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
      }, idx * 400);
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
    }, aiLines.length * 400 + 350);
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
            ? `\n⚠️ มีเสียงหอนด้วยความพิโรธดังก้องจากป่า! "ลูกหมาป่า (Wolf Cub)" เสียชีวิตลงแล้ว ส่งผลให้คืนถัดไปพ่อหมาป่าจะสามารถสังหารเหยื่อได้ถึง 2 คน!`
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
          shellState: 'GAME_OVER',
        });
        return;
      }

      setPhase('DAY_DISCUSSION');
      soundFX.playDayTransition();
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
      seerKnowledge,
      bodyguardKnowledge,
      lastProtectedId,
      messages,
      votes,
      broadcastGameState,
      triggerDayDiscussion,
    ]
  );

  executeNightResolveRef.current = executeNightResolution;

  // Player clicks Confirm Night Action
  const handleConfirmNightAction = async () => {
    const needsTarget =
      humanPlayer.alive &&
      (isWerewolfTeam(humanPlayer.role) ||
        humanPlayer.role === 'SEER' ||
        humanPlayer.role === 'BODYGUARD');

    if (needsTarget && !selectedTargetId) return;

    soundFX.playNightAction(humanPlayer.role);

    const myAction = {
      primary: selectedTargetId,
      secondary: secondTargetId,
    };

    if (isMultiDeviceOnline && onlineAliveHumans.length > 1) {
      setHasSubmittedNight(true);
      sendWsMessage({
        type: 'SUBMIT_NIGHT_ACTION',
        playerId: humanPlayer.id,
        nightAction: myAction,
      });
      return;
    }

    await executeNightResolution({
      [humanPlayer.id]: myAction,
    });
  };

  // Human sends a message during Day Discussion -> Broadcast to real friends + AI replies (if any AI alive)
  const handleSendHumanStatement = async (customText?: string) => {
    const textToSend = (customText ?? humanInput).trim();
    if (!textToSend || isGeneratingAI) return;
    if (!customText) setHumanInput('');

    const myMsg: ChatMessage = {
      id: `human-msg-${humanPlayer.id}-${Date.now()}`,
      senderId: humanPlayer.id,
      senderName: humanPlayer.name,
      text: textToSend,
      phaseLabel: `วันที่ ${dayCount} · ถกเถียง`,
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
          dayNumber: dayCount,
          players,
          seerKnowledge,
          bodyguardKnowledge,
          recentTranscript,
          previousVotes: votes,
          humanMessage: textToSend,
          speakerName: humanPlayer.name,
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
        speakerName: humanPlayer.shortName,
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
      }, idx * 380);
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
    }, replies.length * 380 + 350);
  };

  // Start Day Voting Phase
  const handleProceedToVoting = () => {
    setPhase('DAY_VOTING');
    setSelectedTargetId(null);
    setVotes([]);
    setVoteReadyIds([]);
    setHasSubmittedVote(false);
    soundFX.playMessagePop(true);
    const votePromptMsg: ChatMessage = {
      id: `vote-prompt-${dayCount}-${Date.now()}`,
      senderId: 'moderator',
      senderName: 'ผู้ดำเนินเกม (Moderator)',
      text: `หมดเวลาถกเถียงสำหรับวันที่ ${dayCount}! เข้าสู่ "ช่วงโหวตประหาร" โปรดเลือกผู้เล่น 1 คนที่คุณต้องการโหวตออกจากหมู่บ้าน (หากผลโหวตสูงสุดเสมอกัน จะไม่มีใครถูกประหารและเข้าสู่คืนถัดไปทันที)`,
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
  };

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

      // Record all submitted human votes first
      const humanVoteRecords: VoteRecord[] = [];
      for (const hp of players.filter((p) => p.isHuman && p.alive && p.canVote)) {
        const tId = collectedHumanVotes[hp.id];
        const hTarget = tId ? players.find((p) => p.id === tId) : undefined;
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
              const target = players.find(
                (p) => p.id === v.targetId || p.name.includes(v.targetId)
              );
              if (
                voter &&
                !voter.isHuman &&
                voter.alive &&
                voter.canVote &&
                target &&
                target.alive
              ) {
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
      resolvedVotes.forEach((v) => {
        tally[v.targetId] = (tally[v.targetId] || 0) + 1;
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

      // TIE RULE: If top vote is tied (more than 1 player has maxVotes, or no votes cast), NOBODY is executed!
      if (topTargetIds.length !== 1 || maxVotes === 0) {
        const tiedNames = topTargetIds
          .map((id) => players.find((p) => p.id === id)?.name)
          .filter(Boolean)
          .join(' และ ');
        soundFX.playMessagePop(true);
        specialResultText =
          maxVotes === 0
            ? `\n\n⚖️ มติสภาหมู่บ้าน: ไม่มีผู้ลงคะแนนโหวตในวันนี้ จึงไม่มีใครถูกประหาร และเข้าสู่คืนถัดไปทันที`
            : `\n\n⚖️ มติสภาหมู่บ้าน: ผลโหวตสูงสุดเสมอกันที่ ${maxVotes} เสียง (${tiedNames})! ` +
              `ตามกติกาจึงไม่มีใครถูกประหารในวันนี้ และเข้าสู่คืนถัดไปทันที`;
      } else {
        const executedId = topTargetIds[0];
        const executedPlayer = players.find((p) => p.id === executedId)!;

        soundFX.playExecutionImpact();
        setImpactTrigger((c) => c + 1);

        if (executedPlayer.role === 'BEGGAR' && !executedPlayer.revealedBeggar) {
          updatedPlayers = players.map((p) =>
            p.id === executedPlayer.id
              ? { ...p, alive: true, canVote: false, revealedBeggar: true }
              : p
          );
          specialResultText =
            `\n\n🎭 [กติกาพิเศษ: ยาจก / คนงี่เง่า (Beggar / Idiot)] ทันทีที่เพชฌฆาตกำลังจะลงมือ "${executedPlayer.name}" ก็หงายการ์ดเปิดเผยตัวตนว่าเป็น "ยาจก / คนงี่เง่า"! ` +
            `เขารอดชีวิตจากการถูกประหารในวันนี้! แต่จะสูญเสียสิทธิ์ในการลงคะแนนโหวตไปตลอดทั้งเกมที่เหลือ`;
        } else {
          updatedPlayers = players.map((p) =>
            p.id === executedPlayer.id ? { ...p, alive: false } : p
          );

          if (executedPlayer.role === 'WOLF_CUB') {
            nextDoubleKill = true;
            setDoubleKillNextNight(true);
            specialResultText =
              `\n\n🐺🔥 [กติกาพิเศษ: คำสาปลูกหมาป่า (Wolf Cub)] เสียงหอนโหยหวนดังกึกก้องไปทั่วหมู่บ้านเมื่อร่างของ "${executedPlayer.name}" ล้มลง! ` +
              `ในคืนถัดไป พ่อหมาป่าที่เหลืออยู่จะคลั่งและสังหารเหยื่อได้ถึง 2 คน!`;
          } else {
            specialResultText = `\n\nมติสภาหมู่บ้าน: "${executedPlayer.name}" ได้รับคะแนนโหวตสูงสุด (${maxVotes} เสียง) และถูกประหารออกจากหมู่บ้าน! (ไม่เปิดเผยบทบาทที่แท้จริง)`;
          }
        }
      }

      const voteBreakdownText =
        `สรุปผลการลงคะแนนโหวตประจำวันที่ ${dayCount}:\n` +
        resolvedVotes
          .map(
            (v) => `• ${v.voterName} โหวต ➔ ${v.targetName} ("${v.reason}")`
          )
          .join('\n') +
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
          shellState: 'GAME_OVER',
        });
        return;
      }

      // Advance directly to next Night
      const nextNight = dayCount + 1;
      setDayCount(nextNight);
      setPhase('NIGHT_ACTION');
      soundFX.playNightTransition();

      const nightStartMsg: ChatMessage = {
        id: `night-start-${nextNight}-${Date.now()}`,
        senderId: 'moderator',
        senderName: 'ผู้ดำเนินเกม (Moderator)',
        text:
          `เข้าสู่ คืนที่ ${nextNight}: ความมืดกลับมาปกคลุมหมู่บ้านจันทร์ทมิฬอีกครั้ง...\n` +
          `ขอให้ทุกคนหลับตาลง และเลือกแอ็กชันประจำบทบาทของคุณในยามวิกาล` +
          (nextDoubleKill
            ? `\n🔥 [คำสาปลูกหมาป่าทำงาน] คืนนี้พ่อหมาป่าสามารถสังหารเหยื่อได้ถึง 2 คน!`
            : ''),
        phaseLabel: `คืนที่ ${nextNight} · ยามวิกาล`,
        timestamp: formatTime(),
      };

      const nextNightMsgs = [...afterVoteMsgs, nightStartMsg];
      setMessages(nextNightMsgs);

      broadcastGameState({
        players: updatedPlayers,
        phase: 'NIGHT_ACTION',
        dayCount: nextNight,
        doubleKillNextNight: nextDoubleKill,
        lastProtectedId,
        seerKnowledge,
        bodyguardKnowledge,
        messages: nextNightMsgs,
        votes: resolvedVotes,
        winSummary,
        shellState: 'PLAYING',
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
      broadcastGameState,
    ]
  );

  executeVoteResolveRef.current = executeVoteResolution;

  const handleConfirmVote = async () => {
    if (humanPlayer.alive && humanPlayer.canVote && !selectedTargetId) return;

    if (isMultiDeviceOnline && onlineEligibleHumanVoters.length > 1) {
      setHasSubmittedVote(true);
      sendWsMessage({
        type: 'SUBMIT_DAY_VOTE',
        playerId: humanPlayer.id,
        voteTargetId:
          humanPlayer.alive && humanPlayer.canVote ? selectedTargetId : null,
      });
      return;
    }

    const soloVotes: Record<string, string> = {};
    if (humanPlayer.alive && humanPlayer.canVote && selectedTargetId) {
      soloVotes[humanPlayer.id] = selectedTargetId;
    }
    await executeVoteResolution(soloVotes);
  };

  const revealTargetPlayer = useMemo(() => {
    if (isMultiDeviceOnline) {
      return players.find((p) => p.id === myClientId) || humanPlayer;
    }
    const myMatch = players.find((p) => p.id === myClientId && p.isHuman);
    if (humanPlayersList.length <= 1 && myMatch) return myMatch;
    return humanPlayersList[revealIndex] || myMatch || humanPlayer;
  }, [players, myClientId, humanPlayersList, revealIndex, humanPlayer, isMultiDeviceOnline]);

  const revealPartnerWolves = useMemo(() => {
    if (!revealTargetPlayer || !isWerewolfTeam(revealTargetPlayer.role)) return [];
    return players.filter(
      (p) => p.id !== revealTargetPlayer.id && isWerewolfTeam(p.role)
    );
  }, [revealTargetPlayer, players]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#070C18] text-slate-100 select-none">
      {/* 1. Isolated 60fps Canvas World Layer */}
      <div className="absolute inset-0 z-0">
        <VillageCanvas
          phase={phase}
          dayCount={dayCount}
          players={players}
          viewerPlayerId={humanPlayer.id}
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
                    className="w-full bg-[#0F172A] border-2 border-amber-500/60 focus:border-amber-400 rounded-xl px-4 py-3 text-base font-bold text-white placeholder:text-slate-500 outline-none select-text"
                  />
                </div>

                <button
                  type="submit"
                  disabled={!myName.trim()}
                  className="w-full py-3.5 px-6 rounded-xl bg-amber-400 hover:bg-amber-300 disabled:opacity-40 text-slate-950 font-bold text-base shadow-[0_0_25px_rgba(245,158,11,0.3)] transition-all cursor-pointer flex items-center justify-center gap-2"
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
                    className="w-full bg-[#0F172A] border-2 border-amber-500/60 focus:border-amber-400 rounded-xl px-3.5 py-2.5 text-sm font-bold text-white placeholder:text-slate-500 outline-none select-text"
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
                    <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-red-400 font-semibold">พ่อหมาป่า</span>
                      <span className="font-mono font-bold text-white">
                        {rolePoolPreview.WEREWOLF} ใบ
                      </span>
                    </div>
                    <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                      <span className="text-orange-400 font-semibold">ลูกหมาป่า</span>
                      <span className="font-mono font-bold text-white">
                        {rolePoolPreview.WOLF_CUB} ใบ
                      </span>
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
                      className="flex-1 bg-[#0F172A] border border-slate-700 focus:border-amber-400 rounded-xl px-3 py-2 text-xs text-white placeholder:text-slate-500 outline-none select-text"
                    />
                    <button
                      type="submit"
                      disabled={!newFriendNameInput.trim() || humanParticipants.length >= 10}
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-bold text-amber-300 flex items-center gap-1 shrink-0 cursor-pointer"
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
                              className="flex-1 bg-transparent text-xs font-bold text-white outline-none border-b border-slate-700 focus:border-amber-400 py-0.5 select-text disabled:border-transparent"
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
                  className="w-full py-3.5 px-6 text-sm md:text-base font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 active:scale-[0.99] rounded-xl shadow-[0_0_30px_rgba(245,158,11,0.35)] transition-all cursor-pointer flex items-center justify-center gap-2.5"
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

      {/* 2B. ROLE CARD REVEAL SCREEN (SHOWN IMMEDIATELY AFTER CLICKING START GAME) */}
      {shellState === 'ROLE_REVEAL' && revealTargetPlayer && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/85 pointer-events-auto overflow-y-auto">
          <div className="bg-[#0B1324] border-2 border-amber-500/60 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-[0_0_50px_rgba(245,158,11,0.25)] my-auto">
            <div className="text-center space-y-1">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wider text-amber-400 uppercase">
                <Sparkles className="w-4 h-4" />
                <span>ผลการสุ่มการ์ดบทบาทประจำตัวของคุณ</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-white">
                ผู้เล่น: <span className="text-amber-300">{revealTargetPlayer.name}</span>
              </h2>
              <p className="text-xs text-slate-400">
                โปรดจำบทบาทของคุณไว้เป็นความลับ ห้ามให้ผู้เล่นคนอื่นล่วงรู้เด็ดขาด!
              </p>
            </div>

            {!isMultiDeviceOnline && humanPlayersList.length > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-1.5 bg-[#0F172A] p-2 rounded-xl border border-slate-800">
                <span className="text-[11px] text-slate-400 mr-1">
                  ดูการ์ดของผู้เล่น:
                </span>
                {humanPlayersList.map((hp, i) => (
                  <button
                    key={hp.id}
                    type="button"
                    onClick={() => {
                      setRevealIndex(i);
                      setRoleCardImgError(false);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
                      revealTargetPlayer.id === hp.id
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {hp.name}
                  </button>
                ))}
              </div>
            )}

            {/* Dealt Role Card Artwork & Frame */}
            <div className="relative aspect-[3/4] w-60 md:w-64 mx-auto rounded-2xl overflow-hidden border-2 border-amber-400/70 bg-slate-900 shadow-[0_12px_35px_rgba(0,0,0,0.75)]">
              {!roleCardImgError ? (
                <img
                  src={ROLE_INFO[revealTargetPlayer.role].image}
                  alt={`การ์ดบทบาท ${ROLE_INFO[revealTargetPlayer.role].thaiName}`}
                  referrerPolicy="no-referrer"
                  onError={() => setRoleCardImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-slate-800 to-slate-950">
                  <Shield className="w-14 h-14 text-amber-400 mb-3" />
                  <span className="font-bold text-xl text-white">
                    {ROLE_INFO[revealTargetPlayer.role].thaiName}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">
                    {ROLE_INFO[revealTargetPlayer.role].teamThai}
                  </span>
                </div>
              )}

              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/80 to-transparent p-4 text-center">
                <p
                  className="text-xs font-bold tracking-wider uppercase"
                  style={{ color: ROLE_INFO[revealTargetPlayer.role].accentColor }}
                >
                  {ROLE_INFO[revealTargetPlayer.role].teamThai}
                </p>
                <h3 className="text-xl font-bold text-white">
                  {ROLE_INFO[revealTargetPlayer.role].thaiName}
                </h3>
                <p className="text-[11px] text-slate-300 font-mono">
                  {ROLE_INFO[revealTargetPlayer.role].englishName}
                </p>
              </div>
            </div>

            <div className="bg-[#0F172A] border border-slate-800 rounded-xl p-4 space-y-2 text-xs md:text-sm text-slate-200 leading-relaxed">
              <div className="font-bold text-amber-300">
                ความสามารถและหน้าที่ของคุณ:
              </div>
              <p>{ROLE_INFO[revealTargetPlayer.role].summary}</p>
              {revealPartnerWolves.length > 0 && (
                <div className="pt-2 border-t border-slate-800 text-red-400 font-bold">
                  🐺 เพื่อนร่วมฝูงหมาป่าของคุณในกระดานนี้คือ:{' '}
                  {revealPartnerWolves
                    .map((w) => `${w.name} (${ROLE_INFO[w.role].thaiName})`)
                    .join(', ')}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setActiveHumanId(revealTargetPlayer.id);
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
          <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 md:p-5">
            {/* Top Perimeter Status Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pointer-events-auto bg-[#0B1324]/95 border border-slate-800/90 rounded-xl px-4 py-2.5 shadow-lg">
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
                {!isMultiDeviceOnline && humanPlayersList.length > 1 && (
                  <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs">
                    <span className="text-slate-400">มุมมอง:</span>
                    <select
                      value={humanPlayer.id}
                      onChange={(e) => {
                        setActiveHumanId(e.target.value);
                        setSelectedTargetId(null);
                        setSecondTargetId(null);
                      }}
                      className="bg-transparent text-amber-300 font-bold outline-none cursor-pointer"
                    >
                      {humanPlayersList.map((hp) => (
                        <option
                          key={hp.id}
                          value={hp.id}
                          className="bg-slate-900 text-white"
                        >
                          {hp.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <button
                  onClick={() => {
                    setRoleCardImgError(false);
                    setShowRoleCardModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>
                    การ์ดของ {humanPlayer.shortName}:{' '}
                    {ROLE_INFO[humanPlayer.role].thaiName}
                  </span>
                </button>

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
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row items-stretch justify-between gap-4 mt-3">
              {/* Left Side: Player Roster Strip anchored at the bottom of the Canvas */}
              <div className="flex-1 flex flex-col justify-end pointer-events-none">
                <div className="pointer-events-auto bg-[#0B1324]/95 border border-slate-800/90 rounded-xl p-3 shadow-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-slate-300">
                      ผู้เล่นทั้ง {players.length} คนรอบโต๊ะสภา (คลิกเลือกเป้าหมายได้ทั้งบนโต๊ะหรือปุ่มด้านล่าง)
                    </span>
                    <span className="text-xs text-amber-300 font-mono tabular-nums">
                      {selectedTargetId
                        ? `เป้าหมาย: ${players.find((p) => p.id === selectedTargetId)?.name}${
                            secondTargetId
                              ? ` + ${players.find((p) => p.id === secondTargetId)?.name}`
                              : ''
                          }`
                        : 'ยังไม่ได้เลือกเป้าหมาย'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                    {players.map((p, index) => {
                      const selectable = isTargetSelectable(p);
                      const isSelected =
                        selectedTargetId === p.id || secondTargetId === p.id;
                      const isFellow = fellowWolves.some((w) => w.id === p.id);
                      const seerStat = seerKnownMap[p.id];
                      const isCurrentViewer = p.id === humanPlayer.id;

                      return (
                        <button
                          key={p.id}
                          onClick={() => handleSelectPlayerOnCanvas(p.id)}
                          disabled={!p.alive}
                          className={`text-left px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer ${
                            !p.alive
                              ? 'bg-slate-950/60 border-slate-900 opacity-45 cursor-not-allowed'
                              : isSelected
                              ? 'bg-amber-500/20 border-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
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
                          <div className="text-[10px] text-slate-400 truncate">
                            {p.alive
                              ? p.revealedBeggar
                                ? 'ยาจก (งดโหวต)'
                                : 'มีชีวิตอยู่'
                              : 'เสียชีวิตแล้ว'}
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
                              {p.role === 'WOLF_CUB'
                                ? 'ลูกหมาป่า (ฝูงเรา)'
                                : 'พ่อหมาป่า (ฝูงเรา)'}
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

              {/* Right Side: Thai Moderator & Natural Player Discussion Console */}
              <div className="w-full lg:w-[470px] xl:w-[530px] h-[55vh] lg:h-full flex flex-col pointer-events-auto bg-[#0B1324]/95 border border-slate-800/90 rounded-xl shadow-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between bg-[#0F172A]">
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

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {visibleMessages.map((m) => {
                    const isMod = m.senderId === 'moderator';
                    const isSecret = m.senderId === 'secret' || m.isSecret;
                    const isMe = m.senderId === humanPlayer.id;

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

                {/* Phase Action Footer */}
                <div className="p-3.5 border-t border-slate-800 bg-[#0F172A] space-y-2.5">
                  {/* PHASE 1: NIGHT ACTION CONTROLS */}
                  {phase === 'NIGHT_ACTION' && (
                    <div className="space-y-2.5">
                      {hasSubmittedNight && isMultiDeviceOnline ? (
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
                                  playerId: humanPlayer.id,
                                  nightAction: {
                                    primary: selectedTargetId,
                                    secondary: secondTargetId,
                                  },
                                })
                              }
                              className="w-full py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-bold text-xs transition-colors cursor-pointer"
                            >
                              หัวห้อง: ดำเนินการจบคืนที่ {dayCount} ทันที
                            </button>
                          )}
                        </div>
                      ) : !humanPlayer.alive ? (
                        <button
                          onClick={handleConfirmNightAction}
                          className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition-colors cursor-pointer"
                        >
                          ดำเนินการผ่านคืนที่ {dayCount} ({humanPlayer.name} เสียชีวิตแล้ว)
                        </button>
                      ) : humanPlayer.role === 'VILLAGER' ||
                        humanPlayer.role === 'BEGGAR' ? (
                        <div className="space-y-2">
                          <p className="text-xs text-slate-300">
                            {humanPlayer.name} คือ{' '}
                            <span className="text-amber-300 font-semibold">
                              {ROLE_INFO[humanPlayer.role].thaiName}
                            </span>{' '}
                            ในยามวิกาลไม่มีแอ็กชันพิเศษ กดเข้านอนเพื่อรอฟังผลในเช้าวันพรุ่งนี้
                          </p>
                          <button
                            onClick={handleConfirmNightAction}
                            className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                          >
                            <Moon className="w-4 h-4" />
                            <span>เข้านอนและรอจนถึงรุ่งสาง (จบคืนที่ {dayCount})</span>
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-amber-300 font-semibold">
                              {isWerewolfTeam(humanPlayer.role) &&
                                (doubleKillNextNight
                                  ? '🔥 คืนล้างแค้นลูกหมาป่า! คลิกเลือกเหยื่อ 2 คนที่ต้องการสังหาร:'
                                  : 'เลือกเหยื่อ 1 คนที่ฝูงหมาป่าต้องการสังหารในคืนนี้:')}
                              {humanPlayer.role === 'SEER' &&
                                'เลือกผู้เล่น 1 คนที่เทพพยากรณ์ต้องการส่องดูบทบาท:'}
                              {humanPlayer.role === 'BODYGUARD' &&
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
                                return (
                                  <button
                                    key={p.id}
                                    onClick={() => handleSelectPlayerOnCanvas(p.id)}
                                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                                      isChosen
                                        ? 'bg-amber-400 text-slate-950'
                                        : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                                    }`}
                                  >
                                    {p.name}
                                  </button>
                                );
                              })}
                          </div>
                          <button
                            onClick={handleConfirmNightAction}
                            disabled={!selectedTargetId}
                            className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-bold text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                          >
                            <Shield className="w-4 h-4" />
                            <span>
                              {selectedTargetId
                                ? `ยืนยันแอ็กชันคืนที่ ${dayCount} กับ ${
                                    players.find((p) => p.id === selectedTargetId)
                                      ?.shortName
                                  }${
                                    secondTargetId
                                      ? ` และ ${
                                          players.find((p) => p.id === secondTargetId)
                                            ?.shortName
                                        }`
                                      : ''
                                  }`
                                : 'โปรดคลิกเลือกเป้าหมายก่อน'}
                            </span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* PHASE 2: DAY DISCUSSION CONTROLS */}
                  {phase === 'DAY_DISCUSSION' && (
                    <div className="space-y-2">
                      {humanPlayer.alive && (
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
                            placeholder={`พิมพ์พูดคุย ถามจี้ หรือวิเคราะห์ในชื่อ "${humanPlayer.name}"...`}
                            disabled={isGeneratingAI}
                            className="flex-1 bg-slate-900 border border-slate-700 focus:border-amber-400 rounded-lg px-3 py-2 text-xs md:text-sm text-white placeholder:text-slate-500 outline-none select-text"
                          />
                          <button
                            type="submit"
                            disabled={!humanInput.trim() || isGeneratingAI}
                            className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-amber-300 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>ส่งข้อความ</span>
                          </button>
                        </form>
                      )}

                      <div
                        className={`grid gap-2 ${
                          aliveAICount > 0 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
                        }`}
                      >
                        {aliveAICount > 0 && (
                          <button
                            type="button"
                            onClick={handleContinueAIDebate}
                            disabled={isGeneratingAI}
                            className="py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 font-semibold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 border border-slate-700"
                          >
                            <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
                            <span>ฟังคนในวงวิเคราะห์กันต่อ</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={handleProceedToVoting}
                          disabled={isGeneratingAI}
                          className="py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          <UserCheck className="w-4 h-4" />
                          <span>เข้าสู่ช่วงโหวตประหาร (วันที่ {dayCount})</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* PHASE 3: DAY VOTING CONTROLS */}
                  {phase === 'DAY_VOTING' && (
                    <div className="space-y-2.5">
                      {hasSubmittedVote && isMultiDeviceOnline ? (
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
                                  playerId: humanPlayer.id,
                                  voteTargetId: selectedTargetId,
                                })
                              }
                              className="w-full py-2 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition-colors cursor-pointer"
                            >
                              หัวห้อง: สรุปผลโหวตประหารทันที
                            </button>
                          )}
                        </div>
                      ) : humanPlayer.alive && humanPlayer.canVote ? (
                        <>
                          <p className="text-xs text-amber-300 font-semibold">
                            เลือกผู้เล่น 1 คนที่ {humanPlayer.name} ต้องการโหวตประหาร (หากคะแนนสูงสุดเสมอกันจะไม่มีใครตาย):
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {players
                              .filter((p) => p.alive && p.id !== humanPlayer.id)
                              .map((p) => (
                                <button
                                  key={p.id}
                                  onClick={() => setSelectedTargetId(p.id)}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                                    selectedTargetId === p.id
                                      ? 'bg-red-500 text-white'
                                      : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                                  }`}
                                >
                                  โหวต {p.shortName}
                                </button>
                              ))}
                          </div>
                          <button
                            onClick={handleConfirmVote}
                            disabled={!selectedTargetId || isGeneratingAI}
                            className="w-full py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-bold text-sm transition-colors cursor-pointer"
                          >
                            {selectedTargetId
                              ? `ยืนยันโหวตประหาร "${
                                  players.find((p) => p.id === selectedTargetId)?.name
                                }"`
                              : 'โปรดเลือกผู้เล่นที่ต้องการโหวต 1 คน'}
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={handleConfirmVote}
                          disabled={isGeneratingAI}
                          className="w-full py-2.5 px-4 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-sm transition-colors cursor-pointer"
                        >
                          {!humanPlayer.alive
                            ? 'ดูผลการโหวตของผู้เล่นที่เหลืออยู่'
                            : 'คุณเสียสิทธิ์โหวตแล้ว (ยาจก) · กดเพื่อดูผลโหวตของสภา'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* PHASE 4: GAME OVER QUICK RESTART */}
                  {phase === 'GAME_OVER' && (
                    <button
                      onClick={startNewRandomGame}
                      className="w-full py-2.5 px-4 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
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

      {/* 4. IN-GAME SECRET ROLE CARD MODAL */}
      {showRoleCardModal && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/80 pointer-events-auto">
          <div className="bg-[#0F172A] border border-slate-700 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-amber-400 font-semibold">
                  การ์ดบทบาทลับของ {humanPlayer.name} · ห้ามให้ผู้อื่นล่วงรู้
                </p>
                <h3 className="text-xl font-bold text-white">
                  {ROLE_INFO[humanPlayer.role].thaiName} (
                  {ROLE_INFO[humanPlayer.role].englishName})
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
                  src={ROLE_INFO[humanPlayer.role].image}
                  alt={`การ์ดบทบาท ${ROLE_INFO[humanPlayer.role].thaiName}`}
                  referrerPolicy="no-referrer"
                  onError={() => setRoleCardImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-slate-800 to-slate-950">
                  <Shield className="w-12 h-12 text-amber-400 mb-3" />
                  <span className="font-bold text-lg text-white">
                    {ROLE_INFO[humanPlayer.role].thaiName}
                  </span>
                  <span className="text-xs text-slate-400 mt-1">
                    {ROLE_INFO[humanPlayer.role].teamThai}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2 text-xs md:text-sm text-slate-300 leading-relaxed">
              <div className="text-amber-300 font-semibold">
                สังกัด: {ROLE_INFO[humanPlayer.role].teamThai}
              </div>
              <p>{ROLE_INFO[humanPlayer.role].summary}</p>
              {fellowWolves.length > 0 && (
                <p className="text-red-300 font-semibold">
                  เพื่อนร่วมฝูงหมาป่าของคุณคือ:{' '}
                  {fellowWolves
                    .map((w) => `${w.name} (${ROLE_INFO[w.role].thaiName})`)
                    .join(', ')}
                </p>
              )}
              {humanPlayer.role === 'SEER' && seerKnowledge.length > 0 && (
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
                มีฝ่ายหมาป่าแค่ 2 ตนเสมอ คือ พ่อหมาป่า 1 ตน และ ลูกหมาป่า (Wolf Cub) 1 ตน
                ส่วนฝ่ายชาวบ้านประกอบด้วย เทพพยากรณ์ 1 คน, บอดี้การ์ด 1 คน, ยาจก/คนงี่เง่า (เมื่อเล่น 7 คนขึ้นไป) และชาวบ้าน
              </p>
              <p>
                • <strong className="text-emerald-300">ผลโหวตประหารเสมอกัน:</strong>{' '}
                หากในการโหวตประหารมีผู้ได้คะแนนสูงสุดเท่ากัน (เสมอกัน) จะไม่มีใครถูกประหารในวันนั้น และเข้าสู่คืนถัดไปทันที
              </p>
              <p>
                • <strong className="text-orange-300">ลูกหมาป่า (Wolf Cub):</strong>{' '}
                หากลูกหมาป่าถูกประหารหรือตาย คืนถัดไปพ่อหมาป่าจะได้สิทธิ์ฆ่าเหยื่อ 2 คน!
              </p>
              <p>
                • <strong className="text-amber-300">ยาจก / คนงี่เง่า (Beggar / Idiot):</strong>{' '}
                หากถูกโหวตประหารด้วยเสียงข้างมากเดี่ยว การ์ดจะถูกเปิดเผยและรอดชีวิตไม่ตาย แต่จะเสียสิทธิ์โหวตไปตลอดทั้งเกม
              </p>
              <p>
                • <strong className="text-white">เงื่อนไขการชนะ:</strong>{' '}
                ฝ่ายชาวบ้านชนะเมื่อกำจัดพ่อหมาป่าและลูกหมาป่าได้ครบทั้ง 2 ตน /
                ฝ่ายหมาป่าชนะทันทีเมื่อจำนวนฝ่ายหมาป่าที่รอดชีวิตเท่ากับหรือมากกว่าชาวบ้านที่เหลืออยู่
                (ขณะนี้เหลือฝ่ายหมาป่า {aliveWolvesCount} ตน)
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

      {/* 6. VICTORY / GAME OVER MODAL */}
      {shellState === 'GAME_OVER' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center p-4 bg-black/85 pointer-events-auto">
          <div className="bg-[#0F172A] border border-slate-700 rounded-2xl max-w-xl w-full p-6 space-y-5 shadow-2xl">
            <div className="space-y-1">
              <p className="text-xs font-semibold tracking-wider text-amber-400">
                บทสรุปแห่งหมู่บ้านจันทร์ทมิฬ · จบเกมในวันที่ {dayCount}
              </p>
              <h2 className="text-2xl md:text-3xl font-bold text-white">
                {winSummary.winner === 'VILLAGE'
                  ? 'ฝ่ายชาวบ้านเป็นฝ่ายชนะ!'
                  : 'ฝ่ายมนุษย์หมาป่าเป็นฝ่ายชนะ!'}
              </h2>
              <p className="text-xs md:text-sm text-slate-300 leading-relaxed pt-1">
                {winSummary.reasonThai}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400">
                เฉลยบทบาทลับของผู้เล่นทั้ง {players.length} คน:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                {players.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs"
                  >
                    <div>
                      <span className="font-bold text-white">{p.name}</span>
                      <span className="text-slate-500 mx-1.5" aria-hidden="true">
                        ·
                      </span>
                      <span className="text-slate-400">
                        {p.alive ? 'รอดชีวิต' : 'เสียชีวิต'}
                      </span>
                    </div>
                    <span
                      className="font-bold"
                      style={{ color: ROLE_INFO[p.role].accentColor }}
                    >
                      {ROLE_INFO[p.role].thaiName}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
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
                  Build Command: <code className="text-amber-300">npm install && npm run build</code> · Start Command:{' '}
                  <code className="text-amber-300">npx tsx server.ts</code>
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
    </div>
  );
}
