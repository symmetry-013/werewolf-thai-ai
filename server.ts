import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import { GoogleGenAI, Type } from "@google/genai";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// Multi-AI Provider Engine (Gemini Primary/Fast + Optional AIs)
// ============================================================

type AIProviderName =
  | "gemini"
  | "openai"
  | "openrouter"
  | "groq"
  | "deepseek"
  | "anthropic";

function isValidKey(val: string | undefined): val is string {
  if (!val) return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (
    trimmed === "MY_GEMINI_API_KEY" ||
    trimmed === "YOUR_GEMINI_API_KEY" ||
    trimmed.startsWith("YOUR_")
  ) {
    return false;
  }
  return true;
}

function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!isValidKey(apiKey)) return null;
  return {
    apiKey: apiKey.trim(),
    primaryModel: (process.env.GEMINI_MODEL_PRIMARY || "gemini-2.5-pro").trim(),
    fastModel: (process.env.GEMINI_MODEL_FAST || "gemini-2.5-flash").trim(),
  };
}

function getConfiguredProviders(): AIProviderName[] {
  const orderEnv =
    process.env.AI_PROVIDER_ORDER ||
    "gemini,openai,openrouter,groq,deepseek,anthropic";
  const requested = orderEnv
    .split(",")
    .map((s) => s.trim().toLowerCase() as AIProviderName);

  const active: AIProviderName[] = [];
  for (const p of requested) {
    if (p === "gemini" && getGeminiConfig()) active.push("gemini");
    else if (p === "openai" && isValidKey(process.env.OPENAI_API_KEY)) active.push("openai");
    else if (p === "openrouter" && isValidKey(process.env.OPENROUTER_API_KEY)) active.push("openrouter");
    else if (p === "groq" && isValidKey(process.env.GROQ_API_KEY)) active.push("groq");
    else if (p === "deepseek" && isValidKey(process.env.DEEPSEEK_API_KEY)) active.push("deepseek");
    else if (p === "anthropic" && isValidKey(process.env.ANTHROPIC_API_KEY)) active.push("anthropic");
  }
  return active;
}

let providerRotationCursor = 0;

function extractJsonFromText(raw: string): any {
  const trimmed = (raw || "").trim();
  if (!trimmed) throw new Error("Empty AI response");
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("Could not parse JSON from AI response");
  }
}

