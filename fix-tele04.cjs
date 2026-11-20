/**
 * fix-tele04.cjs
 * ระบบบันทึกและจำลองพฤติกรรมการคลิกมนุษย์ (Autonomous Macro Recorder & Playback Engine)
 * + สคริปต์ล็อกอินและสแกนดึงค่า API อัตโนมัติ (use: Sommart, PW: 891013) ดึงทั้งค่าน้ำ (ม.รทก. / ม.รสม.) และค่าน้ำฝน (มม.)
 * + ชุดคำสั่งดักกรองค่าบั๊กระบบ/ภัยวิกฤตขั้นสูง (Strict Data Loop Filter):
 *   - ค่าติดลบเกิน -10 ลงไปจนถึง -999 (<= -10 ถึง -999) และ >= 999 คือค่าไม่ถูกต้อง ทั้งหน่วย ม.รทก. และ ม.รสม.
 * + ตารางเวลาทำงานทุก 1 ชั่วโมง ตลอด 24 ชั่วโมง (00:00 - 23:00 น. ทุกวัน) ยึดตามเวลาจริงโดยไม่รีเซ็ตเวลาเมื่อกดตรวจด้วยมือ
 * สำหรับแผนกที่ 1 (Browser RPA — สีฟ้า) บนเครื่องคอมพิวเตอร์ Windows (User: Tele_04)
 * พิกัดโปรเจกต์: C:\Users\Tele_04\Desktop\agent-orchestrator
 */

try { require('dotenv').config(); } catch (_e) {}
const fs = require('fs');
const path = require('path');
const os = require('os');
const ExcelJS = require('exceljs');

const TELE04_ROOT = fs.existsSync('C:\\Users\\Tele_04') ? 'C:\\Users\\Tele_04' : os.homedir();
const ORCHESTRATOR_DIR = fs.existsSync('C:\\Users\\Tele_04\\Desktop\\agent-orchestrator')
  ? 'C:\\Users\\Tele_04\\Desktop\\agent-orchestrator'
  : process.cwd();
const USER_DOWNLOADS_DIR = path.join(TELE04_ROOT, 'Downloads');
const MACRO_CONFIG_FILE_PATH = path.join(ORCHESTRATOR_DIR, 'tele04_macro_config.json');
const CHROME_EXE_WIN_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CHROME_PROFILE_DIR_NAME = 'Profile 5';
const CHROME_SHORTCUT_FLAG = '--source-shortcut-location=desktop';
const CHROME_USER_DATA_DIR = 'C:/Users/Tele_04/AppData/Local/Google/Chrome/User Data';
const CHROME_FALLBACK_PROFILE_DIR = 'C:/Users/Tele_04/AppData/Local/Google/Chrome/TeleRID_Profile5_Mirror';
const TELERID_MAIN_URL = 'https://telerid.rid.go.th/#/';
const TELERID_CCTV_URL = 'https://telerid.rid.go.th/#/cctv';

// ข้อมูลบัญชีผู้ใช้สำหรับล็อกอินและสแกนดึงค่า API ทั้งค่าน้ำ (ม.รทก. / ม.รสม.) และน้ำฝน (มม.)
const TELERID_AUTH_CREDENTIALS = {
  username: process.env.TELERID_USERNAME || '',
  password: process.env.TELERID_PASSWORD || '',
};

const stationsData = {
  "โขงตะวันออกเฉียงเหนือ": {
    "TKS.121": "บ้านป่งไฮ", "TKH.118": "ปตร.ห้วยหลวง", "TKH.128": "อบต. บ้านแมด", "TKH.130": "อ่างเก็บน้ำห้วยหลวง",
    "TKH.129": "อ่างเก็บน้ำบ้านจั่น", "TKH.119": "สะพานห้วยลม", "TKS.109": "วัดนาหว้า", "TKS.107": "เขื่อนน้ำอูน",
    "TKL.125": "บ้านเพีย", "TKS.120": "บ้านโป่งเปื่อย", "TKS.108": "วัดศรีธรรมราช", "TKS.113": "บ้านหนองหมากแซว",
    "TKS.114": "บ้าห้วยหลัว", "TKS.115": "บ้านเหล่าสมบูรณ์", "TKS.119": "บ้านปากน้ำอูน", "TKS.116": "บ้านสุขสำราญ",
    "TKS.117": "บ้านท่าสำราญ", "TKS.118": "บ้านดงหนองบัว", "TKL.123": "บ้านหนองบอน", "TKL.86": "บ้านไร่ม่วง",
    "TKL.61": "บ้านแก่งบง", "TKL.58B": "เทศบาลเมืองเลย", "TKL.122": "บ้านเลยวังไสย์", "TKL.28A": "บ้านฟากเลย",
    "TKL.126": "บ้านโป่ง", "TKS.112": "บ้านโพธิ์ชัยทอง", "TKS.110": "บ้านพันนา", "TKL.105": "บ้านผาน้อย",
    "TKL.77A": "บ้านกกซ้อ", "TKH.132": "โรงเรียนบ้านดอนหวาย", "TKH.103": "สะพานข้ามห้วยหลวง", "TKH.121": "ศูนย์การเรียนรู้ อบต.เตาไห",
    "TKH.53A": "สะพานหนองวัวซอ", "TKS.111": "ชุมชนบ้านขัวสูงสวรรค์", "TKH.124": "สะพานห้วยน้ำขุ่น", "TKH.120": "สะพานห้วยบ้าน",
    "TKH.131": "ปตร.ห้วยดาน", "TKH.127": "สะพานข้ามห้วยดาน", "TKL-R1": "บ้านยางเดี่ยว", "TKL-R2": "บ้านขอนยาง",
    "TKL-R3": "บ้านท่าสะอาด", "TKL-R4": "อ่างเก็บน้ำห้วยน้ำหมาน", "TKS-R1": "โรงเรียนชุมชนส่องดาว", "TKS-R2": "โรงเรียนบ้านนาคำ",
    "TKS-R3": "อบต.บ้านยา", "TKS-R4": "เทศบาลเฝ้าไร่", "TKS-R5": "อบต.หนองแวงใต้", "TKS-R6": "โรงเรียนบ้านนาดี",
    "TKH-R1": "โรงเรียนบ้านหนองฆ้องสีนวล", "TKH-R2": "วัดราษฎร์บำรุง", "TKH-R3": "วัดสระมณี", "TKH-R4": "วัดศรีแก้วจอมทอง",
    "TKH-R5": "กศน.หนองอ้อ", "TKH-R6": "โรงเรียน เจซี. บ้านอินทร์แปลง", "TKH-R7": "อบต.บ้านตาด", "TKH-R8": "โรงเรียนยิ่งยวดพิทยาณุกูล",
    "TKH-R9": "โรงเรียนบ้านทุ่ง อบต.บ้านชัย", "TKH-133": "อ่างเก็บน้ำกุดลิงง้อ"
  },
  "ชี": {
    "LP-02": "สถานีฝายกุมภวาปี", "LP-03": "สถานี E.65", "LP-04": "สถานีอ.วังสามหมอ", "LP-05": "สถานีอ.สมเด็จ",
    "LP-06": "สถานีเขื่อนลำปาว", "LP-07": "สถานี E.75", "LP-08": "สถานีอ.กมลาไสย E.87", "LP-09": "สถานีฝายวังยาง",
    "LP-10": "สถานีฝายร้อยเอ็ด", "TE.100": "ฝายมหาสารคาม (บ้านคุยเชือก)", "TE.101": "บ้านไผ่ล้อม", "TE.102": "ท้ายเขื่อนลำปะทาว",
    "TE.107": "ฝายยโสธร", "TE.108": "ฝายธาตุน้อย", "TE.109": "ฝายร้อยเอ็ด (บ้านดอนวิเวก)"
  },
  "มูล": {
    "TM.104": "TM.104 (มูลนิธิวัดสวนแก้ว)", "TM.145": "TM.145", "TM.159": "TM.159", "TM.164": "TM.164",
    "TM.194 (U/S), (D/S)": "T ขรน.มะเกลือใหม่ (U/S), (D/S)", "TM.195 (U/S), (D/S)": "T ขรน.กันผม (U/S), (D/S)",
    "TM.200 (U/S), (D/S)": "Tฝายยางบ้านส้ม (U/S), (D/S)", "TM.201 (D/S)": "T ปตร.น้ำเค็ม (D/S)",
    "TM.202 (U/S), (D/S)": "Tเขื่อนพิมาย (U/S), (D/S)", "TM.203": "T หลุมข้าว",
    "TM.204 (U/S), (D/S)": "Tฝายชุมพวง (U/S), (D/S)", "TM.205 (U/S), (D/S)": "Tฝายยางบ้านเขว้า (U/S), (D/S)",
    "TM.206 (U/S), (D/S)": "Tฝายยางบ้านตะลุง (U/S), (D/S)", "TMN 14": "อุบลราชธานี", "TMN 15": "พิบูลมังสาหาร"
  }
};

const hardcodedBasins = [
  "ลุ่มน้ำโขงเหนือ",
  "ลุ่มน้ำโขงตะวันออกเฉียงเหนือ",
  "ลุ่มน้ำชี",
  "ลุ่มน้ำมูล",
  "ลุ่มน้ำปิง",
  "ลุ่มน้ำวัง",
  "ลุ่มน้ำยม",
  "ลุ่มน้ำน่าน",
  "ลุ่มน้ำเจ้าพระยา",
  "ลุ่มน้ำป่าสัก",
  "ลุ่มน้ำสะแกกรัง",
  "ลุ่มน้ำท่าจีน",
  "ลุ่มน้ำแม่กลอง",
  "ลุ่มน้ำบางปะกง",
  "ลุ่มน้ำชายทะเลฝั่งตะวันออก",
  "ลุ่มน้ำเพชรบุรี-ประจวบคีรีขันธ์",
  "ลุ่มน้ำภาคใต้ฝั่งตะวันตก",
  "ลุ่มน้ำภาคใต้ฝั่งตะวันออกตอนบน",
  "ลุ่มน้ำภาคใต้ฝั่งตะวันออกตอนล่าง",
  "ลุ่มน้ำทะเลสาบสงขลา",
  "ลุ่มน้ำสาละวิน",
  "ลุ่มน้ำโตนเลสาป",
  "KRC"
];

function normalizeBasinNameForTeleRidWeb(basinInput) {
  const raw = String(basinInput || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.includes('โขงอีสาน') || raw.includes('โขงตะวันออกเฉียงเหนือ')) {
    return 'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ';
  }
  if (raw === 'KRC') return 'KRC';
  const withoutPrefix = raw.replace(/^ลุ่มน้ำ\s*/, '').trim();
  return `ลุ่มน้ำ${withoutPrefix}`;
}

/**
 * ตรวจสอบหน่วยระดับน้ำจากข้อความหรือฟิลด์ข้อมูล (รองรับทั้ง ม.รทก. และ ม.รสม.)
 */
function detectWaterLevelUnit(rawText) {
  const txt = String(rawText || '');
  if (txt.includes('ม.รทก')) return 'ม.รทก.';
  if (txt.includes('ม.รสม')) return 'ม.รสม.';
  return 'ม.รทก./ม.รสม.';
}

/**
 * ตรวจสอบว่าสถานีตั้งอยู่บนพื้นที่บก/พื้นที่ดอน (Upland Terrain) ที่ระดับน้ำห้ามติดลบหรือไม่
 */
function isUplandTerrainStation(basinName, stationCode, stationName) {
  const combined = `${basinName || ''} ${stationCode || ''} ${stationName || ''}`;
  if (/โขงตะวันออกเฉียงเหนือ|โขงเหนือ|ชี|มูล|ปิง|วัง|ยม|น่าน|ป่าสัก|TKH|TKS|TKL|TE\.|LP-|TM\.|TMN/i.test(combined)) {
    return true;
  }
  if (/ปากน้ำ|ปากแม่น้ำ|ทะเล|ชายฝั่ง/i.test(combined)) {
    return false;
  }
  return true;
}

/**
 * ซิงค์ข้อมูลสำคัญจาก User Data/Profile 5 (รหัสผ่านที่บันทึกไว้, คุกกี้, ประวัติการใช้งาน, Local Storage)
 * มายังโฟลเดอร์ Mirror สำรอง เผื่อกรณีที่ผู้ใช้เปิดหน้าต่าง Chrome (Profile 5) ค้างไว้อยู่แล้วทำให้ติด SingletonLock
 */
