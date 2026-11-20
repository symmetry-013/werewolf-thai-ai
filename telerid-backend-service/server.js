require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const WebSocket = require('ws');
const schedule = require('node-schedule');

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(__dirname));

const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017';
const DB_NAME = process.env.DB_NAME || 'telerid_db';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'stations';
const CCTV_COLLECTION_NAME = process.env.CCTV_COLLECTION_NAME || 'cctv_cameras';

let db;
let client;


function parseTeleRidDateAnyFormat(rawVal) {
  if (!rawVal) return null;
  if (typeof rawVal === 'number' && rawVal > 1000000000) {
    return new Date(rawVal < 10000000000 ? rawVal * 1000 : rawVal);
  }
  const s = String(rawVal).trim();
  if (!s || s === '-' || s === '--') return null;
  // รองรับ DD/MM/YYYY HH:mm:ss หรือ DD-MM-YYYY HH:mm:ss (ทั้ง พ.ศ. และ ค.ศ.)
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    let yr = parseInt(m[3], 10);
    if (yr > 2400) yr -= 543;
    const mo = String(parseInt(m[2], 10)).padStart(2, '0');
    const dy = String(parseInt(m[1], 10)).padStart(2, '0');
    const hr = String(parseInt(m[4], 10)).padStart(2, '0');
    const mn = String(parseInt(m[5], 10)).padStart(2, '0');
    const sc = String(parseInt(m[6] || '0', 10)).padStart(2, '0');
    const d = new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:${sc}+07:00`);
    if (!isNaN(d.getTime())) return d;
  }
  // รองรับ YYYY-MM-DD HH:mm:ss (ไม่มี timezone -> ถือเป็น +07:00)
  const isoNoTz = s.match(/^(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):(\d{2})$/);
  if (isoNoTz) {
    const d = new Date(`${isoNoTz[1]}-${isoNoTz[2]}-${isoNoTz[3]}T${isoNoTz[4]}:${isoNoTz[5]}:${isoNoTz[6]}+07:00`);
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}


function classifyStationTypeFromItem(code, item, wlUpRtk, wlUpRsm, wlDownRtk, wlDownRsm, rainNow, rain1Day) {
  const hasWlMeasure = Boolean(
    item?.measure?.wl ||
    wlUpRtk !== null ||
    wlUpRsm !== null ||
    wlDownRtk !== null ||
    wlDownRsm !== null
  );
  const isRainCode = /-R\d+$/i.test(String(code || '').trim());
  const hasRainMeasure = Boolean(
    item?.measure?.r ||
    isRainCode ||
    (rainNow !== null && rainNow !== undefined) ||
    (rain1Day !== null && rain1Day !== undefined)
  );
  if (hasWlMeasure && hasRainMeasure) return 'สถานีวัดระดับน้ำ + น้ำฝน';
  if (hasWlMeasure && !hasRainMeasure) return 'สถานีวัดระดับน้ำอย่างเดียว';
  return 'สถานีน้ำฝนอย่างเดียว';
}

function cleanNumber(val) {
  if (val === null || val === undefined || val === '' || val === '-' || val === '--') return null;
  const num = parseFloat(val);
  if (isNaN(num) || num === -999 || num === 999) return null; 
  return num;
}


// ============================================================================
// 📷 ระบบดึงข้อมูลสถานะกล้อง CCTV + เช็กภาพเข้า/ไม่มีภาพเข้า + กฎดับเกิน 24 ชม.
// ============================================================================
function normalizeTeleRidCameraUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/restapi/')) return `https://telerid.rid.go.th${trimmed}`;
  if (trimmed.startsWith('/')) return `https://telerid.rid.go.th${trimmed}`;
  return `https://telerid.rid.go.th/restapi/main/camera/${trimmed}`;
}

function parseTimestampFromTimingFilename(urlStr) {
  const s = String(urlStr || '');
  // 1) _20261114121601671_TIMING.jpg หรือ _19700123030712977_TIMING.jpg
  let m = s.match(/_((?:19|20)\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})\d*_TIMING/i);
  // 2) _20261114-12133735_Schedule.jpg
  if (!m) m = s.match(/_((?:19|20)\d{2})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\d*_Schedule/i);
  // 3) _20120118_11_00_06.jpg
  if (!m) m = s.match(/_((?:19|20)\d{2})(\d{2})(\d{2})_(\d{2})_(\d{2})_(\d{2})\./i);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

