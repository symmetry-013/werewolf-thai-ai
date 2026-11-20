import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import WebSocket from 'ws';
import { MongoClient } from 'mongodb';
import {
  normalizeOfficialTeleRidBasinDisplayName,
  lookupOfficialTeleRidStationByCode,
} from './teleridStationsData.ts';

export interface TeleRidStationDetailedRow {
  stationCode: string;
  stationName: string;
  basin: string;
  stationType?: 'สถานีวัดระดับน้ำ + น้ำฝน' | 'สถานีวัดระดับน้ำอย่างเดียว' | 'สถานีน้ำฝนอย่างเดียว';
  province: string;
  amphur: string;
  tambon: string;
  onlineStatus: 'ออนไลน์' | 'ออฟไลน์'; // การเชื่อมต่อ
  alertStatus: 'ปกติ' | 'เตือนภัย' | 'วิกฤติ' | 'ขัดข้อง'; // ระดับน้ำ (สถานะ)
  status: 'ปกติ' | 'เตือนภัย' | 'วิกฤติ' | 'ขัดข้อง';
  rain7toNow: number | null; // ฝน 07:00-ปัจจุบัน (มม.)
  rain1Day: number | null; // ฝน 1 วัน (24ชม.) (มม.)
  waterLevelUp_RTK: number | null; // เหนือน้ำ (ม.รทก.)
  waterLevelUp_RSM: number | null; // เหนือน้ำ (ม.รสม.)
  waterLevelDown_RTK: number | null; // ท้ายน้ำ (ม.รทก.)
  waterLevelDown_RSM: number | null; // ท้ายน้ำ (ม.รสม.)
  rawWaterLevelUp_RTK?: number | null;
  rawWaterLevelUp_RSM?: number | null;
  rawWaterLevelDown_RTK?: number | null;
  rawWaterLevelDown_RSM?: number | null;
  warningThreshold: number | null;
  criticalThreshold: number | null;
  location: {
    lat: number | null;
    lng: number | null;
  };
  recordedAt: string;
  updatedAt?: string;
  sourceChannel?: 'WS_LIVE' | 'CHROME_SECRETARY' | 'REST_TOKEN_API' | 'LOCAL_FILE' | 'MONGODB';
}

export interface SecretaryProgressSnapshot {
  isActive: boolean;
  startedAtIso: string;
  startedAtText: string;
  selectedBasins: string[];
  observedBasinsOnScreen: string[];
  stationsRecordedCount: number;
  stationsCapturedCount: number;
  abnormalStationsCount: number;
  cctvRecordedCount: number;
  userInteractionsCount: number;
  userInteractionCount: number;
  lastObservedAction: string;
  lastActionDescription: string;
  summaryCards: {
    online: number | null;
    warning: number | null;
    critical: number | null;
    offline: number | null;
    totalStations: number | null;
  };
  recentStationsPreview: TeleRidStationDetailedRow[];
  latestStationsPreview: TeleRidStationDetailedRow[];
}


export interface MongoConnectionStatus {
  connected: boolean;
  mongoUriMasked: string;
  dbName: string;
  collectionName: string;
  totalDocsInCollection: number;
  fetchedRowsCount: number;
  fetchSuccess: boolean;
  lastCheckedAt: string;
  errorMessage: string | null;
}

function maskMongoUri(uri: string): string {
  return uri.replace(/(mongodb(?:\+srv)?:\/\/[^:]+:)([^@]+)(@)/i, '$1***$3');
}