const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 7500;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function callGeminiProvider(params: {
  tier: "primary" | "fast";
  systemInstruction: string;
  userPrompt: string;
  responseSchema: any;
}): Promise<{ data: any; modelUsed: string }> {
  const cfg = getGeminiConfig();
  if (!cfg) throw new Error("Gemini not configured");

  const ai = new GoogleGenAI({
    apiKey: cfg.apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  // For real-time multiplayer board game speed, always prioritize the fast model (gemini-2.5-flash)
  // unless AI_PREFER_PRIMARY=true is explicitly enabled in .env.
  const preferPrimary =
    process.env.AI_PREFER_PRIMARY === "true" && params.tier === "primary";
  const modelsToTry = preferPrimary
    ? [cfg.primaryModel, cfg.fastModel]
    : [cfg.fastModel, cfg.primaryModel];
  const uniqueModels = Array.from(new Set(modelsToTry.filter(Boolean)));

  let lastErr: any = null;
  for (const modelName of uniqueModels) {
    try {
      const isFlash25 = modelName.toLowerCase().includes("2.5-flash");
      const config: any = {
        systemInstruction: params.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: params.responseSchema,
        temperature: 0.75,
        maxOutputTokens: 900,
      };
      // Disable extended thinking on 2.5-flash so AI responds in ~1-2 seconds instead of 20-40s
      if (isFlash25) {
        config.thinkingConfig = { thinkingBudget: 0 };
      }

      const response = await withTimeout(
        ai.models.generateContent({
          model: modelName,
          contents: params.userPrompt,
          config,
        }),
        AI_TIMEOUT_MS,
        `gemini:${modelName}`
      );
      const parsed = extractJsonFromText(response.text ?? "");
      return { data: parsed, modelUsed: `gemini:${modelName}` };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Gemini request failed");
}

async function callOpenAICompatibleProvider(params: {
  provider: "openai" | "openrouter" | "groq" | "deepseek";
  systemInstruction: string;
  userPrompt: string;
  jsonHint: string;
}): Promise<{ data: any; modelUsed: string }> {
  let endpoint = "";
  let apiKey = "";
  let model = "";
  const extraHeaders: Record<string, string> = {};

  if (params.provider === "openai") {
    endpoint = "https://api.openai.com/v1/chat/completions";
    apiKey = (process.env.OPENAI_API_KEY || "").trim();
    model = (process.env.OPENAI_MODEL || "gpt-4o-mini").trim();
  } else if (params.provider === "openrouter") {
    endpoint = "https://openrouter.ai/api/v1/chat/completions";
    apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
    model = (process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash").trim();
    extraHeaders["HTTP-Referer"] = process.env.APP_URL || "https://render.com";
    extraHeaders["X-Title"] = "Ultimate Werewolf Thai";
  } else if (params.provider === "groq") {
    endpoint = "https://api.groq.com/openai/v1/chat/completions";
    apiKey = (process.env.GROQ_API_KEY || "").trim();
    model = (process.env.GROQ_MODEL || "llama-3.3-70b-versatile").trim();
  } else {
    endpoint = "https://api.deepseek.com/chat/completions";
    apiKey = (process.env.DEEPSEEK_API_KEY || "").trim();
    model = (process.env.DEEPSEEK_MODEL || "deepseek-chat").trim();
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        temperature: 0.75,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `${params.systemInstruction}\n\nสำคัญมาก: ตอบกลับเป็น JSON ที่ถูกต้องตามโครงสร้างนี้เท่านั้น ห้ามมีคำอธิบายนอก JSON:\n${params.jsonHint}`,
          },
          { role: "user", content: params.userPrompt },
        ],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`${params.provider} HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json: any = await res.json();
    const content = json?.choices?.[0]?.message?.content || "";
    return {
      data: extractJsonFromText(content),
      modelUsed: `${params.provider}:${model}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callAnthropicProvider(params: {
  systemInstruction: string;
  userPrompt: string;
  jsonHint: string;
}): Promise<{ data: any; modelUsed: string }> {
  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
  const model = (process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest").trim();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 900,
        system: `${params.systemInstruction}\n\nสำคัญมาก: ตอบกลับเป็น JSON ที่ถูกต้องตามโครงสร้างนี้เท่านั้น ห้ามมีข้อความอื่นนอก JSON:\n${params.jsonHint}`,
        messages: [{ role: "user", content: params.userPrompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`anthropic HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const json: any = await res.json();
    const textBlock = Array.isArray(json?.content)
      ? json.content.find((b: any) => b.type === "text")?.text || ""
      : "";
    return {
      data: extractJsonFromText(textBlock),
      modelUsed: `anthropic:${model}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateStructuredAIJson(params: {
  tier: "primary" | "fast";
  systemInstruction: string;
  userPrompt: string;
  responseSchema: any;
  jsonHint: string;
}): Promise<{ data: any; modelUsed: string } | null> {
  const configured = getConfiguredProviders();
  if (configured.length === 0) return null;

  let orderedProviders = [...configured];
  if (process.env.AI_MIX_PROVIDERS === "true" && configured.length > 1) {
    const startIdx = providerRotationCursor % configured.length;
    providerRotationCursor += 1;
    orderedProviders = [
      ...configured.slice(startIdx),
      ...configured.slice(0, startIdx),
    ];
  }

  for (const provider of orderedProviders) {
    try {
      if (provider === "gemini") {
        return await callGeminiProvider(params);
      } else if (provider === "anthropic") {
        return await callAnthropicProvider(params);
      } else {
        return await callOpenAICompatibleProvider({
          provider,
          systemInstruction: params.systemInstruction,
          userPrompt: params.userPrompt,
          jsonHint: params.jsonHint,
        });
      }
    } catch (err: any) {
      console.error(`AI provider [${provider}] failed:`, err?.message || err);
    }
  }

  return null;
}

// ============================================================
// Source Files List for In-App Download
// ============================================================

const SOURCE_FILES = [
  "package.json",
  "render.yaml",
  "tsconfig.json",
  "vite.config.ts",
  "index.html",
  "metadata.json",
  ".env.example",
  "server.ts",
  "src/main.tsx",
  "src/index.css",
  "src/App.tsx",
  "src/data/werewolfEngine.ts",
  "src/components/VillageCanvas.tsx",
  "src/utils/sound.ts",
];

// ============================================================
// Multiplayer Room State (Max 10 Real Humans, Auto AI Scaling)
// ============================================================

interface RoomParticipant {
  id: string;
  name: string;
  isOnline: boolean;
}

interface RoomState {
  roomId: string;
  hostId: string | null;
  totalPlayers: number;
  participants: RoomParticipant[];
  gameStarted: boolean;
  gameSnapshot: any | null;
  pendingNightActions: Record<string, { primary: string | null; secondary?: string | null }>;
  pendingDayVotes: Record<string, string>;
}

const MAX_HUMAN_PLAYERS = 10;
const rooms = new Map<string, RoomState>();
const clientMeta = new Map<WebSocket, { roomId: string; playerId: string; isAlive: boolean }>();

function getOrCreateRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      roomId,
      hostId: null,
      totalPlayers: 10,
      participants: [],
      gameStarted: false,
      gameSnapshot: null,
      pendingNightActions: {},
      pendingDayVotes: {},
    };
    rooms.set(roomId, room);
  }
  return room;
}

function getLiveOnlineIds(roomId: string): Set<string> {
  const onlineIds = new Set<string>();
  for (const [ws, meta] of clientMeta.entries()) {
    if (meta.roomId === roomId && ws.readyState === WebSocket.OPEN) {
      onlineIds.add(meta.playerId);
    }
  }
  return onlineIds;
}

function syncOnlineStatus(room: RoomState) {
  const liveIds = getLiveOnlineIds(room.roomId);
  room.participants = room.participants.map((p) => ({
    ...p,
    isOnline: liveIds.has(p.id),
  }));
}

function isWolfRole(role: string | undefined): boolean {
  return role === "WEREWOLF" || role === "WOLF_CUB";
}

function sanitizeSnapshotForRecipient(
  snapshot: any,
  recipientPlayerId: string,
  isHost: boolean
): any {
  if (!snapshot) return snapshot;

  const isGameOver =
    snapshot.shellState === "GAME_OVER" || snapshot.phase === "GAME_OVER";

  // STRICT PRIVACY: Secret messages are ONLY sent to their exact owner (even over WS wire)
  const filteredMessages = Array.isArray(snapshot.messages)
    ? snapshot.messages.filter((m: any) => {
        if (m.isSecret || m.senderId === "secret") {
          return m.visibleToPlayerId === recipientPlayerId;
        }
        return true;
      })
    : [];

  // Host retains full player roles in memory for game-engine night/vote resolution,
  // while non-host players ONLY receive their own role (+ fellow wolf if wolf, + revealed beggar)
  // until GAME_OVER.
  if (isGameOver || isHost) {
    return {
      ...snapshot,
      messages: filteredMessages,
    };
  }

  const allPlayers: any[] = Array.isArray(snapshot.players) ? snapshot.players : [];
  const recipientPlayer = allPlayers.find((p) => p.id === recipientPlayerId);
  const recipientIsWolf = isWolfRole(recipientPlayer?.role);

  const sanitizedPlayers = allPlayers.map((p) => {
    const canSeeTrueRole =
      p.id === recipientPlayerId ||
      Boolean(p.revealedBeggar) ||
      (recipientIsWolf && isWolfRole(p.role));
    return canSeeTrueRole ? p : { ...p, role: "VILLAGER" };
  });

  return {
    ...snapshot,
    players: sanitizedPlayers,
    seerKnowledge:
      recipientPlayer?.role === "SEER" && Array.isArray(snapshot.seerKnowledge)
        ? snapshot.seerKnowledge
        : [],
    bodyguardKnowledge:
      recipientPlayer?.role === "BODYGUARD" &&
      Array.isArray(snapshot.bodyguardKnowledge)
        ? snapshot.bodyguardKnowledge
        : [],
    messages: filteredMessages,
  };
}

function mergeAuthoritativeSnapshot(
  prevSnapshot: any,
  incomingSnapshot: any,
  senderIsHost: boolean
): any {
  if (!incomingSnapshot) return prevSnapshot;
  if (!prevSnapshot) return incomingSnapshot;

  // Preserve secret messages that belong to other players so they are never wiped out on sync
  const prevSecretMsgs = Array.isArray(prevSnapshot.messages)
    ? prevSnapshot.messages.filter((m: any) => m.isSecret || m.senderId === "secret")
    : [];
  const incomingMsgs = Array.isArray(incomingSnapshot.messages)
    ? incomingSnapshot.messages
    : [];
  const incomingIds = new Set(incomingMsgs.map((m: any) => m.id));
  const missingSecrets = prevSecretMsgs.filter((m: any) => !incomingIds.has(m.id));
  const mergedMessages =
    missingSecrets.length > 0 ? [...missingSecrets, ...incomingMsgs] : incomingMsgs;

  if (senderIsHost) {
    return {
      ...incomingSnapshot,
      messages: mergedMessages,
    };
  }

  // Non-host clients have masked roles; NEVER let a non-host overwrite authoritative roles or private knowledge
  const trueRoleById = new Map<string, string>();
  if (Array.isArray(prevSnapshot.players)) {
    for (const p of prevSnapshot.players) {
      trueRoleById.set(p.id, p.role);
    }
  }
  const mergedPlayers = Array.isArray(incomingSnapshot.players)
    ? incomingSnapshot.players.map((p: any) => ({
        ...p,
        role: trueRoleById.get(p.id) || p.role,
      }))
    : prevSnapshot.players;

  return {
    ...prevSnapshot,
    ...incomingSnapshot,
    players: mergedPlayers,
    seerKnowledge: prevSnapshot.seerKnowledge || [],
    bodyguardKnowledge: prevSnapshot.bodyguardKnowledge || [],
    messages: mergedMessages,
  };
}

function broadcastToRoom(roomId: string, payload: any, excludeWs?: WebSocket) {
  const msg = JSON.stringify(payload);
  for (const [ws, meta] of clientMeta.entries()) {
    if (
      meta.roomId === roomId &&
      ws !== excludeWs &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.send(msg);
    }
  }
}

function broadcastPersonalizedToRoom(
  room: RoomState,
  buildPayload: (playerId: string, isHost: boolean) => any,
  excludeWs?: WebSocket
) {
  for (const [ws, meta] of clientMeta.entries()) {
    if (
      meta.roomId === room.roomId &&
      ws !== excludeWs &&
      ws.readyState === WebSocket.OPEN
    ) {
      const payload = buildPayload(meta.playerId, room.hostId === meta.playerId);
      ws.send(JSON.stringify(payload));
    }
  }
}

function sendToPlayerInRoom(roomId: string, playerId: string, payload: any): boolean {
  const msg = JSON.stringify(payload);
  for (const [ws, meta] of clientMeta.entries()) {
    if (
      meta.roomId === roomId &&
      meta.playerId === playerId &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.send(msg);
      return true;
    }
  }
  return false;
}

function findActiveHostOrFirstOnline(room: RoomState): string | null {
  if (room.hostId) {
    for (const [ws, meta] of clientMeta.entries()) {
      if (
        meta.roomId === room.roomId &&
        meta.playerId === room.hostId &&
        ws.readyState === WebSocket.OPEN
      ) {
        return room.hostId;
      }
    }
  }
  for (const [ws, meta] of clientMeta.entries()) {
    if (meta.roomId === room.roomId && ws.readyState === WebSocket.OPEN) {
      return meta.playerId;
    }
  }
  return null;
}

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: "2mb" }));

  // Health check endpoint for Render.com
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      providers: getConfiguredProviders(),
      roomsActive: rooms.size,
    });
  });

  // Room preview endpoint so friends opening an invite link see room status before entering nickname
  app.get("/api/rooms/:roomId", (req, res) => {
    const roomId = (req.params.roomId || "").trim().toUpperCase();
    const room = rooms.get(roomId);
    if (!room) {
      return res.json({
        exists: false,
        roomId,
        totalPlayers: 10,
        humanCount: 0,
        maxHumans: MAX_HUMAN_PLAYERS,
        participants: [],
        gameStarted: false,
        isFull: false,
      });
    }
    return res.json({
      exists: true,
      roomId: room.roomId,
      hostId: room.hostId,
      totalPlayers: room.totalPlayers,
      humanCount: room.participants.length,
      maxHumans: MAX_HUMAN_PLAYERS,
      participants: room.participants.map((p) => ({
        id: p.id,
        name: p.name,
        isOnline: p.isOnline,
      })),
      gameStarted: room.gameStarted,
      isFull: room.participants.length >= MAX_HUMAN_PLAYERS,
    });
  });

  // WebSocket Server for multiplayer invite links & real-time sync (Render.com friendly)
  const wss = new WebSocketServer({ server: httpServer, path: "/ws-game" });

  // 25s ping/pong heartbeat so Render.com reverse proxy never drops idle WebSocket connections
  const heartbeatInterval = setInterval(() => {
    for (const [ws, meta] of clientMeta.entries()) {
      if (!meta.isAlive) {
        ws.terminate();
        continue;
      }
      meta.isAlive = false;
      try {
        ws.ping();
      } catch {
        // Ignore
      }
    }
  }, 25000);

  wss.on("close", () => {
    clearInterval(heartbeatInterval);
  });

  wss.on("connection", (ws) => {
    ws.on("pong", () => {
      const meta = clientMeta.get(ws);
      if (meta) meta.isAlive = true;
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const {
          type,
          roomId,
          playerId,
          playerName,
          totalPlayers,
          participants,
          snapshot,
          chatMessage,
          nightAction,
          voteTargetId,
        } = msg;
        if (!roomId) return;

        const normalizedRoomId = String(roomId).trim().toUpperCase();
        const room = getOrCreateRoom(normalizedRoomId);

        if (type === "JOIN_ROOM") {
          const existing = room.participants.find((p) => p.id === playerId);

          if (!existing && room.participants.length >= MAX_HUMAN_PLAYERS) {
            ws.send(
              JSON.stringify({
                type: "ROOM_FULL",
                roomId: room.roomId,
                maxHumans: MAX_HUMAN_PLAYERS,
              })
            );
            return;
          }

          clientMeta.set(ws, {
            roomId: normalizedRoomId,
            playerId,
            isAlive: true,
          });

          if (!room.hostId) {
            room.hostId = playerId;
          }

          const cleanName =
            typeof playerName === "string" && playerName.trim()
              ? playerName.trim().slice(0, 24)
              : `ผู้เล่น ${room.participants.length + 1}`;

          if (existing) {
            existing.name = cleanName;
            existing.isOnline = true;
          } else {
            room.participants.push({
              id: playerId,
              name: cleanName,
              isOnline: true,
            });
          }

          // Auto-expand totalPlayers if real humans exceed current target count (up to 10),
          // so AI count automatically drops to (totalPlayers - humanParticipants.length)
          if (room.participants.length > room.totalPlayers) {
            room.totalPlayers = Math.min(
              MAX_HUMAN_PLAYERS,
              Math.max(6, room.participants.length)
            );
          }

          syncOnlineStatus(room);

          ws.send(
            JSON.stringify({
              type: "ROOM_SYNC",
              roomId: room.roomId,
              hostId: room.hostId,
              totalPlayers: room.totalPlayers,
              participants: room.participants,
              gameStarted: room.gameStarted,
              snapshot: sanitizeSnapshotForRecipient(
                room.gameSnapshot,
                playerId,
                room.hostId === playerId
              ),
              nightReadyIds: Object.keys(room.pendingNightActions),
              voteReadyIds: Object.keys(room.pendingDayVotes),
            })
          );

          broadcastToRoom(
            normalizedRoomId,
            {
              type: "LOBBY_UPDATED",
              hostId: room.hostId,
              totalPlayers: room.totalPlayers,
              participants: room.participants,
            },
            ws
          );
        } else if (type === "UPDATE_LOBBY") {
          if (Array.isArray(participants)) {
            const liveIds = getLiveOnlineIds(normalizedRoomId);
            const incomingById = new Map<string, RoomParticipant>();
            for (const p of participants.slice(0, MAX_HUMAN_PLAYERS)) {
              if (p && p.id) {
                incomingById.set(p.id, {
                  id: p.id,
                  name: typeof p.name === "string" ? p.name.slice(0, 24) : "ผู้เล่น",
                  isOnline: liveIds.has(p.id),
                });
              }
            }
            // Never drop currently online participants during a lobby update
            for (const existing of room.participants) {
              if (liveIds.has(existing.id) && !incomingById.has(existing.id)) {
                incomingById.set(existing.id, { ...existing, isOnline: true });
              }
            }
            room.participants = Array.from(incomingById.values()).slice(
              0,
              MAX_HUMAN_PLAYERS
            );
          }

          syncOnlineStatus(room);

          if (typeof totalPlayers === "number") {
            room.totalPlayers = Math.max(
              6,
              Math.min(
                MAX_HUMAN_PLAYERS,
                Math.max(totalPlayers, room.participants.length)
              )
            );
          } else if (room.participants.length > room.totalPlayers) {
            room.totalPlayers = Math.min(
              MAX_HUMAN_PLAYERS,
              room.participants.length
            );
          }

          broadcastToRoom(normalizedRoomId, {
            type: "LOBBY_UPDATED",
            hostId: room.hostId,
            totalPlayers: room.totalPlayers,
            participants: room.participants,
          });
        } else if (type === "UPDATE_NAME") {
          const target = room.participants.find((p) => p.id === playerId);
          if (target && typeof playerName === "string") {
            target.name = playerName.slice(0, 24);
          }
          syncOnlineStatus(room);
          broadcastToRoom(
            normalizedRoomId,
            {
              type: "LOBBY_UPDATED",
              hostId: room.hostId,
              totalPlayers: room.totalPlayers,
              participants: room.participants,
            },
            ws
          );
        } else if (type === "START_GAME") {
          room.gameStarted = true;
          room.gameSnapshot = snapshot;
          room.pendingNightActions = {};
          room.pendingDayVotes = {};
          syncOnlineStatus(room);

          broadcastPersonalizedToRoom(
            room,
            (recipientId, recipientIsHost) => ({
              type: "GAME_STARTED",
              hostId: room.hostId,
              participants: room.participants,
              snapshot: sanitizeSnapshotForRecipient(
                room.gameSnapshot,
                recipientId,
                recipientIsHost
              ),
            }),
            ws
          );
        } else if (type === "SYNC_GAME_STATE") {
          const senderMeta = clientMeta.get(ws);
          const senderId = senderMeta?.playerId || playerId;
          const senderIsHost = !room.hostId || senderId === room.hostId;

          room.gameSnapshot = mergeAuthoritativeSnapshot(
            room.gameSnapshot,
            snapshot,
            senderIsHost
          );
          if (room.gameSnapshot?.phase !== "NIGHT_ACTION") {
            room.pendingNightActions = {};
          }
          if (room.gameSnapshot?.phase !== "DAY_VOTING") {
            room.pendingDayVotes = {};
          }

          broadcastPersonalizedToRoom(
            room,
            (recipientId, recipientIsHost) => ({
              type: "GAME_STATE_UPDATED",
              hostId: room.hostId,
              snapshot: sanitizeSnapshotForRecipient(
                room.gameSnapshot,
                recipientId,
                recipientIsHost
              ),
              nightReadyIds: Object.keys(room.pendingNightActions),
              voteReadyIds: Object.keys(room.pendingDayVotes),
            }),
            ws
          );
        } else if (type === "HUMAN_CHAT" && chatMessage) {
          if (room.gameSnapshot && Array.isArray(room.gameSnapshot.messages)) {
            if (!room.gameSnapshot.messages.some((m: any) => m.id === chatMessage.id)) {
              room.gameSnapshot.messages = [
                ...room.gameSnapshot.messages,
                chatMessage,
              ];
            }
          }
          broadcastToRoom(
            normalizedRoomId,
            {
              type: "HUMAN_CHAT_RECEIVED",
              chatMessage,
            },
            ws
          );
        } else if (type === "SUBMIT_NIGHT_ACTION") {
          syncOnlineStatus(room);
          room.pendingNightActions[playerId] = nightAction || { primary: null };
          const readyIds = Object.keys(room.pendingNightActions);

          broadcastToRoom(normalizedRoomId, {
            type: "NIGHT_READY_UPDATED",
            nightReadyIds: readyIds,
          });

          const snapPlayers: any[] = room.gameSnapshot?.players || [];
          const onlineHumanIds = getLiveOnlineIds(normalizedRoomId);
          const requiredHumanPlayers = snapPlayers.filter(
            (p) => p.isHuman && p.alive && onlineHumanIds.has(p.id)
          );
          const allSubmitted =
            requiredHumanPlayers.length === 0 ||
            requiredHumanPlayers.every((p) => Boolean(room.pendingNightActions[p.id]));

          if (allSubmitted) {
            const resolverId = findActiveHostOrFirstOnline(room) || playerId;
            const actionsCopy = { ...room.pendingNightActions };
            room.pendingNightActions = {};
            sendToPlayerInRoom(normalizedRoomId, resolverId, {
              type: "EXECUTE_NIGHT_RESOLVE",
              humanActions: actionsCopy,
            });
          }
        } else if (type === "FORCE_RESOLVE_NIGHT") {
          const actionsCopy = { ...room.pendingNightActions };
          if (playerId && nightAction) {
            actionsCopy[playerId] = nightAction;
          }
          room.pendingNightActions = {};
          const resolverId = findActiveHostOrFirstOnline(room) || playerId;
          sendToPlayerInRoom(normalizedRoomId, resolverId, {
            type: "EXECUTE_NIGHT_RESOLVE",
            humanActions: actionsCopy,
          });
        } else if (type === "SUBMIT_DAY_VOTE") {
          syncOnlineStatus(room);
          if (voteTargetId) {
            room.pendingDayVotes[playerId] = voteTargetId;
          } else {
            room.pendingDayVotes[playerId] = "__ABSTAIN__";
          }
          const readyIds = Object.keys(room.pendingDayVotes);

          broadcastToRoom(normalizedRoomId, {
            type: "VOTE_READY_UPDATED",
            voteReadyIds: readyIds,
          });

          const snapPlayers: any[] = room.gameSnapshot?.players || [];
          const onlineHumanIds = getLiveOnlineIds(normalizedRoomId);
          const requiredVoters = snapPlayers.filter(
            (p) => p.isHuman && p.alive && p.canVote && onlineHumanIds.has(p.id)
          );
          const allVoted =
            requiredVoters.length === 0 ||
            requiredVoters.every((p) => Boolean(room.pendingDayVotes[p.id]));

          if (allVoted) {
            const resolverId = findActiveHostOrFirstOnline(room) || playerId;
            const votesCopy: Record<string, string> = {};
            Object.entries(room.pendingDayVotes).forEach(([k, v]) => {
              if (v && v !== "__ABSTAIN__") votesCopy[k] = v;
            });
            room.pendingDayVotes = {};
            sendToPlayerInRoom(normalizedRoomId, resolverId, {
              type: "EXECUTE_VOTE_RESOLVE",
              humanVotes: votesCopy,
            });
          }
        } else if (type === "FORCE_RESOLVE_VOTE") {
          const votesCopy: Record<string, string> = {};
          Object.entries(room.pendingDayVotes).forEach(([k, v]) => {
            if (v && v !== "__ABSTAIN__") votesCopy[k] = v;
          });
          if (playerId && voteTargetId) {
            votesCopy[playerId] = voteTargetId;
          }
          room.pendingDayVotes = {};
          const resolverId = findActiveHostOrFirstOnline(room) || playerId;
          sendToPlayerInRoom(normalizedRoomId, resolverId, {
            type: "EXECUTE_VOTE_RESOLVE",
            humanVotes: votesCopy,
          });
        } else if (type === "RETURN_TO_LOBBY") {
          room.gameStarted = false;
          room.gameSnapshot = null;
          room.pendingNightActions = {};
          room.pendingDayVotes = {};
          syncOnlineStatus(room);
          broadcastToRoom(
            normalizedRoomId,
            {
              type: "RETURNED_TO_LOBBY",
              hostId: room.hostId,
              totalPlayers: room.totalPlayers,
              participants: room.participants,
            },
            ws
          );
        }
      } catch (err) {
        console.error("WS message error:", err);
      }
    });

    ws.on("close", () => {
      const meta = clientMeta.get(ws);
      if (meta) {
        clientMeta.delete(ws);
        const room = rooms.get(meta.roomId);
        if (room) {
          syncOnlineStatus(room);
          let hostTransferredTo: string | null = null;
          // If host disconnected, transfer host to next online participant
          if (room.hostId === meta.playerId) {
            const nextOnline = room.participants.find((item) => item.isOnline);
            if (nextOnline) {
              room.hostId = nextOnline.id;
              hostTransferredTo = nextOnline.id;
            }
          }
          broadcastToRoom(meta.roomId, {
            type: "LOBBY_UPDATED",
            hostId: room.hostId,
            totalPlayers: room.totalPlayers,
            participants: room.participants,
          });
          // Give the newly promoted host authoritative game state so they can resolve nights/votes
          if (hostTransferredTo && room.gameStarted && room.gameSnapshot) {
            sendToPlayerInRoom(meta.roomId, hostTransferredTo, {
              type: "GAME_STATE_UPDATED",
              hostId: room.hostId,
              snapshot: sanitizeSnapshotForRecipient(
                room.gameSnapshot,
                hostTransferredTo,
                true
              ),
              nightReadyIds: Object.keys(room.pendingNightActions),
              voteReadyIds: Object.keys(room.pendingDayVotes),
            });
          }
        }
      }
    });
  });

  // Endpoint: Return all source code files as JSON for in-app viewing & downloading
  app.get("/api/project-files", (_req, res) => {
    try {
      const files: { path: string; content: string }[] = [];
      for (const relPath of SOURCE_FILES) {
        const fullPath = path.join(__dirname, relPath);
        if (fs.existsSync(fullPath)) {
          files.push({
            path: relPath,
            content: fs.readFileSync(fullPath, "utf-8"),
          });
        }
      }
      res.json({ files });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to read files" });
    }
  });

  // Endpoint: Download full project archive (.tar.gz including generated images)
  app.get("/api/project-archive", (_req, res) => {
    res.setHeader("Content-Type", "application/gzip");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="ultimate-werewolf-thai.tar.gz"'
    );
    const child = execFile(
      "tar",
      [
        "-czf",
        "-",
        "--exclude=node_modules",
        "--exclude=dist",
        "--exclude=.git",
        ".",
      ],
      { cwd: __dirname, encoding: "buffer", maxBuffer: 50 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          res.status(500).end();
          return;
        }
        res.end(stdout);
      }
    );
    child.on("error", () => {
      res.status(500).end();
    });
  });

  // Endpoint 1: Generate natural, unscripted Thai Day Discussion (Fast Multi-AI enabled)
  app.post("/api/werewolf/discuss", async (req, res) => {
    try {
      const {
        roomId,
        dayNumber,
        players: reqPlayers,
        nightVictimNames,
        seerKnowledge: reqSeerKnowledge,
        bodyguardKnowledge: reqBgKnowledge,
        recentTranscript,
        previousVotes,
        humanMessage,
        speakerName,
        mode, // 'INITIAL_DAY' | 'REPLY_TO_HUMAN' | 'CONTINUE_DEBATE'
      } = req.body;

      // Use server's authoritative gameSnapshot when available so non-host clients never need true roles
      const authSnap =
        roomId && rooms.get(String(roomId).trim().toUpperCase())?.gameSnapshot;
      const players = Array.isArray(authSnap?.players)
        ? authSnap.players
        : reqPlayers || [];
      const seerKnowledge = Array.isArray(authSnap?.seerKnowledge)
        ? authSnap.seerKnowledge
        : reqSeerKnowledge || [];
      const bodyguardKnowledge = Array.isArray(authSnap?.bodyguardKnowledge)
        ? authSnap.bodyguardKnowledge
        : reqBgKnowledge || [];

      const aliveAI = players.filter((p: any) => p.alive && !p.isHuman);
      if (aliveAI.length === 0) {
        return res.json({ fallback: false, data: { messages: [] }, aliveAIIds: [] });
      }

      const totalCount = players.length || 10;
      const aliveAll = players.filter((p: any) => p.alive);
      const deadAll = players.filter((p: any) => !p.alive);

      const playerDescriptions = aliveAll
        .map(
          (p: any) =>
            `- ID: ${p.id} | ชื่อ: ${p.name} | ${p.isHuman ? "ผู้เล่นคนจริง" : `ผู้เล่น AI (${p.personaTrait})`} | [บทบาทลับจริงของคนนี้: ${p.role}${p.revealedBeggar ? " (เปิดการ์ดยาจกแล้ว ไม่มีสิทธิ์โหวต)" : ""}]`
        )
        .join("\n");

      const deadDescriptions =
        deadAll.length > 0
          ? deadAll.map((p: any) => `${p.name}`).join(", ")
          : "ยังไม่มีผู้เสียชีวิตก่อนหน้านี้";

      const wolvesNames = players
        .filter((p: any) => p.role === "WEREWOLF" || p.role === "WOLF_CUB")
        .map((p: any) => `${p.name} (${p.role})`)
        .join(" และ ");

      const aiIdsList = aliveAI.map((a: any) => `${a.name} [${a.id}]`).join(", ");

      const systemPrompt = `คุณคือระบบจำลองผู้เล่นมนุษย์จริงๆ ที่กำลังล้อมวงเล่นบอร์ดเกม Ultimate Werewolf เป็นภาษาไทย (เริ่มเกมมี ${totalCount} คน, ตอนนี้เหลือรอดชีวิต ${aliveAll.length} คน)
กฎสำคัญเพื่อให้การคุยสมจริงเหมือนคนเล่นจริง 100% และตอบกระชับรวดเร็ว (คนละ 1-2 ประโยคสั้นๆ ชัดเจน):
1. สร้างคำพูดเฉพาะจากผู้เล่น AI ที่ยังมีชีวิตอยู่เท่านั้น (${aiIdsList}) — ห้ามสร้างคำพูดแทนผู้เล่นคนจริงเด็ดขาด
2. ใช้ภาษาพูดแบบเพื่อนคนไทยเล่นบอร์ดเกมจริงๆ ถกเถียง ตั้งข้อสังเกต วิเคราะห์รูปเกม และโต้ตอบกันอย่างเป็นธรรมชาติ
3. ห้ามโกงด้วยข้อมูลนอกบทบาท! แต่ละคนรู้เฉพาะข้อมูลของบทบาทตัวเองเท่านั้น:
   - WEREWOLF / WOLF_CUB [ได้แก่: ${wolvesNames}]: รู้จักกันเอง ทำตัวเนียนเป็นชาวบ้าน เบี่ยงประเด็นอย่างมีเหตุผล
   - SEER: รู้ผลส่องลูกแก้วของตัวเองเท่านั้น (${JSON.stringify(seerKnowledge)})
   - BODYGUARD: รู้ว่าตัวเองคุ้มกันใคร (${JSON.stringify(bodyguardKnowledge)})
   - VILLAGER / BEGGAR: ไม่รู้บทบาทใครเลย วิเคราะห์สดจากสถานการณ์จริง`;

      const humanDisplayName = speakerName || "ผู้เล่น";
      const targetMsgCount = Math.min(aliveAI.length, mode === "INITIAL_DAY" ? 4 : 3);

      let userPrompt = "";
      if (mode === "REPLY_TO_HUMAN") {
        userPrompt = `กลางวันวันที่ ${dayNumber}
ผู้มีชีวิตอยู่ (${aliveAll.length} คน):
${playerDescriptions}
ผู้ที่ตายไปแล้ว: ${deadDescriptions}

บทสนทนาล่าสุด:
${(recentTranscript || []).slice(-10).join("\n")}

ล่าสุด "${humanDisplayName}" พูดว่า: "${humanMessage}"
ให้ผู้เล่น AI 1-${targetMsgCount} คน พูดวิเคราะห์และโต้ตอบคำพูดนี้อย่างกระชับและเป็นธรรมชาติ (คนละ 1-2 ประโยค)`;
      } else if (mode === "CONTINUE_DEBATE") {
        userPrompt = `กลางวันวันที่ ${dayNumber} (ถกเถียงต่อเนื่องก่อนโหวต)
ผู้มีชีวิตอยู่ (${aliveAll.length} คน):
${playerDescriptions}

บทสนทนาล่าสุด:
${(recentTranscript || []).slice(-10).join("\n")}

ให้ผู้เล่น AI 1-${targetMsgCount} คน พูดวิเคราะห์ต่อยอดอย่างกระชับและเป็นธรรมชาติ (คนละ 1-2 ประโยค)`;
      } else {
        userPrompt = `เช้าวันที่ ${dayNumber}
เหตุการณ์เมื่อคืน: ${
          nightVictimNames && nightVictimNames.length > 0
            ? `${nightVictimNames.join(" และ ")} ถูกหมาป่าสังหารเมื่อคืนนี้`
            : "เมื่อคืนไม่มีใครตายเลย! (บอดี้การ์ดน่าจะกันถูกคน)"
        }
ผู้ที่ตายไปแล้ว: ${deadDescriptions}
ประวัติโหวตเมื่อวาน: ${JSON.stringify(previousVotes || [])}

ผู้มีชีวิตอยู่ (${aliveAll.length} คน):
${playerDescriptions}

ให้ผู้เล่น AI ${Math.min(aliveAI.length, 3)}-${targetMsgCount} คน พูดวิเคราะห์สถานการณ์ช่วงเช้ากันเองอย่างกระชับเป็นธรรมชาติ (คนละ 1-2 ประโยค)`;
      }

      const result = await generateStructuredAIJson({
        tier: "fast",
        systemInstruction: systemPrompt,
        userPrompt,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            messages: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  speakerId: { type: Type.STRING },
                  speakerName: { type: Type.STRING },
                  text: { type: Type.STRING },
                  tone: { type: Type.STRING },
                },
                required: ["speakerId", "speakerName", "text", "tone"],
              },
            },
          },
          required: ["messages"],
        },
        jsonHint: `{ "messages": [ { "speakerId": "ai-1", "speakerName": "ชื่อผู้เล่น AI", "text": "ข้อความภาษาไทย 1-2 ประโยค", "tone": "ท่าทีสั้นๆ" } ] }`,
      });

      if (!result) {
        return res.status(200).json({ fallback: true });
      }

      return res.json({
        fallback: false,
        data: result.data,
        modelUsed: result.modelUsed,
        aliveAIIds: aliveAI.map((a: any) => a.id),
      });
    } catch (error: any) {
      console.error("AI discuss error:", error?.message || error);
      return res.status(200).json({ fallback: true, error: error?.message });
    }
  });

  // Endpoint 2: Generate logical, INDEPENDENT AI Votes and Reasons in Thai (Fast Multi-AI enabled)
  app.post("/api/werewolf/vote", async (req, res) => {
    try {
      const {
        roomId,
        dayNumber,
        players: reqPlayers,
        seerKnowledge: reqSeerKnowledge,
        bodyguardKnowledge: reqBgKnowledge,
        recentTranscript,
      } = req.body;

      const authSnap =
        roomId && rooms.get(String(roomId).trim().toUpperCase())?.gameSnapshot;
      const players = Array.isArray(authSnap?.players)
        ? authSnap.players
        : reqPlayers || [];
      const seerKnowledge = Array.isArray(authSnap?.seerKnowledge)
        ? authSnap.seerKnowledge
        : reqSeerKnowledge || [];
      const bodyguardKnowledge = Array.isArray(authSnap?.bodyguardKnowledge)
        ? authSnap.bodyguardKnowledge
        : reqBgKnowledge || [];

      const aliveAll = players.filter((p: any) => p.alive);
      const eligibleAI = aliveAll.filter(
        (p: any) => !p.isHuman && p.canVote !== false
      );

      if (eligibleAI.length === 0) {
        return res.json({ fallback: false, data: { votes: [] } });
      }

      const totalCount = players.length || 10;

      const systemPrompt = `คุณคือสมองของผู้เล่น AI แต่ละคนในการตัดสินใจโหวตประหารในเกม Ultimate Werewolf ภาษาไทย (เริ่มเกม ${totalCount} คน)
กฎเหล็กของการโหวต:
1. ผู้เล่น AI แต่ละคนคิดวิเคราะห์และตัดสินใจโหวตด้วยตัวเองจากบทสนทนาวันนี้และข้อมูลลับเฉพาะบทบาท (ห้ามโหวตตามผู้เล่นมนุษย์แบบไร้เหตุผล)
2. ห้ามโหวตตัวเอง และไม่โหวตคนที่หงายการ์ดเป็นยาจกไปแล้ว
3. พ่อหมาป่า (WEREWOLF) และ ลูกหมาป่า (WOLF_CUB): ห้ามโหวตกันเองเด็ดขาด ให้โหวตชาวบ้านที่ดูน่าสงสัยหรือเป็นภัย
4. เทพพยากรณ์ (SEER): หากส่องเจอหมาป่าที่ยังมีชีวิต (${JSON.stringify(seerKnowledge)}) จะโหวตหมาป่าคนนั้นทันที และไม่โหวตคนที่ส่องแล้วว่าเป็นชาวบ้าน
5. บอดี้การ์ด (BODYGUARD): ใช้ข้อมูลคนที่คุ้มกัน (${JSON.stringify(bodyguardKnowledge)}) ประกอบการตัดสินใจ
6. เขียนเหตุผลการโหวตให้สั้น กระชับ (ไม่เกิน 1 ประโยค) เป็นธรรมชาติเหมือนคนเล่นจริง`;

      const userPrompt = `กลางวันวันที่ ${dayNumber} - ช่วงลงมติโหวตประหาร
รายชื่อผู้มีชีวิตอยู่:
${aliveAll.map((p: any) => `- ID: ${p.id} | ชื่อ: ${p.name} | บทบาทลับ: ${p.role} | สิทธิ์โหวต: ${p.canVote !== false ? "มี" : "เสียสิทธิ์โหวตแล้ว (ยาจก)"}`).join("\n")}

บทสนทนาวันนี้:
${(recentTranscript || []).slice(-12).join("\n")}

ระบุการโหวตของ AI ที่มีสิทธิ์โหวตทุกคน (${eligibleAI.map((p: any) => `${p.name} [${p.id}]`).join(", ")}) พร้อมเหตุผลสั้นๆ`;

      const result = await generateStructuredAIJson({
        tier: "fast",
        systemInstruction: systemPrompt,
        userPrompt,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            votes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  voterId: { type: Type.STRING },
                  targetId: { type: Type.STRING },
                  reason: { type: Type.STRING },
                },
                required: ["voterId", "targetId", "reason"],
              },
            },
          },
          required: ["votes"],
        },
        jsonHint: `{ "votes": [ { "voterId": "ai-1", "targetId": "ai-2", "reason": "เหตุผลสั้นๆ 1 ประโยค" } ] }`,
      });

      if (!result) {
        return res.status(200).json({ fallback: true });
      }

      return res.json({
        fallback: false,
        data: result.data,
        modelUsed: result.modelUsed,
      });
    } catch (error: any) {
      console.error("AI vote error:", error?.message || error);
      return res.status(200).json({ fallback: true, error: error?.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    const activeProviders = getConfiguredProviders();
    const geminiCfg = getGeminiConfig();
    console.log(`Ultimate Werewolf Server running on port ${PORT}`);
    console.log(
      `Active AI providers: ${
        activeProviders.length > 0 ? activeProviders.join(", ") : "local-engine-only"
      }${
        geminiCfg
          ? ` (Gemini Primary: ${geminiCfg.primaryModel}, Fast: ${geminiCfg.fastModel})`
          : ""
      }`
    );
  });
}

startServer();