async function checkCameraImageAvailable(imageUrl) {
  if (!imageUrl) return { hasImage: false, httpStatus: 0, reason: 'ไม่มีลิงก์รูปภาพ' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(imageUrl, { method: 'GET', signal: controller.signal });
    clearTimeout(timer);
    const cType = (res.headers.get('content-type') || '').toLowerCase();
    // จากหน้า #/cctv จริง: ถ้าไม่มีภาพ (IMAGE NOT FOUND) จะตอบ HTTP 500/404 หรือ content-type เป็น json
    if (res.status === 200 && cType.includes('image')) {
      return { hasImage: true, httpStatus: 200, reason: 'มีภาพเข้าปกติ' };
    }
    return {
      hasImage: false,
      httpStatus: res.status,
      reason: `ไม่มีภาพเข้า (HTTP ${res.status} / ${cType || 'IMAGE NOT FOUND'})`,
    };
  } catch (err) {
    clearTimeout(timer);
    return { hasImage: false, httpStatus: 0, reason: `โหลดภาพไม่สำเร็จ (${err.message})` };
  }
}

async function extractAndSyncCctvFromStationsDict(stationsDict) {
  if (!db || !stationsDict || typeof stationsDict !== 'object') return 0;
  const cctvCol = db.collection(CCTV_COLLECTION_NAME);
  await cctvCol.createIndex({ stationCode: 1 }, { unique: true }).catch(() => {});

  const candidates = [];
  const now = new Date();

  for (const k of Object.keys(stationsDict)) {
    const item = stationsDict[k];
    if (!item || !item.code) continue;

    const code = String(item.code).trim();
    const name = item.name ? String(item.name).trim() : code;
    const basinName = item.basin?.name || item.project?.name || 'ไม่ระบุ';

    const cctvList = Array.isArray(item.cctv)
      ? item.cctv
      : Array.isArray(item.cctvs)
      ? item.cctvs
      : Array.isArray(item.cameras)
      ? item.cameras
      : item.cctv && typeof item.cctv === 'object'
      ? [item.cctv]
      : [];

    const valListCctv = item.values?.water_level_value_list?.value || [];
    const wlCheck = cleanNumber(valListCctv[0]) ?? cleanNumber(item.values?.water_level?.value);
    const stType = classifyStationTypeFromItem(code, item, wlCheck, cleanNumber(valListCctv[1]), cleanNumber(valListCctv[2]), cleanNumber(valListCctv[3]), cleanNumber(item.values?.rain_sum_now?.value), null);

    // สถานีน้ำฝนอย่างเดียว ไม่มีกล้อง CCTV และไม่มีค่าน้ำ -> ข้ามไม่นำเข้า cctv_cameras
    if (stType === 'สถานีน้ำฝนอย่างเดียว' && cctvList.length === 0 && !item.cctv_url && !item.values?.cctv) {
      continue;
    }

    const hasCctvFlag =
      cctvList.length > 0 ||
      Boolean(item.has_cctv || item.is_cctv || item.cctv_url || item.values?.cctv || item.measure?.cctv || item.sta_cctv1 || item.sta_cctv2);

    if (!hasCctvFlag && stType === 'สถานีน้ำฝนอย่างเดียว') continue;

    const firstCam = cctvList[0] || {};
    const rawImgUrl =
      firstCam.image_url ||
      firstCam.image ||
      firstCam.url ||
      firstCam.snapshot ||
      item.cctv_url ||
      item.values?.cctv?.url ||
      '';
    const imageUrl = normalizeTeleRidCameraUrl(rawImgUrl);

    const camTimeRaw =
      firstCam.datetime ||
      firstCam.updated_at ||
      item.values?.cctv?.datetime ||
      item.datetime ||
      null;
    const camUnix = firstCam.unixtime || item.values?.cctv?.unixtime || item.values?.water_level?.unixtime || null;

    let camDate = parseTimestampFromTimingFilename(imageUrl) || (camTimeRaw ? new Date(camTimeRaw) : camUnix ? new Date(camUnix * 1000) : null);
    if (camDate && isNaN(camDate.getTime())) camDate = null;

    const lagMinutes = camDate ? Math.max(0, Math.round((now.getTime() - camDate.getTime()) / 60000)) : null;
    const lagHours = lagMinutes !== null ? Number((lagMinutes / 60).toFixed(1)) : null;

    candidates.push({
      code,
      name,
      basinName,
      cameraCount: Math.max(1, cctvList.length),
      hasCctvFlag,
      imageUrl,
      camDate,
      lagMinutes,
      lagHours,
      itemOnline: item.hasOwnProperty('is_online')
        ? Boolean(item.is_online)
        : firstCam.hasOwnProperty('is_online')
        ? Boolean(firstCam.is_online)
        : item.is_display !== false,
    });
  }

  // เช็ก URL รูปภาพจริงแบบแบ่งรอบละ 15 กล้อง เพื่อดูว่ามีภาพเข้า (200 image/jpeg) หรือไม่มีภาพเข้า (500/404 IMAGE NOT FOUND)
  const ops = [];
  const BATCH = 15;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
    const checks = await Promise.all(
      slice.map(async (c) => {
        const imgCheck = c.imageUrl
          ? await checkCameraImageAvailable(c.imageUrl)
          : { hasImage: c.itemOnline, httpStatus: c.itemOnline ? 200 : 0, reason: c.itemOnline ? 'ออนไลน์ (ไม่มี URL ภาพใน Payload)' : 'ออฟไลน์' };

        const isOver1h = c.lagMinutes === null || c.lagMinutes > 60;
        const isOver24h = c.lagHours !== null && c.lagHours > 24;
        let cctvStatus = 'ปกติ';
        let imageDisplayStatus = 'มีภาพเข้าปกติ';

        if (!imgCheck.hasImage) {
          cctvStatus = 'ขัดข้อง';
          imageDisplayStatus = imgCheck.reason || 'ไม่มีภาพเข้า (IMAGE NOT FOUND)';
        } else if (isOver1h) {
          cctvStatus = 'ขัดข้อง';
          imageDisplayStatus =
            c.lagMinutes === null
              ? 'ติดต่อ SV ไม่ได้ / ไม่มีเวลาภาพล่าสุด (> 1 ชม.)'
              : `ภาพค้าง/ติดต่อ SV ไม่ได้เกิน 1 ชม. (${c.lagHours} ชม.)`;
        } else if (!c.itemOnline) {
          cctvStatus = 'ขัดข้อง';
          imageDisplayStatus = 'กล้องออฟไลน์';
        }

        return {
          updateOne: {
            filter: { stationCode: c.code },
            update: {
              $set: {
                stationCode: c.code,
                stationName: c.name,
                basin: c.basinName,
                hasCctv: c.hasCctvFlag,
                cameraCount: c.cameraCount,
                onlineStatus: cctvStatus === 'ปกติ' ? 'ออนไลน์' : 'ออฟไลน์',
                cctvStatus,
                hasImage: imgCheck.hasImage,
                httpStatus: imgCheck.httpStatus,
                isOver1h,
                isOver24h,
                imageDisplayStatus,
                imageUrl: c.imageUrl,
                lagMinutes: c.lagMinutes,
                lagHours: c.lagHours,
                imageTimestampText: c.camDate ? c.camDate.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-',
                updatedAt: now,
              },
            },
            upsert: true,
          },
        };
      })
    );
    ops.push(...checks);
  }

  const activeCctvCodes = candidates.map((c) => c.code);
  if (activeCctvCodes.length > 0) {
    await cctvCol.deleteMany({ stationCode: { $nin: activeCctvCodes } }).catch(() => {});
  }
  if (ops.length > 0) {
    await cctvCol.bulkWrite(ops);
    console.log(`📷 [CCTV Sync] บันทึกสถานะกล้องลง "${DB_NAME}.${CCTV_COLLECTION_NAME}" สำเร็จ: ${ops.length} รายการ`);
  }
  return ops.length;
}