let lastMongoStatus: MongoConnectionStatus = {
  connected: false,
  mongoUriMasked: maskMongoUri(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017'),
  dbName: process.env.DB_NAME || 'telerid_db',
  collectionName: process.env.COLLECTION_NAME || 'stations',
  totalDocsInCollection: 0,
  fetchedRowsCount: 0,
  fetchSuccess: false,
  lastCheckedAt: '-',
  errorMessage: 'ยังไม่ได้ทดสอบเชื่อมต่อ',
};

let runtimeMongoUri = '';
let runtimeDbName = '';
let runtimeCollectionName = '';

export function getLastMongoStatus(): MongoConnectionStatus {
  const effectiveUri = runtimeMongoUri || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
  const effectiveDb = runtimeDbName || process.env.DB_NAME || 'telerid_db';
  const effectiveColl = runtimeCollectionName || process.env.COLLECTION_NAME || 'stations';
  return {
    ...lastMongoStatus,
    mongoUriMasked: maskMongoUri(effectiveUri),
    dbName: effectiveDb,
    collectionName: effectiveColl,
  };
}

export function updateRuntimeMongoConnectionConfig(
  configOrUri?:
    | string
    | {
        mongoUri?: string;
        MONGO_URI?: string;
        dbName?: string;
        DB_NAME?: string;
        collectionName?: string;
        COLLECTION_NAME?: string;
      },
  dbNameArg?: string,
  collectionNameArg?: string
): MongoConnectionStatus {
  if (typeof configOrUri === 'string') {
    if (configOrUri.trim()) runtimeMongoUri = configOrUri.trim();
    if (dbNameArg?.trim()) runtimeDbName = dbNameArg.trim();
    if (collectionNameArg?.trim()) runtimeCollectionName = collectionNameArg.trim();
  } else if (configOrUri && typeof configOrUri === 'object') {
    const u = configOrUri.mongoUri || configOrUri.MONGO_URI;
    const d = configOrUri.dbName || configOrUri.DB_NAME;
    const c = configOrUri.collectionName || configOrUri.COLLECTION_NAME;
    if (u?.trim()) runtimeMongoUri = u.trim();
    if (d?.trim()) runtimeDbName = d.trim();
    if (c?.trim()) runtimeCollectionName = c.trim();
  }
  return getLastMongoStatus();
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'telerid_db';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'stations';
const TELERID_API_TOKEN = process.env.TELERID_API_TOKEN || '';
const TELERID_WS_URL = 'wss://telerid.rid.go.th/ws/public/';
const CACHE_SCHEMA_VERSION = 4;

const TELE04_ROOT = process.env.TELE04_ROOT || (fs.existsSync('C:\\Users\\Tele_04') ? 'C:\\Users\\Tele_04' : os.homedir());
const USER_DOWNLOADS_DIR = path.join(TELE04_ROOT, 'Downloads');
const USER_DESKTOP_DIR = path.join(TELE04_ROOT, 'Desktop');
const WORKSPACE_DIR = path.join(process.cwd(), 'workspace_inbox');
const LOCAL_STATIONS_CACHE_FILE = path.join(WORKSPACE_DIR, 'telerid_stations_synced.json');

// เก็บฐานข้อมูลสถานีทั้งหมดที่ซิงค์ได้จริงจาก WebSocket / API / MongoDB / เลขา AI
const inMemoryStationsMap = new Map<string, TeleRidStationDetailedRow>();

/**
 * ตรวจสอบว่าชื่อสถานีผิดพลาด (เช่น เผลอดึงคำว่า "ลุ่มน้ำมูล" มาเป็นชื่อสถานี) หรือไม่
 */
export function isInvalidOrBasinStationName(name: string | undefined | null): boolean {
  const clean = String(name || '').trim();
  if (!clean) return true;
  if (/^ลุ่มน้ำ/.test(clean)) return true;
  if (/^(ออนไลน์|ออฟไลน์|ปกติ|เตือนภัย|วิกฤติ|วิกฤต|ขัดข้อง|-|--)$/i.test(clean)) return true;
  return false;
}

/**
 * ฟังก์ชันแปลงตัวเลขและดักจับค่าผิดปกติ (-999 / 999) ตามสคริปต์ server.js / run-sync-local.js
 */

function parseStationTimestampMs(raw: unknown): number | null {
  if (!raw) return null;
  if (typeof raw === 'number' && raw > 1000000000) return raw < 10000000000 ? raw * 1000 : raw;
  const s = String(raw).trim();
  if (!s || s === '-') return null;
  // รองรับรูปแบบไทย: "15/11/2569 10:45:00" หรือ "15/11/2569, 10:45:00"
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    let yr = parseInt(m[3], 10);
    if (yr > 2400) yr -= 543;
    const mo = String(parseInt(m[2], 10)).padStart(2, '0');
    const dy = String(parseInt(m[1], 10)).padStart(2, '0');
    const hr = String(parseInt(m[4], 10)).padStart(2, '0');
    const mn = String(parseInt(m[5], 10)).padStart(2, '0');
    const sc = String(parseInt(m[6] || '0', 10)).padStart(2, '0');
    const d = new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:${sc}+07:00`);
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const iso = new Date(s);
  return Number.isNaN(iso.getTime()) ? null : iso.getTime();
}

export function cleanTeleRidNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '' || val === '-' || val === '--') return null;
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  if (Number.isNaN(num) || num === -999 || num === 999) return null;
  return num;
}

/**
 * เก็บค่าตัวเลขดิบก่อนตัด -999 / 999 เพื่อใช้ตรวจจับเซนเซอร์บั๊ก (<= -10 ถึง -999 หรือ >= 999)
 */
export function parseRawTeleRidNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === '' || val === '-' || val === '--') return null;
  const num = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  return Number.isNaN(num) ? null : num;
}

/**
 * แมปชื่อลุ่มน้ำจากข้อมูล WebSocket/API หรือรหัสสถานีให้ตรงกับชื่อลุ่มน้ำในหน้าเว็บ TeleRID 100%
 */
export function resolveStationBasinName(
  rawBasin: string | undefined | null,
  stationCode: string,
  preferredBasins: string[] = []
): string {
  const matched = lookupOfficialTeleRidStationByCode(stationCode, preferredBasins);
  if (matched) return matched.basinDisplayName;

  const cleanRaw = String(rawBasin || '').trim();
  if (cleanRaw && cleanRaw !== 'ไม่ระบุ' && cleanRaw !== 'ไม่ระบุลุ่มน้ำ') {
    const normalized = normalizeOfficialTeleRidBasinDisplayName(cleanRaw);
    if (normalized) return normalized;
  }

  const upper = stationCode.trim().toUpperCase();
  if (/^(?:TKH|TKS|TKL|TSN)\b/.test(upper)) return 'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ';
  if (/^(?:TE|LP)\b/.test(upper)) return 'ลุ่มน้ำชี';
  if (/^(?:TM|TMN)\b/.test(upper)) return 'ลุ่มน้ำมูล';
  if (/^(?:TTC)\b/.test(upper)) return 'ลุ่มน้ำท่าจีน';
  if (/^(?:TC)\b/.test(upper)) return 'ลุ่มน้ำเจ้าพระยา';
  if (/^(?:TSK)\b/.test(upper)) return 'ลุ่มน้ำสะแกกรัง';
  if (/^(?:TS)\b/.test(upper)) return 'ลุ่มน้ำป่าสัก';
  if (/^(?:TTP|TK\.)/.test(upper)) return 'ลุ่มน้ำภาคใต้ฝั่งตะวันออกตอนบน';
  if (/^(?:BNR|TPAT|TKOL)\b/.test(upper)) return 'ลุ่มน้ำภาคใต้ฝั่งตะวันออกตอนล่าง';

  return cleanRaw || 'ไม่ระบุลุ่มน้ำ';
}

/**
 * ตรวจสอบว่าสถานีอยู่ในกลุ่มลุ่มน้ำที่ผู้ใช้เลือกไว้หรือไม่
 */
export function doesStationMatchSelectedBasins(
  station: TeleRidStationDetailedRow,
  selectedBasins: string[]
): boolean {
  if (!selectedBasins || selectedBasins.length === 0) return true;
  const resolvedBasin = resolveStationBasinName(station.basin, station.stationCode, selectedBasins);
  const stBasinNorm = normalizeOfficialTeleRidBasinDisplayName(resolvedBasin);
  const stBasinShort = stBasinNorm.replace(/^ลุ่มน้ำ/, '').trim();

  for (const rawSel of selectedBasins) {
    if (!rawSel || rawSel === 'ALL') return true;
    const selNorm = normalizeOfficialTeleRidBasinDisplayName(rawSel);
    const selShort = selNorm.replace(/^ลุ่มน้ำ/, '').trim();
    if (stBasinNorm === selNorm || stBasinShort === selShort) {
      return true;
    }
  }
  return false;
}

/**
 * แปลง 1 รายการสถานีจากโครงสร้าง TeleRID WebSocket INIT (`payload.data[key]`)
 * ให้เป็น `TeleRidStationDetailedRow` โดยใช้เฉพาะสถานะจริงจากระบบ TeleRID เท่านั้น
 * (แก้ไขปัญหาเทียบ wlUpRtk ม.รทก. กับ warningThreshold ที่เป็น 0 หรือคนละหน่วย ม.รสม. จนขึ้นเตือนภัยมั่ว)
 */
export function parseTeleRidWsStationItem(
  item: Record<string, unknown>,
  sourceChannel: TeleRidStationDetailedRow['sourceChannel'] = 'WS_LIVE'
): TeleRidStationDetailedRow | null {
  if (!item || typeof item !== 'object') return null;
  const rawCode = String(item.code || item.station_code || item.stationCode || '').trim();
  if (!rawCode) return null;

  const matchedOfficial = lookupOfficialTeleRidStationByCode(rawCode);
  const candidateName = String(item.name || item.station_name || item.stationName || '').trim();
  const stationName = !isInvalidOrBasinStationName(candidateName)
    ? candidateName
    : matchedOfficial?.fullLabel || rawCode;

  const basinObj = (typeof item.basin === 'object' && item.basin !== null ? item.basin : undefined) as Record<string, unknown> | undefined;
  const projectObj = (typeof item.project === 'object' && item.project !== null ? item.project : undefined) as Record<string, unknown> | undefined;
  const rawBasinCandidate =
    basinObj?.name ||
    basinObj?.th ||
    basinObj?.basin_name ||
    projectObj?.name ||
    item.basin_name ||
    (typeof item.basin === 'string' ? item.basin : '');
  const rawBasinName = String(rawBasinCandidate || '').replace('[object Object]', '').trim();
  const basin = resolveStationBasinName(rawBasinName, rawCode);

  const valuesObj = (item.values as Record<string, unknown>) || {};
  const rainSumNowObj = (valuesObj.rain_sum_now as Record<string, unknown>) || {};
  const rainSumObj = (valuesObj.rain_sum as Record<string, unknown>) || {};
  const wlListObj = (valuesObj.water_level_value_list as Record<string, unknown>) || {};
  const wlSingleObj = (valuesObj.water_level as Record<string, unknown>) || {};

  // 1. ค่าน้ำฝน: 07:00-ปัจจุบัน และ ฝน 1 วัน (24ชม.)
  const rainNow =
    cleanTeleRidNumber(rainSumNowObj.value ?? item.rain7toNow ?? item.rainfall) ?? null;
  let rain1Day: number | null = rainNow;
  if (Array.isArray(rainSumObj.value) && rainSumObj.value.length > 0) {
    const arr = rainSumObj.value;
    rain1Day = cleanTeleRidNumber(arr[arr.length - 1]) ?? rainNow;
  } else if (item.rain1Day !== undefined) {
    rain1Day = cleanTeleRidNumber(item.rain1Day) ?? rainNow;
  }

  // 2. ระดับน้ำ: [เหนือน้ำ ม.รทก., เหนือน้ำ ม.รสม., ท้ายน้ำ ม.รทก., ท้ายน้ำ ม.รสม.]
  const valList = Array.isArray(wlListObj.value) ? wlListObj.value : [];
  const rawWlUpRtk =
    parseRawTeleRidNumber(valList[0]) ??
    parseRawTeleRidNumber(wlSingleObj.value ?? item.waterLevelUp_RTK ?? item.water_level);
  const rawWlUpRsm = parseRawTeleRidNumber(valList[1] ?? item.waterLevelUp_RSM);
  const rawWlDownRtk = parseRawTeleRidNumber(valList[2] ?? item.waterLevelDown_RTK);
  const rawWlDownRsm = parseRawTeleRidNumber(valList[3] ?? item.waterLevelDown_RSM);

  const wlUpRtk = cleanTeleRidNumber(rawWlUpRtk);
  const wlUpRsm = cleanTeleRidNumber(rawWlUpRsm);
  const wlDownRtk = cleanTeleRidNumber(rawWlDownRtk);
  const wlDownRsm = cleanTeleRidNumber(rawWlDownRsm);

  // 3. การเชื่อมต่อ: ออนไลน์ / ออฟไลน์
  const measureObj = (item.measure as Record<string, unknown>) || {};
  const unixtime = Number(wlSingleObj.unixtime ?? 0);
  const hasData =
    wlUpRtk !== null ||
    wlDownRtk !== null ||
    (rainNow !== null && rainNow >= 0) ||
    unixtime > 0 ||
    Boolean(measureObj.wl || measureObj.r);

  const rawStatusStr = String(
    item.status || item.alertStatus || item.water_state || item.state || ''
  ).trim();
  const upperStatus = rawStatusStr.toUpperCase();

  const isExplicitOffline =
    item.onlineStatus === 'ออฟไลน์' ||
    item.connection === 'offline' ||
    item.is_online === false ||
    item.is_display === false ||
    rawStatusStr === 'ขัดข้อง' ||
    rawStatusStr === 'ออฟไลน์' ||
    upperStatus === 'OFFLINE';

  const isOnline = isExplicitOffline ? false : item.onlineStatus === 'ออนไลน์' ? true : hasData;
  const onlineStatus: 'ออนไลน์' | 'ออฟไลน์' = isOnline ? 'ออนไลน์' : 'ออฟไลน์';

  // 4. สถานะระดับน้ำจริง (ปกติ / เตือนภัย / วิกฤติ / ขัดข้อง)
  // กฎเหล็ก: ห้ามเดาสุ่มและห้ามนำ wlUpRtk (ม.รทก. 100-400 ม.) ไปเทียบกับ warningThreshold ที่เป็น 0 หรือหน่วย ม.รสม.!
  const wlCrit = cleanTeleRidNumber(item.water_level_critical ?? item.criticalThreshold);
  const wlWarn = cleanTeleRidNumber(item.water_level_warning ?? item.warningThreshold);
  let alertStatus: 'ปกติ' | 'เตือนภัย' | 'วิกฤติ' | 'ขัดข้อง' = isOnline ? 'ปกติ' : 'ขัดข้อง';

  if (!isOnline) {
    alertStatus = 'ขัดข้อง';
  } else if (
    item.is_critical === true ||
    item.type === 'CRITICAL' ||
    rawStatusStr === 'วิกฤติ' ||
    rawStatusStr === 'วิกฤต' ||
    upperStatus === 'CRITICAL' ||
    upperStatus === 'DANGER' ||
    item.level_status === 3 ||
    item.level_status === '3'
  ) {
    alertStatus = 'วิกฤติ';
  } else if (
    item.is_warning === true ||
    item.type === 'WARNING' ||
    rawStatusStr === 'เตือนภัย' ||
    rawStatusStr === 'เฝ้าระวัง' ||
    upperStatus === 'WARNING' ||
    upperStatus === 'WARN' ||
    item.level_status === 2 ||
    item.level_status === '2'
  ) {
    alertStatus = 'เตือนภัย';
  } else if (
    wlUpRtk !== null &&
    wlWarn !== null &&
    wlCrit !== null &&
    wlWarn > 10 &&
    wlCrit > wlWarn &&
    wlCrit - wlWarn <= 8 &&
    Math.abs(wlUpRtk - wlWarn) <= 6
  ) {
    // เปรียบเทียบเฉพาะกรณีที่เกณฑ์เตือนภัยและวิกฤติอยู่ในระดับความสูง ม.รทก. เดียวกับระดับน้ำจริงเท่านั้น
    if (wlUpRtk >= wlCrit) alertStatus = 'วิกฤติ';
    else if (wlUpRtk >= wlWarn) alertStatus = 'เตือนภัย';
    else alertStatus = 'ปกติ';
  }

  const locObj = (item.location as Record<string, unknown>) || {};

  return {
    stationCode: rawCode,
    stationName,
    basin,
    stationType: (() => {
      const explicit = String(item.stationType || '').trim();
      if (explicit === 'สถานีวัดระดับน้ำ + น้ำฝน' || explicit === 'สถานีวัดระดับน้ำอย่างเดียว' || explicit === 'สถานีน้ำฝนอย่างเดียว') {
        return explicit;
      }
      const hasWl = Boolean(measureObj.wl || wlUpRtk !== null || wlUpRsm !== null || wlDownRtk !== null || wlDownRsm !== null);
      const isRainCode = /-R\d+$/i.test(rawCode);
      const hasRain = Boolean(measureObj.r || isRainCode || rainNow !== null || rain1Day !== null);
      if (hasWl && hasRain) return 'สถานีวัดระดับน้ำ + น้ำฝน';
      if (hasWl && !hasRain) return 'สถานีวัดระดับน้ำอย่างเดียว';
      return 'สถานีน้ำฝนอย่างเดียว';
    })(),
    province: String(item.province || item.province_name || ''),
    amphur: String(item.amphur || item.amphoe_name || item.district || ''),
    tambon: String(item.tambon || item.tambon_name || item.subdistrict || ''),
    onlineStatus,
    alertStatus,
    status: alertStatus,
    rain7toNow: rainNow,
    rain1Day,
    waterLevelUp_RTK: wlUpRtk,
    waterLevelUp_RSM: wlUpRsm,
    waterLevelDown_RTK: wlDownRtk,
    waterLevelDown_RSM: wlDownRsm,
    rawWaterLevelUp_RTK: rawWlUpRtk,
    rawWaterLevelUp_RSM: rawWlUpRsm,
    rawWaterLevelDown_RTK: rawWlDownRtk,
    rawWaterLevelDown_RSM: rawWlDownRsm,
    warningThreshold: wlWarn,
    criticalThreshold: wlCrit,
    location: {
      lat: cleanTeleRidNumber(locObj.y ?? locObj.lat),
      lng: cleanTeleRidNumber(locObj.x ?? locObj.lng),
    },
    recordedAt: (() => {
      if (typeof item.stationDatetime === 'string' && item.stationDatetime.trim()) {
        return item.stationDatetime.trim();
      }
      if (item.updatedAt) {
        const dt = new Date(item.updatedAt as string | number | Date);
        if (!Number.isNaN(dt.getTime())) {
          return dt.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });
        }
      }
      return String(item.recordedAt || new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }));
    })(),
    updatedAt: new Date().toISOString(),
    sourceChannel,
  };
}

/**
 * ล้างข้อมูลแคชเก่าที่อาจมีชื่อสถานีเป็นชื่อลุ่มน้ำ ("ลุ่มน้ำมูล") หรือสถานะเตือนภัยผิดพลาด
 */
export function sanitizeStationRow(st: TeleRidStationDetailedRow): TeleRidStationDetailedRow | null {
  if (!st || !st.stationCode) return null;
  const matched = lookupOfficialTeleRidStationByCode(st.stationCode);
  const fixedName = !isInvalidOrBasinStationName(st.stationName)
    ? st.stationName
    : matched?.fullLabel || st.stationCode;
  const fixedBasin = resolveStationBasinName(st.basin, st.stationCode);
  return {
    ...st,
    stationName: fixedName,
    basin: fixedBasin,
  };
}

/**
 * โหลดแคชข้อมูลสถานีจากดิสก์เมื่อเปิดเซิร์ฟเวอร์ (ตรวจสอบ CACHE_SCHEMA_VERSION เพื่อล้างค่าผิดพลาดรุ่นเก่าทิ้ง)
 */
export function loadCachedStationsFromDisk(): TeleRidStationDetailedRow[] {
  try {
    if (fs.existsSync(LOCAL_STATIONS_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LOCAL_STATIONS_CACHE_FILE, 'utf-8'));
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        if (raw.schemaVersion === CACHE_SCHEMA_VERSION && Array.isArray(raw.stations)) {
          for (const st of raw.stations) {
            const cleanSt = sanitizeStationRow(st as TeleRidStationDetailedRow);
            if (cleanSt) {
              inMemoryStationsMap.set(cleanSt.stationCode, cleanSt);
            }
          }
        } else {
          // ลบแคชรุ่นเก่าที่มีปัญหาเตือนภัยเกินจริงทิ้งทันที
          try {
            fs.unlinkSync(LOCAL_STATIONS_CACHE_FILE);
          } catch {
            // ignore
          }
        }
      } else {
        // รูปแบบเก่าที่เป็น Array เปล่าๆ ลบทิ้งทันทีเพื่อไม่ให้ค่าเตือนภัยมั่วค้าง
        try {
          fs.unlinkSync(LOCAL_STATIONS_CACHE_FILE);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  return Array.from(inMemoryStationsMap.values());
}

export function saveCachedStationsToDisk(): void {
  try {
    if (!fs.existsSync(WORKSPACE_DIR)) {
      fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    }
    const list = Array.from(inMemoryStationsMap.values());
    fs.writeFileSync(
      LOCAL_STATIONS_CACHE_FILE,
      JSON.stringify(
        {
          schemaVersion: CACHE_SCHEMA_VERSION,
          updatedAt: new Date().toISOString(),
          stations: list,
        },
        null,
        2
      ),
      'utf-8'
    );
  } catch {
    // ignore
  }
}

export function upsertStationsIntoMemoryAndDisk(rows: TeleRidStationDetailedRow[]): number {
  let count = 0;
  for (const rawRow of rows) {
    const r = sanitizeStationRow(rawRow);
    if (!r || !r.stationCode) continue;
    const existing = inMemoryStationsMap.get(r.stationCode);
    inMemoryStationsMap.set(r.stationCode, {
      ...(existing || {}),
      ...r,
      stationName: !isInvalidOrBasinStationName(r.stationName)
        ? r.stationName
        : existing && !isInvalidOrBasinStationName(existing.stationName)
        ? existing.stationName
        : r.stationCode,
      waterLevelUp_RTK: r.waterLevelUp_RTK ?? existing?.waterLevelUp_RTK ?? null,
      waterLevelUp_RSM: r.waterLevelUp_RSM ?? existing?.waterLevelUp_RSM ?? null,
      waterLevelDown_RTK: r.waterLevelDown_RTK ?? existing?.waterLevelDown_RTK ?? null,
      waterLevelDown_RSM: r.waterLevelDown_RSM ?? existing?.waterLevelDown_RSM ?? null,
      rain7toNow: r.rain7toNow ?? existing?.rain7toNow ?? null,
      rain1Day: r.rain1Day ?? existing?.rain1Day ?? null,
    });
    count++;
  }
  if (count > 0) {
    saveCachedStationsToDisk();
  }
  return count;
}

export function getAllSyncedStations(filter?: {
  basins?: string[];
  status?: string;
}): TeleRidStationDetailedRow[] {
  if (inMemoryStationsMap.size === 0) {
    loadCachedStationsFromDisk();
  }
  let list = Array.from(inMemoryStationsMap.values());
  if (filter?.basins && filter.basins.length > 0 && !filter.basins.includes('ALL')) {
    list = list.filter((st) => doesStationMatchSelectedBasins(st, filter.basins!));
  }
  if (filter?.status && filter.status !== 'ALL') {
    list = list.filter(
      (st) => st.status === filter.status || st.alertStatus === filter.status
    );
  }
  return list.sort((a, b) => a.stationCode.localeCompare(b.stationCode));
}

/**
 * บันทึกข้อมูลสถานีลง MongoDB (`mongodb://127.0.0.1:27017` -> `telerid_db.stations`) ด้วย BulkWrite
 */
export async function syncStationsToLocalMongoDb(
  stations: TeleRidStationDetailedRow[]
): Promise<{ syncedToMongo: boolean; mongoCount: number; fromMongoRows: TeleRidStationDetailedRow[]; mongoStatus: MongoConnectionStatus }> {
  const uri = runtimeMongoUri || process.env.MONGO_URI || MONGO_URI;
  const dbName = runtimeDbName || process.env.DB_NAME || DB_NAME;
  const collName = runtimeCollectionName || process.env.COLLECTION_NAME || COLLECTION_NAME;
  const checkedAt = new Date().toLocaleString('th-TH');
  let client: MongoClient | null = null;
  try {
    client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 3500,
      connectTimeoutMS: 3500,
    });
    await client.connect();
    const db = client.db(dbName);
    const collection = db.collection(collName);

    const totalDocsInCollection = await collection.countDocuments().catch(() => 0);

    if (stations.length > 0) {
      const bulkOps = stations.map((st) => ({
        updateOne: {
          filter: { stationCode: st.stationCode },
          update: {
            $set: {
              ...st,
              schemaVersion: CACHE_SCHEMA_VERSION,
              updatedAt: new Date(),
            },
          },
          upsert: true,
        },
      }));
      await collection.bulkWrite(bulkOps);
    }

    const docs = await collection
      .find({})
      .sort({ stationCode: 1, code: 1 })
      .limit(2500)
      .toArray();
    const fromMongoRows: TeleRidStationDetailedRow[] = [];
    for (const d of docs) {
      const parsed = parseTeleRidWsStationItem(d as unknown as Record<string, unknown>, 'MONGODB');
      if (parsed) {
        const stTimeMs = parseStationTimestampMs(d.stationDatetime || d.datetime || d.recordedAt);
        const isOver1HourOffline = stTimeMs !== null && (Date.now() - stTimeMs > 60 * 60 * 1000);

        if (isOver1HourOffline || d.onlineStatus === 'ออฟไลน์') {
          parsed.onlineStatus = 'ออฟไลน์';
          parsed.alertStatus = 'ขัดข้อง';
        } else {
          if (d.onlineStatus === 'ออนไลน์') {
            parsed.onlineStatus = 'ออนไลน์';
          }
          const rawAlert = String(d.alertStatus || d.status || '').trim();
          if (rawAlert === 'ปกติ' || rawAlert === 'เตือนภัย' || rawAlert === 'วิกฤติ' || rawAlert === 'ขัดข้อง') {
            parsed.alertStatus = rawAlert;
          }
        }
        parsed.status = parsed.alertStatus;
        parsed.rain7toNow = cleanTeleRidNumber(
          d.rain7toNow ?? d.rain_7to_now ?? d.rain_today ?? parsed.rain7toNow
        );
        parsed.rain1Day = cleanTeleRidNumber(
          d.rain1Day ?? d.rain_1d ?? d.rain_24h ?? parsed.rain1Day
        );
        parsed.waterLevelUp_RTK = cleanTeleRidNumber(
          d.waterLevelUp_RTK ?? d.wl_up_rtk ?? d.water_level_msl ?? parsed.waterLevelUp_RTK
        );
        parsed.waterLevelUp_RSM = cleanTeleRidNumber(
          d.waterLevelUp_RSM ?? d.wl_up_rsm ?? d.water_level_rsm ?? parsed.waterLevelUp_RSM
        );
        parsed.waterLevelDown_RTK = cleanTeleRidNumber(
          d.waterLevelDown_RTK ?? d.wl_down_rtk ?? parsed.waterLevelDown_RTK
        );
        parsed.waterLevelDown_RSM = cleanTeleRidNumber(
          d.waterLevelDown_RSM ?? d.wl_down_rsm ?? parsed.waterLevelDown_RSM
        );
        fromMongoRows.push(parsed);
      }
    }

    inMemoryStationsMap.clear();
    if (fromMongoRows.length > 0) {
      upsertStationsIntoMemoryAndDisk(fromMongoRows);
    }

    await client.close();
    lastMongoStatus = {
      connected: true,
      mongoUriMasked: maskMongoUri(uri),
      dbName,
      collectionName: collName,
      totalDocsInCollection: Math.max(totalDocsInCollection, docs.length),
      fetchedRowsCount: fromMongoRows.length,
      fetchSuccess: fromMongoRows.length > 0,
      lastCheckedAt: checkedAt,
      errorMessage: fromMongoRows.length > 0 ? null : `เชื่อมต่อ ${dbName}.${collName} ได้ แต่ไม่พบข้อมูลสถานี (0 แถว)`,
    };

    return {
      syncedToMongo: true,
      mongoCount: fromMongoRows.length,
      fromMongoRows,
      mongoStatus: lastMongoStatus,
    };
  } catch (err: unknown) {
    if (client) {
      await client.close().catch(() => {});
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    lastMongoStatus = {
      connected: false,
      mongoUriMasked: maskMongoUri(uri),
      dbName,
      collectionName: collName,
      totalDocsInCollection: 0,
      fetchedRowsCount: 0,
      fetchSuccess: false,
      lastCheckedAt: checkedAt,
      errorMessage: errMsg,
    };
    return { syncedToMongo: false, mongoCount: 0, fromMongoRows: [], mongoStatus: lastMongoStatus };
  }
}

/**
 * 1. ดึงข้อมูลสดจากท่อ WebSocket `wss://telerid.rid.go.th/ws/public/`
 */
export function fetchFromTeleRidLiveWebSocket(timeoutMs = 12000): Promise<TeleRidStationDetailedRow[]> {
  return new Promise((resolve) => {
    let isResolved = false;
    let ws: WebSocket | null = null;

    const finish = (rows: TeleRidStationDetailedRow[]) => {
      if (isResolved) return;
      isResolved = true;
      clearTimeout(timer);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      resolve(rows);
    };

    const timer = setTimeout(() => {
      finish([]);
    }, timeoutMs);

    try {
      ws = new WebSocket(TELERID_WS_URL, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Origin: 'https://telerid.rid.go.th',
        },
      });

      ws.on('message', (data) => {
        try {
          const text = data.toString();
          const parsed = JSON.parse(text);
          let payload = parsed;
          if (typeof parsed.message === 'string') {
            try {
              payload = JSON.parse(parsed.message);
            } catch {
              payload = parsed;
            }
          }

          if ((payload.type === 'INIT' || payload.data) && typeof payload.data === 'object') {
            const dict = payload.data as Record<string, Record<string, unknown>>;
            const keys = Object.keys(dict);
            const results: TeleRidStationDetailedRow[] = [];

            try {
              if (!fs.existsSync(WORKSPACE_DIR)) fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
              fs.writeFileSync(
                path.join(WORKSPACE_DIR, 'telerid_ws_init.json'),
                text,
                'utf-8'
              );
            } catch {
              // ignore
            }

            for (const k of keys) {
              const row = parseTeleRidWsStationItem(dict[k], 'WS_LIVE');
              if (row) results.push(row);
            }

            if (results.length > 0) {
              finish(results);
            }
          }
        } catch {
          // ignore non-json message
        }
      });

      ws.on('error', () => finish([]));
      ws.on('close', () => finish([]));
    } catch {
      finish([]);
    }
  });
}