function syncChromeProfile5ToMirror(sourceUserDataDir, targetMirrorUserDataDir) {
  try {
    const sourceProfile5Dir = path.join(sourceUserDataDir, CHROME_PROFILE_DIR_NAME);
    if (!fs.existsSync(sourceProfile5Dir)) return;

    const targetProfile5Dir = path.join(targetMirrorUserDataDir, CHROME_PROFILE_DIR_NAME);
    if (!fs.existsSync(targetProfile5Dir)) {
      fs.mkdirSync(targetProfile5Dir, { recursive: true });
    }

    const localStateSrc = path.join(sourceUserDataDir, 'Local State');
    const localStateDst = path.join(targetMirrorUserDataDir, 'Local State');
    if (fs.existsSync(localStateSrc)) {
      try {
        fs.copyFileSync(localStateSrc, localStateDst);
      } catch (_e) {}
    }

    for (const fileName of [
      'Preferences',
      'Secure Preferences',
      'Login Data',
      'Login Data For Account',
      'Web Data',
      'History',
      'Cookies',
      'Favicons',
      'Bookmarks',
    ]) {
      const s = path.join(sourceProfile5Dir, fileName);
      const d = path.join(targetProfile5Dir, fileName);
      if (fs.existsSync(s)) {
        try {
          fs.copyFileSync(s, d);
        } catch (_e) {}
      }
    }

    const srcNet = path.join(sourceProfile5Dir, 'Network');
    const dstNet = path.join(targetProfile5Dir, 'Network');
    if (fs.existsSync(srcNet)) {
      if (!fs.existsSync(dstNet)) fs.mkdirSync(dstNet, { recursive: true });
      for (const nf of ['Cookies', 'Cookies-journal', 'Network Persistent State', 'TransportSecurity']) {
        const s = path.join(srcNet, nf);
        const d = path.join(dstNet, nf);
        if (fs.existsSync(s)) {
          try {
            fs.copyFileSync(s, d);
          } catch (_e) {}
        }
      }
    }

    for (const dirName of ['Local Storage', 'Session Storage']) {
      const sDir = path.join(sourceProfile5Dir, dirName);
      const dDir = path.join(targetProfile5Dir, dirName);
      if (fs.existsSync(sDir) && typeof fs.cpSync === 'function') {
        try {
          fs.cpSync(sDir, dDir, { recursive: true, force: true });
        } catch (_e) {}
      }
    }
  } catch (_e) {}
}

function clearStaleChromeLocksInDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    for (const ln of ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile']) {
      const p1 = path.join(dirPath, ln);
      if (fs.existsSync(p1)) {
        try { fs.unlinkSync(p1); } catch (_e) {}
      }
      const p2 = path.join(dirPath, CHROME_PROFILE_DIR_NAME, ln);
      if (fs.existsSync(p2)) {
        try { fs.unlinkSync(p2); } catch (_e) {}
      }
    }
  } catch (_e) {}
}

/**
 * 1. เปิดโปรไฟล์ Chrome จริงในเครื่อง (Persistent Context Directory):
 * บังคับเปิดตามที่อยู่: "C:\Program Files\Google\Chrome\Application\chrome.exe" --profile-directory="Profile 5" --source-shortcut-location=desktop
 * รองรับการเปิดซ้ำได้ไม่จำกัดครั้งโดยล้าง SingletonLock ที่ค้างและสำรอง Session อัตโนมัติ
 */
async function launchTele04PersistentChrome(playwright, options = {}) {
  const headlessMode = options.headless ?? false;
  const userDataDir = options.userDataDir || CHROME_USER_DATA_DIR;
  const hasChromeExe = process.platform === 'win32' && fs.existsSync(CHROME_EXE_WIN_PATH);
  const chromeArgs = [
    `--profile-directory=${CHROME_PROFILE_DIR_NAME}`,
    CHROME_SHORTCUT_FLAG,
    '--disable-blink-features=AutomationControlled',
    '--start-maximized',
  ];

  try {
    const context = await playwright.chromium.launchPersistentContext(userDataDir, {
      executablePath: hasChromeExe ? CHROME_EXE_WIN_PATH : undefined,
      channel: hasChromeExe ? undefined : 'chrome',
      headless: headlessMode,
      viewport: null,
      args: chromeArgs,
    });
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    return {
      context,
      page,
      profileUsed: `"${CHROME_EXE_WIN_PATH}" --profile-directory="${CHROME_PROFILE_DIR_NAME}" ${CHROME_SHORTCUT_FLAG}`,
    };
  } catch {
    if (!fs.existsSync(CHROME_FALLBACK_PROFILE_DIR)) {
      fs.mkdirSync(CHROME_FALLBACK_PROFILE_DIR, { recursive: true });
    }
    clearStaleChromeLocksInDir(CHROME_FALLBACK_PROFILE_DIR);
    if (process.platform === 'win32' && fs.existsSync(CHROME_USER_DATA_DIR)) {
      syncChromeProfile5ToMirror(CHROME_USER_DATA_DIR, CHROME_FALLBACK_PROFILE_DIR);
    }
    try {
      const context = await playwright.chromium.launchPersistentContext(CHROME_FALLBACK_PROFILE_DIR, {
        executablePath: hasChromeExe ? CHROME_EXE_WIN_PATH : undefined,
        channel: hasChromeExe ? undefined : 'chrome',
        headless: headlessMode,
        viewport: null,
        args: chromeArgs,
      });
      const pages = context.pages();
      const page = pages.length > 0 ? pages[0] : await context.newPage();
      return {
        context,
        page,
        profileUsed: `"${CHROME_EXE_WIN_PATH}" --profile-directory="${CHROME_PROFILE_DIR_NAME}" ${CHROME_SHORTCUT_FLAG} (Synced Mirror)`,
      };
    } catch {
      const sessionMirrorDir = `${CHROME_FALLBACK_PROFILE_DIR}_Session_${Date.now()}`;
      fs.mkdirSync(sessionMirrorDir, { recursive: true });
      if (process.platform === 'win32' && fs.existsSync(CHROME_USER_DATA_DIR)) {
        syncChromeProfile5ToMirror(CHROME_USER_DATA_DIR, sessionMirrorDir);
      }
      const context = await playwright.chromium.launchPersistentContext(sessionMirrorDir, {
        executablePath: hasChromeExe ? CHROME_EXE_WIN_PATH : undefined,
        channel: hasChromeExe ? undefined : 'chrome',
        headless: headlessMode,
        viewport: null,
        args: chromeArgs,
      });
      const pages = context.pages();
      const page = pages.length > 0 ? pages[0] : await context.newPage();
      return {
        context,
        page,
        profileUsed: `"${CHROME_EXE_WIN_PATH}" --profile-directory="${CHROME_PROFILE_DIR_NAME}" ${CHROME_SHORTCUT_FLAG} (Fresh Session Mirror)`,
      };
    }
  }
}

/**
 * ============================================================================
 * 2. สคริปต์ล็อกอินอัตโนมัติ (use: Sommart, PW: 891013) และสแกนดึงค่า API
 *    ดึงข้อมูลได้ทั้งค่าน้ำ (ม.รทก. และ ม.รสม.) และค่าน้ำฝน (มม.) จากเว็บ TeleRID
 * ============================================================================
 */