async function initDatabase() {
  try {
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(DB_NAME);
    await db.collection(COLLECTION_NAME).createIndex({ stationCode: 1 }, { unique: true });
    console.log(`✅ [MongoDB] เชื่อมต่อสำเร็จ: ฐานข้อมูล "${DB_NAME}"`);

    syncTelemetryData().catch(err => console.warn('⚠️ คำเตือนการซิงค์รอบแรก:', err.message));
  } catch (error) {
    console.error('❌ [MongoDB Error]:', error.message);
  }
}

initDatabase();

function syncTelemetryData() {
  return new Promise((resolve, reject) => {
    console.log(`\n⏰ [${new Date().toLocaleString('th-TH')}] เริ่มกระบวนการดึงข้อมูลสดจาก TeleRID WebSocket...`);

    const WS_URL = 'wss://telerid.rid.go.th/ws/public/';
    const ws = new WebSocket(WS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows)',
        'Origin': 'https://rid.go.th'
      }
    });

    let isResolved = false;
    const timeoutId = setTimeout(() => {
      if (!isResolved) {
        ws.terminate();
        reject(new Error('WebSocket Connection Timeout'));
      }
    }, 30000);

    ws.on('message', async (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        let payload = parsed;
        if (typeof parsed.message === 'string') {
          try { payload = JSON.parse(parsed.message); } catch (e) { payload = parsed; }
        }

        if (payload.type === 'INIT' && payload.data) {
          isResolved = true;
          clearTimeout(timeoutId);
          ws.close();

          const stationsDict = payload.data;
          const keys = Object.keys(stationsDict);
          
          const bulkOps = keys.map(k => {
            const item = stationsDict[k];
            if (!item || !item.code) return null;

            const code = item.code.trim();
            const name = item.name ? item.name.trim() : code;
            const basinName = item.basin?.name || item.project?.name || 'ไม่ระบุ';

            const rainNow = cleanNumber(item.values?.rain_sum_now?.value) ?? 0.0;
            let rain1Day = rainNow;
            if (Array.isArray(item.values?.rain_sum?.value) && item.values.rain_sum.value.length > 0) {
              const arr = item.values.rain_sum.value;
              rain1Day = cleanNumber(arr[arr.length - 1]) ?? rainNow;
            }

            const valList = item.values?.water_level_value_list?.value || [];
            const wlUpRtk = cleanNumber(valList[0]) ?? cleanNumber(item.values?.water_level?.value);
            const wlUpRsm = cleanNumber(valList[1]);
            const wlDownRtk = cleanNumber(valList[2]);
            const wlDownRsm = cleanNumber(valList[3]);

            // 🟢 หาเวลาข้อมูลล่าสุดจริงของสถานีจากทุกเซนเซอร์ใน item.values[*] (ทั้ง unixtime, datetime, time, date)
            let candidateUnix = Number(item.unixtime || 0);
            const rawDtCandidates = [item.datetime, item.last_update, item.updated_at];
            if (item.values && typeof item.values === 'object') {
              for (const vObj of Object.values(item.values)) {
                if (!vObj || typeof vObj !== 'object') continue;
                const u = Number(vObj.unixtime || vObj.timestamp || 0);
                if (u > candidateUnix) candidateUnix = u;
                if (vObj.datetime) rawDtCandidates.push(vObj.datetime);
                if (vObj.time) rawDtCandidates.push(vObj.time);
                if (vObj.date) rawDtCandidates.push(vObj.date);
              }
            }
            const cleanDtCandidates = rawDtCandidates.filter(Boolean);
            const rawDtStr = cleanDtCandidates[0] || '';
            let stationDateObj = candidateUnix > 0 ? new Date(candidateUnix < 10000000000 ? candidateUnix * 1000 : candidateUnix) : null;
            for (const cand of cleanDtCandidates) {
              const parsedD = parseTeleRidDateAnyFormat(cand);
              if (parsedD && (!stationDateObj || parsedD.getTime() > stationDateObj.getTime())) {
                stationDateObj = parsedD;
              }
            }

            // 🟢 กฎ 1 ชั่วโมง (60 นาที): ถ้ามีเวลาและห่างเกิน 1 ชม. หรือ is_online === false -> ออฟไลน์
            const ONE_HOUR_MS = 60 * 60 * 1000;
            const isStaleOver1Hour =
              stationDateObj !== null && (Date.now() - stationDateObj.getTime() > ONE_HOUR_MS);

            let isOnline = true;
            if (item.hasOwnProperty('is_online')) {
              isOnline = Boolean(item.is_online) && !isStaleOver1Hour;
            } else if (item.is_display === false) {
              isOnline = false;
            } else if (isStaleOver1Hour) {
              isOnline = false;
            } else {
              isOnline = Boolean(item.measure?.wl || item.measure?.r || wlUpRtk !== null || rainNow !== null);
            }
            const onlineStatus = isOnline ? 'ออนไลน์' : 'ออฟไลน์';

            const wlCrit = cleanNumber(item.water_level_critical);
            const wlWarn = cleanNumber(item.water_level_warning);
            let alertStatus = isOnline ? 'ปกติ' : 'ขัดข้อง';
            if (isOnline && wlUpRtk !== null) {
              if (wlCrit !== null && wlUpRtk >= wlCrit) alertStatus = 'วิกฤติ';
              else if (wlWarn !== null && wlUpRtk >= wlWarn) alertStatus = 'เตือนภัย';
            }

            const stationTime = stationDateObj
              ? stationDateObj.toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })
              : (rawDtStr || '-');

            return {
              updateOne: {
                filter: { stationCode: code },
                update: {
                  $set: {
                    stationCode: code,
                    stationName: name,
                    basin: basinName,
                    stationType: classifyStationTypeFromItem(code, item, wlUpRtk, wlUpRsm, wlDownRtk, wlDownRsm, rainNow, rain1Day),
                    onlineStatus: onlineStatus,
                    alertStatus: alertStatus,
                    status: alertStatus,
                    rain7toNow: rainNow,
                    rain1Day: rain1Day,
                    waterLevelUp_RTK: wlUpRtk,
                    waterLevelUp_RSM: wlUpRsm,
                    waterLevelDown_RTK: wlDownRtk,
                    waterLevelDown_RSM: wlDownRsm,
                    warningThreshold: wlWarn,
                    criticalThreshold: wlCrit,
                    stationDatetime: stationTime || '-', // บันทึกเวลาข้อมูลจริง
                    updatedAt: new Date()
                  }
                },
                upsert: true
              }
            };
          }).filter(op => op !== null);

          if (bulkOps.length > 0) {
            const collection = db.collection(COLLECTION_NAME);
            const result = await collection.bulkWrite(bulkOps);
            console.log(`🎉 BulkWrite เรียบร้อย: ${result.upsertedCount + result.modifiedCount} รายการ`);
            await extractAndSyncCctvFromStationsDict(stationsDict).catch((e) => console.warn('⚠️ CCTV Sync Warning:', e.message));
            resolve(bulkOps.length);
          } else {
            resolve(0);
          }
        }
      } catch (err) {
        if (!isResolved) {
          clearTimeout(timeoutId);
          ws.terminate();
          reject(err);
        }
      }
    });

    ws.on('error', (err) => {
      if (!isResolved) { clearTimeout(timeoutId); reject(err); }
    });
    ws.on('close', () => {
      if (!isResolved) { clearTimeout(timeoutId); reject(new Error('Connection closed')); }
    });
  });
}