/**
 * 2. ดึงข้อมูลจากไฟล์ telerid_ws_init.json และ telerid_real_alarm.csv ในเครื่อง (ถ้ามี)
 */
export function importStationsFromLocalWsJsonAndCsv(): TeleRidStationDetailedRow[] {
  const rows: TeleRidStationDetailedRow[] = [];

  const possibleWsJsonPaths = [
    path.join(process.cwd(), 'telerid_ws_init.json'),
    path.join(WORKSPACE_DIR, 'telerid_ws_init.json'),
    path.join(USER_DOWNLOADS_DIR, 'telerid_ws_init.json'),
    path.join(USER_DESKTOP_DIR, 'agent-orchestrator', 'telerid_ws_init.json'),
    path.join(USER_DESKTOP_DIR, 'telerid_ws_init.json'),
  ];

  for (const jsonPath of possibleWsJsonPaths) {
    if (fs.existsSync(jsonPath)) {
      try {
        const content = fs.readFileSync(jsonPath, 'utf-8').trim();
        const rootObj = JSON.parse(content);
        let payload = rootObj;
        if (typeof rootObj.message === 'string') {
          try {
            payload = JSON.parse(rootObj.message);
          } catch {
            payload = rootObj;
          }
        }
        const stationsDict = (payload.data || payload) as Record<string, Record<string, unknown>>;
        for (const key of Object.keys(stationsDict)) {
          const parsed = parseTeleRidWsStationItem(stationsDict[key], 'LOCAL_FILE');
          if (parsed) rows.push(parsed);
        }
        if (rows.length > 0) break;
      } catch {
        // ignore
      }
    }
  }

  const possibleCsvPaths = [
    path.join(USER_DOWNLOADS_DIR, 'telerid_real_alarm.csv'),
    path.join(process.cwd(), 'telerid_real_alarm.csv'),
    path.join(WORKSPACE_DIR, 'telerid_real_alarm.csv'),
  ];

  for (const csvPath of possibleCsvPaths) {
    if (fs.existsSync(csvPath)) {
      try {
        const lines = fs
          .readFileSync(csvPath, 'utf-8')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length > 1) {
          const headers = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map((c) => c.replace(/"/g, '').trim());
            const rec: Record<string, string> = {};
            headers.forEach((h, idx) => {
              rec[h] = cols[idx] || '';
            });
            const code = rec.Station_Code || rec['Station Code'] || '';
            const rawName = rec.Station_Name || rec['Station Name'] || '';
            const matched = lookupOfficialTeleRidStationByCode(code);
            const name = !isInvalidOrBasinStationName(rawName)
              ? rawName
              : matched?.fullLabel || code;
            const val = parseFloat(rec.Value || '');
            const statusType = (rec.Type || 'NORMAL').toUpperCase();
            const dt = rec.DateTime || new Date().toLocaleString('th-TH');
            if (code && code !== 'UNKNOWN') {
              const alertSt: TeleRidStationDetailedRow['alertStatus'] =
                statusType.includes('CRIT') || statusType.includes('วิกฤต')
                  ? 'วิกฤติ'
                  : statusType.includes('WARN') || statusType.includes('เตือน')
                  ? 'เตือนภัย'
                  : 'ปกติ';
              rows.push({
                stationCode: code,
                stationName: name,
                basin: resolveStationBasinName('', code),
                province: '',
                amphur: '',
                tambon: '',
                onlineStatus: 'ออนไลน์',
                alertStatus: alertSt,
                status: alertSt,
                rain7toNow: null,
                rain1Day: null,
                waterLevelUp_RTK: Number.isNaN(val) ? null : val,
                waterLevelUp_RSM: null,
                waterLevelDown_RTK: null,
                waterLevelDown_RSM: null,
                warningThreshold: null,
                criticalThreshold: null,
                location: { lat: null, lng: null },
                recordedAt: dt,
                sourceChannel: 'LOCAL_FILE',
              });
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }

  return rows;
}

/**
 * 3. ดึงข้อมูลผ่าน REST API Token ของ TeleRID
 */
export async function fetchFromTeleRidTokenApi(): Promise<TeleRidStationDetailedRow[]> {
  if (!TELERID_API_TOKEN) return [];
  const endpoints = [
    'https://telerid.rid.go.th/api/stations',
    'https://rid.go.th',
  ];
  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          Authorization: `token ${TELERID_API_TOKEN}`,
        },
        signal: controller.signal,
      });
      clearTimeout(t);
      if (!res.ok) continue;
      const cType = res.headers.get('content-type') || '';
      if (!cType.includes('json')) continue;
      const data = await res.json();
      const list = Array.isArray(data) ? data : data?.results || data?.data || [];
      if (Array.isArray(list) && list.length > 0) {
        const rows: TeleRidStationDetailedRow[] = [];
        for (const item of list) {
          const parsed = parseTeleRidWsStationItem(item as Record<string, unknown>, 'REST_TOKEN_API');
          if (parsed) rows.push(parsed);
        }
        if (rows.length > 0) return rows;
      }
    } catch {
      // ignore
    }
  }
  return [];
}

