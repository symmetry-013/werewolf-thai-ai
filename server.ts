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
let discoveredGeminiModelsCache: { keyPrefix: string; models: string[]; fetchedAt: number } | null = null;

async function discoverGeminiActiveModels(apiKey: string): Promise<string[]> {
  const keyPrefix = apiKey.slice(0, 10);
  if (
    discoveredGeminiModelsCache &&
    discoveredGeminiModelsCache.keyPrefix === keyPrefix &&
    Date.now() - discoveredGeminiModelsCache.fetchedAt < 10 * 60 * 1000
  ) {
    return discoveredGeminiModelsCache.models;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      { signal: controller.signal }
    );
    if (!res.ok) return [];
    const json: any = await res.json();
    const rawList: any[] = Array.isArray(json?.models) ? json.models : [];
    const valid = rawList
      .filter((m) => {
        const methods: string[] = Array.isArray(m?.supportedGenerationMethods)
          ? m.supportedGenerationMethods
          : [];
        if (!methods.includes("generateContent")) return false;
        const name = String(m?.name || "").replace(/^models\//, "").toLowerCase();
        if (!name.startsWith("gemini-")) return false;
        // Strictly exclude deprecated and non-text-chat models
        if (
          name.startsWith("gemini-1.") ||
          name.startsWith("gemini-2.0") ||
          name === "gemini-pro" ||
          name.includes("embedding") ||
          name.includes("image") ||
          name.includes("tts") ||
          name.includes("live") ||
          name.includes("audio") ||
          name.includes("transcribe") ||
          name.includes("translate") ||
          name.includes("robotics") ||
          name.includes("computer-use") ||
          name.includes("deep-research") ||
          name.includes("decision") ||
          name.includes("omni")
        ) {
          return false;
        }
        return true;
      })
      .map((m) => String(m.name).replace(/^models\//, ""));

    const scoreModel = (name: string): number => {
      const n = name.toLowerCase();
      if (n === "gemini-4-hydrogen") return 100;
      if (n === "gemini-3.1-flash-lite") return 96;
      if (n.includes("flash-lite")) return 90;
      if (n.includes("flash") && !n.includes("thinking")) return 85;
      if (n.startsWith("gemini-4-")) return 80;
      if (n.startsWith("gemini-3")) return 75;
      if (n.startsWith("gemini-2.5")) return 70;
      return 40;
    };

    const sorted = Array.from(new Set(valid)).sort((a, b) => scoreModel(b) - scoreModel(a));
    discoveredGeminiModelsCache = { keyPrefix, models: sorted, fetchedAt: Date.now() };
    if (sorted.length > 0) {
      console.log(`[Gemini] Auto-discovered accessible models: ${sorted.slice(0, 6).join(", ")}`);
    }
    return sorted;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

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
  const baseModels = preferPrimary
    ? [cfg.primaryModel, cfg.fastModel, "gemini-4-hydrogen", "gemini-3.1-flash-lite"]
    : [cfg.fastModel, cfg.primaryModel, "gemini-3.1-flash-lite", "gemini-4-hydrogen"];

  const now = Date.now();
  const baseUnique = Array.from(new Set(baseModels.filter(Boolean)));
  const allBaseCooledDown = baseUnique.every(
    (m) => (geminiModelCooldownUntil.get(m) || 0) > now
  );

  // If all default models hit 404/cooldown (e.g. external API key on Render), auto-discover active models
  let modelsToTry = [...baseUnique];
  if (allBaseCooledDown || (discoveredGeminiModelsCache && discoveredGeminiModelsCache.models.length > 0)) {
    const discovered = await discoverGeminiActiveModels(cfg.apiKey);
    modelsToTry = [...baseUnique, ...discovered];
  }

  const runGeminiModel = async (modelName: string, timeoutMs: number) => {
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
      timeoutMs,
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
  };

  const uniqueModels = Array.from(new Set(modelsToTry.filter(Boolean)));
  const readyModels = uniqueModels.filter(
    (m) => (geminiModelCooldownUntil.get(m) || 0) <= Date.now()
  );
  const candidateModels = readyModels.length > 0 ? readyModels : uniqueModels;

  let lastErr: any = null;
  let sawNotFound = false;
  const triedSet = new Set<string>();

  const tryList = async (list: string[]) => {
    for (let idx = 0; idx < list.length; idx++) {
      const modelName = list[idx];
      if (triedSet.has(modelName)) continue;
      triedSet.add(modelName);

      const hasMoreFallbacks =
        idx < list.length - 1 || Boolean(params.hasBackupProviders);
      const attemptTimeoutMs = hasMoreFallbacks
        ? Math.min(AI_TIMEOUT_MS, 15000)
        : AI_TIMEOUT_MS;

      try {
        return await runGeminiModel(modelName, attemptTimeoutMs);
      } catch (err: any) {
        lastErr = err;
        const errMsg = String(err?.message || err);
        const lowerErr = errMsg.toLowerCase();
        if (lowerErr.includes("404") || lowerErr.includes("not found")) {
          sawNotFound = true;
          geminiModelCooldownUntil.set(modelName, Date.now() + 15 * 60 * 1000);
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
    return null;
  };

  const firstPass = await tryList(candidateModels.slice(0, 5));
  if (firstPass) return firstPass;

  // If 404 occurred and we haven't queried /v1beta/models yet, discover live models and retry immediately
  if (sawNotFound) {
    const discovered = await discoverGeminiActiveModels(cfg.apiKey);
    const freshOnes = discovered.filter(
      (m) => !triedSet.has(m) && (geminiModelCooldownUntil.get(m) || 0) <= Date.now()
    );
    if (freshOnes.length > 0) {
      const secondPass = await tryList(freshOnes.slice(0, 4));
      if (secondPass) return secondPass;
    }
  }

  throw lastErr || new Error("Gemini request failed");
}

const groqModelCooldownUntil = new Map<string, number>();
let discoveredGroqModelsCache: { keyPrefix: string; models: string[]; fetchedAt: number } | null = null;

async function discoverGroqChatModels(apiKey: string): Promise<string[]> {
  const keyPrefix = apiKey.slice(0, 10);
  if (
    discoveredGroqModelsCache &&
    discoveredGroqModelsCache.keyPrefix === keyPrefix &&
    Date.now() - discoveredGroqModelsCache.fetchedAt < 10 * 60 * 1000
  ) {
    return discoveredGroqModelsCache.models;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });
    if (!res.ok) return [];
    const json: any = await res.json();
    const rawList: any[] = Array.isArray(json?.data) ? json.data : [];
    const chatIds = rawList
      .filter((m) => m && m.active !== false && typeof m.id === "string")
      .map((m) => String(m.id).trim())
      .filter((id) => {
        const low = id.toLowerCase();
        // Filter out audio, speech, safety guard, and embedding models
        return !(
          low.includes("whisper") ||
          low.includes("tts") ||
          low.includes("guard") ||
          low.includes("embed") ||
          low.includes("moderation") ||
          low.includes("playai") ||
          low.includes("orpheus") ||
          low.includes("distil-whisper") ||
          low.includes("allam")
        );
      });

    // Prioritize fast, high-quality Thai-capable chat models on Groq
    const scoreGroqModel = (id: string): number => {
      const low = id.toLowerCase();
      if (low.includes("llama-3.3-70b")) return 100;
      if (low.includes("llama-4-maverick")) return 96;
      if (low.includes("llama-4-scout")) return 94;
      if (low.includes("gpt-oss-120b")) return 92;
      if (low.includes("qwen3-32b") || low.includes("qwen-qwq")) return 90;
      if (low.includes("kimi-k2")) return 88;
      if (low.includes("llama-3.1-8b-instant")) return 86;
      if (low.includes("gpt-oss-20b")) return 84;
      if (low.includes("llama")) return 75;
      if (low.includes("qwen") || low.includes("gemma") || low.includes("mistral")) return 70;
      if (low.includes("compound")) return 35;
      return 50;
    };

    const sorted = Array.from(new Set(chatIds)).sort(
      (a, b) => scoreGroqModel(b) - scoreGroqModel(a)
    );
    discoveredGroqModelsCache = { keyPrefix, models: sorted, fetchedAt: Date.now() };
    if (sorted.length > 0) {
      console.log(`[Groq] Auto-discovered accessible chat models: ${sorted.slice(0, 6).join(", ")}`);
    }
    return sorted;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

const GROQ_FALLBACK_MODELS = [
  "llama-3.3-70b-versatile",
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3-32b",
];

async function callOpenAICompatibleProvider(params: {
  provider: "openai" | "openrouter" | "groq" | "deepseek";
  systemInstruction: string;
  userPrompt: string;
  jsonHint: string;
  maxOutputTokens?: number;
}): Promise<{ data: any; modelUsed: string }> {
  let endpoint = "";
  let apiKey = "";
  let candidateModels: string[] = [];
  const extraHeaders: Record<string, string> = {};

  if (params.provider === "openai") {
    endpoint = "https://api.openai.com/v1/chat/completions";
    apiKey = (process.env.OPENAI_API_KEY || "").trim();
    candidateModels = [(process.env.OPENAI_MODEL || "gpt-4o-mini").trim()];
  } else if (params.provider === "openrouter") {
    endpoint = "https://openrouter.ai/api/v1/chat/completions";
    apiKey = (process.env.OPENROUTER_API_KEY || "").trim();
    candidateModels = [(process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash").trim()];
    extraHeaders["HTTP-Referer"] = process.env.APP_URL || "https://render.com";
    extraHeaders["X-Title"] = "Ultimate Werewolf Thai";
  } else if (params.provider === "groq") {
    endpoint = "https://api.groq.com/openai/v1/chat/completions";
    apiKey = (process.env.GROQ_API_KEY || "").trim();
    const envGroqModel = (process.env.GROQ_MODEL || "").trim();
    const discovered = await discoverGroqChatModels(apiKey);
    if (discovered.length > 0) {
      // Only try envGroqModel first if it actually exists in the user's Groq account
      candidateModels =
        envGroqModel && discovered.includes(envGroqModel)
          ? [envGroqModel, ...discovered.filter((m) => m !== envGroqModel)]
          : discovered;
    } else {
      candidateModels = Array.from(
        new Set([envGroqModel, ...GROQ_FALLBACK_MODELS].filter(Boolean))
      );
    }
    const now = Date.now();
    const ready = candidateModels.filter(
      (m) => (groqModelCooldownUntil.get(m) || 0) <= now
    );
    candidateModels = (ready.length > 0 ? ready : candidateModels).slice(0, 5);
  } else {
    endpoint = "https://api.deepseek.com/chat/completions";
    apiKey = (process.env.DEEPSEEK_API_KEY || "").trim();
    candidateModels = [(process.env.DEEPSEEK_MODEL || "deepseek-chat").trim()];
  }

  const sendRequest = async (model: string, useJsonResponseFormat: boolean) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const payload: any = {
        model,
        temperature: 0.75,
        max_tokens: params.maxOutputTokens || 900,
        messages: [
          {
            role: "system",
            content: `${params.systemInstruction}\n\nสำคัญมาก: ตอบกลับเป็น JSON ที่ถูกต้องตามโครงสร้างนี้เท่านั้น ห้ามมีคำอธิบายนอก JSON:\n${params.jsonHint}`,
          },
          { role: "user", content: params.userPrompt },
        ],
      };
      if (useJsonResponseFormat) {
        payload.response_format = { type: "json_object" };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...extraHeaders,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        const err: any = new Error(
          `${params.provider}(${model}) HTTP ${res.status}: ${errText.slice(0, 220)}`
        );
        err.status = res.status;
        err.bodyText = errText;
        throw err;
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
  };

  let lastErr: any = null;
  for (const model of candidateModels) {
    try {
      const result = await sendRequest(model, true);
      if (params.provider === "groq") {
        groqModelCooldownUntil.delete(model);
      }
      return result;
    } catch (err: any) {
      lastErr = err;
      const errMsg = String(err?.message || err).toLowerCase();
      // Some Groq/OpenAI-compatible models reject response_format=json_object (HTTP 400); retry cleanly as plain text JSON
      if (
        err?.status === 400 &&
        (errMsg.includes("response_format") ||
          errMsg.includes("json") ||
          errMsg.includes("failed_generation"))
      ) {
        try {
          const retryResult = await sendRequest(model, false);
          if (params.provider === "groq") {
            groqModelCooldownUntil.delete(model);
          }
          return retryResult;
        } catch (retryErr: any) {
          lastErr = retryErr;
        }
      }

      if (params.provider === "groq") {
        if (err?.status === 404 || errMsg.includes("model_not_found") || errMsg.includes("does not exist")) {
          groqModelCooldownUntil.set(model, Date.now() + 15 * 60 * 1000);
        } else if (err?.status === 429 || errMsg.includes("rate_limit")) {
          groqModelCooldownUntil.set(model, Date.now() + 45 * 1000);
        }
        console.warn(`[Groq] ${model} failed: ${String(lastErr?.message || lastErr).slice(0, 180)}`);
      }
    }
  }

  throw lastErr || new Error(`${params.provider} request failed`);
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
  const providerErrors: string[] = [];
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
        const shortMsg = String(err?.message || err).slice(0, 160);
        providerErrors.push(`[${provider}] ${shortMsg}`);
        console.error(`AI provider [${provider}] failed:`, err?.message || err);
      }
    }
  }

  if (providerErrors.length > 1) {
    throw new Error(`ทุก AI Provider ตอบไม่สำเร็จ: ${providerErrors.join(" | ")}`);
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
  "src/components/LineGroupChatFeed.tsx",
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
  activeBotLoopId: number;
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
      activeBotLoopId: 0,
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

function cancelRoomBotLoop(room: RoomState) {
  room.activeBotLoopId += 1;
  broadcastToRoom(room.roomId, {
    type: "BOT_TYPING",
    botId: null,
    name: null,
    isTyping: false,
  });
  broadcastToRoom(room.roomId, {
    type: "BOT_QUEUE_DONE",
    loopId: room.activeBotLoopId,
    cancelled: true,
  });
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
    cancelRoomBotLoop(room);
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
    cancelRoomBotLoop(room);
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
          cancelRoomBotLoop(room);
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
            if (nextPhase !== "DAY_DISCUSSION" && nextPhase !== "DAY_RESULT") {
              cancelRoomBotLoop(room);
            }
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
          cancelRoomBotLoop(room);
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

  // =========================================================================
  // Sequential Rate-Limit-Safe Bot Chat Engine (4-5s Queue + ~500 Token Prompt
  // + Hybrid Day-1 0-Token + Groq 8s -> Gemini -> Local Fallback Bank)
  // =========================================================================

  const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const randomBotDelayMs = () => 4000 + Math.floor(Math.random() * 1001); // 4,000 - 5,000 ms

  const formatThaiCall = (p: any): string => {
    const nick = String(p?.shortName || p?.name || "มึง").replace(/^(ไอ้|อี)/, "");
    if (p?.gender === "F") return `อี${nick}`;
    return `ไอ้${nick}`;
  };

  const formatChatClock = (): string => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const ROLE_THAI_SHORT: Record<string, string> = {
    WEREWOLF: "พ่อหมาป่า",
    WOLF_CUB: "ลูกหมาป่า",
    HUMAN_WOLF: "หมาป่ามนุษย์(หมอดูส่องเห็นเป็นชาวบ้าน)",
    SEER: "เทพพยากรณ์(หมอดู)",
    BODYGUARD: "บอดี้การ์ด",
    BEGGAR: "ยาจก(โดนโหวตจะเปิดการ์ดรอด1ครั้ง)",
    VILLAGER: "ชาวบ้าน",
  };

  // คลังประโยคสำรองตามบุคลิก (4 ชาย + 4 หญิง + 2 Wildcard) ใช้ทั้ง Hybrid Day 1 (0 Token) และ Fallback เมื่อ API ติด Limit
  const LOCAL_FALLBACK_BANK: Record<
    string,
    { tone: string; day1: string[]; fallback: string[] }
  > = {
    M_HOTHEAD: {
      tone: "หัวร้อน",
      day1: [
        "เห้ยเปิดมาก็เดือดเลยเหรอวะ {target} มึงทำหน้าลุกลี้ลุกลนทำไม พูดมา!",
        "เอาจริงดิ ใครแม่งเงียบสุดในวงกูเล็งมึงก่อนเลยนะเว้ย โดยเฉพาะ {target}!",
        "อย่ามัวลีลาพวกมึง ใครเป็นหมาป่าสารภาพมาเลย ไม่งั้นกูไล่บี้ {target} คนแรก!",
      ],
      fallback: [
        "มึงพูดจาแปลกๆ นะ {target} ทำไมรีบโยนขี้จังวะ โคตรมีพิรุธเลยสัส!",
        "กูไม่เชื่อขี้ปากมึงหรอก {target} เลิกแถแล้วตอบมาตรงๆ ดีกว่า!",
        "เห้ยพวกมึงดู {target} ดิ แม่งเหลี่ยมจัด รอบนี้กูว่ามีกลิ่นหมาป่าชัวร์!",
      ],
    },
    M_TROLL: {
      tone: "ปั่นวง",
      day1: [
        "5555 ตื่นกันยังพวกมึง กูว่าหน้าอย่าง {target} นี่แหละหมาป่าตัวพ่อเลย",
        "เอ้าเริ่มเกมปุ๊บ กูขอแทงหวยใส่ {target} ก่อนเลยได้ปะ หน้ามึงดูเหลี่ยมๆ ว่ะ 555",
        "วงนี้เงียบกริบเลยเว้ย สงสัย {target} กำลังคิดมุกโกหกอยู่ชัวร์ 5555",
      ],
      fallback: [
        "เดี๋ยวๆ 5555 {target} มึงรนอะไรขนาดนั้นวะ หางโผล่แล้วมั้งเพื่อน!",
        "กูฮาชิบหาย {target} แถจนสีข้างถลอกหมดแล้วมั้งมึงอ่ะ 555",
        "เอาล่ะพวกมึง กูขอปั่นหน่อยเหอะ {target} แม่งโคตรน่าสงสัยเลยว่ะวันนี้!",
      ],
    },
    M_DETECTIVE: {
      tone: "จับพิรุธ",
      day1: [
        "ใจเย็นพวกมึง วันแรกยังไม่มีข้อมูลชัด แต่กูขอจับตาดู {target} ไว้ก่อนนะ",
        "ลองดูจังหวะคนพูดในวงดีๆ ดิ ใครรีบเปิดก่อนหรือเงียบเกินอย่าง {target} น่าเช็กหมด",
        "อย่าเพิ่งเดามั่ว ฟังเหตุผลทุกคนก่อน โดยเฉพาะ {target} มึงคิดยังไงว่ามาดิ๊",
      ],
      fallback: [
        "กูไล่อ่านแชทดูแล้ว ตรรกะของ {target} แม่งแปลกๆ ว่ะ เหมือนพยายามเบี่ยงประเด็น",
        "สังเกตปะ {target} ไม่ค่อยกล้าชี้ตัวใครเลย แบบนี้มีสิทธิ์เป็นหมาป่าเนียนๆ สูงมาก",
        "เดี๋ยวลองเช็กคำพูด {target} อีกรอบดิ กูว่าข้อมูลมันขัดกันเองอยู่นะพวกมึง",
      ],
    },
    M_MANIPULATOR: {
      tone: "ปั่นเนียน",
      day1: [
        "กูว่าอย่าเพิ่งรีบโหวตมั่วเลยพวกมึง ลองฟัง {target} พูดก่อนดีกว่า เผื่อมีข้อมูลดีๆ",
        "แปลกนะ เปิดวันแรกมาทำไมวงมันเงียบจัง {target} มึงดูนิ่งผิดปกติปะเนี่ย",
        "พวกมึงคิดเหมือนกูปะ ว่าคนเงียบๆ อย่าง {target} นี่แหละชอบแอบซุ่มสุดละ",
      ],
      fallback: [
        "กูไม่ได้จะปรักปรำนะ แต่ถ้ามองกลางๆ {target} ดูได้ประโยชน์สุดถ้าวงนี้แตกคอกัน",
        "ลองคิดตามกูดิ {target} รีบปัดประเด็นหนีเร็วเกินไปปะ พวกมึงไม่เอะใจเหรอ?",
        "กูว่าเราอย่าหลงกลคนเสียงดังเลย หันไปดูคนเนียนๆ อย่าง {target} ดีกว่าว่ะ",
      ],
    },
    M_GAMBLER: {
      tone: "สายเสี่ยง",
      day1: [
        "วันแรกมันต้องวัดดวงเว้ย! กูขอเปิดหน้าท้า {target} เลย กล้าสาบานปะว่าไม่ใช่หมา?",
        "ไม่รู้แหละ กูเชื่อเซนส์ตัวเอง รอบนี้ {target} มีรังสีอำมหิตแปลกๆ ว่ะ 555",
        "ใครเงียบกูทุบหมดอ่ะบอกเลย เริ่มจาก {target} ก่อนเป็นไงพวกมึง!",
      ],
      fallback: [
        "กูเทหมดหน้าตักเลยรอบนี้ ถ้า {target} ไม่ใช่หมาป่าให้กูเลี้ยงข้าวเลยเอ้า!",
        "เอาวะวัดใจกันไปเลย พวกมึงลองจี้ {target} ดูดิ เดี๋ยวก็มีหลุด!",
        "เซนส์กูมันร้องเตือนดังมากว่า {target} กำลังตอแหลอยู่ชัวร์!",
      ],
    },
    F_DRAMA: {
      tone: "ดราม่า",
      day1: [
        "กรี๊ดดด เปิดเกมมาก็ขนลุกแล้วอ่ะพวกมึง อย่าบอกนะว่า {target} เป็นหมาป่าอ่ะ?!",
        "เห้ยพวกมึงกูกลัวนะเนี่ย! ทำไม {target} ทำตัวมีพิรุธตั้งแต่วันแรกเลยวะ!",
        "โอ๊ยยย วงนี้ไว้ใจใครไม่ได้เลยสักคน โดยเฉพาะ {target} หน้าตึงมากมึง!",
      ],
      fallback: [
        "ว้ายยย {target} มึงพูดแบบนี้หมายความว่าไงวะ จะโยนความผิดให้คนอื่นเหรอ?!",
        "ไม่จริงอ่ะ! กูว่า {target} แม่งโคตรน่าสงสัยเลยพวกมึง อย่าไปหลงเชื่อมันนะ!",
        "โอ๊ยปวดหัวกับวงนี้มาก {target} มึงเลิกตอแหลแล้วพูดความจริงมาเดี๋ยวนี้!",
      ],
    },
    F_ROASTER: {
      tone: "ปากแซ่บ",
      day1: [
        "แหมมม ตื่นมาก็ทำตัวเนียนเลยนะ {target} อย่าคิดว่ากูดูไม่ออกนะจ๊ะ",
        "เปิดวันแรกมาก็เงียบเป็นเป่าสากเลยพวกมึง โดยเฉพาะ {target} อมอะไรไว้คายออกมา!",
        "สภาพแต่ละคนโคตรมีพิรุธ โดยเฉพาะ {target} แกล้งทำเป็นใสซื่อเหรอมึง 555",
      ],
      fallback: [
        "โห {target} แถเก่งขนาดนี้ไปเป็นทนายเถอะมึง ตอแหลไม่เนียนเลยสักนิด!",
        "หยุดเลย {target} ยิ่งแก้ตัวยิ่งดูเหมือนหมาป่าจนมุมว่ะ พวกมึงดูมันดิ!",
        "ขำว่ะ {target} คิดว่าพูดแค่นี้แล้วคนในวงจะเชื่อเหรอ ฝันไปเถอะมึง!",
      ],
    },
    F_INNOCENT: {
      tone: "สายเนียน",
      day1: [
        "เห้ยพวกมึง กูเพิ่งตื่นยังงงอยู่เลยอ่ะ {target} มึงว่าใครน่าสงสัยสุดวะ?",
        "อย่าเพิ่งรุมกูนะเว้ย กูชาวบ้านใสๆ จริงๆ แต่กูแอบกลัว {target} ยังไงไม่รู้อ่ะ",
        "วันแรกยังเดาไม่ออกเลยอ่ะพวกมึง ลองถาม {target} ดูก่อนมั้ยว่าคิดไง?",
      ],
      fallback: [
        "เดี๋ยวนะ กูงงไปหมดแล้วอ่ะ แต่ทำไม {target} ดูรีบจังเลยวะ กูแอบระแวงนะเนี่ย",
        "กูไม่ได้อยากหาเรื่องใครนะ แต่เมื่อกี้ {target} พูดแปลกจริงพวกมึง ลองดูดีๆ ดิ",
        "เห้ยอย่าเพิ่งโหวตมั่วดิ กูว่าลองฟัง {target} อธิบายก่อนมั้ยมันดูลุกลนแปลกๆ",
      ],
    },
    F_OBSERVER: {
      tone: "จับโป๊ะ",
      day1: [
        "กูนั่งดูเงียบๆ อยู่นะ แต่เห็นชัดเลยว่า {target} ดูเกร็งผิดปกติตั้งแต่วันแรก",
        "ใครพูดน้อยเกินหรือพูดมากเกินกูจดหมดแหละ โดยเฉพาะ {target} ระวังตัวไว้",
        "เปิดเกมมาแบบนี้จับจังหวะง่ายดีนะ {target} มึงลองพูดอะไรหน่อยดิ เงียบทำไม",
      ],
      fallback: [
        "จับโป๊ะได้จุดนึงละ {target} เปลี่ยนเรื่องไวมากเวลาโดนถามจี้ แบบนี้ไม่ปกติชัวร์",
        "กูสังเกตมาสองรอบละ {target} ชอบไหลตามน้ำไม่ยอมออกความเห็นเอง หมาป่าชัดๆ",
        "ดูทรงแล้ว {target} พยายามเบี่ยงเป้าอยู่นะพวกมึง อย่าเพิ่งหลุดโฟกัส",
      ],
    },
    F_INSTIGATOR: {
      tone: "สายเสี้ยม",
      day1: [
        "อุ๊ยยย พวกมึงเห็นปะเมื่อกี้ {target} แอบมองแรงอ่ะ สงสัยกลัวโดนจับได้ปะเนี่ย 555",
        "เอาจริงนะ กูว่าวงนี้ต้องมีคนแอบแทงข้างหลังแน่ๆ กูเล็ง {target} ไว้ก่อนเลย!",
        "ลองโยนหินถามทางหน่อยดิ ถ้าวันนี้ลองโหวต {target} จะมีใครรีบออกตัวปกป้องมั้ยน้า~",
      ],
      fallback: [
        "เอ๊ะ ทำไม {target} ดูร้อนตัวจังวะ หรือว่าโดนจี้ถูกจุดเข้าให้แล้วอ่ะพวกมึง 555",
        "พวกมึงสังเกตปะ เวลาใครแตะ {target} มันรีบเปลี่ยนเรื่องทันทีเลย น่าคิดนะเว้ย!",
        "กูเชียร์ให้จี้ {target} ต่อเลย ดูซิว่าจะแถไปได้อีกกี่น้ำ!",
      ],
    },
  };

  function pickLocalFallbackLine(params: {
    bot: any;
    players: any[];
    isDay1Opening: boolean;
    nightVictimNames?: string[];
    usedTexts: Set<string>;
  }): { text: string; tone: string } {
    const { bot, players, isDay1Opening, nightVictimNames, usedTexts } = params;
    const archKey =
      bot.archetypeId && LOCAL_FALLBACK_BANK[bot.archetypeId]
        ? bot.archetypeId
        : bot.gender === "F"
        ? "F_ROASTER"
        : "M_TROLL";
    const bank = LOCAL_FALLBACK_BANK[archKey] || LOCAL_FALLBACK_BANK.M_TROLL;
    const pool = isDay1Opening ? bank.day1 : bank.fallback;

    const othersAlive = players.filter((p: any) => p.alive && p.id !== bot.id);
    const randomTarget =
      othersAlive.length > 0
        ? formatThaiCall(othersAlive[Math.floor(Math.random() * othersAlive.length)])
        : "พวกมึง";

    const candidates = pool
      .map((tpl) => tpl.replace(/\{target\}/g, randomTarget))
      .filter((txt) => !usedTexts.has(txt));

    let chosen =
      candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : pool[Math.floor(Math.random() * pool.length)].replace(/\{target\}/g, randomTarget);

    if (isDay1Opening && Array.isArray(nightVictimNames) && nightVictimNames.length > 0 && Math.random() < 0.45) {
      const deadShort = nightVictimNames[0].replace(/\s*\(.*\)$/, "");
      chosen = `เชี่ย ${deadShort} ปลิวตั้งแต่คืนแรกเลยเหรอวะ! ${chosen}`;
    }

    usedTexts.add(chosen);
    return { text: chosen, tone: bank.tone };
  }

  // Ultra-Compact Prompt (~500 tokens max per single-bot API call)
  function buildUltraCompactBotPrompt(params: {
    bot: any;
    dayNumber: number;
    players: any[];
    seerKnowledge: any[];
    bodyguardKnowledge: any[];
    wolfKillHistory: any[];
    recentTranscript: string[];
    nightVictimNames?: string[];
    humanMessage?: string;
    speakerName?: string;
    mode: string;
  }): { systemPrompt: string; userPrompt: string } {
    const {
      bot,
      dayNumber,
      players,
      seerKnowledge,
      bodyguardKnowledge,
      recentTranscript,
      nightVictimNames,
      humanMessage,
      speakerName,
      mode,
    } = params;

    const aliveNames = players
      .filter((p: any) => p.alive)
      .map((p: any) => formatThaiCall(p))
      .join(",");
    // Strictly NO roles of dead players!
    const deadNamesOnly =
      players
        .filter((p: any) => !p.alive)
        .map((p: any) => p.shortName || p.name)
        .join(",") || "ไม่มี";
    const revealedBeggarName =
      players
        .filter((p: any) => p.revealedBeggar)
        .map((p: any) => p.shortName || p.name)
        .join(",") || "ไม่มี";

    const tableStatusLine = `วันที่:${dayNumber} | รอด:${aliveNames} | ตาย:${deadNamesOnly} | เปิดการ์ดยาจก:${revealedBeggarName}`;

    // Private skill intel ONLY for this specific bot (1 concise line)
    let privateIntel = "ไม่มีข้อมูลลับเพิ่ม";
    if (isWolfRole(bot.role)) {
      const partners = players
        .filter((p: any) => p.id !== bot.id && isWolfRole(p.role))
        .map((p: any) => `${formatThaiCall(p)}(${p.alive ? "รอด" : "ตาย"})`)
        .join(",");
      privateIntel = `ฝูงหมาป่า:${partners || "เหลือมึงตัวเดียว"} ห้ามแฉพวกเดียวกัน ให้เนียนป้ายสีชาวบ้าน`;
    } else if (bot.role === "SEER") {
      const checks = (seerKnowledge || [])
        .slice(-3)
        .map((k: any) => `${k.targetName}=${k.isWerewolf ? "หมาป่า!" : "คนดี"}`)
        .join(", ");
      privateIntel = checks ? `ผลส่องหมอดู:${checks} (เลือกซ่อนตัวหรือแฉเองได้)` : "ยังไม่มีผลส่อง";
    } else if (bot.role === "BODYGUARD") {
      const saves = (bodyguardKnowledge || [])
        .slice(-3)
        .map((k: any) => `คืน${k.night}:${k.targetName}${k.savedAttack ? "(เซฟติด!)" : ""}`)
        .join(", ");
      privateIntel = saves ? `ประวัติการ์ด:${saves}` : "ยังไม่เคยเซฟใคร";
    }

    const botGender = bot.gender === "F" ? "หญิง" : "ชาย";
    const botRoleThai = ROLE_THAI_SHORT[bot.role] || "ชาวบ้าน";
    const botPersona = `${bot.archetypeName || bot.personaLabel || "เพื่อนซี้"} (${(bot.personaTrait || "").slice(0, 60)})`;

    const botProfileBlock =
      `ตัวมึง:${formatThaiCall(bot)}(${botGender}) | บทลับ:${botRoleThai} | นิสัย:${botPersona}\n` +
      `ข้อมูลลับเฉพาะมึง:${privateIntel}`;

    // Strictly last 8-10 messages only!
    const compactHistory = (recentTranscript || [])
      .slice(-10)
      .map((line) => String(line).slice(0, 140))
      .join("\n");

    const systemPrompt =
      `มึงคือผู้เล่นเกม Werewolf ในแชทกลุ่มเพื่อนซี้คนไทย สวมบทเป็น ${formatThaiCall(bot)} เท่านั้น\n` +
      `กฎเหล็ก: ตอบภาษาเพื่อนสนิทดิบๆ กู-มึง ไอ้/อี แซวแรง ปั่นประสาท ห้ามมีคำสุภาพ(ครับ/ค่ะ/คุณ/ผม/ฉัน)เด็ดขาด! ` +
      `พิมพ์แค่คำพูดของมึงสั้นๆ 1-2 ประโยค ห้ามใส่ชื่อนำหน้า ห้ามใส่เครื่องหมายคำพูด`;

    let triggerNote = "เปิดวงถกเถียงต่อจากแชทล่าสุดให้ตรงนิสัยมึง";
    if (mode === "REPLY_TO_HUMAN" && humanMessage) {
      triggerNote = `ล่าสุด ${speakerName || "เพื่อน"} พิมพ์ว่า "${String(humanMessage).slice(0, 120)}" ให้มึงโต้ตอบหรือสวนกลับตามนิสัย`;
    } else if (mode === "INITIAL_DAY") {
      triggerNote =
        nightVictimNames && nightVictimNames.length > 0
          ? `เมื่อคืน ${nightVictimNames.join(",")} โดนหมาป่าฆ่า! ออกความเห็นสั้นๆ`
          : "เมื่อคืนไม่มีใครตาย (บอดี้การ์ดเซฟได้)! ออกความเห็นสั้นๆ";
    }

    const userPrompt =
      `${tableStatusLine}\n` +
      `${botProfileBlock}\n` +
      `แชทล่าสุด:\n${compactHistory || "(เพิ่งเปิดวง)"}\n` +
      `คำสั่ง:${triggerNote} (ตอบสั้น 1-2 ประโยคภาษา กู-มึง เท่านั้น)`;

    return { systemPrompt, userPrompt };
  }

  function sanitizeSingleBotReply(raw: string, bot: any): string {
    let cleaned = String(raw || "").trim();
    // Strip markdown code fences or JSON wrappers if a model accidentally wraps it
    cleaned = cleaned.replace(/^```[\s\S]*?\n|```$/g, "").trim();
    if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
      try {
        const parsed = JSON.parse(cleaned);
        if (typeof parsed.text === "string") cleaned = parsed.text;
        else if (typeof parsed.message === "string") cleaned = parsed.message;
      } catch {
        // Keep raw text
      }
    }
    // Strip leading speaker name prefix like "ไอ้บอส: ..." or "บอส:"
    const shortName = String(bot?.shortName || bot?.name || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (shortName) {
      cleaned = cleaned.replace(new RegExp(`^(?:ไอ้|อี)?${shortName}\\s*[:：-]\\s*`, "i"), "");
    }
    cleaned = cleaned.replace(/^["'「『]+|["'」』]+$/g, "").replace(/\s+/g, " ").trim();
    // Keep strictly concise (1-2 sentences / max ~220 Thai chars)
    if (cleaned.length > 220) {
      cleaned = `${cleaned.slice(0, 217).trim()}...`;
    }
    return cleaned;
  }

  // Single-Bot AI Caller:
  // 1) Groq (GROQ_MODEL, 8s timeout, max_tokens: 100)
  // 2) Failover immediately to Gemini (GEMINI_MODEL_PRIMARY) on timeout / 429 / error
  // 3) Failover to LOCAL_FALLBACK_BANK if both APIs fail
  async function callBotSingleReplyAI(params: {
    bot: any;
    systemPrompt: string;
    userPrompt: string;
    players: any[];
    usedTexts: Set<string>;
  }): Promise<{ text: string; tone: string; modelUsed: string }> {
    const { bot, systemPrompt, userPrompt, players, usedTexts } = params;
    const defaultTone =
      LOCAL_FALLBACK_BANK[bot.archetypeId]?.tone ||
      (bot.personaLabel ? String(bot.personaLabel).slice(0, 14) : "ถกเถียง");

    // --- Step 1: Try GROQ_MODEL first (strict 8,000ms timeout & max_tokens: 100) ---
    const groqApiKey = (process.env.GROQ_API_KEY || "").trim();
    if (isValidKey(groqApiKey)) {
      const envGroqModel = (process.env.GROQ_MODEL || "").trim();
      const discovered = await discoverGroqChatModels(groqApiKey);
      let groqCandidates: string[] = [];
      if (discovered.length > 0) {
        groqCandidates =
          envGroqModel && discovered.includes(envGroqModel)
            ? [envGroqModel, ...discovered.filter((m) => m !== envGroqModel)]
            : discovered;
      } else {
        groqCandidates = Array.from(
          new Set([envGroqModel, ...GROQ_FALLBACK_MODELS].filter(Boolean))
        );
      }
      const now = Date.now();
      const activeGroq = groqCandidates.filter(
        (m) => (groqModelCooldownUntil.get(m) || 0) <= now
      );
      // Try top 1-2 Groq models with strict 8s timeout total so failover to Gemini is instant
      for (const model of (activeGroq.length > 0 ? activeGroq : groqCandidates).slice(0, 2)) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${groqApiKey}`,
            },
            body: JSON.stringify({
              model,
              temperature: 0.85,
              max_tokens: 100,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
            }),
          });
          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            if (res.status === 404 || errBody.toLowerCase().includes("model_not_found")) {
              groqModelCooldownUntil.set(model, Date.now() + 15 * 60 * 1000);
              continue; // try next discovered Groq model if 404
            }
            if (res.status === 429) {
              groqModelCooldownUntil.set(model, Date.now() + 60 * 1000);
              console.warn(`[BotQueue] Groq ${model} 429 Rate Limit -> Failover to Gemini`);
              break; // immediate failover to Gemini on 429
            }
            console.warn(`[BotQueue] Groq ${model} HTTP ${res.status} -> Failover to Gemini`);
            break;
          }
          const json: any = await res.json();
          const rawText = json?.choices?.[0]?.message?.content || "";
          const cleaned = sanitizeSingleBotReply(rawText, bot);
          if (cleaned) {
            groqModelCooldownUntil.delete(model);
            usedTexts.add(cleaned);
            return { text: cleaned, tone: defaultTone, modelUsed: `groq:${model}` };
          }
        } catch (err: any) {
          console.warn(
            `[BotQueue] Groq ${model} failed/timeout (>8s): ${String(err?.message || err).slice(0, 120)} -> Failover to Gemini`
          );
          break; // immediate failover to Gemini on timeout/network error
        } finally {
          clearTimeout(timer);
        }
      }
    }

    // --- Step 2: Failover to GEMINI_MODEL_PRIMARY ---
    const geminiCfg = getGeminiConfig();
    if (geminiCfg) {
      try {
        const ai = new GoogleGenAI({
          apiKey: geminiCfg.apiKey,
          httpOptions: { headers: { "User-Agent": "aistudio-build" } },
        });
        const baseList = Array.from(
          new Set(
            [
              geminiCfg.primaryModel,
              geminiCfg.fastModel,
              "gemini-4-hydrogen",
              "gemini-3.1-flash-lite",
            ].filter(Boolean)
          )
        );
        const now = Date.now();
        let candidates = baseList.filter((m) => (geminiModelCooldownUntil.get(m) || 0) <= now);
        if (candidates.length === 0) {
          const discovered = await discoverGeminiActiveModels(geminiCfg.apiKey);
          candidates = discovered.filter((m) => (geminiModelCooldownUntil.get(m) || 0) <= now);
        }

        for (const modelName of (candidates.length > 0 ? candidates : baseList).slice(0, 2)) {
          try {
            const isGemini4 = modelName.toLowerCase().startsWith("gemini-4-");
            const config: any = {
              systemInstruction: systemPrompt,
              safetySettings: WEREWOLF_SAFETY_SETTINGS,
            };
            if (isGemini4) {
              config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
            } else {
              config.temperature = 0.85;
              config.maxOutputTokens = 120;
            }
            const response = await withTimeout(
              ai.models.generateContent({
                model: modelName,
                contents: userPrompt,
                config,
              }),
              9000,
              `gemini:${modelName}`
            );
            const rawText =
              response.text ||
              response.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") ||
              "";
            const cleaned = sanitizeSingleBotReply(rawText, bot);
            if (cleaned) {
              geminiModelCooldownUntil.delete(modelName);
              usedTexts.add(cleaned);
              return { text: cleaned, tone: defaultTone, modelUsed: `gemini:${modelName}` };
            }
          } catch (gErr: any) {
            const gMsg = String(gErr?.message || gErr).toLowerCase();
            if (gMsg.includes("404") || gMsg.includes("not found")) {
              geminiModelCooldownUntil.set(modelName, Date.now() + 15 * 60 * 1000);
            } else if (gMsg.includes("429") || gMsg.includes("quota") || gMsg.includes("timed out")) {
              geminiModelCooldownUntil.set(modelName, Date.now() + 45 * 1000);
            }
            console.warn(`[BotQueue] Gemini ${modelName} failed: ${String(gErr?.message || gErr).slice(0, 140)}`);
          }
        }
      } catch (err: any) {
        console.warn(`[BotQueue] Gemini failover error: ${String(err?.message || err).slice(0, 140)}`);
      }
    }

    // --- Step 3: Local Fallback Bank (never freezes the game!) ---
    const local = pickLocalFallbackLine({
      bot,
      players,
      isDay1Opening: false,
      usedTexts,
    });
    return { text: local.text, tone: local.tone, modelUsed: "local:fallback_bank" };
  }

  // Pick 3-5 living AI bots, prioritizing bots whose nickname was mentioned in recent chat
  function selectBotsForDiscussionQueue(params: {
    aliveAI: any[];
    recentTranscript: string[];
    humanMessage?: string;
    mode: string;
  }): any[] {
    const { aliveAI, recentTranscript, humanMessage, mode } = params;
    if (aliveAI.length === 0) return [];

    // 3 to 5 bots per round to stay well below 12 RPM
    const desiredCount =
      mode === "INITIAL_DAY"
        ? Math.min(aliveAI.length, 3 + Math.floor(Math.random() * 3)) // 3..5 bots
        : Math.min(aliveAI.length, 3 + Math.floor(Math.random() * 2)); // 3..4 bots

    const latestFocusText = [
      humanMessage || "",
      ...(recentTranscript || []).slice(-3),
    ]
      .join(" ")
      .toLowerCase();

    const mentioned: any[] = [];
    const others: any[] = [];
    for (const bot of aliveAI) {
      const nick = String(bot.shortName || bot.name || "")
        .replace(/^(ไอ้|อี)/, "")
        .trim()
        .toLowerCase();
      if (nick && latestFocusText.includes(nick)) {
        mentioned.push(bot);
      } else {
        others.push(bot);
      }
    }

    const shuffle = <T,>(arr: T[]): T[] => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    };

    return [...shuffle(mentioned), ...shuffle(others)].slice(0, desiredCount);
  }

  // Sequential Queue Loop: strictly 1 bot at a time with 4,000 - 5,000 ms delay & live BOT_TYPING
  async function runBotChatLoop(params: {
    room: RoomState | null;
    loopId: number;
    dayNumber: number;
    players: any[];
    aliveAI: any[];
    nightVictimNames?: string[];
    seerKnowledge: any[];
    bodyguardKnowledge: any[];
    wolfKillHistory: any[];
    recentTranscript: string[];
    humanMessage?: string;
    speakerName?: string;
    mode: string;
    streamOverWs: boolean;
  }): Promise<any[]> {
    const {
      room,
      loopId,
      dayNumber,
      players,
      aliveAI,
      nightVictimNames,
      seerKnowledge,
      bodyguardKnowledge,
      wolfKillHistory,
      humanMessage,
      speakerName,
      mode,
      streamOverWs,
    } = params;

    const selectedBots = selectBotsForDiscussionQueue({
      aliveAI,
      recentTranscript: params.recentTranscript,
      humanMessage,
      mode,
    });

    const isLoopCancelled = (): boolean => {
      if (!room) return false;
      if (room.activeBotLoopId !== loopId) return true;
      if (!room.gameStarted) return true;
      const curPhase = room.gameSnapshot?.phase;
      if (curPhase && curPhase !== "DAY_DISCUSSION" && curPhase !== "DAY_RESULT") {
        return true;
      }
      return false;
    };

    const isHybridDay1Opening = Number(dayNumber) === 1 && mode === "INITIAL_DAY";
    const rollingTranscript = [...(params.recentTranscript || [])].slice(-10);
    const usedTexts = new Set<string>();
    const emittedMessages: any[] = [];

    try {
      for (let idx = 0; idx < selectedBots.length; idx++) {
        if (isLoopCancelled()) break;

        const bot = selectedBots[idx];
        const botDisplayName = formatThaiCall(bot);

        // Emit LINE Typing Indicator before generating/waiting
        if (streamOverWs && room) {
          broadcastToRoom(room.roomId, {
            type: "BOT_TYPING",
            botId: bot.id,
            name: botDisplayName,
            gender: bot.gender,
            isTyping: true,
            loopId,
          });
        }

        let reply: { text: string; tone: string; modelUsed: string };

        if (isHybridDay1Opening) {
          // Day 1 Opening = 0 Token from LOCAL_FALLBACK_BANK, still paced with realistic typing feel
          if (streamOverWs) {
            await sleepMs(1200 + Math.floor(Math.random() * 800));
            if (isLoopCancelled()) break;
          }
          const localLine = pickLocalFallbackLine({
            bot,
            players,
            isDay1Opening: true,
            nightVictimNames,
            usedTexts,
          });
          reply = { ...localLine, modelUsed: "local:day1_hybrid_0token" };
        } else {
          // Refresh rolling transcript from authoritative room snapshot if humans typed mid-loop
          if (room?.gameSnapshot && Array.isArray(room.gameSnapshot.messages)) {
            const latestPublic = room.gameSnapshot.messages
              .filter((m: any) => !m.isSecret && m.senderId !== "secret")
              .slice(-10)
              .map((m: any) => `${m.senderName}: ${m.text}`);
            if (latestPublic.length > 0) {
              rollingTranscript.length = 0;
              rollingTranscript.push(...latestPublic);
            }
          }

          const { systemPrompt, userPrompt } = buildUltraCompactBotPrompt({
            bot,
            dayNumber,
            players,
            seerKnowledge,
            bodyguardKnowledge,
            wolfKillHistory,
            recentTranscript: rollingTranscript.slice(-10),
            nightVictimNames,
            humanMessage,
            speakerName,
            mode,
          });

          reply = await callBotSingleReplyAI({
            bot,
            systemPrompt,
            userPrompt,
            players,
            usedTexts,
          });
        }

        if (isLoopCancelled()) break;

        const phaseLabel =
          mode === "REPLY_TO_HUMAN"
            ? `วันที่ ${dayNumber} · โต้ตอบ`
            : mode === "CONTINUE_DEBATE"
            ? `วันที่ ${dayNumber} · วิเคราะห์ต่อ`
            : `วันที่ ${dayNumber} · ถกเถียง`;

        const chatMessage = {
          id: `bot-${dayNumber}-${loopId}-${idx}-${Date.now()}`,
          senderId: bot.id,
          senderName: bot.name,
          senderGender: bot.gender,
          senderPersona: bot.personaLabel,
          text: reply.text,
          tone: reply.tone,
          phaseLabel,
          timestamp: formatChatClock(),
        };

        emittedMessages.push({
          speakerId: bot.id,
          speakerName: bot.name,
          text: reply.text,
          tone: reply.tone,
          modelUsed: reply.modelUsed,
        });

        rollingTranscript.push(`${bot.name}: ${reply.text}`);
        if (rollingTranscript.length > 10) {
          rollingTranscript.splice(0, rollingTranscript.length - 10);
        }

        // Persist into authoritative room snapshot & broadcast immediately to LINE Group Chat
        if (streamOverWs && room) {
          if (room.gameSnapshot && Array.isArray(room.gameSnapshot.messages)) {
            if (!room.gameSnapshot.messages.some((m: any) => m.id === chatMessage.id)) {
              room.gameSnapshot.messages = [...room.gameSnapshot.messages, chatMessage];
            }
          }
          broadcastToRoom(room.roomId, {
            type: "BOT_CHAT_MESSAGE",
            chatMessage,
            modelUsed: reply.modelUsed,
            loopId,
          });
          broadcastToRoom(room.roomId, {
            type: "BOT_TYPING",
            botId: null,
            name: null,
            isTyping: false,
            loopId,
          });
        }

        // Strict sequential pacing: sleep random 4,000 - 5,000 ms BEFORE calling the next bot!
        if (idx < selectedBots.length - 1) {
          const delayMs = randomBotDelayMs();
          // Sleep in 250ms slices so Ready/Phase-change aborts instantaneously without waiting 5s
          let elapsed = 0;
          while (elapsed < delayMs) {
            if (isLoopCancelled()) break;
            const step = Math.min(250, delayMs - elapsed);
            await sleepMs(step);
            elapsed += step;
          }
          if (isLoopCancelled()) break;
        }
      }
    } finally {
      if (streamOverWs && room && room.activeBotLoopId === loopId) {
        broadcastToRoom(room.roomId, {
          type: "BOT_TYPING",
          botId: null,
          name: null,
          isTyping: false,
          loopId,
        });
        broadcastToRoom(room.roomId, {
          type: "BOT_QUEUE_DONE",
          loopId,
        });
      }
    }

    return emittedMessages;
  }

  // Endpoint 1: Sequential Rate-Limit-Safe Thai Day Discussion (3-5 Bots, 4-5s Delay, Hybrid Day 1)
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
        recentTranscript,
        humanMessage,
        speakerName,
        mode, // 'INITIAL_DAY' | 'REPLY_TO_HUMAN' | 'CONTINUE_DEBATE'
      } = req.body;

      const normalizedRoomId = roomId ? String(roomId).trim().toUpperCase() : "";
      const room = normalizedRoomId ? rooms.get(normalizedRoomId) || null : null;
      const authSnap = room?.gameSnapshot;

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

      const aliveAI = players.filter((p: any) => p.alive && !p.isHuman);
      if (aliveAI.length === 0) {
        return res.json({ ok: true, data: { messages: [] }, aliveAIIds: [] });
      }

      const safeTranscript = Array.isArray(recentTranscript)
        ? recentTranscript.slice(-10)
        : [];
      const hasLiveWsClients =
        Boolean(room) && getLiveOnlineIds(normalizedRoomId).size > 0;

      if (room && hasLiveWsClients) {
        // Cancel any previous unfinished bot loop in this room and launch fresh sequential queue
        room.activeBotLoopId += 1;
        const loopId = room.activeBotLoopId;

        void runBotChatLoop({
          room,
          loopId,
          dayNumber: Number(dayNumber) || 1,
          players,
          aliveAI,
          nightVictimNames: Array.isArray(nightVictimNames) ? nightVictimNames : [],
          seerKnowledge,
          bodyguardKnowledge,
          wolfKillHistory,
          recentTranscript: safeTranscript,
          humanMessage,
          speakerName,
          mode: mode || "INITIAL_DAY",
          streamOverWs: true,
        }).catch((err) => {
          console.error("[BotQueue] Sequential loop error:", err?.message || err);
        });

        return res.json({
          ok: true,
          queued: true,
          loopId,
          aliveAIIds: aliveAI.map((a: any) => a.id),
        });
      }

      // Offline / no-WS fallback: run sequentially and return JSON messages directly
      const messages = await runBotChatLoop({
        room: null,
        loopId: Date.now(),
        dayNumber: Number(dayNumber) || 1,
        players,
        aliveAI,
        nightVictimNames: Array.isArray(nightVictimNames) ? nightVictimNames : [],
        seerKnowledge,
        bodyguardKnowledge,
        wolfKillHistory,
        recentTranscript: safeTranscript,
        humanMessage,
        speakerName,
        mode: mode || "INITIAL_DAY",
        streamOverWs: false,
      });

      return res.json({
        ok: true,
        data: { messages },
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