// ตั้งเวลารันอัตโนมัติทุกๆ 5 นาที เพื่อให้เวลาข้อมูลใน MongoDB เป็นปัจจุบันตลอด
schedule.scheduleJob('*/5 * * * *', async () => {
  try { await syncTelemetryData(); } catch (error) {}
});

app.get('/api/stations', async (req, res) => {
  try {
    const { basin, status } = req.query;
    const filter = {};
    if (basin && basin !== 'ALL') filter.basin = basin;
    if (status && status !== 'ALL') {
      filter.$or = [{ status: status }, { alertStatus: status }];
    }
    const stations = await db.collection(COLLECTION_NAME).find(filter).sort({ stationCode: 1 }).toArray();
    res.json({ ok: true, count: stations.length, data: stations });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/stations/summary', async (req, res) => {
  try {
    const total = await db.collection(COLLECTION_NAME).countDocuments();
    const online = await db.collection(COLLECTION_NAME).countDocuments({ onlineStatus: 'ออนไลน์' });
    const offline = await db.collection(COLLECTION_NAME).countDocuments({ onlineStatus: 'ออฟไลน์' });
    const critical = await db.collection(COLLECTION_NAME).countDocuments({ $or: [{ status: 'วิกฤติ' }, { alertStatus: 'วิกฤติ' }] });
    const warning = await db.collection(COLLECTION_NAME).countDocuments({ $or: [{ status: 'เตือนภัย' }, { alertStatus: 'เตือนภัย' }] });
    const normal = total - (critical + warning);
    res.json({ ok: true, summary: { total, online, offline, normal, warning, critical } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/sync-now', async (req, res) => {
  try {
    const count = await syncTelemetryData();
    res.json({ ok: true, message: `ซิงค์ข้อมูลสำเร็จจำนวน ${count} สถานี` });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});


app.get('/api/cctv', async (req, res) => {
  try {
    const { basin, status } = req.query;
    const filter = {};
    if (basin && basin !== 'ALL') filter.basin = basin;
    if (status && status !== 'ALL') filter.onlineStatus = status;
    const cameras = await db.collection(CCTV_COLLECTION_NAME).find(filter).sort({ stationCode: 1 }).toArray();
    res.json({ ok: true, count: cameras.length, data: cameras });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/cctv/sync-now', async (_req, res) => {
  try {
    const count = await syncTelemetryData();
    const cctvCount = await db.collection(CCTV_COLLECTION_NAME).countDocuments();
    res.json({ ok: true, message: `ซิงค์ข้อมูลสถานี ${count} และกล้อง CCTV ${cctvCount} รายการสำเร็จ` });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => { console.log(`🚀 [API Server] ทำงานที่ Port ${PORT}`); });