/**
 * ฟังก์ชันหลักสำหรับซิงค์ข้อมูลจากทุกช่องทางจริง (WebSocket `wss://telerid.rid.go.th/ws/public/`, Token API, Local JSON/CSV, และ MongoDB)
 */
export async function syncAllTeleRidStationsEngine(): Promise<{
  ok: boolean;
  totalSynced: number;
  wsCount: number;
  localFileCount: number;
  tokenApiCount: number;
  syncedToMongo: boolean;
  mongoStatus: MongoConnectionStatus;
  stations: TeleRidStationDetailedRow[];
}> {
  const mongoResult = await syncStationsToLocalMongoDb([]);
  const finalStations = Array.from(inMemoryStationsMap.values()).sort((a, b) =>
    a.stationCode.localeCompare(b.stationCode)
  );

  return {
    ok: mongoResult.syncedToMongo && finalStations.length > 0,
    totalSynced: finalStations.length,
    wsCount: 0,
    localFileCount: 0,
    tokenApiCount: 0,
    syncedToMongo: mongoResult.syncedToMongo,
    mongoStatus: mongoResult.mongoStatus,
    stations: finalStations,
  };
}

/**
 * ============================================================================
 * โหมดผู้ช่วยเลขา AI (AI Secretary Mode — เปิด Chrome Profile 5 ค้างไว้ให้ผู้ใช้คลิกดูข้อมูล
 * และคอยจดบันทึกข้อมูลทุกสถานีจนกว่าผู้ใช้จะกดปิดโปรแกรม Google Chrome)
 * ============================================================================
 */