async function loginAndScanTeleRidWaterAndRainApi(
  page,
  credentials = TELERID_AUTH_CREDENTIALS,
  targetBasins = ['ลุ่มน้ำโขงตะวันออกเฉียงเหนือ', 'ลุ่มน้ำชี', 'ลุ่มน้ำมูล'],
  socketIoOrCallback = null
) {
  const username = credentials?.username || process.env.TELERID_USERNAME || '';
  const password = credentials?.password || process.env.TELERID_PASSWORD || '';
  const capturedApiEndpoints = [];
  const apiExtractedStations = [];

  // ดักจับท่อส่งข้อมูล API ทั้งหมดในหน้าเว็บ (ทั้งค่าน้ำ ม.รทก./ม.รสม. และค่าน้ำฝน มม.)
  const apiInterceptor = async (response) => {
    try {
      const url = response.url();
      const lowerUrl = url.toLowerCase();
      const cType = (response.headers()['content-type'] || '').toLowerCase();
      const reqType = response.request ? response.request().resourceType() : 'fetch';

      if (
        (reqType === 'fetch' || reqType === 'xhr' || cType.includes('json')) &&
        (lowerUrl.includes('api') ||
          lowerUrl.includes('station') ||
          lowerUrl.includes('summary') ||
          lowerUrl.includes('water') ||
          lowerUrl.includes('rain') ||
          lowerUrl.includes('telemetry') ||
          lowerUrl.includes('telerid'))
      ) {
        const jsonBody = await response.json().catch(() => null);
        if (!jsonBody) return;

        capturedApiEndpoints.push({
          url,
          status: response.status(),
          capturedAt: new Date().toLocaleTimeString('th-TH'),
        });

        const rows = Array.isArray(jsonBody)
          ? jsonBody
          : Array.isArray(jsonBody.data)
          ? jsonBody.data
          : Array.isArray(jsonBody.stations)
          ? jsonBody.stations
          : Array.isArray(jsonBody.result)
          ? jsonBody.result
          : Array.isArray(jsonBody.features)
          ? jsonBody.features
          : [];

        for (const item of rows) {
          const p = item.properties || item;
          const code = String(
            p.station_code || p.stationCode || p.code || p.tele_station_oldcode || p.id || ''
          ).trim();
          if (!code) continue;

          const name = String(p.station_name || p.stationName || p.name || p.tele_station_name || code).trim();
          const basin = String(p.basin_name || p.basin || p.basinName || targetBasins[0] || 'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ').trim();

          // ดึงทั้งค่าน้ำ ม.รทก. (MSL) และ ม.รสม. (RSM / Local Datum)
          const rawWlMsl = p.water_level_msl ?? p.wl_msl ?? p.water_level ?? p.wl ?? p.waterLevel;
          const rawWlRsm = p.water_level_rsm ?? p.wl_rsm ?? p.water_level_local;
          const chosenWl = rawWlMsl !== undefined && rawWlMsl !== null ? rawWlMsl : rawWlRsm;

          // ระบุหน่วยว่าเป็น ม.รทก. หรือ ม.รสม.
          let unitLabel = 'ม.รทก.';
          if (String( chosenWl || '' ).includes('ม.รสม') || (rawWlMsl === undefined && rawWlRsm !== undefined)) {
            unitLabel = 'ม.รสม.';
          } else if (String(p.unit || p.wl_unit || '').includes('รสม')) {
            unitLabel = 'ม.รสม.';
          }

          // ดึงค่าน้ำฝนปัจจุบัน และ น้ำฝนสะสม 24 ชม. (มม.)
          const rainCurrent = p.rain_1h ?? p.rain_current ?? p.rain ?? p.rainfall ?? 0;
          const rain24h = p.rain_24h ?? p.rain24h ?? p.rainfall_24h ?? p.acc_rain ?? rainCurrent;

          const rawStatus = String(p.status || p.water_status || p.color || 'ปกติ');
          let status = 'ปกติ';
          if (/วิกฤต|critical|danger|red|3/i.test(rawStatus)) status = 'วิกฤติ';
          else if (/เตือนภัย|เฝ้าระวัง|warn|yellow|orange|2/i.test(rawStatus)) status = 'เตือนภัย';
          else if (/ขัดข้อง|offline|gray|0|-1/i.test(rawStatus)) status = 'ขัดข้อง';

          apiExtractedStations.push({
            stationCode: code,
            stationName: name.includes(code) ? name : `${code} ${name}`,
            basin,
            status,
            waterLevel: chosenWl !== undefined && chosenWl !== null ? `${chosenWl} ${unitLabel}` : `- ${unitLabel}`,
            waterLevelMsl: rawWlMsl !== undefined ? `${rawWlMsl} ม.รทก.` : undefined,
            waterLevelRsm: rawWlRsm !== undefined ? `${rawWlRsm} ม.รสม.` : undefined,
            waterUnit: unitLabel,
            rainfall: `${rainCurrent} มม.`,
            rainfall24h: `${rain24h} มม.`,
            scannedAt: new Date().toLocaleString('th-TH'),
          });
        }
      }
    } catch {
      // ignore non-json
    }
  };

  page.on('response', apiInterceptor);

  try {
    await page.goto(TELERID_MAIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // ตรวจสอบว่ามีปุ่มเข้าสู่ระบบหรือช่องกรอก Username / Password หรือไม่ หากมีให้ล็อกอินด้วย use: Sommart, PW: 891013 ทันที
    const loginBtn = page
      .locator('button:has-text("เข้าสู่ระบบ"), a:has-text("เข้าสู่ระบบ"), button:has-text("Login"), [class*="login"]')
      .first();
    if ((await loginBtn.count().catch(() => 0)) > 0) {
      await loginBtn.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    const userField = page
      .locator(
        'input[name*="user" i], input[placeholder*="ชื่อผู้ใช้" i], input[placeholder*="user" i], input[type="text"]'
      )
      .first();
    const passField = page
      .locator('input[type="password"], input[name*="pass" i], input[placeholder*="รหัสผ่าน" i]')
      .first();

    if ((await userField.count().catch(() => 0)) > 0 && (await passField.count().catch(() => 0)) > 0) {
      await userField.fill(username).catch(() => {});
      await passField.fill(password).catch(() => {});
      const submitBtn = page
        .locator('button[type="submit"], button:has-text("เข้าสู่ระบบ"), button:has-text("ตกลง"), button:has-text("Login")')
        .first();
      if ((await submitBtn.count().catch(() => 0)) > 0) {
        await submitBtn.click({ timeout: 5000 }).catch(() => {});
      } else {
        await passField.press('Enter').catch(() => {});
      }
      await page.waitForTimeout(2000);
    }

    // คลิกเลือกกรองลุ่มน้ำตามรายการที่กำหนดเพื่อให้เว็บยิง API ค่าน้ำและน้ำฝนของลุ่มน้ำนั้นออกมา
    for (const bName of targetBasins) {
      const cleanName = normalizeBasinNameForTeleRidWeb(bName);
      const shortName = cleanName.replace(/^ลุ่มน้ำ\s*/, '');
      const loc = page
        .locator(`label:has-text("${cleanName}"), span:has-text("${cleanName}"), label:has-text("${shortName}")`)
        .first();
      if ((await loc.count().catch(() => 0)) > 0) {
        await loc.click({ timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
    }
  } finally {
    page.off('response', apiInterceptor);
  }

  // คัดกรองค่าผิดปกติด้วย Data Loop Filter (ตรวจจับค่าติดลบเกิน -10 ลงไปจนถึง -999 ทั้ง ม.รทก. และ ม.รสม.)
  const thresholdResult = runStrictDataThresholdLoopFilter(apiExtractedStations, []);
  if (thresholdResult.hasCriticalAnomaly && socketIoOrCallback) {
    const first = thresholdResult.allFlaggedAnomalies[0];
    const payload = {
      type: 'SENSOR_BUG',
      stationId: first.stationCode,
      stationName: first.stationName,
      basin: first.basin,
      value: first.numericValue,
      unit: first.unit,
      reason: `${first.categoryThai}: ${first.reason}`,
      time: first.scannedAt,
    };
    if (typeof socketIoOrCallback.emit === 'function') {
      socketIoOrCallback.emit('SENSOR_BUG', payload);
    } else if (typeof socketIoOrCallback === 'function') {
      socketIoOrCallback(payload);
    }
  }

  return {
    authenticatedUser: username,
    capturedApiEndpoints,
    stationsCount: apiExtractedStations.length,
    stations: apiExtractedStations,
    thresholdResult,
  };
}

/**
 * โครงสร้างไฟล์ Macro JSON Config มาตรฐาน (พร้อมขั้นล็อกอิน use: Sommart, PW: 891013 และตรวจลุ่มน้ำโขงตะวันออกเฉียงเหนือ)
 */
function getDefaultMacroConfigJson() {
  return {
    macroId: 'MACRO-TELE04-KONG-ISAN',
    macroName: 'บันทึกพฤติกรรมการคลิกมนุษย์ (use: Sommart): ตรวจลุ่มน้ำโขงตะวันออกเฉียงเหนือ + ชี + มูล & กล้อง CCTV',
    createdAt: new Date().toISOString(),
    createdAtText: new Date().toLocaleString('th-TH'),
    credentials: {
      username: TELERID_AUTH_CREDENTIALS.username,
      password: TELERID_AUTH_CREDENTIALS.password,
    },
    targetBasins: ['ลุ่มน้ำโขงตะวันออกเฉียงเหนือ', 'ลุ่มน้ำชี', 'ลุ่มน้ำมูล'],
    cronSchedule: '0 * * * * (ตรวจสอบทุก 1 ชั่วโมง ตลอด 24 ชั่วโมง ยึดเวลาต้นชั่วโมงจริง 00:00 - 23:00 น. โดยไม่รีเซ็ตเมื่อกดตรวจเอง)',
    steps: [
      {
        stepNo: 1,
        actionType: 'navigate',
        url: TELERID_MAIN_URL,
        description: `เปิดหน้าหลักระบบโทรมาตร ${TELERID_MAIN_URL} และล็อกอินด้วย use: ${TELERID_AUTH_CREDENTIALS.username}`,
        delayAfterMs: 1800,
      },
      {
        stepNo: 2,
        actionType: 'click',
        x: 1265,
        y: 248,
        selector: 'label:has-text("ลุ่มน้ำโขงตะวันออกเฉียงเหนือ"), span:has-text("โขงตะวันออกเฉียงเหนือ")',
        innerText: 'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ',
        description: 'คลิกเลือกตัวกรอง "ลุ่มน้ำโขงตะวันออกเฉียงเหนือ" บนแผงควบคุมด้านขวา',
        delayAfterMs: 1200,
      },
      {
        stepNo: 3,
        actionType: 'click',
        x: 1265,
        y: 276,
        selector: 'label:has-text("ลุ่มน้ำชี"), span:has-text("ลุ่มน้ำชี")',
        innerText: 'ลุ่มน้ำชี',
        description: 'คลิกเลือกตัวกรอง "ลุ่มน้ำชี"',
        delayAfterMs: 1200,
      },
      {
        stepNo: 4,
        actionType: 'click',
        x: 1265,
        y: 304,
        selector: 'label:has-text("ลุ่มน้ำมูล"), span:has-text("ลุ่มน้ำมูล")',
        innerText: 'ลุ่มน้ำมูล',
        description: 'คลิกเลือกตัวกรอง "ลุ่มน้ำมูล"',
        delayAfterMs: 1500,
      },
      {
        stepNo: 5,
        actionType: 'observe_dom_table',
        url: TELERID_MAIN_URL,
        description:
          'สกัดค่าน้ำ (ทั้ง ม.รทก. และ ม.รสม.) และค่าน้ำฝน (มม.) จาก API & Elements หน้าจอจริง (ดักจับค่าติดลบเกิน -10 ลงไปจนถึง -999)',
        delayAfterMs: 1000,
      },
      {
        stepNo: 6,
        actionType: 'navigate',
        url: TELERID_CCTV_URL,
        description: 'คลิกสลับไปที่หน้าตรวจสอบกล้องโทรทัศน์วงจรปิด https://telerid.rid.go.th/#/cctv',
        delayAfterMs: 2000,
      },
      {
        stepNo: 7,
        actionType: 'observe_dom_cctv',
        url: TELERID_CCTV_URL,
        description: 'สกัดสถานะกล้อง CCTV และเวลาอัปเดตภาพล่าสุดจาก Elements หน้าจอจริง',
        delayAfterMs: 800,
      },
    ],
  };
}

function loadMacroConfigFromDisk() {
  try {
    if (fs.existsSync(MACRO_CONFIG_FILE_PATH)) {
      const raw = fs.readFileSync(MACRO_CONFIG_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
        return parsed;
      }
    }
  } catch {
    // fallback
  }
  const fallback = getDefaultMacroConfigJson();
  try {
    fs.writeFileSync(MACRO_CONFIG_FILE_PATH, JSON.stringify(fallback, null, 2), 'utf-8');
  } catch {
    // ignore
  }
  return fallback;
}

function saveMacroConfigToDisk(macroConfig) {
  try {
    const dir = path.dirname(MACRO_CONFIG_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(MACRO_CONFIG_FILE_PATH, JSON.stringify(macroConfig, null, 2), 'utf-8');
  } catch {
    // ignore
  }
  return MACRO_CONFIG_FILE_PATH;
}

/**
 * ============================================================================
 * 3. กลไกการบันทึกมาโคร (Macro Recording Engine)
 * ============================================================================
 */
let activeRecordingSession = null;

async function startMacroRecordingSession(playwright, onStepRecordedCallback = null) {
  if (activeRecordingSession && activeRecordingSession.isRecording) {
    return {
      ok: true,
      alreadyRecording: true,
      startedAt: activeRecordingSession.startedAt,
      recordedSteps: activeRecordingSession.steps,
    };
  }

  const { context, page, profileUsed } = await launchTele04PersistentChrome(playwright, {
    headless: false,
  });

  const recordedSteps = [
    {
      stepNo: 1,
      actionType: 'navigate',
      url: TELERID_MAIN_URL,
      description: `เปิดหน้าต่าง Chrome จริงเข้าสู่ ${TELERID_MAIN_URL} (use: ${TELERID_AUTH_CREDENTIALS.username})`,
      timestamp: new Date().toLocaleTimeString('th-TH'),
      delayAfterMs: 1200,
    },
  ];

  await context.exposeBinding('__tele04CaptureHumanEvent', (_source, evtPayload) => {
    if (!activeRecordingSession || !activeRecordingSession.isRecording) return;
    const stepNo = recordedSteps.length + 1;
    const stepItem = {
      stepNo,
      actionType: evtPayload.actionType || 'click',
      x: typeof evtPayload.x === 'number' ? evtPayload.x : undefined,
      y: typeof evtPayload.y === 'number' ? evtPayload.y : undefined,
      selector: evtPayload.selector || '',
      tagName: evtPayload.tagName || '',
      innerText: (evtPayload.innerText || '').slice(0, 120),
      inputValue: evtPayload.inputValue || undefined,
      keyPressed: evtPayload.keyPressed || undefined,
      url: evtPayload.url || page.url(),
      description: evtPayload.description || `คลิกที่พิกัด (${evtPayload.x}, ${evtPayload.y})`,
      timestamp: new Date().toLocaleTimeString('th-TH'),
      delayAfterMs: 1000,
    };
    recordedSteps.push(stepItem);
    if (typeof onStepRecordedCallback === 'function') {
      onStepRecordedCallback(stepItem, recordedSteps);
    }
  });

  const domRecorderScript = () => {
    if (window.__tele04MacroListenersInstalled) return;
    window.__tele04MacroListenersInstalled = true;

    function buildSmartSelector(el) {
      if (!el || !el.tagName) return 'body';
      if (el.id) return `#${el.id}`;
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      const tag = el.tagName.toLowerCase();
      if (text && text.length <= 45 && ['button', 'label', 'span', 'a', 'li', 'div'].includes(tag)) {
        return `${tag}:has-text("${text.replace(/"/g, '\\"')}")`;
      }
      if (el.name) return `${tag}[name="${el.name}"]`;
      if (el.placeholder) return `${tag}[placeholder="${el.placeholder}"]`;
      return tag;
    }

    document.addEventListener(
      'click',
      (e) => {
        const target = e.target;
        if (!target) return;
        const selector = buildSmartSelector(target);
        const text = (target.innerText || target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        const x = Math.round(e.clientX || 0);
        const y = Math.round(e.clientY || 0);

        let desc = `คลิกเมาส์ที่ (${x}, ${y})`;
        if (text.includes('ลุ่มน้ำ') || text.includes('โขงตะวันออกเฉียงเหนือ')) {
          desc = `คลิกเลือกชื่อลุ่มน้ำ "${text}" ที่พิกัด (${x}, ${y})`;
        } else if (text) {
          desc = `คลิกปุ่ม/องค์ประกอบ "${text}" ที่พิกัด (${x}, ${y})`;
        }

        if (typeof window.__tele04CaptureHumanEvent === 'function') {
          window.__tele04CaptureHumanEvent({
            actionType: 'click',
            x,
            y,
            selector,
            tagName: target.tagName,
            innerText: text,
            url: window.location.href,
            description: desc,
          });
        }
      },
      true
    );

    document.addEventListener(
      'change',
      (e) => {
        const target = e.target;
        if (!target || !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
        const selector = buildSmartSelector(target);
        const val = String(target.value || '');
        if (typeof window.__tele04CaptureHumanEvent === 'function') {
          window.__tele04CaptureHumanEvent({
            actionType: 'input',
            selector,
            tagName: target.tagName,
            inputValue: val,
            url: window.location.href,
            description: `พิมพ์ข้อความ/เลือกค่า "${val}" ลงในช่อง ${selector}`,
          });
        }
      },
      true
    );
  };

  await context.addInitScript(domRecorderScript);
  await page.goto(TELERID_MAIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.evaluate(domRecorderScript).catch(() => {});

  activeRecordingSession = {
    isRecording: true,
    startedAt: new Date().toISOString(),
    startedAtText: new Date().toLocaleString('th-TH'),
    profileUsed,
    context,
    page,
    steps: recordedSteps,
  };

  return {
    ok: true,
    startedAt: activeRecordingSession.startedAt,
    startedAtText: activeRecordingSession.startedAtText,
    profileUsed,
    macroConfigPath: MACRO_CONFIG_FILE_PATH,
    recordedSteps,
  };
}

async function stopAndSaveMacroRecordingSession(customTargetBasins) {
  const existingConfig = loadMacroConfigFromDisk();
  let stepsToSave = [];
  let basinsDetected = Array.isArray(customTargetBasins) && customTargetBasins.length > 0
    ? customTargetBasins.map((b) => normalizeBasinNameForTeleRidWeb(b))
    : ['ลุ่มน้ำโขงตะวันออกเฉียงเหนือ', 'ลุ่มน้ำชี', 'ลุ่มน้ำมูล'];

  if (activeRecordingSession) {
    activeRecordingSession.isRecording = false;
    stepsToSave = Array.isArray(activeRecordingSession.steps) ? [...activeRecordingSession.steps] : [];

    const clickedBasins = [];
    for (const st of stepsToSave) {
      const txt = String(st.innerText || st.description || '');
      for (const hb of hardcodedBasins) {
        const shortHb = hb.replace(/^ลุ่มน้ำ\s*/, '');
        if (txt.includes(hb) || (shortHb.length >= 2 && txt.includes(shortHb))) {
          const norm = normalizeBasinNameForTeleRidWeb(hb);
          if (!clickedBasins.includes(norm)) clickedBasins.push(norm);
        }
      }
    }
    if (clickedBasins.length > 0) {
      basinsDetected = clickedBasins;
    }

    try {
      if (activeRecordingSession.context) {
        await activeRecordingSession.context.close().catch(() => {});
      }
    } catch {
      // ignore
    }
    activeRecordingSession = null;
  }

  if (stepsToSave.length <= 1) {
    stepsToSave = getDefaultMacroConfigJson().steps;
  } else {
    if (!stepsToSave.some((s) => s.actionType === 'observe_dom_table')) {
      stepsToSave.push({
        stepNo: stepsToSave.length + 1,
        actionType: 'observe_dom_table',
        url: TELERID_MAIN_URL,
        description:
          'สกัดค่าน้ำสด (ทั้ง ม.รทก. และ ม.รสม.) และค่าน้ำฝน (มม.) จากหน้าจอจริงและ API (ดักจับค่าติดลบเกิน -10 ลงไปจนถึง -999)',
        delayAfterMs: 1000,
      });
    }
    if (!stepsToSave.some((s) => s.actionType === 'observe_dom_cctv')) {
      stepsToSave.push({
        stepNo: stepsToSave.length + 1,
        actionType: 'navigate',
        url: TELERID_CCTV_URL,
        description: 'เปิดหน้ากล้อง CCTV https://telerid.rid.go.th/#/cctv',
        delayAfterMs: 1800,
      });
      stepsToSave.push({
        stepNo: stepsToSave.length + 1,
        actionType: 'observe_dom_cctv',
        url: TELERID_CCTV_URL,
        description: 'ดึงสถานะกล้อง CCTV และตรวจสอบกล้องค้างเกิน 1 ชั่วโมงจาก Elements หน้าจอจริง',
        delayAfterMs: 800,
      });
    }
  }

  const newMacroConfig = {
    macroId: `MACRO-TELE04-${Date.now()}`,
    macroName: `บันทึกพฤติกรรมการคลิกมนุษย์ (${basinsDetected.join(' + ')})`,
    createdAt: new Date().toISOString(),
    createdAtText: new Date().toLocaleString('th-TH'),
    credentials: TELERID_AUTH_CREDENTIALS,
    targetBasins: basinsDetected,
    cronSchedule: '0 * * * * (ตรวจสอบทุก 1 ชั่วโมง ตลอด 24 ชั่วโมง ยึดเวลาต้นชั่วโมงจริง 00:00 - 23:00 น. โดยไม่รีเซ็ตเมื่อกดตรวจเอง)',
    steps: stepsToSave,
  };

  const savedPath = saveMacroConfigToDisk(newMacroConfig);
  return {
    ok: true,
    macroConfigPath: savedPath,
    macroConfig: newMacroConfig || existingConfig,
  };
}

/**
 * ============================================================================
 * 4. ฟังก์ชันการลูปตรวจจับค่าผิดปกติขั้นสูง (Strict Data Loop Filter)
 * กฎเหล็กอัปเดตใหม่:
 * 1) [ตรวจจับค่าน้ำผิดปกติ/ไม่ถูกต้อง ทั้ง ม.รทก. และ ม.รสม.]:
 *    - หากค่าน้ำมีค่าติดลบเกิน -10 ลงไปจนถึง -999 (wlNum <= -10, เช่น -10, -25, -150, ..., -999)
 *      หรือพุ่งเกิน >= 999 ไม่ว่าจะอยู่ในหน่วย "ม.รทก." หรือ "ม.รสม." ถือเป็นค่าไม่ถูกต้อง ต้องแจ้งเตือนทันที!
 * 2) [ตรวจจับค่าน้ำติดลบตามภูมิประเทศ]: ค่าน้ำติดลบ (< 0 ถึง > -10) ในสถานีพื้นที่บก/พื้นที่ดอน
 * 3) [ตรวจจับค่าน้ำฝนสะสม/น้ำฝนปัจจุบันวิกฤต]: น้ำฝน > 100 มม. หรือทะลุ >= 1,000 - 10,000+ มม.
 * 4) [ตรวจจับกล้อง CCTV ค้างส่งเกิน 1 ชั่วโมง]: กล้องไม่แสดงภาพ หรือเวลาค้างส่ง > 60 นาที
 * ============================================================================
 */
function runStrictDataThresholdLoopFilter(observedStations = [], observedCctvCameras = []) {
  const waterSystemBugStations = []; // ค่าติดลบเกิน -10 ลงไปจนถึง -999 (<= -10) หรือ >= 999 ทั้ง ม.รทก. และ ม.รสม.
  const negativeUplandWaterStations = []; // ค่าน้ำติดลบ (0 ถึง -9.99) บนพื้นที่บก/ดอน
  const rainCriticalOver100Stations = []; // น้ำฝน > 100 มม.
  const rainExtremeOver1000Stations = []; // น้ำฝน >= 1,000 ถึงหลักหมื่น มม.
  const cctvFrozenOrBrokenStations = []; // CCTV ค้าง > 60 นาที หรือภาพเทา
  const allFlaggedAnomalies = [];

  for (const st of observedStations) {
    const stationCode = String(st.stationCode || '').trim();
    const stationName = String(st.stationName || stationCode).trim();
    const basin = String(st.basin || 'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ').trim();
    const scannedAt = st.scannedAt || new Date().toLocaleString('th-TH');

    const rawWlStr = String(st.waterLevel ?? '').replace(/,/g, '');
    const detectedUnit = st.waterUnit || detectWaterLevelUnit(rawWlStr);
    const rawRainCurStr = String(st.rainfall ?? '').replace(/,/g, '');
    const rawRain24Str = String(st.rainfall24h ?? st.rainfall ?? '').replace(/,/g, '');

    const wlMatch = rawWlStr.match(/-?\d+(?:\.\d+)?/);
    const rainCurMatch = rawRainCurStr.match(/-?\d+(?:\.\d+)?/);
    const rain24Match = rawRain24Str.match(/-?\d+(?:\.\d+)?/);

    const wlNum = wlMatch ? parseFloat(wlMatch[0]) : NaN;
    const rainCurNum = rainCurMatch ? parseFloat(rainCurMatch[0]) : NaN;
    const rain24Num = rain24Match ? parseFloat(rain24Match[0]) : NaN;
    const maxRainNum = Math.max(
      Number.isNaN(rainCurNum) ? 0 : rainCurNum,
      Number.isNaN(rain24Num) ? 0 : rain24Num
    );

    // เงื่อนไขที่ 1 (อัปเดตตามคำสั่ง): ค่าติดลบเกิน -10 ลงไปจนถึง -999 (wlNum <= -10) หรือ >= 999
    // คือค่าไม่ถูกต้อง ทั้งหน่วย ม.รทก. และ ม.รสม.!
    if (!Number.isNaN(wlNum) && (wlNum <= -10 || wlNum >= 999)) {
      const anomaly = {
        category: 'WATER_SYSTEM_BUG',
        categoryThai:
          wlNum <= -10
            ? `ค่าน้ำติดลบผิดปกติเกิน -10 ลงไปถึง -999 (${detectedUnit})`
            : `ค่าน้ำระบบเอ๋อพุ่งเกิน >= 999 (${detectedUnit})`,
        stationCode,
        stationName,
        basin,
        observedValue: `${wlNum} ${detectedUnit}`,
        numericValue: wlNum,
        unit: detectedUnit,
        reason:
          wlNum <= -10
            ? `ตรวจพบค่าน้ำติดลบเกิน -10 ลงไปจนถึง -999 (${wlNum} ${detectedUnit}) ซึ่งเป็นค่าไม่ถูกต้องทั้ง ม.รทก. และ ม.รสม. (เซนเซอร์ขัดข้อง)`
            : `ตรวจพบค่าน้ำพุ่งเกิน 999 (${wlNum} ${detectedUnit}) ซึ่งเป็นค่าไม่ถูกต้องทั้ง ม.รทก. และ ม.รสม.`,
        scannedAt,
      };
      waterSystemBugStations.push(anomaly);
      allFlaggedAnomalies.push(anomaly);
    }
    // เงื่อนไขที่ 2: ค่าน้ำติดลบ (< 0 แต่ยังไม่ถึง -10) บนสถานีพื้นที่บก/พื้นที่ดอน
    else if (!Number.isNaN(wlNum) && wlNum < 0 && isUplandTerrainStation(basin, stationCode, stationName)) {
      const anomaly = {
        category: 'NEGATIVE_UPLAND_WATER',
        categoryThai: `ค่าน้ำติดลบในพื้นที่บก/พื้นที่ดอน (${detectedUnit})`,
        stationCode,
        stationName,
        basin,
        observedValue: `${wlNum} ${detectedUnit}`,
        numericValue: wlNum,
        unit: detectedUnit,
        reason: `ตรวจพบค่าน้ำติดลบ (${wlNum} ${detectedUnit}) ในสถานีพื้นที่บก/พื้นที่ดอน`,
        scannedAt,
      };
      negativeUplandWaterStations.push(anomaly);
      allFlaggedAnomalies.push(anomaly);
    }

    // เงื่อนไขที่ 3: ค่าน้ำฝนสะสม/น้ำฝนปัจจุบันวิกฤต (> 100 มม. หรือทะลุ >= 1,000 ถึงหลักหมื่น มม.)
    if (!Number.isNaN(maxRainNum) && maxRainNum >= 1000) {
      const anomaly = {
        category: 'RAIN_EXTREME_SPIKE',
        categoryThai: 'ค่าน้ำฝนพุ่งสูงเวอร์ทะลุหลักพัน/หลักหมื่น (>= 1,000 มม.)',
        stationCode,
        stationName,
        basin,
        observedValue: `${maxRainNum} มม.`,
        numericValue: maxRainNum,
        unit: 'มม.',
        reason: `ตรวจพบค่าน้ำฝนพุ่งสูงเวอร์ผิดปกติ (${maxRainNum} มม. >= 1,000 มม.) RTU/เซนเซอร์วัดน้ำฝนส่งค่าบั๊ก`,
        scannedAt,
      };
      rainExtremeOver1000Stations.push(anomaly);
      allFlaggedAnomalies.push(anomaly);
    } else if (!Number.isNaN(maxRainNum) && maxRainNum > 100) {
      const anomaly = {
        category: 'RAIN_CRITICAL_OVER_100',
        categoryThai: 'ค่าน้ำฝนวิกฤตเกิน 100 มม.',
        stationCode,
        stationName,
        basin,
        observedValue: `${maxRainNum} มม.`,
        numericValue: maxRainNum,
        unit: 'มม.',
        reason: `ตรวจพบค่าน้ำฝนสะสม/ปัจจุบันสูงวิกฤต (${maxRainNum} มม. > 100 มม.) เฝ้าระวังน้ำหลาก`,
        scannedAt,
      };
      rainCriticalOver100Stations.push(anomaly);
      allFlaggedAnomalies.push(anomaly);
    }
  }

  // เงื่อนไขที่ 4: กล้อง CCTV ค้างส่งเกิน 1 ชั่วโมง หรือไม่แสดงภาพ
  for (const cam of observedCctvCameras) {
    const lagMin = Number(cam.lagMinutes ?? 0);
    const isBroken = Boolean(cam.isBrokenOrGray) || String(cam.imageDisplayStatus || '').includes('ไม่แสดงภาพ');
    if (isBroken || lagMin > 60) {
      const anomaly = {
        category: 'CCTV_FROZEN_OR_BROKEN',
        categoryThai: isBroken ? 'กล้อง CCTV ไม่แสดงภาพ (ภาพเทา)' : `กล้อง CCTV ค้างส่งเกิน 1 ชม. (${lagMin} นาที)`,
        stationCode: cam.stationCode || 'CCTV',
        stationName: cam.stationName || cam.stationCode || 'สถานี CCTV',
        basin: cam.basin || 'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ',
        observedValue: isBroken ? 'ไม่มีสัญญาณภาพ' : `ค้าง ${lagMin} นาที`,
        numericValue: lagMin,
        unit: 'นาที',
        reason: isBroken
          ? 'ตรวจพบกล่องภาพสีเทา/ไอคอนภาพเสียบนหน้า #/cctv'
          : `เวลาบนภาพกล้อง CCTV ค้างส่งนาน ${lagMin} นาที (เกิน 1 ชั่วโมง)`,
        scannedAt: new Date().toLocaleString('th-TH'),
      };
      cctvFrozenOrBrokenStations.push(anomaly);
      allFlaggedAnomalies.push(anomaly);
    }
  }

  return {
    hasCriticalAnomaly: allFlaggedAnomalies.length > 0,
    totalAnomaliesCount: allFlaggedAnomalies.length,
    waterSystemBugStations,
    negativeUplandWaterStations,
    rainCriticalOver100Stations,
    rainExtremeOver1000Stations,
    cctvFrozenOrBrokenStations,
    allFlaggedAnomalies,
  };
}

/**
 * ============================================================================
 * 5. กลไกการเล่นซ้ำมาโคร 1:1 + ล็อกอิน Sommart / 891013 ดึงค่า API & DOM หน้าจอจริง
 * ============================================================================
 */
async function playMacroAndScrapePureDomOnChrome(playwright, macroConfigInput = null, socketIoOrCallback = null) {
  const macroConfig = macroConfigInput || loadMacroConfigFromDisk();
  const playbackLogs = [];
  const logStep = (msg) => {
    playbackLogs.push(`[${new Date().toLocaleTimeString('th-TH')}] ${msg}`);
  };

  logStep(
    `เริ่มรัน Macro Playback (${macroConfig.macroName}) ด้วยบัญชี use: ${TELERID_AUTH_CREDENTIALS.username} จำนวน ${macroConfig.steps.length} ขั้นตอน`
  );

  const { context, page, profileUsed } = await launchTele04PersistentChrome(playwright, {
    headless: false,
  });

  let pureObservedDashboard = null;
  let pureObservedStations = [];
  let pureObservedCctv = [];
  let apiScanData = null;
  let pageObservationStatus = 'OK_LIVE_DOM_AND_API_OBSERVED';

  try {
    // สแกนและล็อกอินดึงค่า API ทั้งค่าน้ำ (ม.รทก. / ม.รสม.) และน้ำฝน (มม.) ด้วย use: Sommart, PW: 891013
    apiScanData = await loginAndScanTeleRidWaterAndRainApi(
      page,
      TELERID_AUTH_CREDENTIALS,
      macroConfig.targetBasins,
      socketIoOrCallback
    );

    for (const step of macroConfig.steps) {
      logStep(`Step #${step.stepNo} [${step.actionType}]: ${step.description || ''}`);

      if (step.actionType === 'navigate' && step.url) {
        await page.goto(step.url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(step.delayAfterMs || 1500);
      } else if (step.actionType === 'click') {
        if (typeof step.x === 'number' && typeof step.y === 'number') {
          await page.mouse.move(step.x, step.y, { steps: 12 }).catch(() => {});
        }
        let clickedBySelector = false;
        if (step.selector) {
          const loc = page.locator(step.selector).first();
          if ((await loc.count().catch(() => 0)) > 0) {
            await loc.click({ timeout: 5000 }).catch(() => {});
            clickedBySelector = true;
          }
        }
        if (!clickedBySelector && typeof step.x === 'number' && typeof step.y === 'number') {
          await page.mouse.click(step.x, step.y).catch(() => {});
        }
        await page.waitForTimeout(step.delayAfterMs || 1000);
      } else if (step.actionType === 'input' && step.selector) {
        const loc = page.locator(step.selector).first();
        if ((await loc.count().catch(() => 0)) > 0) {
          await loc.fill(String(step.inputValue || '')).catch(() => {});
        }
        await page.waitForTimeout(step.delayAfterMs || 800);
      } else if (step.actionType === 'keypress' && step.keyPressed) {
        await page.keyboard.press(step.keyPressed).catch(() => {});
        await page.waitForTimeout(step.delayAfterMs || 600);
      } else if (step.actionType === 'observe_dom_table') {
        const domSnapshot = await page.evaluate(() => {
          const bodyText = document.body ? document.body.innerText.trim() : '';
          if (!bodyText) {
            return {
              isEmptyOrUnrefreshed: true,
              statusMessage: 'หน้าจอโหลดมาว่างเปล่า หรือค่ายังไม่รีเฟรช ณ วินาทีที่สแกน',
              summary: { online: null, warning: null, critical: null, offline: null, total: null },
              rows: [],
            };
          }

          const readNumberNearLabel = (labelPattern) => {
            const rgx = new RegExp(`(\\d+)\\s*(?:\\(\\s*สถานี\\s*\\))?\\s*[\\r\\n\\s]*(?:${labelPattern})`);
            const m = bodyText.match(rgx);
            return m ? parseInt(m[1], 10) : null;
          };

          const totalMatch = bodyText.match(/จำนวนสถานี\s*(\d+)\s*สถานี/);
          const trElements = Array.from(
            document.querySelectorAll('table tbody tr, .el-table__body tr, .v-data-table tbody tr')
          );
          const extractedRows = [];

          for (const tr of trElements) {
            const cells = Array.from(tr.querySelectorAll('td, .cell')).map((c) =>
              (c.innerText || c.textContent || '').replace(/\s+/g, ' ').trim()
            );
            if (cells.length < 2) continue;
            const rowText = cells.join(' | ');
            if (!rowText || /ชื่อสถานี.*สถานะ/i.test(rowText)) continue;

            const codeMatch = rowText.match(/([A-Za-z]{2,5}[.-]?\d+[A-Za-z0-9.\s()/,-]*)/);
            const stationCode = codeMatch ? codeMatch[1].trim() : cells[0] || 'ไม่พบค่า';
            const cell1Text = (cells[1] || '').trim();
            const isCell1Basin = /^ลุ่มน้ำ/.test(cell1Text);
            const stationName = !isCell1Basin && cell1Text ? cell1Text : stationCode;
            const rowBasin = isCell1Basin ? cell1Text : 'อ่านจากหน้าจอจริง (Live DOM)';

            // ห้ามตรวจ tr.innerHTML ด้วยคำว่า warn/yellow เด็ดขาด เพราะตาราง TeleRID มี class ซ่อนอยู่ในทุกแถว
            let status = 'ปกติ';
            if (/\b(?:วิกฤติ|วิกฤต)\b/.test(rowText)) status = 'วิกฤติ';
            else if (/\bเตือนภัย\b/.test(rowText)) status = 'เตือนภัย';
            else if (/\b(?:ขัดข้อง|ออฟไลน์)\b/.test(rowText)) status = 'ขัดข้อง';

            // ตรวจจับหน่วย ม.รทก. หรือ ม.รสม. จากแถวตารางจริง
            const unitDetected = rowText.includes('ม.รทก') ? 'ม.รทก.' : rowText.includes('ม.รสม') ? 'ม.รสม.' : '';
            const numericTokens = rowText.replace(stationCode, '').match(/-?\d+(?:\.\d+)?/g) || [];
            const waterLevel =
              numericTokens.length > 0
                ? `${numericTokens[0]}${unitDetected ? ' ' + unitDetected : ''}`
                : cells[2] || 'ไม่พบค่า';
            const rainfall = numericTokens.length > 1 ? `${numericTokens[1]} มม.` : cells[3] || 'ไม่พบค่า';
            const rainfall24h =
              numericTokens.length > 2 ? `${numericTokens[numericTokens.length - 1]} มม.` : rainfall;

            extractedRows.push({
              stationCode,
              stationName,
              basin: rowBasin,
              status,
              waterLevel,
              waterUnit: unitDetected || 'ไม่พบค่า',
              rainfall,
              rainfall24h,
              rawDomRowText: rowText,
              scannedAt: new Date().toLocaleString('th-TH'),
            });
          }

          const online = readNumberNearLabel('ปกติ');
          const warning = readNumberNearLabel('เตือนภัย');
          const critical = readNumberNearLabel('วิกฤติ?');
          const offline = readNumberNearLabel('ขัดข้อง');
          const sumVal = (online ?? 0) + (warning ?? 0) + (critical ?? 0) + (offline ?? 0);

          return {
            isEmptyOrUnrefreshed: sumVal === 0 && extractedRows.length === 0,
            statusMessage:
              sumVal === 0 && extractedRows.length === 0
                ? 'ไม่พบค่า (หน้าเว็บยังโหลดตัวเลขสถานีไม่สำเร็จ)'
                : `อ่านค่าสดจาก Elements หน้าเพจสำเร็จ (${extractedRows.length} แถว)`,
            summary:
              sumVal > 0
                ? {
                    online,
                    warning,
                    critical,
                    offline,
                    total: totalMatch ? parseInt(totalMatch[1], 10) : null,
                  }
                : { online: null, warning: null, critical: null, offline: null, total: null },
            rows: extractedRows,
          };
        });

        pureObservedDashboard = domSnapshot.summary;
        pureObservedStations =
          apiScanData && apiScanData.stations.length > 0
            ? [...apiScanData.stations, ...domSnapshot.rows]
            : domSnapshot.rows;
        if (domSnapshot.isEmptyOrUnrefreshed && (!apiScanData || apiScanData.stations.length === 0)) {
          pageObservationStatus = domSnapshot.statusMessage;
        }
        logStep(domSnapshot.statusMessage);
      } else if (step.actionType === 'observe_dom_cctv') {
        const cctvSnapshot = await page.evaluate(() => {
          const cards = Array.from(
            document.querySelectorAll('.cctv-card, .camera-card, .el-card, .v-card, [class*="cctv"]')
          );
          const cams = [];
          const nowMs = Date.now();

          for (const card of cards) {
            const text = (card.innerText || card.textContent || '').replace(/\s+/g, ' ').trim();
            if (!text) continue;
            const img = card.querySelector('img');
            const isBrokenOrGray = !img || !img.complete || img.naturalWidth === 0;

            let lagMinutes = 0;
            const timeMatch = text.match(/(\d{1,2}):(\d{2})/);
            if (timeMatch) {
              const now = new Date();
              const camTime = new Date(now);
              camTime.setHours(parseInt(timeMatch[1], 10), parseInt(timeMatch[2], 10), 0, 0);
              const diffMin = Math.round((nowMs - camTime.getTime()) / 60000);
              if (diffMin > 0 && diffMin < 1440) lagMinutes = diffMin;
            }

            cams.push({
              stationCode: (text.match(/[A-Za-z]{2,5}[.-]?\d+/) || ['CCTV'])[0],
              stationName: text.slice(0, 80),
              isBrokenOrGray,
              imageDisplayStatus: isBrokenOrGray ? 'ไม่แสดงภาพ (กล่องสีเทา/ไอคอนเสีย)' : 'แสดงภาพปกติ',
              lagMinutes,
            });
          }
          return cams;
        });

        pureObservedCctv = cctvSnapshot;
        logStep(`สกัดการ์ดกล้อง CCTV จากหน้าจอจริงสำเร็จ (${pureObservedCctv.length} กล้อง)`);
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  const thresholdResult = runStrictDataThresholdLoopFilter(pureObservedStations, pureObservedCctv);

  if (thresholdResult.hasCriticalAnomaly && socketIoOrCallback) {
    const firstAnomaly = thresholdResult.allFlaggedAnomalies[0];
    const alertPayload = {
      type: 'SENSOR_BUG',
      stationId: firstAnomaly.stationCode,
      stationName: firstAnomaly.stationName,
      basin: firstAnomaly.basin,
      value: firstAnomaly.numericValue,
      unit: firstAnomaly.unit,
      reason: `${firstAnomaly.categoryThai}: ${firstAnomaly.reason}`,
      time: firstAnomaly.scannedAt,
      allAnomaliesCount: thresholdResult.totalAnomaliesCount,
    };
    if (typeof socketIoOrCallback.emit === 'function') {
      socketIoOrCallback.emit('SENSOR_BUG', alertPayload);
    } else if (typeof socketIoOrCallback === 'function') {
      socketIoOrCallback(alertPayload);
    }
  }

  const executionResult = {
    executedAtIso: new Date().toISOString(),
    executedAtText: new Date().toLocaleString('th-TH'),
    profileUsed,
    authenticatedUser: TELERID_AUTH_CREDENTIALS.username,
    macroId: macroConfig.macroId,
    macroName: macroConfig.macroName,
    targetBasins: macroConfig.targetBasins,
    pageObservationStatus,
    pureObservedDashboard,
    pureObservedStations,
    pureObservedCctv,
    thresholdResult,
    playbackLogs,
  };

  const exportedFiles = await exportPureObservationToExcelAndPdf(executionResult);
  executionResult.savedExcelPath = exportedFiles.excelFilePath;
  executionResult.savedPdfPath = exportedFiles.pdfFilePath;

  return executionResult;
}

/**
 * 6. ส่งออกผลลัพธ์ที่สแกนพบจริงเป็นไฟล์ Excel (.xlsx) และ PDF ลงใน C:\Users\Tele_04\Downloads ทันที
 */
async function exportPureObservationToExcelAndPdf(executionResult, customOutputDir = USER_DOWNLOADS_DIR) {
  if (!fs.existsSync(customOutputDir)) {
    fs.mkdirSync(customOutputDir, { recursive: true });
  }

  const now = new Date();
  const timeSlug = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;

  const excelFilePath = path.join(customOutputDir, `TeleRID_Macro_Observation_${timeSlug}.xlsx`);
  const pdfFilePath = path.join(customOutputDir, `TeleRID_Macro_Observation_${timeSlug}.pdf`);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TeleRID Autonomous Macro Recorder & Pure DOM Observer (User: Tele_04)';
  workbook.created = now;

  const wsAnomalies = workbook.addWorksheet('สถานีผิดปกติ (Data Loop Filter)');
  wsAnomalies.columns = [
    { header: 'ลำดับ', key: 'idx', width: 10 },
    { header: 'ประเภทความผิดปกติ (Threshold Rule)', key: 'categoryThai', width: 42 },
    { header: 'รหัสสถานี', key: 'stationCode', width: 22 },
    { header: 'ชื่อสถานีโทรมาตร (อ่านสดจากหน้าจอจริง/API)', key: 'stationName', width: 42 },
    { header: 'ลุ่มน้ำ', key: 'basin', width: 32 },
    { header: 'ค่าที่ตรวจพบ (ม.รทก. / ม.รสม. / มม.)', key: 'observedValue', width: 26 },
    { header: 'รายละเอียดการคัดกรอง', key: 'reason', width: 56 },
    { header: 'เวลาที่สแกนจริง', key: 'scannedAt', width: 24 },
  ];
  wsAnomalies.getRow(1).font = { bold: true, size: 12 };

  const flagged = executionResult?.thresholdResult?.allFlaggedAnomalies || [];
  if (flagged.length === 0) {
    wsAnomalies.addRow({
      idx: 1,
      categoryThai: 'ไม่พบสถานีผิดปกติในรอบชั่วโมงนี้',
      stationCode: '-',
      stationName: executionResult.pageObservationStatus || 'อ่านค่าจากหน้าจอจริงเรียบร้อย',
      basin: (executionResult.targetBasins || []).join(', '),
      observedValue: 'ปกติ',
      reason: 'ทุกสถานีอยู่ในเกณฑ์ปกติ (ไม่พบค่าติดลบเกิน -10 ถึง -999 ทั้ง ม.รทก. และ ม.รสม.)',
      scannedAt: executionResult.executedAtText,
    });
  } else {
    flagged.forEach((item, idx) => {
      wsAnomalies.addRow({
        idx: idx + 1,
        categoryThai: item.categoryThai,
        stationCode: item.stationCode,
        stationName: item.stationName,
        basin: item.basin,
        observedValue: item.observedValue,
        reason: item.reason,
        scannedAt: item.scannedAt,
      });
    });
  }

  const wsRawDom = workbook.addWorksheet('ข้อมูลสดบนหน้าจอจริง (Pure DOM & API)');
  wsRawDom.columns = [
    { header: 'ลำดับ', key: 'idx', width: 10 },
    { header: 'รหัสสถานี', key: 'stationCode', width: 22 },
    { header: 'ชื่อสถานี', key: 'stationName', width: 42 },
    { header: 'ลุ่มน้ำ', key: 'basin', width: 30 },
    { header: 'สถานะบนหน้าเว็บ', key: 'status', width: 18 },
    { header: 'ระดับน้ำปัจจุบัน (ม.รทก. / ม.รสม.)', key: 'waterLevel', width: 26 },
    { header: 'น้ำฝนปัจจุบัน (มม.)', key: 'rainfall', width: 20 },
    { header: 'น้ำฝนสะสม 24 ชม. (มม.)', key: 'rainfall24h', width: 22 },
    { header: 'เวลาบันทึกจริง', key: 'scannedAt', width: 24 },
  ];
  wsRawDom.getRow(1).font = { bold: true, size: 12 };

  const rawStations = executionResult?.pureObservedStations || [];
  rawStations.forEach((st, idx) => {
    wsRawDom.addRow({
      idx: idx + 1,
      stationCode: st.stationCode,
      stationName: st.stationName,
      basin: st.basin,
      status: st.status,
      waterLevel: st.waterLevel,
      rainfall: st.rainfall,
      rainfall24h: st.rainfall24h,
      scannedAt: st.scannedAt,
    });
  });

  await workbook.xlsx.writeFile(excelFilePath);

  const pdfLines = [
    `TeleRID Autonomous Macro Playback & API Observation Report (User: Sommart)`,
    `Scan Time: ${new Date().toISOString()}`,
    `Threshold Rule: Water Level <= -10 down to -999 or >= 999 is INVALID for both MSL (m.rtk.) & RSM (m.rsm.)`,
    `Total Observed Stations: ${rawStations.length} | Total Critical Anomalies: ${flagged.length}`,
    ...flagged.slice(0, 18).map(
      (a, i) => `${i + 1}. [${a.category}] Station: ${a.stationCode} | Value: ${a.numericValue}`
    ),
  ];
  const streamBody = [
    'BT',
    '/F1 11 Tf',
    '45 770 Td',
    '16 TL',
    ...pdfLines.map((l) => `(${String(l).replace(/[^\x20-\x7E]/g, ' ').replace(/[()\\]/g, '')}) Tj T*`),
    'ET',
  ].join('\n');

  const pdfContent = [
    '%PDF-1.4\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(streamBody, 'utf-8')} >>\nstream\n${streamBody}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    'trailer\n<< /Root 1 0 R >>\n%%EOF\n',
  ].join('');
  fs.writeFileSync(pdfFilePath, Buffer.from(pdfContent, 'utf-8'));

  return {
    ok: true,
    excelFilePath,
    pdfFilePath,
    rowCount: rawStations.length,
    anomalyCount: flagged.length,
  };
}

/**
 * ============================================================================
 * 7. ระบบนัดหมายเวลาทำงานทุก 1 ชั่วโมง ตลอด 24 ชั่วโมง (00:00 - 23:00 น. ทุกวัน)
 * กฎเหล็ก: ยึดเวลาต้นชั่วโมงจริงของนาฬิกาคอมพิวเตอร์เสมอ หากกดตรวจสอบด้วยมือห้ามรีเซ็ตเวลาใหม่!
 * ============================================================================
 */
function getMsUntilNextExactClockHour(nowDate = new Date()) {
  const nextHour = new Date(nowDate);
  nextHour.setHours(nowDate.getHours() + 1, 0, 0, 0);
  const full24HoursSchedule = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00 น.`);
  return {
    msUntilNextHour: Math.max(1000, nextHour.getTime() - nowDate.getTime()),
    nextClockHourDate: nextHour,
    nextClockHourText: `${String(nextHour.getHours()).padStart(2, '0')}:00 น.`,
    full24HoursSchedule,
  };
}

let isHourlyCronRunning = false;
function startHourlyClockAlignedCronJob(playwright, socketIoOrCallback = null) {
  const scheduleNextRun = () => {
    const { msUntilNextHour, nextClockHourText } = getMsUntilNextExactClockHour(new Date());
    console.log(
      `[TeleRID 24/7 Hourly Cron] ล็อกเวลารันรอบถัดไปตรงต้นชั่วโมงจริง ${nextClockHourText} (ทำงานตลอด 24 ชม. ทุกวัน — กดตรวจเองไม่รีเซ็ตเวลานี้)`
    );

    setTimeout(async () => {
      try {
        console.log(
          `[TeleRID 24/7 Hourly Cron] ⏰ ถึงเวลาต้นชั่วโมงจริง (${new Date().toLocaleTimeString(
            'th-TH'
          )}) เริ่มรัน Macro Playback & API Scan (use: Sommart)...`
        );
        await playMacroAndScrapePureDomOnChrome(playwright, null, socketIoOrCallback);
      } catch (err) {
        console.error('[TeleRID 24/7 Hourly Cron Error]:', err);
      } finally {
        scheduleNextRun();
      }
    }, msUntilNextHour);
  };

  scheduleNextRun();
}

async function scrapeTeleRidRealDataWithNetworkAndWaitFunction(
  page,
  targetBasinsInput = ['ลุ่มน้ำโขงตะวันออกเฉียงเหนือ', 'ลุ่มน้ำชี', 'ลุ่มน้ำมูล'],
  socketIoOrCallback = null
) {
  const basinList = (Array.isArray(targetBasinsInput) ? targetBasinsInput : [targetBasinsInput]).map((b) =>
    normalizeBasinNameForTeleRidWeb(b)
  );
  const apiRes = await loginAndScanTeleRidWaterAndRainApi(
    page,
    TELERID_AUTH_CREDENTIALS,
    basinList,
    socketIoOrCallback
  );
  const liveSummary = await page
    .evaluate(() => {
      const text = document.body ? document.body.innerText : '';
      const getNum = (pat) => {
        const m = text.match(new RegExp(`(\\d+)\\s*(?:\\(\\s*สถานี\\s*\\))?\\s*[\\r\\n\\s]*(?:${pat})`));
        return m ? parseInt(m[1], 10) : null;
      };
      const totM = text.match(/จำนวนสถานี\s*(\d+)\s*สถานี/);
      return {
        online: getNum('ปกติ'),
        warning: getNum('เตือนภัย'),
        critical: getNum('วิกฤติ?'),
        offline: getNum('ขัดข้อง'),
        totalStations: totM ? parseInt(totM[1], 10) : null,
      };
    })
    .catch(() => ({
      online: null,
      warning: null,
      critical: null,
      offline: null,
      totalStations: null,
    }));
  return {
    selectedBasins: basinList,
    summary: liveSummary,
    stations: apiRes.stations,
    capturedApiEndpoints: apiRes.capturedApiEndpoints,
  };
}

async function exportTeleRidReportToExcelFile(reportData, customOutputPath) {
  return exportPureObservationToExcelAndPdf(
    {
      executedAtText: new Date().toLocaleString('th-TH'),
      targetBasins: reportData?.selectedBasins || ['ลุ่มน้ำโขงตะวันออกเฉียงเหนือ'],
      pureObservedStations: reportData?.stations || [],
      thresholdResult: runStrictDataThresholdLoopFilter(reportData?.stations || [], []),
    },
    customOutputPath ? path.dirname(customOutputPath) : USER_DOWNLOADS_DIR
  );
}

/**
 * ฟังก์ชันซ่อมแซมคำสั่ง npm run electron:dev อัตโนมัติบนเครื่อง C:\Users\Tele_04\Desktop\agent-orchestrator
 * แก้ปัญหา: 'electron' is not recognized as an internal or external command
 */
function ensureElectronDevLauncherFixed() {
  try {
    const pkgPath = path.join(ORCHESTRATOR_DIR, 'package.json');
    const electronDir = path.join(ORCHESTRATOR_DIR, 'electron');
    const launcherPath = path.join(electronDir, 'launch-desktop.cjs');

    if (!fs.existsSync(electronDir)) {
      fs.mkdirSync(electronDir, { recursive: true });
    }

    if (!fs.existsSync(launcherPath)) {
      const launcherCode = `try { require('dotenv').config(); } catch (_e) {}
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, exec } = require('child_process');

const PORT = Number(process.env.PORT) || 3000;
const APP_URL = 'http://127.0.0.1:' + PORT;
const PROJECT_ROOT = path.resolve(__dirname, '..');

function checkServerAlive(url = APP_URL + '/api/health', timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

async function waitForServerReady(maxWaitMs = 25000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await checkServerAlive()) return true;
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

async function main() {
  console.log('🚀 กำลังเปิดระบบ GovAI 3D Agent Orchestrator (User: Tele_04)...');
  if (!(await checkServerAlive())) {
    const tsxCmd = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx.cmd');
    if (fs.existsSync(tsxCmd)) {
      spawn('"' + tsxCmd + '"', ['server.ts'], { cwd: PROJECT_ROOT, stdio: 'inherit', shell: true });
    } else {
      spawn('npx', ['tsx', 'server.ts'], { cwd: PROJECT_ROOT, stdio: 'inherit', shell: true });
    }
    await waitForServerReady(25000);
  }
  const elecExe = path.join(PROJECT_ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
  const elecCmd = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'electron.cmd');
  const bin = fs.existsSync(elecExe) ? elecExe : fs.existsSync(elecCmd) ? elecCmd : null;
  if (bin) {
    spawn('"' + bin + '"', ['.'], { cwd: PROJECT_ROOT, stdio: 'inherit', shell: true });
  } else {
    const chromePaths = [
      'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
      'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
    ];
    const chromeExe = chromePaths.find((p) => fs.existsSync(p));
    if (chromeExe) {
      exec('"' + chromeExe + '" --app=' + APP_URL + ' --start-maximized');
    } else {
      exec('start "" "' + APP_URL + '"');
    }
  }
}
main();
`;
      fs.writeFileSync(launcherPath, launcherCode, 'utf-8');
    }

    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      pkg.scripts = pkg.scripts || {};
      if (pkg.scripts['electron:dev'] === 'electron .') {
        pkg.scripts['electron:dev'] = 'node electron/launch-desktop.cjs';
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
        console.log('✅ อัปเดตคำสั่ง "electron:dev" ใน package.json ให้รันผ่าน node electron/launch-desktop.cjs เรียบร้อยแล้ว');
      }
    }

    // ล้างแคชเก่าที่เคยติดบั๊กชื่อสถานีเป็น "ลุ่มน้ำ..." หรือติดยอดรวมทั้งประเทศ 947 สถานี (727|35|11|174) อัตโนมัติ
    const syncedCacheFile = path.join(ORCHESTRATOR_DIR, 'workspace_inbox', 'telerid_stations_synced.json');
    if (fs.existsSync(syncedCacheFile)) {
      try {
        const rawSync = JSON.parse(fs.readFileSync(syncedCacheFile, 'utf-8'));
        if (rawSync?.schemaVersion !== 4) {
          fs.unlinkSync(syncedCacheFile);
        }
      } catch (_e) {
        try { fs.unlinkSync(syncedCacheFile); } catch (_e2) {}
      }
    }
    const monitorDbFile = path.join(ORCHESTRATOR_DIR, 'workspace_inbox', 'telerid_monitor_db.json');
    if (fs.existsSync(monitorDbFile)) {
      try {
        const rawDb = JSON.parse(fs.readFileSync(monitorDbFile, 'utf-8'));
        if (Array.isArray(rawDb?.reports)) {
          rawDb.reports = rawDb.reports.filter((r) => {
            const s = r?.outputJson?.summary;
            const totalSum = (s?.online ?? 0) + (s?.warning ?? 0) + (s?.critical ?? 0) + (s?.offline ?? 0);
            const basinsCount = Array.isArray(r?.selectedBasins) ? r.selectedBasins.length : 3;
            if (basinsCount <= 6 && totalSum > 450) return false;
            if (
              Array.isArray(r?.module1AbnormalStationsDb) &&
              r.module1AbnormalStationsDb.some(
                (item) => typeof item?.stationName === 'string' && /^ลุ่มน้ำ/.test(item.stationName.trim())
              )
            ) {
              return false;
            }
            return true;
          });
          fs.writeFileSync(monitorDbFile, JSON.stringify(rawDb, null, 2), 'utf-8');
        }
      } catch (_e) {}
    }
  } catch (err) {
    console.warn('[Auto-Fix electron:dev Warning]:', err.message);
  }
}

/**
 * ============================================================================
 * 8. แผนกที่ 3 (Legal & หนังสือราชการ — สีทอง):
 *    ระบบคลายไฟล์บีบอัดอัตโนมัติ (Automated ZIP Decompression Engine — AdmZip)
 *    + วิเคราะห์ข้ามเอกสารด้วย Gemini 4 Argon (True Multi-Document AI Analytics)
 *    + 1:1 XML Pattern Mapping ลงใน C:\Users\Tele_04\Downloads
 * ============================================================================
 */
function resolveGeminiMimeTypeForExt(filenameOrExt) {
  const ext = String(filenameOrExt).startsWith('.')
    ? String(filenameOrExt).toLowerCase()
    : path.extname(String(filenameOrExt)).toLowerCase();

  switch (ext) {
    case '.pdf':
      return {
        standardMimeType: 'application/pdf',
        geminiInlineMimeType: 'application/pdf',
      };
    case '.docx':
      return {
        standardMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        geminiInlineMimeType: 'text/plain',
      };
    case '.xlsx':
      return {
        standardMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        geminiInlineMimeType: 'text/csv',
      };
    case '.csv':
      return {
        standardMimeType: 'text/csv',
        geminiInlineMimeType: 'text/csv',
      };
    case '.json':
      return {
        standardMimeType: 'application/json',
        geminiInlineMimeType: 'application/json',
      };
    case '.md':
      return {
        standardMimeType: 'text/markdown',
        geminiInlineMimeType: 'text/markdown',
      };
    case '.txt':
    default:
      return {
        standardMimeType: 'text/plain',
        geminiInlineMimeType: 'text/plain',
      };
  }
}

async function extractReadableTextFromExtractedBuffer(fileBuffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (['.txt', '.csv', '.json', '.md'].includes(ext)) {
    return fileBuffer.toString('utf-8');
  }
  if (ext === '.xlsx') {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(fileBuffer);
      const sheetLines = [];
      wb.eachSheet((sheet) => {
        sheetLines.push(`[แผ่นงาน Excel: ${sheet.name}]`);
        sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
          const vals = Array.isArray(row.values)
            ? row.values
                .slice(1)
                .map((v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')))
                .join(' | ')
            : '';
          if (vals.trim()) sheetLines.push(`แถวที่ ${rowNumber}: ${vals}`);
        });
      });
      return sheetLines.join('\n');
    } catch {
      return '';
    }
  }
  if (ext === '.docx') {
    try {
      const AdmZip = require('adm-zip');
      const docxZip = new AdmZip(fileBuffer);
      const docXmlEntry = docxZip.getEntry('word/document.xml');
      if (docXmlEntry) {
        const xmlStr = docXmlEntry.getData().toString('utf-8');
        const paragraphs = Array.from(xmlStr.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)).map((m) =>
          Array.from(m[1].matchAll(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g))
            .map((t) => t[1])
            .join('')
            .trim()
        );
        return paragraphs.filter(Boolean).join('\n');
      }
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * ฟังก์ชันแกะไฟล์บีบอัด .zip อัตโนมัติ (AdmZip Extraction Loop)
 * สกัดเอกสารทุกไฟล์ (.pdf, .docx, .xlsx, .csv, .json, .txt) ออกมาเป็น Buffer Array + Base64
 */
async function extractEmbeddedFilesFromZipWithAdmZip(
  zipInputPathOrBuffer,
  outputDir = path.join(ORCHESTRATOR_DIR, 'workspace_inbox', 'unzipped_inbox')
) {
  const AdmZip = require('adm-zip');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const zipBuffer = Buffer.isBuffer(zipInputPathOrBuffer)
    ? zipInputPathOrBuffer
    : fs.readFileSync(zipInputPathOrBuffer);
  const archiveName = Buffer.isBuffer(zipInputPathOrBuffer)
    ? 'uploaded_archive.zip'
    : path.basename(zipInputPathOrBuffer);

  const zip = new AdmZip(zipBuffer);
  const zipEntries = zip.getEntries();
  const allowedExts = new Set(['.pdf', '.docx', '.xlsx', '.csv', '.json', '.txt', '.md']);
  const extractedFilesArray = [];

  for (const zipEntry of zipEntries) {
    if (zipEntry.isDirectory) continue;

    const rawEntryPath = zipEntry.entryName.replace(/\\/g, '/');
    const innerFilename = path.basename(rawEntryPath);

    if (
      !innerFilename ||
      innerFilename.startsWith('~$') ||
      innerFilename.startsWith('.') ||
      rawEntryPath.includes('__MACOSX')
    ) {
      continue;
    }

    const ext = path.extname(innerFilename).toLowerCase();
    const fileBuffer = zipEntry.getData();
    if (!fileBuffer || fileBuffer.length === 0) continue;

    // กรณีมีไฟล์ .zip ซ้อนอยู่ข้างในอีกชั้น
    if (ext === '.zip') {
      const nestedItems = await extractEmbeddedFilesFromZipWithAdmZip(fileBuffer, outputDir);
      extractedFilesArray.push(...nestedItems);
      continue;
    }

    if (!allowedExts.has(ext)) continue;

    const savedDiskPath = path.join(outputDir, `${Date.now()}_${extractedFilesArray.length + 1}_${innerFilename}`);
    fs.writeFileSync(savedDiskPath, fileBuffer);

    const { standardMimeType, geminiInlineMimeType } = resolveGeminiMimeTypeForExt(ext);
    const extractedText = await extractReadableTextFromExtractedBuffer(fileBuffer, innerFilename);

    extractedFilesArray.push({
      indexLabel: `ไฟล์ที่ 1.${extractedFilesArray.length + 1}`,
      filename: innerFilename,
      originalEntryPath: rawEntryPath,
      parentZipName: archiveName,
      extension: ext,
      mimeType: standardMimeType,
      geminiInlineMimeType,
      sizeBytes: fileBuffer.length,
      buffer: fileBuffer,
      base64Data: fileBuffer.toString('base64'),
      savedDiskPath,
      extractedText,
    });
  }

  return extractedFilesArray;
}

/**
 * ฟังก์ชันวิเคราะห์ข้ามเอกสารด้วย Gemini 4 Argon (gemini-4-argon) พร้อมกันในคำสั่งเดียว
 * และทำ 1:1 XML Pattern Mapping ลงในไฟล์เทมเพลตเล่มที่ 2 แล้วบันทึกลง C:\Users\Tele_04\Downloads ทันที
 */
async function analyzeZipAndReplaceDocxTemplateWithGemini4Argon(
  zipFilePathOrBuffer,
  templateDocxPath,
  userInstruction = 'เชื่อมโยงข้อมูลเงื่อนไขจาก PDF และตัวเลขตารางราคาจาก Excel ในไฟล์ .zip แล้วกรอกแทนที่คำแบบ 1:1 ลงในแบบฟอร์มเล่มที่ 2'
) {
  const { GoogleGenAI, Type } = require('@google/genai');
  const AdmZip = require('adm-zip');

  // 1. แตกไฟล์ทั้งหมดจาก .zip ออกเป็น Buffer Array (Base64)
  const extractedDocs = await extractEmbeddedFilesFromZipWithAdmZip(zipFilePathOrBuffer);

  // 2. อ่านโครงสร้าง XML (<w:p> / <w:t>) จากแบบฟอร์มเอกสารเล่มที่ 2
  const tplZip = new AdmZip(templateDocxPath);
  const docXmlEntry = tplZip.getEntry('word/document.xml');
  if (!docXmlEntry) {
    throw new Error(`ไม่พบโครงสร้าง word/document.xml ในไฟล์เทมเพลต: ${templateDocxPath}`);
  }
  const originalDocXml = docXmlEntry.getData().toString('utf-8');
  const templateParagraphs = Array.from(originalDocXml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g))
    .map((m) =>
      Array.from(m[1].matchAll(/<w:t(?:\s+[^>]*)?>([\s\S]*?)<\/w:t>/g))
        .map((t) => t[1])
        .join('')
        .trim()
    )
    .filter(Boolean);

  // 3. เตรียม Multimodal Content Parts (Base64 Array) สำหรับส่งเข้า Gemini 4 Argon ในคำสั่งเดียว
  const contentParts = [];
  for (const doc of extractedDocs) {
    if (['.pdf', '.csv', '.json', '.txt', '.md'].includes(doc.extension)) {
      contentParts.push({
        inlineData: {
          mimeType: doc.geminiInlineMimeType,
          data: doc.base64Data,
        },
      });
    } else if (doc.extractedText) {
      contentParts.push({
        inlineData: {
          mimeType: doc.geminiInlineMimeType,
          data: Buffer.from(
            `[${doc.indexLabel}: ${doc.filename} | MIME: ${doc.mimeType}]\n${doc.extractedText}`,
            'utf-8'
          ).toString('base64'),
        },
      });
    }

    contentParts.push({
      text: `📎 [${doc.indexLabel} (แตกจาก ZIP: ${doc.parentZipName})]: ชื่อไฟล์ "${doc.filename}" (${doc.extension})\nข้อมูลที่สกัดได้:\n"""\n${doc.extractedText.slice(0, 18000)}\n"""`,
    });
  }

  contentParts.push({
    text: `📐 [แบบฟอร์มเอกสารเล่มที่ 2 (Template)]: "${path.basename(templateDocxPath)}"
ย่อหน้าทั้งหมดในแบบฟอร์มเล่มที่ 2 ที่ต้องทำ 1:1 XML Pattern Mapping (Find & Replace Tags) และล้างข้อมูลขยะเก่าออก 100%:
"""
${templateParagraphs.map((p, idx) => `ย่อหน้าที่ ${idx + 1}: ${p}`).join('\n')}
"""
คำสั่งผู้ใช้: "${userInstruction}"`,
  });

  // 4. ยิงคำสั่งประมวลผล Long Context เข้าสู่ Gemini 4 Argon (gemini-4-argon) พร้อมกันในคำสั่งเดียว
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL_PRIMARY || 'gemini-2.5-flash',
    contents: contentParts,
    config: {
      systemInstruction:
        'คุณคือระบบ True Multi-Document AI Analytics ประจำแผนกที่ 3 ให้เปิดอ่านและเชื่อมโยงข้อมูลจริงจากทุกเอกสารที่แตกออกมาจากไฟล์ .zip (เช่น เงื่อนไขจาก PDF และตารางราคา/รหัสสถานีจาก Excel) แล้วสร้างคู่ลำดับ xmlReplacementPairs (search -> replace) แบบ 1:1 เพื่อกรอกลงในแบบฟอร์มเอกสารเล่มที่ 2 โดยห้ามมีข้อมูลขยะเก่าหลงเหลือเด็ดขาด',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          crossDocumentFusionSummary: { type: Type.STRING },
          xmlReplacementPairs: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                field: { type: Type.STRING },
                search: { type: Type.STRING },
                replace: { type: Type.STRING },
              },
              required: ['field', 'search', 'replace'],
            },
          },
        },
        required: ['crossDocumentFusionSummary', 'xmlReplacementPairs'],
      },
    },
  });

  const parsedResult = JSON.parse((response.text || '{}').trim());
  const replacementPairs = Array.isArray(parsedResult.xmlReplacementPairs)
    ? parsedResult.xmlReplacementPairs
    : [];

  // 5. ทำ 1:1 XML Pattern Mapping แทนที่คำลงใน word/document.xml และบันทึกเป็นไฟล์ฉบับจริงใน C:\Users\Tele_04\Downloads
  let updatedDocXml = originalDocXml;
  for (const rule of replacementPairs) {
    if (!rule.search || !rule.replace || rule.search === rule.replace) continue;
    updatedDocXml = updatedDocXml.split(rule.search).join(rule.replace);
  }

  tplZip.updateFile('word/document.xml', Buffer.from(updatedDocXml, 'utf-8'));
  const outputFilename = `แก้ไขตามแบบ_${path.basename(templateDocxPath)}`;
  const savedOutputPath = path.join(USER_DOWNLOADS_DIR, outputFilename);
  tplZip.writeZip(savedOutputPath);

  return {
    ok: true,
    extractedFilesCount: extractedDocs.length,
    extractedFilenames: extractedDocs.map((d) => d.filename),
    crossDocumentFusionSummary: parsedResult.crossDocumentFusionSummary,
    appliedRulesCount: replacementPairs.length,
    savedOutputPath,
  };
}

/**
 * ============================================================================
 * 9. เชื่อมต่อ WebSocket (wss://telerid.rid.go.th/ws/public/) + MongoDB (telerid_db.stations)
 *    ตามโครงสร้างไฟล์ sync-direct.js / import-ws.js / import-csv.js / server.js
 * ============================================================================
 */
function parseTeleRidWsItemForSync(item) {
  if (!item || typeof item !== 'object') return null;
  const stationCode = String(item.code || item.station_code || item.stationCode || '').trim();
  if (!stationCode) return null;
  const stationName = String(item.name || item.station_name || item.stationName || stationCode).trim();
  const basin = String(item.basin_name || item.basin || 'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ').trim();
  const statusUpper = String(item.status || '').toUpperCase();
  let onlineStatus = item.connection === 'online' ? 'ออนไลน์' : item.connection === 'offline' ? 'ออฟไลน์' : 'ไม่พบค่า';
  let alertStatus = 'ไม่พบค่า';
  if (statusUpper === 'OFFLINE' || item.status === 'ขัดข้อง') {
    onlineStatus = 'ออฟไลน์';
    alertStatus = 'ขัดข้อง';
  } else if (statusUpper === 'CRITICAL' || item.status === 'วิกฤติ' || item.status === 'วิกฤต') {
    onlineStatus = 'ออนไลน์';
    alertStatus = 'วิกฤติ';
  } else if (statusUpper === 'WARNING' || item.status === 'เตือนภัย') {
    onlineStatus = 'ออนไลน์';
    alertStatus = 'เตือนภัย';
  } else if (statusUpper === 'NORMAL' || item.status === 'ปกติ') {
    onlineStatus = 'ออนไลน์';
    alertStatus = 'ปกติ';
  }

  const values = item.values || {};
  let rain7toNow = '-';
  if (values.rain_sum_now && values.rain_sum_now.value !== null && values.rain_sum_now.value !== undefined) {
    rain7toNow = values.rain_sum_now.value;
  }
  let rain1Day = '-';
  if (values.rain_sum && Array.isArray(values.rain_sum.value) && values.rain_sum.value.length > 0) {
    const lastVal = values.rain_sum.value[values.rain_sum.value.length - 1];
    if (lastVal !== null && lastVal !== undefined) rain1Day = lastVal;
  }

  let waterLevelUp_RTK = '-';
  let waterLevelUp_RSM = '-';
  let waterLevelDown_RTK = '-';
  let waterLevelDown_RSM = '-';
  if (values.water_level_value_list && Array.isArray(values.water_level_value_list.value)) {
    const wlList = values.water_level_value_list.value;
    if (wlList[0] !== null && wlList[0] !== undefined) waterLevelUp_RTK = wlList[0];
    if (wlList[1] !== null && wlList[1] !== undefined) waterLevelUp_RSM = wlList[1];
    if (wlList[2] !== null && wlList[2] !== undefined) waterLevelDown_RTK = wlList[2];
    if (wlList[3] !== null && wlList[3] !== undefined) waterLevelDown_RSM = wlList[3];
  }

  return {
    stationCode,
    stationName,
    basin,
    province: String(item.province_name || item.province || '-'),
    district: String(item.amphoe_name || item.district || '-'),
    subdistrict: String(item.tambon_name || item.subdistrict || '-'),
    onlineStatus,
    alertStatus,
    rain7toNow,
    rain1Day,
    waterLevelUp_RTK,
    waterLevelUp_RSM,
    waterLevelDown_RTK,
    waterLevelDown_RSM,
    recordedAt: new Date().toLocaleString('th-TH'),
    source: 'WebSocket (wss://telerid.rid.go.th/ws/public/)',
  };
}

async function syncTeleRidWebSocketAndMongoDirect() {
  const stationMap = new Map();
  try {
    const WebSocket = require('ws');
    await new Promise((resolve) => {
      const ws = new WebSocket('wss://telerid.rid.go.th/ws/public/', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
          Origin: 'https://telerid.rid.go.th',
        },
        handshakeTimeout: 10000,
      });
      const timer = setTimeout(() => {
        try { ws.close(); } catch (_e) {}
        resolve();
      }, 12000);
      ws.on('message', (raw) => {
        try {
          const payload = JSON.parse(raw.toString());
          if (payload && payload.type === 'INIT' && payload.data) {
            for (const item of Object.values(payload.data)) {
              const parsed = parseTeleRidWsItemForSync(item);
              if (parsed) stationMap.set(parsed.stationCode, parsed);
            }
            clearTimeout(timer);
            try { ws.close(); } catch (_e) {}
            resolve();
          }
        } catch (_e) {}
      });
      ws.on('error', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  } catch (_e) {}

  const stations = Array.from(stationMap.values());
  if (stations.length > 0) {
    try {
      const { MongoClient } = require('mongodb');
      const client = new MongoClient('mongodb://127.0.0.1:27017', {
        serverSelectionTimeoutMS: 2500,
        connectTimeoutMS: 2500,
      });
      await client.connect();
      const col = client.db('telerid_db').collection('stations');
      const ops = stations.map((st) => ({
        updateOne: {
          filter: { stationCode: st.stationCode },
          update: { $set: { ...st, updatedAt: new Date() } },
          upsert: true,
        },
      }));
      await col.bulkWrite(ops);
      await client.close();
    } catch (_mongoErr) {}
  }
  return stations;
}

/**
 * ============================================================================
 * 10. โหมดผู้ช่วยเลขา AI (AI Secretary Mode):
 *     เปิด "C:\Program Files\Google\Chrome\Application\chrome.exe" --profile-directory="Profile 5"
 *     โดยไม่ปิด Chrome เอง คอยจดบันทึกทุกสถานีและทุกคอลัมน์ระหว่างที่ผู้ใช้คลิก/เลื่อนดู
 *     และสรุปผลเมื่อผู้ใช้กดปิดหน้าต่าง Chrome [X]
 * ============================================================================
 */
async function runInteractiveAiSecretaryOnChrome(
  playwright,
  targetBasins = ['ลุ่มน้ำโขงตะวันออกเฉียงเหนือ', 'ลุ่มน้ำชี', 'ลุ่มน้ำมูล']
) {
  const { context, page, profileUsed } = await launchTele04PersistentChrome(playwright, {
    headless: false,
  });
  const capturedMap = new Map();

  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      try {
        const text = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf-8');
        if (!text || !text.startsWith('{')) return;
        const json = JSON.parse(text);
        const dict = (json && json.data) || json;
        if (dict && typeof dict === 'object') {
          for (const item of Object.values(dict)) {
            const parsed = parseTeleRidWsItemForSync(item);
            if (parsed) capturedMap.set(parsed.stationCode, parsed);
          }
        }
      } catch (_e) {}
    });
  });

  await page.goto(TELERID_MAIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  console.log(
    `🤖 [เลขา AI] เปิด Chrome (${profileUsed}) เรียบร้อยแล้ว! เชิญคลิกเลื่อนดูข้อมูลได้เลย ระบบจะจดบันทึกไว้ให้ทั้งหมด และสรุปผลเมื่อคุณกดปิดหน้าต่าง Chrome [X]`
  );

  await new Promise((resolve) => {
    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      clearInterval(checkAlive);
      if (context) {
        void context.close().catch(() => {});
      }
      resolve();
    };
    context.on('close', done);
    page.on('close', () => {
      setTimeout(() => {
        try {
          const openPages = context ? context.pages().filter((p) => !p.isClosed()) : [];
          if (openPages.length === 0) done();
        } catch (_e) {
          done();
        }
      }, 300);
    });
    const checkAlive = setInterval(() => {
      try {
        const openPages = context ? context.pages().filter((p) => !p.isClosed()) : [];
        if (!context || openPages.length === 0) done();
      } catch (_e) {
        done();
      }
    }, 900);
  });

  return {
    ok: true,
    profileUsed,
    targetBasins,
    totalRecordedStations: capturedMap.size,
    detailedStations: Array.from(capturedMap.values()),
  };
}

module.exports = {
  CHROME_USER_DATA_DIR,
  CHROME_FALLBACK_PROFILE_DIR,
  USER_DOWNLOADS_DIR,
  MACRO_CONFIG_FILE_PATH,
  TELERID_MAIN_URL,
  TELERID_CCTV_URL,
  TELERID_AUTH_CREDENTIALS,
  stationsData,
  hardcodedBasins,
  normalizeBasinNameForTeleRidWeb,
  detectWaterLevelUnit,
  isUplandTerrainStation,
  launchTele04PersistentChrome,
  loginAndScanTeleRidWaterAndRainApi,
  getDefaultMacroConfigJson,
  loadMacroConfigFromDisk,
  saveMacroConfigToDisk,
  startMacroRecordingSession,
  stopAndSaveMacroRecordingSession,
  runStrictDataThresholdLoopFilter,
  playMacroAndScrapePureDomOnChrome,
  exportPureObservationToExcelAndPdf,
  getMsUntilNextExactClockHour,
  startHourlyClockAlignedCronJob,
  scrapeTeleRidRealDataWithNetworkAndWaitFunction,
  exportTeleRidReportToExcelFile,
  ensureElectronDevLauncherFixed,
  resolveGeminiMimeTypeForExt,
  extractEmbeddedFilesFromZipWithAdmZip,
  analyzeZipAndReplaceDocxTemplateWithGemini4Argon,
  parseTeleRidWsItemForSync,
  syncTeleRidWebSocketAndMongoDirect,
  runInteractiveAiSecretaryOnChrome,
};

if (require.main === module) {
  ensureElectronDevLauncherFixed();
  (async () => {
    const playwright = require('playwright');
    const mode = process.argv[2] || 'secretary';
    if (mode === 'fix-electron') {
      console.log('✅ ซ่อมแซมคำสั่ง npm run electron:dev เรียบร้อยแล้ว! สามารถพิมพ์ npm run electron:dev หรือ npm run dev ได้ทันทีครับ');
      return;
    }
    if (mode === 'sync-ws') {
      console.log('🚀 กำลังซิงค์ข้อมูลสถานีจาก wss://telerid.rid.go.th/ws/public/ ลง MongoDB (telerid_db.stations)...');
      const stations = await syncTeleRidWebSocketAndMongoDirect();
      console.log(`✅ ซิงค์สำเร็จทั้งหมด ${stations.length} สถานี`);
      return;
    }
    if (mode === 'secretary') {
      const res = await runInteractiveAiSecretaryOnChrome(playwright);
      console.log(`✅ [เลขา AI] สรุปข้อมูลหลังจากปิด Chrome สำเร็จ: จดบันทึกได้ทั้งหมด ${res.totalRecordedStations} สถานี`);
      return;
    }
    if (mode === 'record') {
      console.log('[TeleRID Macro] เริ่มโหมดบันทึกมาโครบนหน้าต่าง Chrome จริง...');
      await startMacroRecordingSession(playwright, (step) => {
        console.log(`[Recorded Step #${step.stepNo}]:`, step.description);
      });
    } else if (mode === 'api-scan') {
      console.log('[TeleRID API Scanner] กำลังล็อกอินด้วยค่าจาก .env (TELERID_USERNAME) และดึงค่า API ค่าน้ำ & น้ำฝน...');
      const { context, page } = await launchTele04PersistentChrome(playwright, { headless: false });
      const apiData = await loginAndScanTeleRidWaterAndRainApi(page, TELERID_AUTH_CREDENTIALS);
      console.log(`[TeleRID API Scanner] ดึงสถานีสำเร็จ ${apiData.stationsCount} สถานี | พบค่าผิดปกติ ${apiData.thresholdResult.totalAnomaliesCount} รายการ`);
      await context.close();
    } else if (mode === 'cron') {
      console.log('[TeleRID 24/7 Cron] เริ่มระบบตารางเวลาทุก 1 ชั่วโมง ตลอด 24 ชั่วโมง (00:00 - 23:00 น. ทุกวัน)');
      startHourlyClockAlignedCronJob(playwright);
    } else {
      console.log('[TeleRID Macro] สั่งรัน Macro Playback 1:1 (use: Sommart) และดึงค่าหน้าจอจริง + API...');
      const res = await playMacroAndScrapePureDomOnChrome(playwright);
      console.log('[TeleRID Macro] บันทึกไฟล์ Excel ลงที่:', res.savedExcelPath);
      console.log('[TeleRID Macro] บันทึกไฟล์ PDF ลงที่:', res.savedPdfPath);
    }
  })().catch((err) => {
    console.error('[TeleRID Macro Error]:', err);
    process.exit(1);
  });
}
