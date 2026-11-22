import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { WebSocketServer, WebSocket } from "ws";
import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  ThinkingLevel,
  Type,
} from "@google/genai";

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
    primaryModel: (process.env.GEMINI_MODEL_PRIMARY || "gemini-4-hydrogen").trim(),
    fastModel: (process.env.GEMINI_MODEL_FAST || "gemini-3.1-flash-lite").trim(),
  };
}

function getConfiguredProviders(): AIProviderName[] {
  const orderEnv =
    process.env.AI_PROVIDER_ORDER ||
    "gemini,groq,openrouter,openai,deepseek,anthropic";
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

const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 20000;

const WEREWOLF_SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

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

const geminiModelCooldownUntil = new Map<string, number>();

async function callGeminiProvider(params: {
  tier: "primary" | "fast";
  systemInstruction: string;
  userPrompt: string;
  responseSchema: any;
  maxOutputTokens?: number;
  hasBackupProviders?: boolean;
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

  // Prioritize configured primary/fast models with valid active fallbacks
  const preferPrimary =
    process.env.AI_PREFER_PRIMARY === "true" || params.tier === "primary";
  const modelsToTry = preferPrimary
    ? [cfg.primaryModel, cfg.fastModel, "gemini-4-hydrogen", "gemini-3.1-flash-lite"]
    : [cfg.fastModel, cfg.primaryModel, "gemini-3.1-flash-lite", "gemini-4-hydrogen"];
  const uniqueModels = Array.from(new Set(modelsToTry.filter(Boolean)));

  const now = Date.now();
  const readyModels = uniqueModels.filter(
    (m) => (geminiModelCooldownUntil.get(m) || 0) <= now
  );
  const candidateModels = readyModels.length > 0 ? readyModels : uniqueModels;

  let lastErr: any = null;
  for (let idx = 0; idx < candidateModels.length; idx++) {
    const modelName = candidateModels[idx];
    const hasMoreFallbacks =
      idx < candidateModels.length - 1 || Boolean(params.hasBackupProviders);
    const attemptTimeoutMs = hasMoreFallbacks
      ? Math.min(AI_TIMEOUT_MS, 15000)
      : AI_TIMEOUT_MS;

    try {
      const lower = modelName.toLowerCase();
      const isGemini4 = lower.startsWith("gemini-4-");
      const config: any = {
        systemInstruction: params.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: params.responseSchema,
        safetySettings: WEREWOLF_SAFETY_SETTINGS,
      };
      if (isGemini4) {
        // Gemini 4 models use ThinkingLevel.LOW for snappy, smart banter and do NOT accept deprecated temperature
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
      } else {
        config.temperature = 0.85;
        if (params.maxOutputTokens) {
          config.maxOutputTokens = params.maxOutputTokens;
        }
      }

      const response = await withTimeout(
        ai.models.generateContent({
          model: modelName,
          contents: params.userPrompt,
          config,
        }),
        attemptTimeoutMs,
        `gemini:${modelName}`
      );
      const textOut =
        response.text ||
        response.candidates?.[0]?.content?.parts
          ?.map((p: any) => p.text || "")
          .join("") ||
        "";
      if (!textOut.trim()) {
        const finishReason = response.candidates?.[0]?.finishReason || "UNKNOWN";
        throw new Error(`Empty AI response from ${modelName} (finishReason=${finishReason})`);
      }
      const parsed = extractJsonFromText(textOut);
      geminiModelCooldownUntil.delete(modelName);
      return { data: parsed, modelUsed: `gemini:${modelName}` };
    } catch (err: any) {
      lastErr = err;
      const errMsg = String(err?.message || err);
      const lowerErr = errMsg.toLowerCase();
      if (lowerErr.includes("404") || lowerErr.includes("not found")) {
        geminiModelCooldownUntil.set(modelName, Date.now() + 10 * 60 * 1000);
      } else if (
        lowerErr.includes("429") ||
        lowerErr.includes("quota") ||
        lowerErr.includes("resource_exhausted") ||
        lowerErr.includes("timed out")
      ) {
        geminiModelCooldownUntil.set(modelName, Date.now() + 45 * 1000);
      }
      console.warn(`[Gemini] ${modelName} failed: ${errMsg.slice(0, 180)}`);
    }
  }
  throw lastErr || new Error("Gemini request failed");
}

async function callOpenAICompatibleProvider(params: {
  provider: "openai" | "openrouter" | "groq" | "deepseek";
  systemInstruction: string;
  userPrompt: string;
  jsonHint: string;
  maxOutputTokens?: number;
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
        max_tokens: params.maxOutputTokens || 900,
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
  maxOutputTokens?: number;
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
        max_tokens: params.maxOutputTokens || 900,
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
  maxOutputTokens?: number;
}): Promise<{ data: any; modelUsed: string }> {
  const configured = getConfiguredProviders();
  if (configured.length === 0) {
    throw new Error(
      "ยังไม่ได้ตั้งค่า LLM API Key บนเซิร์ฟเวอร์ (กรุณาตั้งค่า GEMINI_API_KEY หรือ GROQ_API_KEY)"
    );
  }

  let orderedProviders = [...configured];
  if (process.env.AI_MIX_PROVIDERS === "true" && configured.length > 1) {
    const startIdx = providerRotationCursor % configured.length;
    providerRotationCursor += 1;
    orderedProviders = [
      ...configured.slice(startIdx),
      ...configured.slice(0, startIdx),
    ];
  }

  let lastError: any = null;
  const maxPasses = orderedProviders.length === 1 ? 2 : 1;

  for (let pass = 0; pass < maxPasses; pass++) {
    if (pass > 0) {
      await new Promise((r) => setTimeout(r, 900 * pass));
    }
    for (let i = 0; i < orderedProviders.length; i++) {
      const provider = orderedProviders[i];
      const hasBackupProviders =
        i < orderedProviders.length - 1 || pass < maxPasses - 1;
      try {
        if (provider === "gemini") {
          return await callGeminiProvider({ ...params, hasBackupProviders });
        } else if (provider === "anthropic") {
          return await callAnthropicProvider(params);
        } else {
          return await callOpenAICompatibleProvider({
            provider,
            systemInstruction: params.systemInstruction,
            userPrompt: params.userPrompt,
            jsonHint: params.jsonHint,
            maxOutputTokens: params.maxOutputTokens,
          });
        }
      } catch (err: any) {
        lastError = err;
        console.error(`AI provider [${provider}] failed:`, err?.message || err);
      }
    }
  }

  throw lastError || new Error("ไม่สามารถเชื่อมต่อ LLM API ได้ในขณะนี้");
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
  "src/components/DeathAnimationOverlay.tsx",
  "src/components/BodyguardAnimationOverlay.tsx",
  "src/components/AnnouncementBannerOverlay.tsx",
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

const DAY_RESULT_AUTO_NIGHT_MS = 5 * 60 * 1000; // 5 minutes discussion timer before auto-entering Night

interface RoomState {
  roomId: string;
  hostId: string | null;
  totalPlayers: number;
  participants: RoomParticipant[];
  gameStarted: boolean;
  gameSnapshot: any | null;
  pendingNightActions: Record<string, { primary: string | null; secondary?: string | null }>;
  pendingDayVotes: Record<string, string>;
  phaseReadyIds: string[];
  wolfMessages: any[];
  wolfSignals: Record<string, { primary: string | null; secondary?: string | null }>;
  phaseDeadlineAt: number | null;
  phaseTimer: ReturnType<typeof setTimeout> | null;
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
      phaseReadyIds: [],
      wolfMessages: [],
      wolfSignals: {},
      phaseDeadlineAt: null,
      phaseTimer: null,
    };
    rooms.set(roomId, room);
  }
  return room;
}

function clearRoomPhaseTimer(room: RoomState) {
  if (room.phaseTimer) {
    clearTimeout(room.phaseTimer);
    room.phaseTimer = null;
  }
  room.phaseDeadlineAt = null;
}

function scheduleDayResultAutoNight(room: RoomState) {
  clearRoomPhaseTimer(room);
  room.phaseDeadlineAt = Date.now() + DAY_RESULT_AUTO_NIGHT_MS;
  broadcastToRoom(room.roomId, {
    type: "PHASE_DEADLINE_UPDATED",
    phaseDeadlineAt: room.phaseDeadlineAt,
  });

  room.phaseTimer = setTimeout(() => {
    room.phaseTimer = null;
    if (!room.gameStarted || room.gameSnapshot?.phase !== "DAY_RESULT") {
      room.phaseDeadlineAt = null;
      return;
    }
    room.phaseDeadlineAt = null;
    room.phaseReadyIds = [];
    broadcastToRoom(room.roomId, {
      type: "PHASE_READY_UPDATED",
      phaseReadyIds: [],
    });
    broadcastToRoom(room.roomId, {
      type: "PHASE_DEADLINE_UPDATED",
      phaseDeadlineAt: null,
    });
    const resolverId = findActiveHostOrFirstOnline(room);
    if (resolverId) {
      sendToPlayerInRoom(room.roomId, resolverId, {
        type: "EXECUTE_PHASE_ADVANCE",
        targetPhase: "NIGHT_ACTION",
        reason: "TIMEOUT",
      });
    }
  }, DAY_RESULT_AUTO_NIGHT_MS);
}

function isPlayerWolfInRoom(room: RoomState, playerId: string): boolean {
  const snapPlayers: any[] = room.gameSnapshot?.players || [];
  const p = snapPlayers.find((item) => item.id === playerId);
  return Boolean(p && isWolfRole(p.role));
}

function broadcastToWolvesOnly(room: RoomState, payload: any, excludeWs?: WebSocket) {
  const msg = JSON.stringify(payload);
  for (const [ws, meta] of clientMeta.entries()) {
    if (
      meta.roomId === room.roomId &&
      ws !== excludeWs &&
      ws.readyState === WebSocket.OPEN &&
      isPlayerWolfInRoom(room, meta.playerId)
    ) {
      ws.send(msg);
    }
  }
}

function checkAndAdvanceUnanimousPhase(room: RoomState, targetPhase: "DAY_VOTING" | "NIGHT_ACTION") {
  const snapPlayers: any[] = room.gameSnapshot?.players || [];
  if (snapPlayers.length === 0) return;

  const onlineHumanIds = getLiveOnlineIds(room.roomId);
  // Every living AI + every living online human player MUST confirm ready!
  const requiredLivingIds = snapPlayers
    .filter((p) => p.alive && (!p.isHuman || onlineHumanIds.has(p.id)))
    .map((p) => p.id);

  if (
    requiredLivingIds.length > 0 &&
    requiredLivingIds.every((id) => room.phaseReadyIds.includes(id))
  ) {
    clearRoomPhaseTimer(room);
    room.phaseReadyIds = [];
    broadcastToRoom(room.roomId, {
      type: "PHASE_READY_UPDATED",
      phaseReadyIds: [],
    });
    broadcastToRoom(room.roomId, {
      type: "PHASE_DEADLINE_UPDATED",
      phaseDeadlineAt: null,
    });
    const resolverId = findActiveHostOrFirstOnline(room);
    if (resolverId) {
      sendToPlayerInRoom(room.roomId, resolverId, {
        type: "EXECUTE_PHASE_ADVANCE",
        targetPhase,
        reason: "UNANIMOUS",
      });
    }
  }
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
  return role === "WEREWOLF" || role === "WOLF_CUB" || role === "HUMAN_WOLF";
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

  // STRICT PRIVACY: Each client ONLY receives their own private Bodyguard shield animation event
  const rawShieldEvents = snapshot.nightShieldEvents as
    | { eventId?: string; byPlayer?: Record<string, string> }
    | null
    | undefined;
  const recipientShieldType = rawShieldEvents?.byPlayer?.[recipientPlayerId] || null;
  const myShieldEvent =
    recipientShieldType && rawShieldEvents?.eventId
      ? { eventId: rawShieldEvents.eventId, type: recipientShieldType }
      : null;

  // Host retains full player roles in memory for game-engine night/vote resolution,
  // while non-host players ONLY receive their own role (+ fellow wolf if wolf, + revealed beggar)
  // until GAME_OVER.
  if (isGameOver || isHost) {
    return {
      ...snapshot,
      messages: filteredMessages,
      nightShieldEvents: undefined,
      myShieldEvent,
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
    nightShieldEvents: undefined,
    myShieldEvent,
    seerKnowledge:
      recipientPlayer?.role === "SEER" && Array.isArray(snapshot.seerKnowledge)
        ? snapshot.seerKnowledge
        : [],
    bodyguardKnowledge:
      recipientPlayer?.role === "BODYGUARD" &&
      Array.isArray(snapshot.bodyguardKnowledge)
        ? snapshot.bodyguardKnowledge
        : [],
    wolfKillHistory:
      recipientIsWolf && Array.isArray(snapshot.wolfKillHistory)
        ? snapshot.wolfKillHistory
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
    wolfKillHistory: prevSnapshot.wolfKillHistory || [],
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
          wolfMessage,
          wolfSignal,
          nightAction,
          voteTargetId,
          ready,
          targetPhase,
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

          const recipientIsWolf = isPlayerWolfInRoom(room, playerId);
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
              phaseReadyIds: room.phaseReadyIds,
              phaseDeadlineAt: room.phaseDeadlineAt,
              wolfMessages: recipientIsWolf ? room.wolfMessages : [],
              wolfSignals: recipientIsWolf ? room.wolfSignals : {},
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
          clearRoomPhaseTimer(room);
          room.gameStarted = true;
          room.gameSnapshot = snapshot;
          room.pendingNightActions = {};
          room.pendingDayVotes = {};
          room.phaseReadyIds = [];
          room.wolfMessages = [];
          room.wolfSignals = {};
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
              phaseDeadlineAt: null,
              wolfMessages: [],
              wolfSignals: {},
            }),
            ws
          );
        } else if (type === "SYNC_GAME_STATE") {
          const senderMeta = clientMeta.get(ws);
          const senderId = senderMeta?.playerId || playerId;
          const senderIsHost = !room.hostId || senderId === room.hostId;
          const prevPhase = room.gameSnapshot?.phase;

          room.gameSnapshot = mergeAuthoritativeSnapshot(
            room.gameSnapshot,
            snapshot,
            senderIsHost
          );
          const nextPhase = room.gameSnapshot?.phase;
          if (nextPhase !== "NIGHT_ACTION") {
            room.pendingNightActions = {};
            room.wolfSignals = {};
          }
          if (nextPhase !== "DAY_VOTING") {
            room.pendingDayVotes = {};
          }
          if (prevPhase !== nextPhase) {
            room.phaseReadyIds = [];
            if (nextPhase === "DAY_RESULT") {
              scheduleDayResultAutoNight(room);
            } else {
              clearRoomPhaseTimer(room);
            }
          }

          broadcastPersonalizedToRoom(
            room,
            (recipientId, recipientIsHost) => {
              const isRecipientWolf = isPlayerWolfInRoom(room, recipientId);
              return {
                type: "GAME_STATE_UPDATED",
                hostId: room.hostId,
                snapshot: sanitizeSnapshotForRecipient(
                  room.gameSnapshot,
                  recipientId,
                  recipientIsHost
                ),
                nightReadyIds: Object.keys(room.pendingNightActions),
                voteReadyIds: Object.keys(room.pendingDayVotes),
                phaseReadyIds: room.phaseReadyIds,
                phaseDeadlineAt: room.phaseDeadlineAt,
                wolfMessages: isRecipientWolf ? room.wolfMessages : [],
                wolfSignals: isRecipientWolf ? room.wolfSignals : {},
              };
            },
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
        } else if (type === "WOLF_CHAT" && wolfMessage) {
          const senderMeta = clientMeta.get(ws);
          const socketPlayerId = senderMeta?.playerId || playerId;
          const canPost =
            isPlayerWolfInRoom(room, socketPlayerId) ||
            (room.hostId === socketPlayerId && isPlayerWolfInRoom(room, wolfMessage.senderId));
          if (!canPost) return;

          if (!room.wolfMessages.some((m: any) => m.id === wolfMessage.id)) {
            room.wolfMessages = [...room.wolfMessages, wolfMessage];
          }
          broadcastToWolvesOnly(
            room,
            {
              type: "WOLF_CHAT_RECEIVED",
              wolfMessage,
            },
            ws
          );
        } else if (type === "WOLF_SIGNAL" && playerId) {
          const senderMeta = clientMeta.get(ws);
          const socketPlayerId = senderMeta?.playerId || playerId;
          const canSignal =
            isPlayerWolfInRoom(room, playerId) &&
            (socketPlayerId === playerId || room.hostId === socketPlayerId);
          if (!canSignal) return;

          room.wolfSignals[playerId] = wolfSignal || { primary: null };
          // If this wolf had already locked a different night action, unlock it so they re-confirm consensus
          const prevSubmitted = room.pendingNightActions[playerId];
          if (
            prevSubmitted &&
            prevSubmitted.primary !== (wolfSignal?.primary ?? null)
          ) {
            delete room.pendingNightActions[playerId];
            broadcastToRoom(normalizedRoomId, {
              type: "NIGHT_READY_UPDATED",
              nightReadyIds: Object.keys(room.pendingNightActions),
            });
          }

          broadcastToWolvesOnly(room, {
            type: "WOLF_SIGNALS_UPDATED",
            wolfSignals: room.wolfSignals,
          });
        } else if (type === "SUBMIT_NIGHT_ACTION") {
          syncOnlineStatus(room);
          room.pendingNightActions[playerId] = nightAction || { primary: null };

          // Keep wolf signal synced with submitted action if sender is a wolf
          if (isPlayerWolfInRoom(room, playerId) && nightAction) {
            room.wolfSignals[playerId] = nightAction;
            broadcastToWolvesOnly(room, {
              type: "WOLF_SIGNALS_UPDATED",
              wolfSignals: room.wolfSignals,
            });
          }

          const snapPlayers: any[] = room.gameSnapshot?.players || [];
          const onlineHumanIds = getLiveOnlineIds(normalizedRoomId);

          // Enforce 2-wolf consensus when BOTH living wolves are online real humans!
          const onlineLivingHumanWolves = snapPlayers.filter(
            (p) => p.isHuman && p.alive && isWolfRole(p.role) && onlineHumanIds.has(p.id)
          );
          if (onlineLivingHumanWolves.length === 2) {
            const [w1, w2] = onlineLivingHumanWolves;
            const act1 = room.pendingNightActions[w1.id];
            const act2 = room.pendingNightActions[w2.id];
            if (act1 && act2 && act1.primary !== act2.primary) {
              delete room.pendingNightActions[w1.id];
              delete room.pendingNightActions[w2.id];
              broadcastToRoom(normalizedRoomId, {
                type: "NIGHT_READY_UPDATED",
                nightReadyIds: Object.keys(room.pendingNightActions),
              });
              broadcastToWolvesOnly(room, {
                type: "WOLF_CONSENSUS_MISMATCH",
                wolfSignals: room.wolfSignals,
                message: `ความเห็นหมาป่าทั้ง 2 ตัวไม่ตรงกัน! โปรดคุยในแชทลับและกดส่งซิกเลือกเหยื่อคนเดียวกันก่อนยืนยัน`,
              });
              return;
            }
          }

          const readyIds = Object.keys(room.pendingNightActions);

          broadcastToRoom(normalizedRoomId, {
            type: "NIGHT_READY_UPDATED",
            nightReadyIds: readyIds,
          });

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
            room.wolfSignals = {};
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
          room.wolfSignals = {};
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
            const votesCopy: Record<string, string> = { ...room.pendingDayVotes };
            room.pendingDayVotes = {};
            sendToPlayerInRoom(normalizedRoomId, resolverId, {
              type: "EXECUTE_VOTE_RESOLVE",
              humanVotes: votesCopy,
            });
          }
        } else if (type === "FORCE_RESOLVE_VOTE") {
          const votesCopy: Record<string, string> = { ...room.pendingDayVotes };
          if (playerId) {
            votesCopy[playerId] = voteTargetId || "__ABSTAIN__";
          }
          room.pendingDayVotes = {};
          const resolverId = findActiveHostOrFirstOnline(room) || playerId;
          sendToPlayerInRoom(normalizedRoomId, resolverId, {
            type: "EXECUTE_VOTE_RESOLVE",
            humanVotes: votesCopy,
          });
        } else if (type === "TOGGLE_PHASE_READY") {
          syncOnlineStatus(room);
          const currentPhase = room.gameSnapshot?.phase;
          const expectedTarget: "DAY_VOTING" | "NIGHT_ACTION" | null =
            currentPhase === "DAY_DISCUSSION"
              ? "DAY_VOTING"
              : currentPhase === "DAY_RESULT"
              ? "NIGHT_ACTION"
              : null;

          if (!expectedTarget || (targetPhase && targetPhase !== expectedTarget)) {
            return;
          }

          if (playerId) {
            const set = new Set(room.phaseReadyIds);
            if (ready === false) {
              set.delete(playerId);
            } else {
              set.add(playerId);
            }
            room.phaseReadyIds = Array.from(set);
          }

          broadcastToRoom(normalizedRoomId, {
            type: "PHASE_READY_UPDATED",
            phaseReadyIds: room.phaseReadyIds,
          });

          checkAndAdvanceUnanimousPhase(room, expectedTarget);
        } else if (type === "RETURN_TO_LOBBY") {
          clearRoomPhaseTimer(room);
          room.gameStarted = false;
          room.gameSnapshot = null;
          room.pendingNightActions = {};
          room.pendingDayVotes = {};
          room.phaseReadyIds = [];
          room.wolfMessages = [];
          room.wolfSignals = {};
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
            const promotedIsWolf = isPlayerWolfInRoom(room, hostTransferredTo);
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
              phaseReadyIds: room.phaseReadyIds,
              phaseDeadlineAt: room.phaseDeadlineAt,
              ...(promotedIsWolf
                ? {
                    wolfMessages: room.wolfMessages,
                    wolfSignals: room.wolfSignals,
                  }
                : {}),
            });
          }
          // Re-check unanimous phase readiness in case the disconnected player was the last one blocking
          if (room.gameStarted && room.gameSnapshot) {
            if (room.gameSnapshot.phase === "DAY_DISCUSSION") {
              checkAndAdvanceUnanimousPhase(room, "DAY_VOTING");
            } else if (room.gameSnapshot.phase === "DAY_RESULT") {
              checkAndAdvanceUnanimousPhase(room, "NIGHT_ACTION");
            }
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

  // Helper to format rich player & game-state context for all autonomous LLM endpoints
  const formatPlayerProfileLine = (p: any) => {
    const genderThai = p.gender === "M" ? "ชาย" : p.gender === "F" ? "หญิง" : "ไม่ระบุเพศ";
    const callPrefix = p.gender === "F" ? `อี${p.shortName || p.name}` : `ไอ้${p.shortName || p.name}`;
    const roleTag = `${p.role}${p.revealedBeggar ? " (เปิดการ์ดยาจกแล้ว - หมดสิทธิ์โหวต)" : ""}`;
    if (p.isHuman) {
      return `- ID: ${p.id} | ชื่อ: ${p.name} (เรียกในวงว่า: ${callPrefix}) | ผู้เล่นคนจริง | บทบาทลับจริง: [${roleTag}]`;
    }
    return `- ID: ${p.id} | ชื่อ: ${p.name} (เพศ: ${genderThai}, เรียกในวงว่า: ${callPrefix}) | นิสัยเฉพาะตัว: [${p.archetypeName || p.personaLabel}] — ${p.personaTrait}${p.archetypeGuide ? ` | สไตล์การคิด/พูด: ${p.archetypeGuide}` : ""} | บทบาทลับจริง: [${roleTag}]`;
  };

  const formatDeadPlayerLine = (p: any) => {
    const causeText =
      p.deathCause === "WOLF_KILL"
        ? `โดนหมาป่าฆ่า (คืนที่ ${p.deathDay || "?"})`
        : p.deathCause === "DAY_EXECUTION"
        ? `โดนชาวบ้านโหวตประหาร (วันที่ ${p.deathDay || "?"})`
        : "เสียชีวิตแล้ว";
    const genderThai = p.gender === "M" ? "ชาย" : p.gender === "F" ? "หญิง" : "";
    return `- ${p.name}${genderThai ? ` (${genderThai})` : ""}: ${causeText}`;
  };

  const formatVoteHistoryBlock = (voteHistory: any[], previousVotes: any[]) => {
    if (Array.isArray(voteHistory) && voteHistory.length > 0) {
      return voteHistory
        .map((round: any) => {
          const lines = (round.votes || [])
            .map((v: any) =>
              v.targetId === "__ABSTAIN__"
                ? `  • ${v.voterName} งดออกเสียง`
                : `  • ${v.voterName} โหวต ${v.targetName} ("${v.reason || ""}")`
            )
            .join("\n");
          const resultNote = round.beggarRevealedName
            ? `=> ${round.beggarRevealedName} เปิดการ์ดยาจกรอดตาย!`
            : round.executedName
            ? `=> ${round.executedName} ถูกโหวตประหาร`
            : "=> เสมอ/งดออกเสียง ไม่มีใครตาย";
          return `วันที่ ${round.day} (${resultNote}):\n${lines}`;
        })
        .join("\n");
    }
    if (Array.isArray(previousVotes) && previousVotes.length > 0) {
      return previousVotes
        .map((v: any) =>
          v.targetId === "__ABSTAIN__"
            ? `• ${v.voterName} งดออกเสียง`
            : `• ${v.voterName} โหวต ${v.targetName}`
        )
        .join("\n");
    }
    return "ยังไม่มีประวัติการโหวตก่อนหน้านี้";
  };

  // Endpoint 1: 100% Autonomous Unscripted Thai Day Discussion (Multi-Bot Conversational Flow)
  app.post("/api/werewolf/discuss", async (req, res) => {
    try {
      const {
        roomId,
        dayNumber,
        players: reqPlayers,
        nightVictimNames,
        seerKnowledge: reqSeerKnowledge,
        bodyguardKnowledge: reqBgKnowledge,
        wolfKillHistory: reqWolfHistory,
        voteHistory: reqVoteHistory,
        doubleKillNextNight,
        recentTranscript,
        previousVotes,
        humanMessage,
        speakerName,
        mode, // 'INITIAL_DAY' | 'REPLY_TO_HUMAN' | 'CONTINUE_DEBATE'
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
      const wolfKillHistory = Array.isArray(authSnap?.wolfKillHistory)
        ? authSnap.wolfKillHistory
        : reqWolfHistory || [];
      const voteHistory = Array.isArray(authSnap?.voteHistory)
        ? authSnap.voteHistory
        : reqVoteHistory || [];

      const aliveAI = players.filter((p: any) => p.alive && !p.isHuman);
      if (aliveAI.length === 0) {
        return res.json({ ok: true, data: { messages: [] }, aliveAIIds: [] });
      }

      const totalCount = players.length || 10;
      const aliveAll = players.filter((p: any) => p.alive);
      const deadAll = players.filter((p: any) => !p.alive);

      const aliveDescriptions = aliveAll.map(formatPlayerProfileLine).join("\n");
      const deadDescriptions =
        deadAll.length > 0
          ? deadAll.map(formatDeadPlayerLine).join("\n")
          : "ยังไม่มีผู้เสียชีวิต";
      const voteHistoryText = formatVoteHistoryBlock(voteHistory, previousVotes);

      const wolvesNames = players
        .filter((p: any) => isWolfRole(p.role))
        .map((p: any) => `${p.name} (${p.role}, ${p.alive ? "ยังมีชีวิต" : "ตายแล้ว"})`)
        .join(" และ ");

      const aiIdsList = aliveAI
        .map((a: any) => `${a.name} [${a.id} · ${a.gender === "M" ? "ชาย" : "หญิง"} · ${a.personaLabel}]`)
        .join(", ");

      const systemPrompt = `คุณคือสมองอิสระของบอท AI แต่ละตัวในแก๊งเพื่อนสนิทคนไทยที่คบกันมา 10 ปี กำลังนั่งล้อมวงเล่นบอร์ดเกม Ultimate Werewolf (${totalCount} คน, ตอนนี้รอดชีวิต ${aliveAll.length} คน)

กฎเหล็ก 100% — คิดสดเองตามสถานการณ์จริง ห้ามพูดซ้ำซาก ห้ามใช้แพตเทิร์นสำเร็จรูป:
1. **บุคลิกและเพศเฉพาะตัว (ต้องสวมบทบาทเป๊ะทุกตัว!)**:
   - บอทแต่ละตัวมี "เพศ (ชาย/หญิง)" และ "นิสัยเฉพาะตัว (Archetype)" ที่กำหนดไว้ในข้อมูลด้านล่าง จงให้บอทคิด วิเคราะห์ ตอบโต้ โกหก และใช้จังหวะคำพูดให้ตรงกับนิสัยและเพศของตัวเอง 100%
   - เรียกเพื่อนผู้ชายว่า "ไอ้[ชื่อ]" และเรียกเพื่อนผู้หญิงว่า "อี[ชื่อ]" หรือ "[ชื่อ]" ให้ตรงเพศจริงๆ ในวงเพื่อนสนิท
2. **ภาษาเพื่อนซี้ดิบๆ ฮาๆ (ห้ามมีคำสุภาพแม้แต่คำเดียว!)**:
   - ใช้เฉพาะ "กู", "มึง", "พวกมึง", "ไอ้...", "อี..." และสแลงวงเหล้า/วงดิสคอร์ด เช่น "เชี่ย", "สัส", "แม่ง", "ตอแหล", "เหลี่ยม", "เนียนเหี้ยๆ", "โง่ชิบหาย", "ควายเอ๊ย", "5555" (จิกกัดฮาๆ แข่งกันมันส์ๆ ไม่ใช่เกลียดชังจริง)
   - **ห้ามเด็ดขาด**: ห้ามมีคำว่า "ครับ", "ค่ะ", "นะครับ", "นะคะ", "คุณ", "ผม", "ฉัน", "ดิฉัน", "ท่าน"
   - พิมพ์สั้น กระชับ เป็นธรรมชาติเหมือนแชทกลุ่มจริง (คนละ 1-3 ประโยคสั้นๆ ไม่ใช่เรียงความ)
3. **การวางแผนอิสระตามบทบาทลับ (ห้ามโกงข้อมูลนอกบทบาท!)**:
   - **WEREWOLF / WOLF_CUB / HUMAN_WOLF** [ฝูงหมาป่าคือ: ${wolvesNames} | ประวัติการล่า: ${JSON.stringify(wolfKillHistory)}]: รู้จักกันเอง คิดแผนเนียนๆ เองได้อิสระ — โกหกป้ายสีชาวบ้าน, แอบช่วยเพื่อนหมาป่าแบบไม่ให้โจ่งแจ้ง, หรือถ้าจนมุมสามารถ "แกล้งเคลมเป็นหมอดู/บอดี้การ์ด" เพื่อปั่นวงได้! (พิเศษ: HUMAN_WOLF รู้ว่าหมอดูส่องตัวเองจะเห็นเป็นชาวบ้าน จึงกล้าท้าให้หมอดูส่อง!)
   - **SEER (เทพพยากรณ์)**: รู้เฉพาะผลส่องของตัวเอง (${JSON.stringify(seerKnowledge)}) — ตัดสินใจเองอย่างฉลาดว่าจะซ่อนตัวก่อนหรือเปิดการ์ดแฉตอนไหนเพื่อช่วยหมู่บ้าน! ห้ามโกงรู้ว่า HUMAN_WOLF เป็นหมาป่าถ้าผลส่องเป็น false
   - **BODYGUARD (บอดี้การ์ด)**: รู้เฉพาะประวัติการคุ้มกันของตัวเอง (${JSON.stringify(bodyguardKnowledge)}) — ตัดสินใจเองว่าจะเก็บตัวเงียบหรือใบ้/เปิดเผยเพื่อช่วยคนที่ตัวเองเซฟไว้
   - **BEGGAR (ยาจก/คนงี่เง่า)**: สามารถแกล้งพูดกวนๆ หรือล่อเป้าให้คนสงสัยแบบเนียนๆ (แต่อย่าเฉลยตรงๆ ว่าตัวเองเป็นยาจก)
   - **VILLAGER (ชาวบ้าน)**: ไม่รู้บทบาทใคร วิเคราะห์สดจากคำพูด พิรุธ เหตุการณ์ตาย และประวัติการโหวตจริง
4. **บทสนทนาโต้ตอบกันเองแบบมีชีวิต (Multi-Bot Back-and-Forth)**:
   - สร้างคำพูดเฉพาะจากบอท AI ที่ยังมีชีวิตอยู่เท่านั้น (${aiIdsList}) — ห้ามสร้างคำพูดแทนผู้เล่นคนจริงเด็ดขาด
   - ให้บอทโต้ตอบกันเองเป็นลำดับต่อกันจริง! เช่น บอทคนที่ 2 เถียง/สวนกลับ/เห็นด้วยกับสิ่งที่บอทคนที่ 1 หรือผู้เล่นคนจริงเพิ่งพิมพ์ไปสดๆ ร้อนๆ และถ้าบอทตัวไหนถูกพาดพิงหรือถูกกล่าวหาในแชท ให้บอทตัวนั้นรีบโผล่มาแก้ตัวหรือด่าสวนตามนิสัยของมันทันที!`;

      const humanDisplayName = speakerName || "ผู้เล่น";
      const targetMsgCount = Math.min(aliveAI.length, mode === "INITIAL_DAY" ? 5 : 4);
      const minMsgCount = Math.min(aliveAI.length, mode === "INITIAL_DAY" ? 3 : 2);

      let userPrompt = "";
      if (mode === "REPLY_TO_HUMAN") {
        userPrompt = `=== กลางวันวันที่ ${dayNumber} (โต้ตอบคำพูดล่าสุดของผู้เล่นคนจริง + เถียงกันต่อ) ===
ผู้เล่นที่ยังมีชีวิต (${aliveAll.length} คน):
${aliveDescriptions}

ผู้เสียชีวิตแล้ว:
${deadDescriptions}

ประวัติการโหวตที่ผ่านมา:
${voteHistoryText}

แชทล่าสุดในห้อง (15 ข้อความล่าสุด):
${(recentTranscript || []).slice(-15).join("\n")}

🔥 ล่าสุด "${humanDisplayName}" เพิ่งพิมพ์ในแชทว่า: "${humanMessage}"

ให้บอท AI ${minMsgCount}-${targetMsgCount} ตัว (เลือกตัวที่ถูกพาดพิงก่อน + ตัวที่มีนิสัยชอบสวน/วิเคราะห์) โต้ตอบคำพูดของ "${humanDisplayName}" และโต้เถียงต่อยอดกันเองตามบทบาทลับและนิสัยเฉพาะตัวของแต่ละคน (1-3 ประโยคสั้นๆ ดิบๆ ฮาๆ ภาษา กู-มึง ห้ามมีคำสุภาพ!)`;
      } else if (mode === "CONTINUE_DEBATE") {
        userPrompt = `=== กลางวันวันที่ ${dayNumber} (ถกเถียงเดือดต่อเนื่องก่อนลงคะแนนโหวต) ===
ผู้เล่นที่ยังมีชีวิต (${aliveAll.length} คน):
${aliveDescriptions}

ผู้เสียชีวิตแล้ว:
${deadDescriptions}

ประวัติการโหวตที่ผ่านมา:
${voteHistoryText}

แชทล่าสุดในห้อง (15 ข้อความล่าสุด):
${(recentTranscript || []).slice(-15).join("\n")}

ให้บอท AI ${minMsgCount}-${targetMsgCount} ตัว เถียงกันต่อ จี้พิรุธจากแชทล่าสุด แก้ตัวถ้าโดนพาดพิง หรือจับโป๊ะจากประวัติโหวต โดยให้บอทตัวหลังโต้ตอบคำพูดบอทตัวก่อนหน้าด้วย (1-3 ประโยคสั้นๆ ตรงนิสัยและเพศของแต่ละตัว ภาษา กู-มึง ล้วนๆ!)`;
      } else {
        userPrompt = `=== เช้าวันที่ ${dayNumber} (เพิ่งตื่นจากกลางคืน) ===
เหตุการณ์เมื่อคืน: ${
          nightVictimNames && nightVictimNames.length > 0
            ? `${nightVictimNames.join(" และ ")} โดนหมาป่าฆ่าตายเมื่อคืนนี้!${doubleKillNextNight ? " (ลูกหมาป่าตายด้วย คืนหน้าหมาป่าจะฆ่าได้ 2 ศพ!)" : ""}`
            : "เมื่อคืนสงบสุข ไม่มีใครตายเลย! (บอดี้การ์ดเซฟถูกคน)"
        }

ผู้เล่นที่ยังมีชีวิต (${aliveAll.length} คน):
${aliveDescriptions}

ผู้เสียชีวิตแล้ว:
${deadDescriptions}

ประวัติการโหวตที่ผ่านมา:
${voteHistoryText}

แชทล่าสุดก่อนหน้า:
${(recentTranscript || []).slice(-15).join("\n") || "(เพิ่งเริ่มวันแรก)"}

ให้บอท AI ${minMsgCount}-${targetMsgCount} ตัว เปิดวงคุยกันสดๆ หลังรู้ข่าวเมื่อคืน โดยให้แต่ละตัวแสดงปฏิกิริยา คิดวิเคราะห์ โยนขี้ ปั่นวง หรือโต้เถียงสวนกันไปมาตามเพศ นิสัยเฉพาะตัว และบทบาทลับของตัวเอง (1-3 ประโยคสั้นๆ ภาษา กู-มึง ล้วนๆ ห้ามมีคำสุภาพ!)`;
      }

      const result = await generateStructuredAIJson({
        tier: "primary",
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
        jsonHint: `{ "messages": [ { "speakerId": "ai-1", "speakerName": "ชื่อบอท", "text": "ข้อความภาษาเพื่อนสนิท กู-มึง 1-3 ประโยค", "tone": "อารมณ์สั้นๆ เช่น หัวร้อน/ปั่นวง/จับพิรุธ" } ] }`,
      });

      return res.json({
        ok: true,
        data: result.data,
        modelUsed: result.modelUsed,
        aliveAIIds: aliveAI.map((a: any) => a.id),
      });
    } catch (error: any) {
      console.error("AI discuss error:", error?.message || error);
      return res.status(503).json({
        ok: false,
        error: error?.message || "LLM API ไม่พร้อมใช้งานชั่วคราว",
      });
    }
  });

  // Endpoint 2: 100% Autonomous AI Voting Decisions & In-Character Reasons
  app.post("/api/werewolf/vote", async (req, res) => {
    try {
      const {
        roomId,
        dayNumber,
        players: reqPlayers,
        seerKnowledge: reqSeerKnowledge,
        bodyguardKnowledge: reqBgKnowledge,
        wolfKillHistory: reqWolfHistory,
        voteHistory: reqVoteHistory,
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
      const wolfKillHistory = Array.isArray(authSnap?.wolfKillHistory)
        ? authSnap.wolfKillHistory
        : reqWolfHistory || [];
      const voteHistory = Array.isArray(authSnap?.voteHistory)
        ? authSnap.voteHistory
        : reqVoteHistory || [];

      const aliveAll = players.filter((p: any) => p.alive);
      const deadAll = players.filter((p: any) => !p.alive);
      const eligibleAI = aliveAll.filter(
        (p: any) => !p.isHuman && p.canVote !== false
      );

      if (eligibleAI.length === 0) {
        return res.json({ ok: true, data: { votes: [] } });
      }

      const systemPrompt = `คุณคือสมองอิสระของบอท AI แต่ละตัวในช่วง "ลงคะแนนโหวตประหาร" เกม Ultimate Werewolf ภาษาไทย
กฎเหล็กของการโหวต:
1. บอท AI แต่ละตัวตัดสินใจโหวตด้วยตรรกะ อารมณ์ นิสัยเฉพาะตัว (Archetype) และบทบาทลับของตัวเองอย่างอิสระจากแชทวันนี้และประวัติโหวตเก่า (ห้ามลอกโหวตตามผู้เล่นคนจริงแบบไร้เหตุผล)
2. ห้ามโหวตตัวเองเด็ดขาด และไม่โหวตคนที่เปิดการ์ดเป็นยาจกไปแล้ว
3. ฝ่ายหมาป่า (WEREWOLF / WOLF_CUB / HUMAN_WOLF) [ประวัติล่า: ${JSON.stringify(wolfKillHistory)}]: ห้ามโหวตพวกเดียวกันเองเด็ดขาด (ยกเว้นจำเป็นสุดๆ ที่เพื่อนหมาป่าโดนแฉขาดลอยแล้วอยากเนียน) ให้โหวตชาวบ้านที่เป็นภัยหรือกำลังถูกวงเพ่งเล็ง
4. เทพพยากรณ์ (SEER): รู้ผลส่อง (${JSON.stringify(seerKnowledge)}) — ถ้าส่องเจอใครเป็นหมาป่าให้โหวตคนนั้นทันที และหลีกเลี่ยงโหวตคนที่ส่องเห็นเป็นชาวบ้าน (ห้ามโกงรู้ตัวจริงของ HUMAN_WOLF ถ้าผลส่องเป็น false)
5. บอดี้การ์ด (BODYGUARD): ใช้ข้อมูลคนที่คุ้มกัน (${JSON.stringify(bodyguardKnowledge)}) ประกอบการตัดสินใจ
6. ถ้าบอทตัวไหนลังเลหรือข้อมูลไม่พอจริงๆ สามารถเลือกไม่โหวตโดยส่ง targetId เป็น "__ABSTAIN__" ได้
7. เหตุผลการโหวต (reason) ต้องเขียนสดๆ 1 ประโยคสั้นๆ ให้ตรงกับเพศและนิสัยเฉพาะตัวของบอทตัวนั้นๆ ใช้ภาษาแก๊งเพื่อนสนิท "กู-มึง / ไอ้... / อี..." ห้ามมีคำสุภาพ (ห้ามมี ครับ/ค่ะ/คุณ/ผม/ฉัน/นะครับ เด็ดขาด!)`;

      const userPrompt = `=== กลางวันวันที่ ${dayNumber} — ลงมติโหวตประหาร ===
ผู้เล่นที่ยังมีชีวิตอยู่:
${aliveAll.map(formatPlayerProfileLine).join("\n")}

ผู้เสียชีวิตแล้ว:
${deadAll.length > 0 ? deadAll.map(formatDeadPlayerLine).join("\n") : "ยังไม่มี"}

ประวัติโหวตรอบก่อนหน้า:
${formatVoteHistoryBlock(voteHistory, [])}

แชทล่าสุดในสภา (15 ข้อความล่าสุด):
${(recentTranscript || []).slice(-15).join("\n")}

จงระบุการโหวตของบอท AI ที่มีสิทธิ์โหวตครบทุกตัว (${eligibleAI.map((p: any) => `${p.name} [${p.id} · ${p.personaLabel}]`).join(", ")}) พร้อมเหตุผลสดๆ ตรงคาแรกเตอร์`;

      const result = await generateStructuredAIJson({
        tier: "primary",
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
        jsonHint: `{ "votes": [ { "voterId": "ai-1", "targetId": "ai-2", "reason": "เหตุผลสดๆ 1 ประโยคภาษาเพื่อนซี้ตรงนิสัย" } ] }`,
      });

      return res.json({
        ok: true,
        data: result.data,
        modelUsed: result.modelUsed,
      });
    } catch (error: any) {
      console.error("AI vote error:", error?.message || error);
      return res.status(503).json({
        ok: false,
        error: error?.message || "LLM API ไม่สามารถประมวลผลโหวต AI ได้ในขณะนี้",
      });
    }
  });

  // Endpoint 3: 100% Autonomous Post-Game Roasting & Candid Debrief (All AI Bots)
  app.post("/api/werewolf/postgame", async (req, res) => {
    try {
      const {
        roomId,
        winner,
        reasonThai,
        dayCount,
        players: reqPlayers,
        recentTranscript,
        seerKnowledge: reqSeerKnowledge,
        bodyguardKnowledge: reqBgKnowledge,
        wolfKillHistory: reqWolfHistory,
        voteHistory: reqVoteHistory,
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
      const wolfKillHistory = Array.isArray(authSnap?.wolfKillHistory)
        ? authSnap.wolfKillHistory
        : reqWolfHistory || [];
      const voteHistory = Array.isArray(authSnap?.voteHistory)
        ? authSnap.voteHistory
        : reqVoteHistory || [];

      const aiPlayers = players.filter((p: any) => !p.isHuman);
      if (aiPlayers.length === 0) {
        return res.json({ ok: true, data: { reactions: [] } });
      }

      const rosterSummary = players
        .map((p: any) => {
          const status = p.alive
            ? "รอดชีวิต"
            : p.deathCause === "WOLF_KILL"
            ? `โดนหมาป่าฆ่าคืนที่ ${p.deathDay || "?"}`
            : p.deathCause === "DAY_EXECUTION"
            ? `โดนโหวตประหารวันที่ ${p.deathDay || "?"}`
            : "เสียชีวิต";
          const g = p.gender === "M" ? "ชาย" : p.gender === "F" ? "หญิง" : "คนจริง";
          return `- ID: ${p.id} | ชื่อ: ${p.name} (${g}${p.isHuman ? "" : ` · นิสัย: ${p.archetypeName || p.personaLabel}`}) | บทบาทจริง: ${p.role} | สถานะ: ${status}`;
        })
        .join("\n");

      const systemPrompt = `เกม Ultimate Werewolf จบลงแล้วและทุกคนหงายการ์ดเฉลยบทบาทจริงทั้งหมดบนโต๊ะแล้ว!
จงสร้างบทพูด "เผาเพื่อน / ด่ากราด / ขิงยับ / ช็อกตาค้างหลังจบเกม" ของบอท AI ครบทุกตัว (ทั้งที่รอดและที่ตายไปแล้ว) เหมือนแก๊งเพื่อนสนิท 10 ปีในวงเหล้าหรือดิสคอร์ดที่เพิ่งจบเกมแล้วระเบิดอารมณ์ใส่กันทันที!

กฎเหล็ก 100%:
1. **ตรงเพศและนิสัยเฉพาะตัว (Archetype) ทุกตัว!** เช่น สายบวกหัวร้อนจะด่าเดือดสุด, สายปั่นขี้แกล้งจะหัวเราะเยาะ 5555, สายวิเคราะห์จะบ่นตรรกะเพื่อน, สายปากแจ๋วจะจิกกัดยับ, สายแอ๊บใสซื่อจะขิงความเนียนหรือแกล้งทำเป็นช็อก
2. **ภาษาเพื่อนสนิทดิบๆ ล้วนๆ**: ใช้เฉพาะ "กู", "มึง", "พวกมึง", "ไอ้[ชื่อผู้ชาย]", "อี[ชื่อผู้หญิง]" พร้อมสแลงฮาๆ ("5555", "เชี่ย", "สัส", "แม่ง", "ควายเอ๊ย", "โง่ชิบหาย", "โคตรเหลี่ยม", "เนียนเหี้ยๆ", "หลอกแดกทั้งวง") — **ห้ามมีคำสุภาพ (ครับ/ค่ะ/คุณ/ผม/ฉัน/นะครับ) แม้แต่คำเดียว!**
3. **อ้างอิงเหตุการณ์จริงในเกมนี้**: พาดพิงชื่อคนจริงและเพื่อนบอท, จังหวะโหวตพลาดจริง, จังหวะบอดี้การ์ดเซฟถูก/เซฟผิดจริง, จังหวะหมอดูส่องโดนหมาป่าหรือโดนหมาป่ามนุษย์หลอกสแกนจริง (1-2 ประโยคสั้นๆ แสบๆ ฮาๆ ไม่ซ้ำกันเลย)
4. สร้างให้ครบทุกตัวในรายชื่อ AI นี้: ${aiPlayers.map((p: any) => `${p.name} [${p.id}]`).join(", ")}`;

      const userPrompt = `=== สรุปผลเกม (จบวันที่ ${dayCount || 1}) ===
ฝ่ายที่ชนะ: ${winner === "VILLAGE" ? "ฝ่ายชาวบ้านชนะ" : "ฝ่ายมนุษย์หมาป่าชนะ"}
รายละเอียด: ${reasonThai || ""}

เฉลยบทบาทและนิสัยทุกคนบนโต๊ะ:
${rosterSummary}

บันทึกเทพพยากรณ์: ${JSON.stringify(seerKnowledge)}
บันทึกบอดี้การ์ด: ${JSON.stringify(bodyguardKnowledge)}
ประวัติการล่าของฝูงหมาป่า: ${JSON.stringify(wolfKillHistory)}
ประวัติการโหวตทั้งเกม:
${formatVoteHistoryBlock(voteHistory, [])}

เหตุการณ์และแชทสำคัญในเกม:
${(recentTranscript || []).slice(-18).join("\n")}

จงสร้างคำพูดเปิดใจเผาเพื่อน/ขิงยับหลังจบเกมของบอท AI ครบทุกตัว พร้อม moodTag สั้นๆ และ sentiment (praise | roast | shock | proud)`;

      const result = await generateStructuredAIJson({
        tier: "primary",
        maxOutputTokens: 1600,
        systemInstruction: systemPrompt,
        userPrompt,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reactions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  speakerId: { type: Type.STRING },
                  speakerName: { type: Type.STRING },
                  moodTag: { type: Type.STRING },
                  sentiment: { type: Type.STRING },
                  text: { type: Type.STRING },
                },
                required: ["speakerId", "speakerName", "moodTag", "sentiment", "text"],
              },
            },
          },
          required: ["reactions"],
        },
        jsonHint: `{ "reactions": [ { "speakerId": "ai-1", "speakerName": "ชื่อบอท", "moodTag": "ขิงยับ/ด่ากราด", "sentiment": "roast", "text": "ข้อความสดๆ หลังจบเกม 1-2 ประโยค" } ] }`,
      });

      return res.json({
        ok: true,
        data: result.data,
        modelUsed: result.modelUsed,
      });
    } catch (error: any) {
      console.error("AI postgame error:", error?.message || error);
      return res.status(503).json({
        ok: false,
        error: error?.message || "LLM API ไม่สามารถสร้างวงเม้าท์หลังจบเกมได้ในขณะนี้",
      });
    }
  });

  // Endpoint 4: 100% Autonomous Private Werewolf Pack Chat & Target Signal Alignment
  app.post("/api/werewolf/wolf-chat", async (req, res) => {
    try {
      const {
        roomId,
        nightNumber,
        aiWolfId,
        humanWolfName,
        humanMessage,
        humanSignaledTargetId,
        mode, // 'OPEN_NIGHT' | 'HUMAN_SIGNAL' | 'HUMAN_CHAT'
        players: reqPlayers,
        wolfKillHistory: reqWolfHistory,
        recentWolfTranscript,
        recentPublicTranscript,
      } = req.body;

      const authSnap =
        roomId && rooms.get(String(roomId).trim().toUpperCase())?.gameSnapshot;
      const players = Array.isArray(authSnap?.players)
        ? authSnap.players
        : reqPlayers || [];
      const wolfKillHistory = Array.isArray(authSnap?.wolfKillHistory)
        ? authSnap.wolfKillHistory
        : reqWolfHistory || [];

      const aiWolf = players.find((p: any) => p.id === aiWolfId && p.alive && !p.isHuman);
      const alivePrey = players.filter(
        (p: any) => p.alive && !isWolfRole(p.role)
      );

      if (!aiWolf || alivePrey.length === 0) {
        return res.status(400).json({ ok: false, error: "ไม่พบเพื่อนหมาป่า AI หรือเหยื่อที่ยังมีชีวิต" });
      }

      const signaledPrey = humanSignaledTargetId
        ? alivePrey.find((p: any) => p.id === humanSignaledTargetId)
        : null;

      const aiWolfThaiRole =
        aiWolf.role === "WOLF_CUB"
          ? "ลูกหมาป่า"
          : aiWolf.role === "HUMAN_WOLF"
          ? "หมาป่ามนุษย์ (หมอดูส่องเห็นเป็นชาวบ้าน)"
          : "พ่อหมาป่า";

      const aiGenderThai = aiWolf.gender === "M" ? "ชาย" : "หญิง";

      const systemPrompt = `คุณคือ "${aiWolf.name}" (เพศ: ${aiGenderThai} | นิสัยเฉพาะตัว: ${aiWolf.archetypeName || aiWolf.personaLabel} — ${aiWolf.personaTrait}) รับบทบาทลับ "${aiWolfThaiRole}" กำลังกระซิบวางแผนฆ่าเหยื่อแบบลับเฉพาะ 2 คนกับเพื่อนร่วมฝูงหมาป่า "${humanWolfName}" (ชาวบ้านไม่มีทางเห็นแชทนี้)
กฎเหล็ก:
1. คิดวิเคราะห์เลือกเหยื่อเองอย่างมีเหตุผลตามบทสนทนาในสภา (เช่น ใครพูดคมน่าจะเป็นหมอดู/บอดี้การ์ด ใครปากดีน่าเก็บก่อน) และพูดคุยให้ตรงกับเพศและนิสัยเฉพาะตัวของ "${aiWolf.name}"
2. ใช้ภาษาเพื่อนสนิท "กู-มึง" แบบดิบๆ กวนๆ สั้นกระชับ 1-2 ประโยค ห้ามมีคำสุภาพเด็ดขาด (ห้ามมี ครับ/ค่ะ/คุณ/ผม/ฉัน/นะครับ)!
3. การสังหารต้องตกลงเลือกเหยื่อคนเดียวกัน (suggestedTargetId ต้องเป็น ID ของเหยื่อฝั่งชาวบ้านที่ยังมีชีวิตอยู่ในรายชื่อเท่านั้น ห้ามเลือกหมาป่าด้วยกัน)
4. ถ้า "${humanWolfName}" ส่งซิกเลือกเหยื่อหรือเสนอชื่อมาแล้ว ส่วนใหญ่ให้ตกลงตามเพื่อนหรือแสดงความเห็นสั้นๆ แล้วส่งซิกให้ตรงกันเพื่อล็อกเป้าได้ไว`;

      const modeInstruction =
        mode === "OPEN_NIGHT"
          ? `เพิ่งเข้าสู่คืนที่ ${nightNumber || 1} — ให้ "${aiWolf.name}" เปิดแชทลับชวน "${humanWolfName}" วางแผนว่าจะเชือดใครคืนนี้ พร้อมส่งซิก suggestedTargetId แรกที่เล็งไว้`
          : mode === "HUMAN_SIGNAL"
          ? `"${humanWolfName}" เพิ่งกดส่งซิกเล็งเป้าหมายไปที่ ${signaledPrey ? `${signaledPrey.name} [${signaledPrey.id}]` : "เหยื่อ"} — ให้ "${aiWolf.name}" ตอบรับ/แสดงความเห็นตามนิสัยแล้วส่งซิก suggestedTargetId`
          : `"${humanWolfName}" พิมพ์กระซิบมาว่า: "${humanMessage || ""}" — ให้ "${aiWolf.name}" ตอบกลับแบบเพื่อนร่วมฝูงพร้อมระบุ suggestedTargetId`;

      const userPrompt = `คืนที่ ${nightNumber || 1} — แชทลับฝูงหมาป่า
รายชื่อเหยื่อฝั่งชาวบ้านที่ยังมีชีวิต:
${alivePrey.map((p: any) => `- ID: ${p.id} | ชื่อ: ${p.name} (${p.gender === "M" ? "ชาย" : p.gender === "F" ? "หญิง" : "คนจริง"}${p.personaLabel ? ` · ${p.personaLabel}` : ""})`).join("\n")}

ประวัติการล่าของฝูงหมาป่าที่ผ่านมา: ${JSON.stringify(wolfKillHistory)}
เพื่อนหมาป่า "${humanWolfName}" กำลังส่งซิกเล็ง: ${signaledPrey ? `${signaledPrey.name} [${signaledPrey.id}]` : "ยังไม่เลือก"}
แชทลับฝูงหมาป่าล่าสุด:
${(recentWolfTranscript || []).slice(-8).join("\n") || "(ยังไม่มี)"}
แชทสภาล่าสุด:
${(recentPublicTranscript || []).slice(-10).join("\n") || "(เพิ่งคืนแรก)"}

${modeInstruction}`;

      const result = await generateStructuredAIJson({
        tier: "fast",
        maxOutputTokens: 400,
        systemInstruction: systemPrompt,
        userPrompt,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING },
            suggestedTargetId: { type: Type.STRING },
          },
          required: ["text", "suggestedTargetId"],
        },
        jsonHint: `{ "text": "ข้อความกระซิบสดๆ 1-2 ประโยคภาษา กู-มึง", "suggestedTargetId": "id ของเหยื่อฝั่งชาวบ้าน" }`,
      });

      return res.json({
        ok: true,
        data: result.data,
        modelUsed: result.modelUsed,
      });
    } catch (error: any) {
      console.error("AI wolf-chat error:", error?.message || error);
      return res.status(503).json({
        ok: false,
        error: error?.message || "LLM API ไม่สามารถตอบแชทลับฝูงหมาป่าได้ในขณะนี้",
      });
    }
  });

  // Endpoint 5: Autonomous AI Night Action Planning (Wolves, Seer, Bodyguard pick targets via LLM)
  app.post("/api/werewolf/night-plan", async (req, res) => {
    try {
      const {
        roomId,
        nightNumber,
        doubleKillActive,
        lastProtectedId,
        players: reqPlayers,
        seerKnowledge: reqSeerKnowledge,
        bodyguardKnowledge: reqBgKnowledge,
        wolfKillHistory: reqWolfHistory,
        voteHistory: reqVoteHistory,
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
      const wolfKillHistory = Array.isArray(authSnap?.wolfKillHistory)
        ? authSnap.wolfKillHistory
        : reqWolfHistory || [];
      const voteHistory = Array.isArray(authSnap?.voteHistory)
        ? authSnap.voteHistory
        : reqVoteHistory || [];

      const alive = players.filter((p: any) => p.alive);
      const aliveWolves = alive.filter((p: any) => isWolfRole(p.role));
      const needsAIWolf = aliveWolves.length > 0 && aliveWolves.every((w: any) => !w.isHuman);
      const aiSeer = alive.find((p: any) => p.role === "SEER" && !p.isHuman);
      const aiBodyguard = alive.find((p: any) => p.role === "BODYGUARD" && !p.isHuman);

      if (!needsAIWolf && !aiSeer && !aiBodyguard) {
        return res.json({ ok: true, data: {} });
      }

      const alivePrey = alive.filter((p: any) => !isWolfRole(p.role));
      const killCount = doubleKillActive ? 2 : 1;

      const systemPrompt = `คุณคือสมองวางแผนยามวิกาลของบอท AI ในเกม Ultimate Werewolf ภาษาไทย (คืนที่ ${nightNumber || 1})
จงตัดสินใจเลือกเป้าหมายให้เฉพาะบทบาทที่เป็นบอท AI อย่างมีกลยุทธ์จากแชทและประวัติเกม:
- ถ้าต้องเลือกเหยื่อให้ฝูงหมาป่า AI (จำนวน ${killCount} คน): เลือก ID จากรายชื่อเหยื่อฝั่งชาวบ้านที่ยังมีชีวิตเท่านั้น (ห้ามเลือกหมาป่าด้วยกัน) เล็งคนที่พูดวิเคราะห์คมๆ หรือดูน่าจะเป็นหมอดู/บอดี้การ์ด
- ถ้าต้องเลือกเป้าหมายให้เทพพยากรณ์ AI (${aiSeer ? `${aiSeer.name} [${aiSeer.id}]` : "ไม่ต้องเลือก"}): เลือก ID ผู้เล่นที่ยังมีชีวิตที่ไม่ใช่ตัวเอง และยังไม่เคยส่องมาก่อน (ผลส่องเดิม: ${JSON.stringify(seerKnowledge)})
- ถ้าต้องเลือกเป้าหมายให้บอดี้การ์ด AI (${aiBodyguard ? `${aiBodyguard.name} [${aiBodyguard.id}]` : "ไม่ต้องเลือก"}): เลือก ID ผู้เล่นที่ยังมีชีวิต (คุ้มกันตัวเองได้) แต่ **ห้ามซ้ำกับคนที่คุ้มกันคืนที่แล้ว** (${lastProtectedId || "ยังไม่มี"}) เลือกปกป้องคนที่เสี่ยงโดนหมาป่าเก็บที่สุด`;

      const userPrompt = `คืนที่ ${nightNumber || 1} — วางแผนแอ็กชันยามวิกาลของบอท AI
ผู้เล่นที่ยังมีชีวิต:
${alive.map(formatPlayerProfileLine).join("\n")}

เหยื่อฝั่งชาวบ้านสำหรับหมาป่า: ${alivePrey.map((p: any) => `${p.name} [${p.id}]`).join(", ")}
ประวัติหมาป่าล่าคืนก่อน: ${JSON.stringify(wolfKillHistory)}
ประวัติบอดี้การ์ดคุ้มกัน: ${JSON.stringify(bodyguardKnowledge)}
ประวัติโหวต:
${formatVoteHistoryBlock(voteHistory, [])}
แชทล่าสุดในห้อง:
${(recentTranscript || []).slice(-12).join("\n") || "(คืนแรก ยังไม่มีแชท)"}

งานที่ต้องเลือก:
1. wolfTargetIds: ${needsAIWolf ? `เลือก ${killCount} ID จากเหยื่อฝั่งชาวบ้าน` : "ส่งอาร์เรย์ว่าง []"}
2. seerTargetId: ${aiSeer ? `เลือก 1 ID (ห้ามเป็น ${aiSeer.id})` : 'ส่งสตริงว่าง ""'}
3. bodyguardTargetId: ${aiBodyguard ? `เลือก 1 ID (ห้ามเป็น ${lastProtectedId || "ไม่มี"})` : 'ส่งสตริงว่าง ""'}`;

      const result = await generateStructuredAIJson({
        tier: "fast",
        maxOutputTokens: 350,
        systemInstruction: systemPrompt,
        userPrompt,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            wolfTargetIds: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            seerTargetId: { type: Type.STRING },
            bodyguardTargetId: { type: Type.STRING },
          },
          required: ["wolfTargetIds", "seerTargetId", "bodyguardTargetId"],
        },
        jsonHint: `{ "wolfTargetIds": ["id1"], "seerTargetId": "id2", "bodyguardTargetId": "id3" }`,
      });

      return res.json({
        ok: true,
        data: result.data,
        modelUsed: result.modelUsed,
      });
    } catch (error: any) {
      console.error("AI night-plan error:", error?.message || error);
      return res.status(503).json({
        ok: false,
        error: error?.message || "LLM API ไม่สามารถวางแผนกลางคืนได้ในขณะนี้",
      });
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