interface ActiveSecretaryState {
  isActive: boolean;
  startedAtIso: string;
  startedAtText: string;
  selectedBasins: string[];
  observedBasinsSet: Set<string>;
  recordedStationsMap: Map<string, TeleRidStationDetailedRow>;
  explicitlyClickedStationCodes: Set<string>;
  recordedCctvMap: Map<
    string,
    {
      stationCode: string;
      stationName: string;
      imageDisplayStatus: 'แสดงภาพได้ปกติ' | 'ไม่แสดงภาพ (กล่องสีเทา/ไอคอนเสีย)';
      imageTimestampText?: string;
      lagMinutes: number;
      reason: string;
    }
  >;
  userInteractionsCount: number;
  lastObservedAction: string;
  summaryCards: {
    online: number | null;
    warning: number | null;
    critical: number | null;
    offline: number | null;
    totalStations: number | null;
  };
  closeSessionAndFinalize?: () => Promise<void>;
}

let activeSecretaryState: ActiveSecretaryState | null = null;

export function getActiveSecretarySnapshot(): SecretaryProgressSnapshot | null {
  if (!activeSecretaryState) return null;
  const activeBasins = Array.from(activeSecretaryState.observedBasinsSet);
  const allRows = Array.from(activeSecretaryState.recordedStationsMap.values());
  const filteredRows = allRows.filter(
    (r) =>
      activeSecretaryState!.explicitlyClickedStationCodes.has(r.stationCode) ||
      doesStationMatchSelectedBasins(r, activeBasins)
  );
  const rows = filteredRows.length > 0 ? filteredRows : allRows;
  const abnormalCount = rows.filter((r) => r.alertStatus !== 'ปกติ').length;
  const preview = rows.slice(-40).reverse();
  return {
    isActive: activeSecretaryState.isActive,
    startedAtIso: activeSecretaryState.startedAtIso,
    startedAtText: activeSecretaryState.startedAtText,
    selectedBasins: activeSecretaryState.selectedBasins,
    observedBasinsOnScreen: activeBasins,
    stationsRecordedCount: rows.length,
    stationsCapturedCount: rows.length,
    abnormalStationsCount: abnormalCount,
    cctvRecordedCount: activeSecretaryState.recordedCctvMap.size,
    userInteractionsCount: activeSecretaryState.userInteractionsCount,
    userInteractionCount: activeSecretaryState.userInteractionsCount,
    lastObservedAction: activeSecretaryState.lastObservedAction,
    lastActionDescription: activeSecretaryState.lastObservedAction,
    summaryCards: activeSecretaryState.summaryCards,
    recentStationsPreview: preview,
    latestStationsPreview: preview,
  };
}

export async function forceFinishActiveSecretarySession(): Promise<boolean> {
  if (activeSecretaryState && typeof activeSecretaryState.closeSessionAndFinalize === 'function') {
    try {
      await activeSecretaryState.closeSessionAndFinalize();
    } catch {
      // ignore
    }
    return true;
  }
  return false;
}

/**
 * แปลงข้อความ 1 แถวตารางที่เลขา AI มองเห็นบนหน้าเว็บ TeleRID ให้เป็น `TeleRidStationDetailedRow`
 * กฎเหล็ก:
 * 1) ห้ามนำคำว่า "ลุ่มน้ำ..." มาตั้งเป็นชื่อสถานีเด็ดขาด (ใช้ชื่อทางการจาก constants.js หรือชื่อจริงในเซลล์แรก)
 * 2) ห้ามใช้ Regex `/warn|yellow|red/` กับ `rowHtml` ทั้งแถว เพราะ HTML ของตารางมีคลาสสีเหลือง/แดงซ่อนอยู่ในทุกแถวทำให้ขึ้นเตือนภัยมั่วทั้งหมด!
 *    ให้ตรวจจากข้อความในเซลล์สถานะ (`ปกติ`, `เตือนภัย`, `วิกฤติ`, `วิกฤต`, `ขัดข้อง`, `ออฟไลน์`, `ออนไลน์`) เท่านั้น!
 */
export function parseDomRowIntoStationDetailedRow(
  cells: string[],
  rawRowText: string,
  _rowHtml: string,
  preferredBasins: string[]
): TeleRidStationDetailedRow | null {
  const cleanCells = cells.map((c) => String(c || '').replace(/\s+/g, ' ').trim());
  const joined = cleanCells.join(' | ');
  if (!joined || /ชื่อสถานี.*การเชื่อมต่อ|รหัสสถานี.*ระดับน้ำ/i.test(joined)) return null;

  const codeMatch = rawRowText.match(
    /\b(?:TMN|TKH|TKS|TKL|TSN|TM|TE|LP|Tpat|Tkol|BNR|TTC|TC|TSK|TS|TTP|TK)(?:[.\-\s]+R?\d+[A-Za-z0-9]*)(?:\s*\(U\/S\)\s*,?\s*\(D\/S\))?/i
  );
  const firstCellCode = cleanCells[0] || '';
  const stationCode = codeMatch
    ? codeMatch[0].replace(/\s+/g, ' ').trim()
    : /^[A-Za-z]{2,5}[.\-\s]?\d+/i.test(firstCellCode)
    ? firstCellCode
    : '';

  if (!stationCode) return null;

  const matchedOfficial = lookupOfficialTeleRidStationByCode(stationCode, preferredBasins);

  // ค้นหาชื่อสถานีจริง (ห้ามใช้เซลล์ที่เป็นชื่อลุ่มน้ำ เช่น "ลุ่มน้ำมูล" เด็ดขาด!)
  let stationName = matchedOfficial?.fullLabel || '';
  if (!stationName) {
    const cell0WithoutCode = firstCellCode.replace(stationCode, '').trim();
    if (cell0WithoutCode.length > 2 && !isInvalidOrBasinStationName(cell0WithoutCode)) {
      stationName = firstCellCode;
    } else if (
      cleanCells[1] &&
      !isInvalidOrBasinStationName(cleanCells[1]) &&
      !/^-?\d+(\.\d+)?$/.test(cleanCells[1])
    ) {
      stationName = `${stationCode} ${cleanCells[1]}`.trim();
    } else {
      stationName = stationCode;
    }
  }

  const basinCell = cleanCells.find((c) => c.startsWith('ลุ่มน้ำ'));
  const basin = resolveStationBasinName(basinCell, stationCode, preferredBasins);

  // ตรวจจับการเชื่อมต่อ (ออนไลน์ / ออฟไลน์) และ ระดับน้ำ (ปกติ / เตือนภัย / วิกฤติ / ขัดข้อง)
  // โดยดูจากข้อความจริงในเซลล์ของตารางเท่านั้น ห้ามดูจาก innerHTML ของแถว
  let onlineStatus: 'ออนไลน์' | 'ออฟไลน์' = 'ออนไลน์';
  let alertStatus: 'ปกติ' | 'เตือนภัย' | 'วิกฤติ' | 'ขัดข้อง' = 'ปกติ';
  let lastStatusCellIdx = 0;

  for (let i = 1; i < cleanCells.length; i++) {
    const c = cleanCells[i];
    if (c.startsWith('ลุ่มน้ำ')) {
      lastStatusCellIdx = Math.max(lastStatusCellIdx, i);
      continue;
    }
    if (/^(ออฟไลน์|ขาดการเชื่อมต่อ|offline)$/i.test(c)) {
      onlineStatus = 'ออฟไลน์';
      alertStatus = 'ขัดข้อง';
      lastStatusCellIdx = Math.max(lastStatusCellIdx, i);
    } else if (/^(ออนไลน์|online)$/i.test(c)) {
      onlineStatus = 'ออนไลน์';
      lastStatusCellIdx = Math.max(lastStatusCellIdx, i);
    } else if (/^(วิกฤติ|วิกฤต|critical)$/i.test(c)) {
      alertStatus = 'วิกฤติ';
      lastStatusCellIdx = Math.max(lastStatusCellIdx, i);
    } else if (/^(เตือนภัย|เฝ้าระวัง|warning)$/i.test(c)) {
      alertStatus = 'เตือนภัย';
      lastStatusCellIdx = Math.max(lastStatusCellIdx, i);
    } else if (/^(ขัดข้อง)$/.test(c)) {
      onlineStatus = 'ออฟไลน์';
      alertStatus = 'ขัดข้อง';
      lastStatusCellIdx = Math.max(lastStatusCellIdx, i);
    } else if (/^(ปกติ|normal)$/i.test(c)) {
      if (alertStatus === 'ปกติ') alertStatus = 'ปกติ';
      lastStatusCellIdx = Math.max(lastStatusCellIdx, i);
    }
  }

  // สกัดตัวเลข 6 คอลัมน์ต่อจากคอลัมน์สถานะ:
  // [ฝน 07:00-ปัจจุบัน, ฝน 1 วัน (24ชม.), เหนือน้ำ (ม.รทก.), เหนือน้ำ (ม.รสม.), ท้ายน้ำ (ม.รทก.), ท้ายน้ำ (ม.รสม.)]
  const startNumIdx = lastStatusCellIdx > 0 ? lastStatusCellIdx + 1 : 2;
  const numericValuesFromCells: (number | null)[] = [];

  for (let i = startNumIdx; i < cleanCells.length; i++) {
    const c = cleanCells[i];
    if (!c || c === '-' || c === '--' || c === 'N/A' || c === 'ไม่มีข้อมูล') {
      numericValuesFromCells.push(null);
      continue;
    }
    const m = c.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/);
    if (m) {
      const parsed = parseFloat(m[0].replace(/,/g, ''));
      numericValuesFromCells.push(Number.isNaN(parsed) ? null : parsed);
    } else {
      numericValuesFromCells.push(null);
    }
  }

  const rain7toNow = numericValuesFromCells.length >= 1 ? numericValuesFromCells[0] : null;
  const rain1Day = numericValuesFromCells.length >= 2 ? numericValuesFromCells[1] : null;
  const rawWlUpRtk = numericValuesFromCells.length >= 3 ? numericValuesFromCells[2] : null;
  const rawWlUpRsm = numericValuesFromCells.length >= 4 ? numericValuesFromCells[3] : null;
  const rawWlDownRtk = numericValuesFromCells.length >= 5 ? numericValuesFromCells[4] : null;
  const rawWlDownRsm = numericValuesFromCells.length >= 6 ? numericValuesFromCells[5] : null;

  return {
    stationCode,
    stationName,
    basin,
    stationType: (() => {
      const explicit = String(item.stationType || '').trim();
      if (explicit === 'สถานีวัดระดับน้ำ + น้ำฝน' || explicit === 'สถานีวัดระดับน้ำอย่างเดียว' || explicit === 'สถานีน้ำฝนอย่างเดียว') {
        return explicit;
      }
      const hasWl = Boolean(measureObj.wl || wlUpRtk !== null || wlUpRsm !== null || wlDownRtk !== null || wlDownRsm !== null);
      const isRainCode = /-R\d+$/i.test(rawCode);
      const hasRain = Boolean(measureObj.r || isRainCode || rainNow !== null || rain1Day !== null);
      if (hasWl && hasRain) return 'สถานีวัดระดับน้ำ + น้ำฝน';
      if (hasWl && !hasRain) return 'สถานีวัดระดับน้ำอย่างเดียว';
      return 'สถานีน้ำฝนอย่างเดียว';
    })(),
    province: '',
    amphur: '',
    tambon: '',
    onlineStatus,
    alertStatus,
    status: alertStatus,
    rain7toNow: cleanTeleRidNumber(rain7toNow),
    rain1Day: cleanTeleRidNumber(rain1Day),
    waterLevelUp_RTK: cleanTeleRidNumber(rawWlUpRtk),
    waterLevelUp_RSM: cleanTeleRidNumber(rawWlUpRsm),
    waterLevelDown_RTK: cleanTeleRidNumber(rawWlDownRtk),
    waterLevelDown_RSM: cleanTeleRidNumber(rawWlDownRsm),
    rawWaterLevelUp_RTK: rawWlUpRtk,
    rawWaterLevelUp_RSM: rawWlUpRsm,
    rawWaterLevelDown_RTK: rawWlDownRtk,
    rawWaterLevelDown_RSM: rawWlDownRsm,
    warningThreshold: null,
    criticalThreshold: null,
    location: { lat: null, lng: null },
    recordedAt: new Date().toLocaleString('th-TH'),
    updatedAt: new Date().toISOString(),
    sourceChannel: 'CHROME_SECRETARY',
  };
}

/**
 * สคริปต์ฝังตัวในหน้าเว็บ Chrome (In-Page Deep Interceptor)
 * ดักจับทั้ง:
 * 1) window.WebSocket (และเปิดท่อสำรองเชื่อม wss://telerid.rid.go.th/ws/public/ ในหน้าเว็บอัตโนมัติ)
 * 2) window.fetch และ XMLHttpRequest (ดักจับ JSON สถานี, ระดับน้ำ, น้ำฝน และรายการกล้อง CCTV บน #/cctv)
 * 3) การคลิกและการเปลี่ยนหน้า (HashChange / PopState เช่น สลับไปหน้า https://telerid.rid.go.th/#/cctv)
 */
const IN_PAGE_SECRETARY_INTERCEPTOR_SCRIPT = `
(() => {
  if (window.__govaiSecInterceptorInstalled) return;
  window.__govaiSecInterceptorInstalled = true;

  const store = (window.__govaiSecStore = window.__govaiSecStore || {
    wsPayloads: [],
    apiPayloads: [],
    cctvApiItems: [],
    userActionCount: 0,
    lastActionText: 'เปิดหน้าเว็บ TeleRID',
    visitedUrls: [window.location.href],
    directWsStarted: false,
  });

  const recordPayloadText = (rawText, sourceType) => {
    try {
      if (!rawText || typeof rawText !== 'string') return;
      const trimmed = rawText.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return;
      const parsed = JSON.parse(trimmed);
      let payload = parsed;
      if (typeof parsed.message === 'string') {
        try { payload = JSON.parse(parsed.message); } catch (_e) { payload = parsed; }
      }
      if (payload && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
        store.wsPayloads.push(payload.data);
        if (store.wsPayloads.length > 6) store.wsPayloads.shift();
        return;
      }
      const arr = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.stations)
        ? payload.stations
        : Array.isArray(payload?.cctv)
        ? payload.cctv
        : Array.isArray(payload?.cameras)
        ? payload.cameras
        : null;
      if (arr && arr.length > 0) {
        if (sourceType === 'cctv' || window.location.hash.includes('cctv')) {
          store.cctvApiItems.push(...arr.slice(0, 500));
        }
        store.apiPayloads.push(arr.slice(0, 1200));
        if (store.apiPayloads.length > 15) store.apiPayloads.shift();
      }
    } catch (_err) {}
  };

  // 1. Hook window.WebSocket
  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket) {
    const WrappedWebSocket = function (url, protocols) {
      const wsInstance = protocols ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
      try {
        wsInstance.addEventListener('message', (ev) => {
          if (typeof ev.data === 'string') {
            recordPayloadText(ev.data, 'ws');
          }
        });
      } catch (_e) {}
      return wsInstance;
    };
    WrappedWebSocket.prototype = NativeWebSocket.prototype;
    Object.assign(WrappedWebSocket, NativeWebSocket);
    window.WebSocket = WrappedWebSocket;

    // เปิดท่อดึง INIT จาก wss://telerid.rid.go.th/ws/public/ ภายใน Chrome โดยตรงเพื่อให้มีข้อมูลครบ 100% ทันที
    if (!store.directWsStarted) {
      store.directWsStarted = true;
      setTimeout(() => {
        try {
          if (store.wsPayloads.length === 0) {
            const bgWs = new NativeWebSocket('wss://telerid.rid.go.th/ws/public/');
            bgWs.addEventListener('message', (ev) => {
              if (typeof ev.data === 'string') {
                recordPayloadText(ev.data, 'ws');
                try { bgWs.close(); } catch (_e2) {}
              }
            });
          }
        } catch (_e) {}
      }, 800);
    }
  }

  // 2. Hook window.fetch
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = async function (...args) {
      const response = await nativeFetch.apply(this, args);
      try {
        const reqUrl = String((args[0] && args[0].url) || args[0] || '');
        const clone = response.clone();
        clone.text().then((txt) => {
          const isCctv = /cctv|cam/i.test(reqUrl) || window.location.hash.includes('cctv');
          recordPayloadText(txt, isCctv ? 'cctv' : 'fetch');
        }).catch(() => {});
      } catch (_e) {}
      return response;
    };
  }

  // 3. Hook XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__govaiUrl = String(url || '');
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        if (typeof this.responseText === 'string' && this.responseText.length > 10) {
          const isCctv = /cctv|cam/i.test(this.__govaiUrl || '') || window.location.hash.includes('cctv');
          recordPayloadText(this.responseText, isCctv ? 'cctv' : 'xhr');
        }
      } catch (_e) {}
    });
    return origSend.apply(this, args);
  };

  // 4. ดักจับการคลิก, เลื่อนหน้าจอ และการเปลี่ยนหน้า (#/ <-> #/cctv)
  document.addEventListener('click', (ev) => {
    store.userActionCount = (store.userActionCount || 0) + 1;
    const t = ev.target;
    const txt = ((t && (t.innerText || t.textContent)) || '').replace(/\\s+/g, ' ').trim().slice(0, 65);
    if (txt) {
      store.lastActionText = 'คลิก "' + txt + '" (' + (window.location.hash || '#/') + ')';
    }
  }, true);

  window.addEventListener('hashchange', () => {
    store.userActionCount = (store.userActionCount || 0) + 1;
    if (!store.visitedUrls.includes(window.location.href)) {
      store.visitedUrls.push(window.location.href);
    }
    store.lastActionText = 'เปลี่ยนหน้าไปยัง ' + window.location.href;
  });
})();
`;

/**
 * รันโหมดผู้ช่วยเลขา AI (AI Secretary Co-Pilot):
 * 1. ปิด Context ที่ค้างอยู่ก่อนหน้า (ถ้ามี) เพื่อให้กดเปิดใหม่ได้ไม่จำกัดจำนวนครั้งโดยไม่ติดล็อก
 * 2. เปิด Google Chrome (`"C:\Program Files\Google\Chrome\Application\chrome.exe" --profile-directory="Profile 5"`)
 * 3. ฝังสคริปต์เจาะระบบดักจับ WebSocket, Fetch, XHR, Vue Memory State และกวาดอ่าน DOM ทั้งหน้าหลัก `#/` และหน้ากล้อง `#/cctv`
 * 4. เมื่อผู้ใช้กดปุ่มกากบาทปิดหน้าต่าง Google Chrome [X] จะสั่ง `contextObj.close()` เพื่อปลดล็อกโปรไฟล์ทันที และสรุปรายงานจริงทั้งหมดขึ้นแสดงผล
 */
export async function runInteractiveChromeSecretarySession(options: {
  selectedBasins: string[];
  launchPersistentSessionFn: (
    url: string,
    opts?: { headless?: boolean }
  ) => Promise<{
    browser: unknown;
    page: unknown;
    profileDirUsed?: string;
  }>;
  chromeExePath: string;
  chromeProfileName: string;
  onProgress?: (snapshot: SecretaryProgressSnapshot) => void;
}): Promise<{
  closedBy: 'USER_CLOSED_CHROME' | 'USER_CLICKED_FINISH' | 'FALLBACK_SYNC';
  profileUsed: string;
  observedBasins: string[];
  summaryCards: {
    online: number | null;
    warning: number | null;
    critical: number | null;
    offline: number | null;
    totalStations: number | null;
  };
  recordedStations: TeleRidStationDetailedRow[];
  recordedCctv: {
    stationCode: string;
    stationName: string;
    imageDisplayStatus: 'แสดงภาพได้ปกติ' | 'ไม่แสดงภาพ (กล่องสีเทา/ไอคอนเสีย)';
    imageTimestampText?: string;
    lagMinutes: number;
    reason: string;
  }[];
  userInteractionsCount: number;
}> {
  // [MongoDB-Only Mode] ยกเลิกระบบเลขา AI / สแกน Chrome แล้ว
  return {
    closedBy: 'FALLBACK_SYNC',
    profileUsed: 'MongoDB-Only (Disabled Chrome Secretary)',
    observedBasins: options.selectedBasins || [],
    summaryCards: {
      online: null,
      warning: null,
      critical: null,
      offline: null,
      totalStations: null,
    },
    recordedStations: [],
    recordedCctv: [],
    userInteractionsCount: 0,
  };
}

export async function loadStationsFromMongoDbOnStartup(): Promise<TeleRidStationDetailedRow[]> {
  const res = await syncStationsToLocalMongoDb([]);
  return res.fromMongoRows;
}
