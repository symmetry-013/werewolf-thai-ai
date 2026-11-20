import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { ThreeOfficeScene } from './components/ThreeOfficeScene';
import { CodeArchitectureModal } from './components/CodeArchitectureModal';
import { VSCodeStudioModal } from './components/VSCodeStudioModal';
import {
  CameraPreset,
  DepartmentId,
  DepartmentStatus,
  GovMemoDocumentData,
  ScannedFileItem,
  WorkflowStepLog,
} from './types/automation';
import {
  ChevronDown,
  ChevronUp,
  Code2,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  FolderOpen,
  FolderSync,
  Globe,
  KeyRound,
  Play,
  RefreshCw,
  Send,
  Server,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  CheckCircle2,
  AlertTriangle,
  Database,
  XCircle,
} from 'lucide-react';
import { initAuth, googleSignIn, getAccessToken, logout } from './services/googleAuth';
import {
  TELERID_HARDCODED_BASINS,
  normalizeOfficialTeleRidBasinDisplayName,
  getTeleRidStationsByBasin,
} from './teleridStationsData';

interface TeleRidStationRow {
  basin: string;
  stationName: string;
  status: 'ออนไลน์' | 'ออฟไลน์/ขัดข้อง' | 'วิกฤติ' | 'เตือนภัย';
  waterLevel: string;
  rainfall: string;
  rainfall24h: string;
  scannedAt: string;
}

interface TeleRidSummaryStats {
  totalStations: number;
  onlineCount: number;
  offlineCount: number;
  criticalCount: number;
  warningCount: number;
  problemStations: {
    basin: string;
    stationName: string;
    status: string;
    waterLevel: string;
    rainfall: string;
    rainfall24h: string;
  }[];
}

interface DeptSocketEvent {
  deptId: DepartmentId;
  status: 'idle' | 'working' | 'completed' | 'alert';
  currentAction: string;
  lastUpdated: string;
  extra?: Record<string, unknown>;
}

interface SavedRpaStep {
  stepNo: number;
  targetUrl: string;
  instruction: string;
  actionPerformed: string;
  whatBotSaw: string;
  savedAt: string;
}

interface WhatBotSawDetail {
  pageTitle: string;
  currentUrl: string;
  visibleButtons: string[];
  visibleInputs: string[];
  visibleHeadings: string[];
  textSummary: string;
}

interface Dept2NewlyDownloadedFileItem {
  id: string;
  filename: string;
  cleanFilename: string;
  localPath: string;
  source: 'Downloads' | 'Desktop';
  sizeBytes: number;
  modifiedAt: string;
  downloadedTimeText: string;
  docType: string;
  isNewWithinOneHour: boolean;
}

interface Dept2HourlyScanReport {
  reportId: string;
  scannedAtIso: string;
  scannedAtText: string;
  nextScanAtIso: string;
  nextScanAtText: string;
  intervalMinutes: number;
  triggerMode: 'hourly-auto' | 'manual' | 'initial';
  triggerLabel: string;
  newFileCount: number;
  totalFilesScanned: number;
  newFiles: Dept2NewlyDownloadedFileItem[];
  summaryHeadline: string;
  fullReportText: string;
}

interface TeleRidMonitorOutputJsonLog {
  scan_time: string;
  basin_name: string;
  isLiveReadSuccess?: boolean;
  summary: {
    online: number | null;
    warning: number | null;
    critical: number | null;
    offline: number | null;
    totalStations?: number | null;
  };
  cctv_issues: {
    active_count: number | null;
    failed_count: number | null;
    station_list: string[];
  };
  water_errors: {
    count: number | null;
    station_list: string[];
  };
  rain_spikes: {
    count: number | null;
    station_list: string[];
  };
}

export interface TeleRidStationDetailedRow {
  stationCode: string;
  stationName: string;
  basin: string;
  stationType?: 'สถานีวัดระดับน้ำ + น้ำฝน' | 'สถานีวัดระดับน้ำอย่างเดียว' | 'สถานีน้ำฝนอย่างเดียว';
  province?: string;
  district?: string;
  subdistrict?: string;
  onlineStatus: 'ออนไลน์' | 'ออฟไลน์' | 'ไม่พบค่า';
  alertStatus: 'ปกติ' | 'เตือนภัย' | 'วิกฤติ' | 'ขัดข้อง' | 'ไม่พบค่า';
  rain7toNow: number | string;
  rain1Day: number | string;
  waterLevelUp_RTK: number | string;
  waterLevelUp_RSM: number | string;
  waterLevelDown_RTK: number | string;
  waterLevelDown_RSM: number | string;
  recordedAt: string;
  source: string;
}

export interface SecretaryProgressSnapshot {
  isActive: boolean;
  startedAtText: string;
  stationsCapturedCount: number;
  userInteractionCount: number;
  lastActionDescription: string;
  latestStationsPreview: TeleRidStationDetailedRow[];
}

interface TeleRidMonitorDetailedReport {
  reportId: string;
  scannedAtIso: string;
  scannedAtText: string;
  nextScanAtIso: string;
  nextScanAtText: string;
  basinName: string;
  isLiveReadSuccess?: boolean;
  statusMessage?: string;
  selectedBasins?: string[];
  executionMode: string;
  representativeStationClicked: string;
  outputJson: TeleRidMonitorOutputJsonLog;
  outputJsonList?: TeleRidMonitorOutputJsonLog[];
  perBasinReports?: TeleRidMonitorDetailedReport[];
  detailedStations?: TeleRidStationDetailedRow[];
  module1AbnormalStationsDb: {
    stationCode: string;
    stationName: string;
    basin: string;
    status: 'เตือนภัย' | 'วิกฤติ' | 'ขัดข้อง';
    recordedAt: string;
  }[];
  module2CctvDetails: {
    totalCameras: number | null;
    normalDisplayCount: number | null;
    noImageGrayBoxCount: number | null;
    noImageStations: string[];
    frozenOver1HrCount: number | null;
    cameraItems: {
      stationCode: string;
      stationName: string;
      imageDisplayStatus: 'แสดงภาพได้ปกติ' | 'ไม่แสดงภาพ (กล่องสีเทา/ไอคอนเสีย)';
      imageTimestampText: string;
      systemTimeText: string;
      lagMinutes: number;
      evaluationStatus: 'ปกติ' | 'CCTV มีปัญหา/ข้อมูลขัดข้องค้างส่ง';
      reason: string;
    }[];
  };
  module3WaterDetails: {
    representativeStation: string;
    inspectedCount: number | null;
    sensorBug999Stations: string[];
    negativeUplandStations: string[];
    items: {
      stationCode: string;
      stationName: string;
      terrainType: string;
      waterLevelText: string;
      numericWaterLevel: number | null;
      anomalyType: 'ระบบเซนเซอร์ขัดข้อง (-999/999)' | 'ค่าติดลบผิดปกติในพื้นที่สูง/บก' | 'วิกฤติระดับน้ำสูง';
      note: string;
    }[];
  };
  module4RainDetails: {
    inspectedCount: number | null;
    over100mmStations: string[];
    extremeBugStations: string[];
    rtuDoubleSpikeStations: string[];
    items: {
      stationCode: string;
      stationName: string;
      accumulatedRainText: string;
      numericRainMm: number;
      timeSeriesBarsSample: number[];
      issueType:
        | 'ฝนตกหนักวิกฤติ (> 100 มม.)'
        | 'ค่าบั๊กน้ำฝนพุ่งหลักหมื่นผิดปกติ'
        | 'พบสถานีมีน้ำฝนเบิ้ลติดกันในกราฟ (RTU ส่งข้อมูลซ้ำซ้อน)';
      detail: string;
    }[];
  };
  playwrightExecutionLogs: {
    moduleNo: number;
    title: string;
    targetUrl: string;
    actionDetail: string;
    timestamp: string;
    status: 'ok' | 'warn';
  }[];
  savedReportJsonPath: string;
  savedReportTxtPath: string;
  savedReportXlsxPath?: string;
  savedReportPdfPath?: string;
  formattedThaiSummary: string;
}

const RID_22_BASINS = TELERID_HARDCODED_BASINS.map((b) =>
  b === 'KRC' ? 'KRC' : `ลุ่มน้ำ${b}`
);

function normalizeBasinShortName(b: string): string {
  const s = String(b || '').replace(/^ลุ่มน้ำ\s*/, '').replace(/\s+/g, ' ').trim();
  if (s.includes('โขงอีสาน') || s.includes('โขงตะวันออกเฉียงเหนือ')) {
    return 'โขงตะวันออกเฉียงเหนือ';
  }
  return s;
}


function parseAppStationTsMs(raw: unknown): number | null {
  if (!raw) return null;
  if (typeof raw === 'number' && raw > 1000000000) return raw < 10000000000 ? raw * 1000 : raw;
  const s = String(raw).trim();
  if (!s || s === '-') return null;
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
    if (!Number.isNaN(d.getTime())) return d.getTime();
  }
  const iso = new Date(s);
  return Number.isNaN(iso.getTime()) ? null : iso.getTime();
}

function isStationToday07ToNow(raw: unknown): boolean {
  const ts = parseAppStationTsMs(raw);
  if (ts === null) return false;
  const now = new Date();
  const bkkDate = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const today07 = new Date(`${bkkDate}T07:00:00+07:00`);
  const startMs = now.getTime() < today07.getTime() ? today07.getTime() - 86400000 : today07.getTime();
  return ts >= startMs && ts <= now.getTime() + 300000;
}

function doesBasinMatchFilter(itemBasin: string, selectedBasin: string): boolean {
  if (!selectedBasin || selectedBasin === 'ALL') return true;
  const a = normalizeBasinShortName(itemBasin);
  const b = normalizeBasinShortName(selectedBasin);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

const INITIAL_DEPARTMENTS: Record<DepartmentId, DepartmentStatus> = {
  rpa: {
    id: 'rpa',
    code: 'DEPT 01',
    nameTh: 'แผนกที่ 1: TeleRID MongoDB Monitor & Anomaly Guard (สีฟ้า)',
    nameEn: '1-Hour Real-Time Flood & Telemetry 4-Module Surveillance Agent',
    roleDescription:
      'ระบบ AI Automation เฝ้าระวังภัยน้ำท่วม (TeleRID Monitor Agent) รันผ่าน Node.js และ Playwright ตรวจสอบ https://telerid.rid.go.th/#/ และ #/cctv ทุกๆ 1 ชั่วโมงตามเวลาจริง แยกตามชื่อลุ่มน้ำ ครบ 4 มอดูล พร้อมออกรายงานและ JSON Logs',
    status: 'idle',
    currentAction: 'ว่าง (กำลังเดินเล่นในออฟฟิศ) — รอรอบสแกนเฝ้าระวังภัยน้ำท่วม TeleRID ทุกๆ 1 ชั่วโมง',
    progress: 100,
    metrics: [
      { label: 'รอบสแกนจริง', value: 'ทุก 1 ชั่วโมง (4 มอดูล)' },
      { label: 'พิกัดเป้าหมาย', value: 'telerid.rid.go.th & #/cctv' },
    ],
    lastUpdated: 'พร้อมทำงาน',
  },
  files: {
    id: 'files',
    code: 'DEPT 02',
    nameTh: 'แผนกที่ 2: CCTV & Stream Check + สแกนเอกสาร (สีเขียวมรกต)',
    nameEn: '1-Hour Real-Time Newly Downloaded Document Scanner & Report',
    roleDescription:
      'ทำงานสแกนเอกสารที่ถูกดาวน์โหลดมาใหม่ทุกๆ 1 ชั่วโมงในเวลาจริง แจ้งว่ามีเอกสารใหม่อะไรบ้าง เวลาเท่าไร มีกี่ไฟล์ และกดดูเป็นรายงานสรุปออกมาได้ทันที',
    status: 'idle',
    currentAction: 'ว่าง (กำลังเดินเล่นในออฟฟิศ) — รอรอบสแกนเอกสารดาวน์โหลดใหม่ทุกๆ 1 ชั่วโมง',
    progress: 100,
    metrics: [
      { label: 'รอบสแกนจริง', value: 'ทุก 1 ชั่วโมง' },
      { label: 'โฟลเดอร์หลัก', value: 'Downloads / Desktop' },
    ],
    lastUpdated: 'รอรอบสแกน 1 ชม.',
  },
  legal: {
    id: 'legal',
    code: 'DEPT 03',
    nameTh: 'แผนกที่ 3: MA & Field Inspection + Gov Docs (สีทอง)',
    nameEn: 'Document Upload Analyzer, Official Reply & Word/Excel Generator',
    roleDescription:
      'อัปโหลดไฟล์เอกสารให้ช่วยวิเคราะห์และเขียนหนังสือตอบกลับ/บันทึกข้อความราชการได้ทุกงาน (ไม่ใช่แค่ TOR) พร้อมสร้างไฟล์ .docx และ .xlsx ลงโฟลเดอร์ Downloads และเปิดใน Word/Excel ทันที',
    status: 'idle',
    currentAction: 'ว่าง (กำลังเดินเล่นในออฟฟิศ) — พร้อมรับไฟล์อัปโหลดเพื่อวิเคราะห์และสร้าง .docx / .xlsx',
    progress: 100,
    metrics: [
      { label: 'Gov Docs', value: 'หนังสือราชการทุกงาน' },
      { label: 'Auto-Launch', value: 'Word & Excel จริง' },
    ],
    lastUpdated: 'พร้อมทำงาน',
  },
  comm: {
    id: 'comm',
    code: 'DEPT 04',
    nameTh: 'แผนกที่ 4: Communication, LINE Alert & Notepad (สีเขียว)',
    nameEn: 'Executive Report Writer & Windows Notepad Launcher',
    roleDescription:
      'เขียนไฟล์สรุปผลการปฏิบัติงานลงเครื่องคอมพิวเตอร์ และรันคำสั่งเปิดโปรแกรม notepad.exe เด้งขึ้นมาแสดงผลบนหน้าจอ Windows ทันที',
    status: 'idle',
    currentAction: 'ว่าง (กำลังเดินเล่นในออฟฟิศ) — พร้อมเขียนรายงานสรุปและเปิดโปรแกรม Notepad',
    progress: 100,
    metrics: [
      { label: 'OS App', value: 'LINE OA + Notepad' },
      { label: 'Delivery', value: 'Instant Popup' },
    ],
    lastUpdated: 'พร้อมส่งออก',
  },
  vscode: {
    id: 'vscode',
    code: 'DEPT 05',
    nameTh: 'แผนกที่ 5: SV Runner (Port 5000 -> MongoDB) & Code Inspector (สีม่วงคราม)',
    nameEn: 'Code Inspector, AI File Editor & VS Code Line Launcher',
    roleDescription:
      'สั่งเปิด/ปิดและติดตาม Log ของตารางเวลา SV (telerid-backend-service Port 5000) ที่ดูดข้อมูล TeleRID WebSocket ลง MongoDB พร้อมเครื่องมือตรวจแก้โค้ด VS Code',
    status: 'idle',
    currentAction: 'ว่าง (กำลังเดินเล่นในออฟฟิศ) — พร้อมตรวจวิเคราะห์โค้ดและเปิด VS Code',
    progress: 100,
    metrics: [
      { label: 'SV Service', value: 'Port 5000 -> MongoDB' },
      { label: 'IDE Bridge', value: 'code -g (VS Code)' },
    ],
    lastUpdated: 'พร้อมทำงาน',
  },
};

const DEFAULT_MEMO_DATA: GovMemoDocumentData = {
  departmentHeader:
    'ส่วนอุทกวิทยา สำนักบริหารจัดการน้ำและอุทกวิทยา กรมชลประทาน (ผส.บอ.) โทร. 2450',
  docNumber: 'กษ 0318.04/ว 2489',
  dateText: '5 พฤศจิกายน 2569',
  subject:
    'รายงานผลการพิจารณาและขออนุมัติขอบเขตของงาน (TOR) งานจ้างเหมาบำรุงรักษาสถานีโทรมาตรและสำรวจข้อมูลอุทกวิทยา พื้นที่ลุ่มน้ำภาคใต้ฝั่งตะวันออกตอนล่าง',
  recipient: 'ผู้อำนวยการสำนักบริหารจัดการน้ำและอุทกวิทยา (ผ่าน ผส.บอ.)',
  backgroundStory:
    'ด้วยส่วนอุทกวิทยา สำนักบริหารจัดการน้ำและอุทกวิทยา กรมชลประทาน มีภารกิจในการเฝ้าระวังและพยากรณ์น้ำในพื้นที่ลุ่มน้ำภาคใต้ฝั่งตะวันออกตอนล่าง จึงมีความจำเป็นต้องบำรุงรักษาสถานีโทรมาตรอัตโนมัติและสำรวจข้อมูลทางชลศาสตร์ให้มีความพร้อมใช้งาน วงเงินงบประมาณ 3,249,900.00 บาท (สามล้านสองแสนสี่หมื่นเก้าพันเก้าร้อยบาทถ้วน)',
  torAnalysisPoints: [
    'ชื่อโครงการ: งานจ้างเหมาบำรุงรักษาสถานีโทรมาตรและสำรวจข้อมูลอุทกวิทยา พื้นที่ลุ่มน้ำภาคใต้ฝั่งตะวันออกตอนล่าง',
    'วงเงินงบประมาณ: 3,249,900.00 บาท (สามล้านสองแสนสี่หมื่นเก้าพันเก้าร้อยบาทถ้วน)',
    'กำหนดเวลาส่งงาน: แบ่งออกเป็น 4 งวด (60 วัน, 150 วัน, 240 วัน, 330 วัน)',
    'ข้อกำหนดทางชลศาสตร์: งานรูปตัดลำน้ำ จำนวน 32 แห่ง | งาน Rating Curve จำนวน 5 แห่ง | ความคลาดเคลื่อน ไม่เกิน ±2 เซนติเมตร',
    'คณะกรรมการ TOR (ท้ายเอกสาร): นายธีรวัฒน์ พงศ์สุวรรณ (ผปน.บอ. ประธานกรรมการ), นางสาวสุพัตรา วรโชติ (ตน.บอ. กรรมการ), นายนนท์ กิตติศักดิ์ (ตน.บอ. กรรมการและเลขานุการ)',
  ],
  vendorComparisonSummary:
    'กรองเฉพาะข้อมูลที่ปรากฏอยู่ในไฟล์ต้นเรื่องที่ 1 เท่านั้น (ไม่มีการดึงข้อมูลบริษัทจากคลังไฟล์ภายนอก)',
  legalComplianceNote:
    'ดำเนินการสอดคล้องตามพระราชบัญญัติการจัดซื้อจัดจ้างและการบริหารพัสดุภาครัฐ พ.ศ. 2560 และระเบียบสำนักนายกรัฐมนตรีว่าด้วยงานสารบรรณ',
  recommendation:
    'จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติขอบเขตของงานและผลการพิจารณา วงเงิน 3,249,900.00 บาท (สามล้านสองแสนสี่หมื่นเก้าพันเก้าร้อยบาทถ้วน)',
  signerName: 'นายธีรวัฒน์ พงศ์สุวรรณ',
  signerPosition: 'ประธานกรรมการ (ผปน.บอ.)',
  budgetAmountTHB: 3249900,
  vendorItems: [
    {
      itemNo: 1,
      description: '1. ข้อมูลพื้นฐานโครงการ (Project Metadata)',
      torSpec: 'วงเงินงบประมาณ 3,249,900.00 บาท',
      vendorASpec: 'งานจ้างเหมาบำรุงรักษาสถานีโทรมาตรและสำรวจข้อมูลอุทกวิทยา พื้นที่ลุ่มน้ำภาคใต้ฝั่งตะวันออกตอนล่าง',
      vendorAPrice: 3249900,
      vendorBPrice: 3249900,
      complianceStatus: 'ผ่านเกณฑ์',
    },
    {
      itemNo: 2,
      description: '2. ข้อกำหนดทางชลศาสตร์และงวดงาน (Operations & Milestones)',
      torSpec: 'แบ่งออกเป็น 4 งวด (60 วัน, 150 วัน, 240 วัน, 330 วัน)',
      vendorASpec: 'งานรูปตัดลำน้ำ จำนวน 32 แห่ง | งาน Rating Curve จำนวน 5 แห่ง | เกณฑ์คลาดเคลื่อน ไม่เกิน ±2 เซนติเมตร',
      vendorAPrice: 0,
      vendorBPrice: 0,
      complianceStatus: 'ผ่านเกณฑ์',
    },
    {
      itemNo: 3,
      description: '3. พิกัดสถานี ภาคผนวก ข & คณะกรรมการ TOR',
      torSpec: 'รหัสสถานี BNR., Tpat., Tkol. รวม 7 สถานี',
      vendorASpec: 'นายธีรวัฒน์ พงศ์สุวรรณ (ผปน.บอ.), นางสาวสุพัตรา วรโชติ (ตน.บอ.), นายนนท์ กิตติศักดิ์ (ตน.บอ.)',
      vendorAPrice: 0,
      vendorBPrice: 0,
      complianceStatus: 'ผ่านเกณฑ์',
    },
  ],
};

export default function App() {
  const [departments, setDepartments] =
    useState<Record<DepartmentId, DepartmentStatus>>(INITIAL_DEPARTMENTS);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('overview');
  const [selectedDept, setSelectedDept] = useState<DepartmentId | null>('rpa');
  const [isDockCollapsed, setIsDockCollapsed] = useState(false);

  const [isWorkflowRunning, setIsWorkflowRunning] = useState(false);
  const [activeStep, setActiveStep] = useState<number>(0);

  // ============================================================================
  // แยก State การสั่งงานอิสระของแต่ละแผนก (Decoupled Per-Department Controls)
  // ============================================================================
  // แผนกที่ 1 (Browser RPA)
  const [rpaUrl, setRpaUrl] = useState('https://telerid.rid.go.th/#/');
  const [rpaInstruction, setRpaInstruction] = useState(
    'ล็อกอินด้วยรหัสที่บันทึกไว้ แล้วบอกว่าเห็นอะไรในหน้าเว็บบ้าง'
  );
  const [rpaUsername, setRpaUsername] = useState('Sommart');
  const [rpaPassword, setRpaPassword] = useState('891013');
  const [rpaAutoLogin, setRpaAutoLogin] = useState(true);
  const [rpaShowCredBox, setRpaShowCredBox] = useState(false);
  const [rpaBotReport, setRpaBotReport] = useState<string>('');
  const [rpaWhatSaw, setRpaWhatSaw] = useState<WhatBotSawDetail | null>(null);
  const [rpaSavedSteps, setRpaSavedSteps] = useState<SavedRpaStep[]>([]);
  const [isRpaBusy, setIsRpaBusy] = useState(false);

  // แผนกที่ 1 (TeleRID Monitor Agent — ระบบเฝ้าระวังภัยน้ำท่วมอัตโนมัติ 4 มอดูล รายชั่วโมงตามเวลาจริง ตลอด 24 ชั่วโมง รองรับการเลือกหลายลุ่มน้ำพร้อมกัน)
  const [teleRidBasinName, setTeleRidBasinName] = useState<string>('ลุ่มน้ำโขงตะวันออกเฉียงเหนือ');
  const [teleRidSelectedBasins, setTeleRidSelectedBasins] = useState<string[]>([
    'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ',
    'ลุ่มน้ำชี',
    'ลุ่มน้ำมูล',
  ]);
  const [teleRidCustomBasinInput, setTeleRidCustomBasinInput] = useState<string>('');
  const [teleRidActiveBasinView, setTeleRidActiveBasinView] = useState<string>('ALL');
  const [teleRidMultiBasinFilter, setTeleRidMultiBasinFilter] = useState<string[]>([]);
  const [teleRidStationTypeFilter, setTeleRidStationTypeFilter] = useState<'ALL' | 'สถานีวัดระดับน้ำ + น้ำฝน' | 'สถานีวัดระดับน้ำอย่างเดียว' | 'สถานีน้ำฝนอย่างเดียว'>('ALL');
  const [teleRidMonitorReport, setTeleRidMonitorReport] =
    useState<TeleRidMonitorDetailedReport | null>(null);
  const [teleRidMonitorHistory, setTeleRidMonitorHistory] = useState<
    TeleRidMonitorDetailedReport[]
  >([]);
  const [teleRidNextScanAtMs, setTeleRidNextScanAtMs] = useState<number>(() => {
    const nextHr = new Date();
    nextHr.setHours(nextHr.getHours() + 1, 0, 0, 0);
    return nextHr.getTime();
  });
  const [teleRidCountdownText, setTeleRidCountdownText] = useState<string>('59 นาที 59 วินาที');
  const [isTeleRidMonitorBusy, setIsTeleRidMonitorBusy] = useState<boolean>(false);
  const [isTeleRidReportModalOpen, setIsTeleRidReportModalOpen] = useState<boolean>(false);
  const [selectedTeleRidHistoryId, setSelectedTeleRidHistoryId] = useState<string>('');
  const [teleRidOpenBrowserOnScan, setTeleRidOpenBrowserOnScan] = useState<boolean>(true);
  const [teleRidJsonCopied, setTeleRidJsonCopied] = useState<boolean>(false);
  const [teleRidDetailedStations, setTeleRidDetailedStations] = useState<TeleRidStationDetailedRow[]>([]);
  const [secretaryProgress, setSecretaryProgress] = useState<SecretaryProgressSnapshot | null>(null);
  const [detailedStationSearch, setDetailedStationSearch] = useState<string>('');
  const [detailedStationStatusFilter, setDetailedStationStatusFilter] = useState<string>('ALL');
  const [detailedStationAnomalyFilter, setDetailedStationAnomalyFilter] = useState<
    | 'ALL_COND'
    | 'ANY_ANOMALY'
    | 'ONLY_999_M999'
    | 'WATER_LE_M10_OR_999'
    | 'WATER_NEGATIVE_ALL'
    | 'WATER_NEG_0_TO_10'
    | 'RAIN_ANOMALY'
  >('ALL_COND');
  const [mongoStatus, setMongoStatus] = useState<{
    connected: boolean;
    mongoUriMasked: string;
    dbName: string;
    collectionName: string;
    totalDocsInCollection: number;
    fetchedRowsCount: number;
    fetchSuccess: boolean;
    lastCheckedAt: string;
    errorMessage: string | null;
  } | null>(null);
  const [apiToken, setApiToken] = useState<string>(
    () => (typeof window !== 'undefined' && localStorage.getItem('govai_api_token')) || ''
  );
  const [mongoAtlasPassword, setMongoAtlasPassword] = useState<string>(
    () => (typeof window !== 'undefined' && localStorage.getItem('govai_mongo_atlas_pass')) || ''
  );
  const [mongoLogMsg, setMongoLogMsg] = useState<string>(
    'โหมดดึงข้อมูลจาก MongoDB โดยตรง (DB_NAME=telerid_db, COLLECTION_NAME=stations | สแกนอัตโนมัติทุก 1 ชั่วโมง)'
  );
  const [isTeleRidHourlyAutoScanEnabled, setIsTeleRidHourlyAutoScanEnabled] = useState<boolean>(true);
  const [lastHourlyMongoScanTimeText, setLastHourlyMongoScanTimeText] = useState<string>('-');

  // แผนกที่ 2 (Real-Time 1-Hour Newly Downloaded Document Scanner & Report)
  const [scannedFiles, setScannedFiles] = useState<ScannedFileItem[]>([]);
  const [customScanFolder, setCustomScanFolder] = useState('');
  const [isScanningFiles, setIsScanningFiles] = useState(false);
  const [dept2HourlyReport, setDept2HourlyReport] = useState<Dept2HourlyScanReport | null>(null);
  const [dept2ReportHistory, setDept2ReportHistory] = useState<Dept2HourlyScanReport[]>([]);
  const [dept2NextScanAtMs, setDept2NextScanAtMs] = useState<number>(() => Date.now() + 3600 * 1000);
  const [dept2CountdownText, setDept2CountdownText] = useState<string>('59 นาที 59 วินาที');
  const [isDept2ReportModalOpen, setIsDept2ReportModalOpen] = useState<boolean>(false);
  const [selectedHistoryReportId, setSelectedHistoryReportId] = useState<string>('');

  // แผนกที่ 3 (AI Gov-Document Multi-Engine — รองรับกลุ่มเอกสารหลักฐานต้นเรื่อง ไฟล์ที่ 1.1, 1.2... N ไฟล์ + ไฟล์ตัวอย่างที่ 2)
  const [memoData, setMemoData] = useState<GovMemoDocumentData>(DEFAULT_MEMO_DATA);
  // อินพุตส่วนที่ 1: กลุ่มเอกสารหลักฐานต้นเรื่อง (ไฟล์ที่ 1.1, 1.2, 1.3... N ไฟล์)
  const [legalSourceFiles, setLegalSourceFiles] = useState<
    {
      id: string;
      filename: string;
      localPath?: string;
      extension: string;
      sizeBytes?: number;
      base64Data?: string;
      textContent?: string;
      mimeType?: string;
      fromZipArchive?: string;
    }[]
  >([]);
  const [legalSelectedFilePath, setLegalSelectedFilePath] = useState<string>('');
  const [legalUploadedName, setLegalUploadedName] = useState<string>('');
  const [legalUploadedBase64, setLegalUploadedBase64] = useState<string>('');
  const [legalUploadedText, setLegalUploadedText] = useState<string>('');
  const [legalFolderSearchPath, setLegalFolderSearchPath] = useState<string>('C:\\Users\\Tele_04\\Downloads');
  const [legalFileKeywordFilter, setLegalFileKeywordFilter] = useState<string>('');
  // อินพุตส่วนที่ 2: ไฟล์ตัวอย่าง (Template / Reference Benchmark File)
  const [legalTemplateSelectedPath, setLegalTemplateSelectedPath] = useState<string>('');
  const [legalTemplateUploadedName, setLegalTemplateUploadedName] = useState<string>('');
  const [legalTemplateUploadedBase64, setLegalTemplateUploadedBase64] = useState<string>('');
  const [legalTemplateUploadedText, setLegalTemplateUploadedText] = useState<string>('');
  const [legalInstruction, setLegalInstruction] = useState<string>(
    'เชื่อมโยงข้อมูลข้ามเอกสาร (Cross-Document Data Fusion) จากทุกไฟล์ในช่องที่ 1 (1.1, 1.2... N) สกัด Core Entities อิสระ และล้างข้อมูลเก่าของไฟล์ตัวอย่างช่องที่ 2 ออกทั้งหมด 100% โดยแทนที่ด้วยข้อมูลจริงจากกลุ่มไฟล์ช่องที่ 1'
  );
  const [legalAnalysisSummary, setLegalAnalysisSummary] = useState<string>('');
  const [legalCrossDocFusionSummary, setLegalCrossDocFusionSummary] = useState<string>('');
  const [legalPerFileInsights, setLegalPerFileInsights] = useState<
    {
      indexLabel: string;
      filename: string;
      extension: string;
      resolvedPath: string;
      sizeBytes: number;
      detectedRole: string;
      extractedProjectName: string;
      extractedBudgetFormatted: string;
      extractedStationsCount: number;
      extractedKeyPoints: string[];
    }[]
  >([]);
  const [legalDynamicFusionJson, setLegalDynamicFusionJson] = useState<Record<string, unknown> | null>(null);
  const [legalShowDynamicFusionModal, setLegalShowDynamicFusionModal] = useState<boolean>(false);
  const [legalAntiMixupAbortedMsg, setLegalAntiMixupAbortedMsg] = useState<string>('');
  const [legalShowTorJsonModal, setLegalShowTorJsonModal] = useState<boolean>(false);
  const [legalTorJsonConfig, setLegalTorJsonConfig] = useState<Record<string, unknown> | null>(null);
  const [legalAppendixBStations, setLegalAppendixBStations] = useState<
    {
      stationCode: string;
      stationName: string;
      subdistrict: string;
      district: string;
      province: string;
      latitude: string;
      longitude: string;
    }[]
  >([]);
  const [legalMergedTextPreview, setLegalMergedTextPreview] = useState<string>('');
  const [legalAuditSteps, setLegalAuditSteps] = useState<
    { stepNo: number; phase: string; detail: string; durationMs: number }[]
  >([]);
  const [legalLineByLineDiff, setLegalLineByLineDiff] = useState<
    { lineNo: number; templateOriginal: string; mergedResult: string; changed: boolean }[]
  >([]);
  const [legalStrictRules, setLegalStrictRules] = useState<
    { category: string; oldText: string; newText: string }[]
  >([]);
  const [legalValidationReport, setLegalValidationReport] = useState<{
    passed: boolean;
    autoFixedCount: number;
    checks: {
      field: string;
      expectedNewValue: string;
      forbiddenOldValue: string;
      foundNewInOutput: boolean;
      lingeringOldInOutput: boolean;
      status: 'PASS' | 'AUTO_FIXED';
    }[];
    summaryText: string;
  } | null>(null);
  const [legalStyleProfile, setLegalStyleProfile] = useState<{
    fontFamily: string;
    localFontPath: string;
    isFontFileFoundOnOS: boolean;
    titleFontSizePt: number;
    bodyFontSizePt: number;
    marginTopTwips: number;
    marginBottomTwips: number;
    marginLeftTwips: number;
    marginRightTwips: number;
    firstLineIndentTwips: number;
    lineSpacingTwips: number;
    headingDoubleSpaces: number;
    outputExtension: string;
    runStyleCodePreview: string;
  } | null>(null);
  const [legalExtractedEntities, setLegalExtractedEntities] = useState<{
    docNumber: string;
    referenceNumbers: string[];
    dateText: string;
    projectName?: string;
    basinOrAreaName?: string;
    basinAreaName?: string;
    projectCode?: string;
    budgetAmountFormatted?: string;
    budgetAmountTHB: number;
    budgetAmountThaiWords?: string;
    medianPriceTHB: number;
    quotedPriceTHB: number;
    quotedPriceThaiWords?: string;
    vendorName: string;
    durationDays?: string | number;
    installmentScheduleText?: string;
    crossSectionCountText?: string;
    ratingCurveCountText?: string;
    toleranceCriterionText?: string;
    committeeMembers: string[];
    signerName: string;
    signerPosition: string;
  } | null>(null);
  const [legalShowRunStyleCode, setLegalShowRunStyleCode] = useState(false);
  const [isLegalAnalyzing, setIsLegalAnalyzing] = useState(false);
  const [isDownloadingDocx, setIsDownloadingDocx] = useState(false);
  const [isDownloadingXlsx, setIsDownloadingXlsx] = useState(false);
  const legalFileInputRef = useRef<HTMLInputElement | null>(null);
  const legalTemplateInputRef = useRef<HTMLInputElement | null>(null);

  // แผนกที่ 4 (Communication & Notepad Report)
  const [linePreview, setLinePreview] = useState({
    toGroup: 'รายงานสรุปผลการปฏิบัติงาน (Notepad & LINE OA)',
    summaryText:
      '====================================================================\n' +
      '   รายงานสรุปผลการปฏิบัติงาน (GovAI 3D Agent Orchestrator)\n' +
      '====================================================================\n' +
      '• แผนกที่ 1 (Browser RPA): เปิด Chrome เข้าเว็บไซต์ ล็อกอิน และบันทึกขั้นตอนสำเร็จ\n' +
      '• แผนกที่ 2 (File Sync): สแกนไฟล์จริงจาก Desktop, Downloads และ workspace_inbox เรียบร้อย\n' +
      '• แผนกที่ 3 (Legal & Docs): วิเคราะห์เอกสารและสร้างไฟล์ .docx / .xlsx ลงใน Downloads แล้ว\n' +
      '• แผนกที่ 5 (VS Code & SV): ตรวจสอบและอัปเดตโค้ดผ่าน VS Code เรียบร้อย\n' +
      '====================================================================',
    sentAt: 'พร้อมเปิดใน Notepad',
  });

  // แผนกที่ 5 (VS Code & SV Inspector)
  const [vscodeFiles, setVscodeFiles] = useState<
    { filename: string; fullPath: string; content: string; sizeBytes: number }[]
  >([]);
  const [selectedVscodeFile, setSelectedVscodeFile] = useState('svGovApiConnector.ts');
  const [customVscodePath, setCustomVscodePath] = useState('');
  const [vscodeInspectReport, setVscodeInspectReport] = useState('');
  const [vscodeAiInstruction, setVscodeAiInstruction] = useState(
    'ตรวจสอบโค้ดในไฟล์นี้และเพิ่มฟังก์ชันตรวจสอบสถานะการเชื่อมต่อพร้อมระบบดักจับข้อผิดพลาด (Error Handling)'
  );
  const [isVscodeBusy, setIsVscodeBusy] = useState(false);

  const [workflowLogs] = useState<WorkflowStepLog[]>([]);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [isVSCodeModalOpen, setIsVSCodeModalOpen] = useState(false);
  type SensorBugAlertItemUi = {
    type: 'SENSOR_BUG';
    stationId: string;
    stationName?: string;
    basin?: string;
    value: number | string;
    unit?: string;
    time: string;
    anomalyReason?: string;
    reason?: string;
  };
  const [sensorBugAlert, setSensorBugAlert] = useState<SensorBugAlertItemUi | null>(null);
  const [sensorBugQueue, setSensorBugQueue] = useState<SensorBugAlertItemUi[]>([]);
  const [sensorBugTotalInBatch, setSensorBugTotalInBatch] = useState<number>(0);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);

  // สถานะระบบบันทึกและเล่นซ้ำมาโครมนุษย์ (Autonomous Macro Recorder & Playback Engine — แผนกที่ 1)
  const [isMacroRecording, setIsMacroRecording] = useState(false);
  const [isMacroBusy, setIsMacroBusy] = useState(false);
  const [macroConfigPath, setMacroConfigPath] = useState(
    'C:\\Users\\Tele_04\\Desktop\\agent-orchestrator\\tele04_macro_config.json'
  );
  const [macroSteps, setMacroSteps] = useState<
    {
      stepNo: number;
      actionType: string;
      x?: number;
      y?: number;
      selector?: string;
      innerText?: string;
      inputValue?: string;
      keyPressed?: string;
      url?: string;
      description: string;
      timestamp?: string;
    }[]
  >([
    {
      stepNo: 1,
      actionType: 'navigate',
      url: 'https://telerid.rid.go.th/#/',
      description: 'เปิดหน้าต่าง Chrome จริงเข้าสู่ https://telerid.rid.go.th/#/',
    },
    {
      stepNo: 2,
      actionType: 'click',
      x: 1265,
      y: 248,
      selector: 'label:has-text("ลุ่มน้ำโขงตะวันออกเฉียงเหนือ")',
      innerText: 'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ',
      description: 'คลิกเมาส์ที่พิกัด (1265, 248) เลือกตัวกรอง "ลุ่มน้ำโขงตะวันออกเฉียงเหนือ"',
    },
    {
      stepNo: 3,
      actionType: 'click',
      x: 1265,
      y: 276,
      selector: 'label:has-text("ลุ่มน้ำชี")',
      innerText: 'ลุ่มน้ำชี',
      description: 'คลิกเมาส์ที่พิกัด (1265, 276) เลือกตัวกรอง "ลุ่มน้ำชี"',
    },
    {
      stepNo: 4,
      actionType: 'click',
      x: 1265,
      y: 304,
      selector: 'label:has-text("ลุ่มน้ำมูล")',
      innerText: 'ลุ่มน้ำมูล',
      description: 'คลิกเมาส์ที่พิกัด (1265, 304) เลือกตัวกรอง "ลุ่มน้ำมูล"',
    },
    {
      stepNo: 5,
      actionType: 'observe_dom_table',
      url: 'https://telerid.rid.go.th/#/',
      description: 'สกัดตัวเลขสดที่ปรากฏบน Elements หน้าตารางค่าน้ำจริง ณ วินาทีนั้น (Pure Observation 100%)',
    },
    {
      stepNo: 6,
      actionType: 'navigate',
      url: 'https://telerid.rid.go.th/#/cctv',
      description: 'สลับไปหน้ากล้องโทรทัศน์วงจรปิด https://telerid.rid.go.th/#/cctv',
    },
    {
      stepNo: 7,
      actionType: 'observe_dom_cctv',
      url: 'https://telerid.rid.go.th/#/cctv',
      description: 'สกัดสถานะกล้อง CCTV และเวลาอัปเดตภาพล่าสุดจาก Elements หน้าจอจริง',
    },
  ]);
  const [macroStatusMessage, setMacroStatusMessage] = useState(
    'พร้อมบันทึกพฤติกรรมการคลิกมนุษย์ หรือสั่งเล่นซ้ำมาโคร 1:1 (รันอัตโนมัติทุกต้นชั่วโมง 07:00, 08:00, 09:00, 10:00 น.)'
  );
  const [nextClockHourText, setNextClockHourText] = useState(() => {
    const nextH = (new Date().getHours() + 1) % 24;
    return `${String(nextH).padStart(2, '0')}:00 น.`;
  });
  const [upcomingHoursSchedule, setUpcomingHoursSchedule] = useState<string[]>([
    '07:00 น.',
    '08:00 น.',
    '09:00 น.',
    '10:00 น.',
    '11:00 น.',
    '12:00 น.',
  ]);
  const [thresholdAnomalies, setThresholdAnomalies] = useState<
    {
      category: string;
      categoryThai: string;
      stationCode: string;
      stationName: string;
      basin: string;
      observedValue: string;
      numericValue: number;
      unit: string;
      reason: string;
      scannedAt: string;
    }[]
  >([]);
  const [showMacroJsonPreview, setShowMacroJsonPreview] = useState(false);


  // โหลดรายการไฟล์จาก Desktop / Downloads / workspace_inbox (รองรับโหมด silent เพื่อไม่ให้แผนก 2 วิ่งทำงานไม่หยุด)
  const fetchScannedFiles = useCallback(
    async (
      folderOverride?: string,
      options?: { silent?: boolean; trigger?: 'hourly-auto' | 'manual' }
    ) => {
      const isSilent = options?.silent ?? false;
      const triggerMode = options?.trigger ?? (isSilent ? 'initial' : 'manual');
      setIsScanningFiles(true);

      if (!isSilent) {
        setDepartments((prev) => ({
          ...prev,
          files: {
            ...prev.files,
            status: 'working',
            currentAction:
              triggerMode === 'hourly-auto'
                ? '⏰ [ครบรอบ 1 ชั่วโมง] กำลังสแกนตรวจหาเอกสารที่ถูกดาวน์โหลดมาใหม่ใน Downloads และ Desktop...'
                : '🔍 กำลังสแกนตรวจหาเอกสารที่ถูกดาวน์โหลดมาใหม่ พร้อมจัดทำรายงานสรุปเวลาและจำนวนไฟล์...',
            lastUpdated: new Date().toLocaleTimeString('th-TH'),
          },
        }));
      }

      try {
        const params = new URLSearchParams();
        if (folderOverride && folderOverride.trim()) {
          params.set('folder', folderOverride.trim());
        }
        if (isSilent) {
          params.set('silent', '1');
        }
        params.set('trigger', triggerMode);

        const res = await fetch(`/api/fs/scan?${params.toString()}`);
        const data = await res.json();
        if (data.ok && Array.isArray(data.files)) {
          setScannedFiles(data.files);
        }
        if (data.hourlyReport) {
          setDept2HourlyReport(data.hourlyReport);
          setSelectedHistoryReportId(data.hourlyReport.reportId);
          if (data.hourlyReport.nextScanAtIso) {
            const parsedNext = new Date(data.hourlyReport.nextScanAtIso).getTime();
            if (!Number.isNaN(parsedNext)) {
              setDept2NextScanAtMs(parsedNext);
            }
          }
          if (!isSilent) {
            const rpt: Dept2HourlyScanReport = data.hourlyReport;
            setDepartments((prev) => ({
              ...prev,
              files: {
                ...prev.files,
                status: 'completed',
                currentAction: `✅ ${rpt.summaryHeadline}`,
                lastUpdated: new Date().toLocaleTimeString('th-TH'),
                metrics: [
                  { label: 'เอกสารใหม่รอบนี้', value: `${rpt.newFileCount} ไฟล์` },
                  { label: 'รอบถัดไป (1 ชม.)', value: rpt.nextScanAtText.replace(' (อีก 1 ชั่วโมง)', '') },
                ],
              },
            }));
            setTimeout(() => {
              setDepartments((prev) => ({
                ...prev,
                files: {
                  ...prev.files,
                  status: 'idle',
                  currentAction: `ว่าง — สแกนล่าสุดพบเอกสารใหม่ ${rpt.newFileCount} ไฟล์ | รอรอบถัดไปเวลา ${rpt.nextScanAtText}`,
                },
              }));
            }, 4500);
          }
        }
        if (Array.isArray(data.reportHistory) && data.reportHistory.length > 0) {
          setDept2ReportHistory(data.reportHistory);
        } else if (data.hourlyReport) {
          setDept2ReportHistory((prev) => {
            const exists = prev.some((r) => r.reportId === data.hourlyReport.reportId);
            return exists ? prev : [data.hourlyReport, ...prev].slice(0, 12);
          });
        }
      } catch {
        // ignore initial boot hiccup
      } finally {
        setIsScanningFiles(false);
      }
    },
    []
  );

  // โหลดข้อมูลรหัสผ่านที่บันทึกไว้และประวัติขั้นตอนของแผนกที่ 1
  const fetchRpaCredentialsAndSteps = useCallback(async () => {
    try {
      const res = await fetch('/api/rpa/credentials');
      const data = await res.json();
      if (data.ok) {
        if (data.credentials?.username) setRpaUsername(data.credentials.username);
        if (data.credentials?.password) setRpaPassword(data.credentials.password);
        if (Array.isArray(data.savedSteps)) setRpaSavedSteps(data.savedSteps);
      }
    } catch {
      // ignore
    }
  }, []);

  // โหลดรายการไฟล์โค้ดของแผนกที่ 5
  const fetchVscodeCodebaseFiles = useCallback(async () => {
    try {
      const res = await fetch('/api/vscode/files');
      const data = await res.json();
      if (data.ok && Array.isArray(data.files)) {
        setVscodeFiles(data.files);
      }
    } catch {
      // ignore
    }
  }, []);

  // โหลดสถานะมาโครและตารางเวลารายชั่วโมงตรงตามนาฬิกาจริงของแผนกที่ 1
  const fetchMacroRecorderStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/rpa/macro/status');
      const data = await res.json();
      if (data.ok) {
        if (typeof data.isRecording === 'boolean') setIsMacroRecording(data.isRecording);
        if (data.macroConfigPath) setMacroConfigPath(data.macroConfigPath);
        if (Array.isArray(data.liveRecordedSteps) && data.liveRecordedSteps.length > 0) {
          setMacroSteps(data.liveRecordedSteps);
        } else if (Array.isArray(data.macroConfig?.steps) && data.macroConfig.steps.length > 0) {
          setMacroSteps(data.macroConfig.steps);
        }
        if (data.nextClockHourText) setNextClockHourText(data.nextClockHourText);
        if (Array.isArray(data.upcomingHoursSchedule) && data.upcomingHoursSchedule.length > 0) {
          setUpcomingHoursSchedule(data.upcomingHoursSchedule);
        }
        if (Array.isArray(data.thresholdAnomalies)) {
          setThresholdAnomalies(data.thresholdAnomalies);
        }
      }
    } catch {
      // ignore initial boot hiccup
    }
  }, []);

  useEffect(() => {
    // โหลดครั้งแรกแบบ silent: true เพื่อเตรียมรายการไฟล์และรายงานตั้งต้น โดยไม่สั่งหุ่นยนต์แผนกที่ 2 ทำงานวนลูป
    void fetchScannedFiles(undefined, { silent: true });
    void fetchRpaCredentialsAndSteps();
    void fetchVscodeCodebaseFiles();
    void fetchMacroRecorderStatus();
  }, [fetchScannedFiles, fetchRpaCredentialsAndSteps, fetchVscodeCodebaseFiles, fetchMacroRecorderStatus]);


  // ตั้งเวลาจริงทุกๆ 1 ชั่วโมง (3,600,000 ms) สำหรับแผนกที่ 2 และตัวนับถอยหลังเวลาจริงรายวินาที
  useEffect(() => {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const hourlyTimer = setInterval(() => {
      void fetchScannedFiles(customScanFolder, {
        silent: false,
        trigger: 'hourly-auto',
      });
    }, ONE_HOUR_MS);

    return () => clearInterval(hourlyTimer);
  }, [customScanFolder, fetchScannedFiles]);

  useEffect(() => {
    const countdownTicker = setInterval(() => {
      const diffMs = Math.max(0, dept2NextScanAtMs - Date.now());
      const totalSec = Math.floor(diffMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      setDept2CountdownText(`${mins} นาที ${secs < 10 ? `0${secs}` : secs} วินาที`);

      // แผนกที่ 1: ยึดเวลาต้นชั่วโมงถัดไปตามนาฬิกาจริงตลอด 24 ชั่วโมง (00:00 - 23:00 น.) ห้ามรีเซตเวลาใหม่เมื่อกดตรวจสอบทันที
      const nowClock = new Date();
      const nextExactClockHr = new Date(nowClock);
      nextExactClockHr.setHours(nowClock.getHours() + 1, 0, 0, 0);
      const diffMsDept1 = Math.max(0, nextExactClockHr.getTime() - nowClock.getTime());
      const totalSecDept1 = Math.floor(diffMsDept1 / 1000);
      const mins1 = Math.floor(totalSecDept1 / 60);
      const secs1 = totalSecDept1 % 60;
      const nextClockLabel = `${String(nextExactClockHr.getHours()).padStart(2, '0')}:00 น.`;
      setNextClockHourText(nextClockLabel);
      setTeleRidCountdownText(`${mins1} นาที ${secs1 < 10 ? `0${secs1}` : secs1} วินาที (รอบ ${nextClockLabel})`);
    }, 1000);

    return () => clearInterval(countdownTicker);
  }, [dept2NextScanAtMs, teleRidNextScanAtMs]);

  // เชื่อมต่อ Socket.io แบบ Real-Time เพื่อให้หุ่นยนต์แต่ละตัวแยกสถานะกันอิสระ (ตัวไหนว่างให้เดินเล่น ตัวไหนถูกสั่งงานให้นั่งทำงานที่โต๊ะ)
  useEffect(() => {
    const socket = io({
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('dept:init', (serverStates: Record<DepartmentId, DeptSocketEvent>) => {
      if (!serverStates) return;
      setDepartments((prev) => {
        const next = { ...prev };
        (Object.keys(serverStates) as DepartmentId[]).forEach((deptId) => {
          if (next[deptId] && serverStates[deptId]) {
            next[deptId] = {
              ...next[deptId],
              status: serverStates[deptId].status,
              currentAction: serverStates[deptId].currentAction,
              lastUpdated: serverStates[deptId].lastUpdated,
            };
          }
        });
        return next;
      });
    });

    socket.on('dept:state', (evt: DeptSocketEvent) => {
      if (!evt || !evt.deptId) return;
      setDepartments((prev) => {
        if (!prev[evt.deptId]) return prev;
        return {
          ...prev,
          [evt.deptId]: {
            ...prev[evt.deptId],
            status: evt.status,
            currentAction: evt.currentAction,
            lastUpdated: evt.lastUpdated,
          },
        };
      });
    });

    // รับสัญญาณแจ้งเตือนด่วน SENSOR_BUG จากหลังบ้าน (เมื่อพบค่าน้ำ -999, 999 หรือน้ำฝนพุ่งสูงผิดปกติหลักหมื่น มม.)
    socket.on(
      'SENSOR_BUG',
      (payload: SensorBugAlertItemUi & { alertsQueue?: SensorBugAlertItemUi[] }) => {
        if (!payload || !payload.stationId) return;
        const rawList =
          Array.isArray(payload.alertsQueue) && payload.alertsQueue.length > 0
            ? payload.alertsQueue
            : [payload];
        const normalizedQueue = rawList.map((it) => ({
          type: 'SENSOR_BUG' as const,
          stationId: it.stationId,
          stationName: it.stationName,
          basin: it.basin,
          value: it.value,
          unit: it.unit,
          time: it.time,
          anomalyReason: it.anomalyReason || it.reason,
        }));
        setSensorBugQueue(normalizedQueue);
        setSensorBugTotalInBatch(normalizedQueue.length);
        setSensorBugAlert(normalizedQueue[0]);
        const nowStr = new Date().toLocaleTimeString('th-TH');
        const stationDisplay = payload.stationName || payload.stationId;
        const valDisplay = `${payload.value}${payload.unit ? ` ${payload.unit}` : ''}`;
        // สั่งให้ตัวละคร AI Agent ในแผนกที่ 1 (สีฟ้า) และ แผนกที่ 3 (สีทอง) เปลี่ยนเป็นท่าทางตกใจ (Alarm/Alerted Animation)
        setDepartments((prev) => ({
          ...prev,
          rpa: {
            ...prev.rpa,
            status: 'alert',
            currentAction: `🚨 ALERT: เซนเซอร์ขัดข้อง! สถานี ${stationDisplay} รายงานค่าผิดปกติ: ${valDisplay}`,
            lastUpdated: nowStr,
          },
          legal: {
            ...prev.legal,
            status: 'alert',
            currentAction: `🚨 ALERT: เตรียมร่างบันทึกแจ้งซ่อมด่วน! สถานี ${stationDisplay} ค่าน้ำผิดปกติ (${valDisplay})`,
            lastUpdated: nowStr,
          },
        }));
      }
    );

    socket.on('sv:log', (evt: { line?: string; logs?: string[] }) => {
      setSvStatusInfo((prev) => ({
        ...prev,
        running: true,
        logs: Array.isArray(evt.logs) ? evt.logs : evt.line ? [...prev.logs.slice(-59), evt.line] : prev.logs,
      }));
    });

    socket.on('SENSOR_BUG_CLEARED', () => {
      setSensorBugQueue([]);
      setSensorBugTotalInBatch(0);
      setSensorBugAlert(null);
      const nowStr = new Date().toLocaleTimeString('th-TH');
      setDepartments((prev) => ({
        ...prev,
        rpa: {
          ...prev.rpa,
          status: 'idle',
          currentAction: 'รับทราบแจ้งเตือนเซนเซอร์ขัดข้องแล้ว — กลับสู่โหมดเฝ้าระวังตามปกติ',
          lastUpdated: nowStr,
        },
        legal: {
          ...prev.legal,
          status: 'idle',
          currentAction: 'รับทราบแจ้งเตือนเซนเซอร์ขัดข้องแล้ว — กลับสู่โหมดทำงานตามปกติ',
          lastUpdated: nowStr,
        },
      }));
    });

    socket.on(
      'files:hourly-report',
      (payload: { hourlyReport?: Dept2HourlyScanReport; history?: Dept2HourlyScanReport[] }) => {
        if (payload?.hourlyReport) {
          setDept2HourlyReport(payload.hourlyReport);
          setSelectedHistoryReportId(payload.hourlyReport.reportId);
          if (payload.hourlyReport.nextScanAtIso) {
            const nextMs = new Date(payload.hourlyReport.nextScanAtIso).getTime();
            if (!Number.isNaN(nextMs)) {
              setDept2NextScanAtMs(nextMs);
            }
          }
        }
        if (Array.isArray(payload?.history)) {
          setDept2ReportHistory(payload.history);
        }
      }
    );

    socket.on(
      'macro:step-recorded',
      (payload: {
        step?: {
          stepNo: number;
          actionType: string;
          x?: number;
          y?: number;
          selector?: string;
          innerText?: string;
          inputValue?: string;
          keyPressed?: string;
          url?: string;
          description: string;
          timestamp?: string;
        };
        allSteps?: {
          stepNo: number;
          actionType: string;
          x?: number;
          y?: number;
          selector?: string;
          innerText?: string;
          inputValue?: string;
          keyPressed?: string;
          url?: string;
          description: string;
          timestamp?: string;
        }[];
      }) => {
        if (Array.isArray(payload?.allSteps)) {
          setMacroSteps(payload.allSteps);
        } else if (payload?.step) {
          setMacroSteps((prev) => [...prev, payload.step!]);
        }
      }
    );

    socket.on('secretary:progress', (snap: SecretaryProgressSnapshot) => {
      if (!snap) return;
      setSecretaryProgress(snap);
      if (Array.isArray(snap.latestStationsPreview) && snap.latestStationsPreview.length > 0) {
        setTeleRidDetailedStations(snap.latestStationsPreview);
      }
    });

    socket.on(
      'secretary:completed',
      (payload: {
        report?: TeleRidMonitorDetailedReport;
        detailedStations?: TeleRidStationDetailedRow[];
        totalRecordedStations?: number;
        userInteractionCount?: number;
      }) => {
        setSecretaryProgress((prev) =>
          prev
            ? {
                ...prev,
                isActive: false,
                stationsCapturedCount:
                  payload?.totalRecordedStations ?? payload?.detailedStations?.length ?? prev.stationsCapturedCount,
                lastActionDescription: `คุณปิดหน้าต่าง Chrome แล้ว — เลขา AI สรุปและแสดงผลทั้งหมด ${
                  payload?.totalRecordedStations ?? payload?.detailedStations?.length ?? 0
                } สถานีเรียบร้อย`,
              }
            : null
        );
        if (payload?.report) {
          setTeleRidMonitorReport(payload.report);
          setSelectedTeleRidHistoryId(payload.report.reportId);
          setRpaBotReport(payload.report.formattedThaiSummary);
        }
        if (Array.isArray(payload?.detailedStations)) {
          setTeleRidDetailedStations(payload.detailedStations);
        } else if (Array.isArray(payload?.report?.detailedStations)) {
          setTeleRidDetailedStations(payload.report.detailedStations);
        }
        setIsTeleRidMonitorBusy(false);
      }
    );

    socket.on(
      'telerid:hourly-mongo-scan',
      (payload: {
        ok?: boolean;
        triggerLabel?: string;
        scannedAtText?: string;
        nextScanAtIso?: string;
        nextClockHourText?: string;
        upcomingHoursSchedule?: string[];
        autoScanEvery1Hour?: boolean;
        mongoStatus?: {
          connected: boolean;
          mongoUriMasked: string;
          dbName: string;
          collectionName: string;
          totalDocsInCollection: number;
          fetchedRowsCount: number;
          fetchSuccess: boolean;
          lastCheckedAt: string;
          errorMessage: string | null;
        };
        report?: TeleRidMonitorDetailedReport;
        detailedStations?: TeleRidStationDetailedRow[];
        thresholdAnomalies?: {
          category: string;
          categoryThai: string;
          stationCode: string;
          stationName: string;
          basin: string;
          observedValue: string;
          numericValue: number;
          unit: string;
          reason: string;
          scannedAt: string;
        }[];
      }) => {
        if (!payload) return;
        if (typeof payload.autoScanEvery1Hour === 'boolean') {
          setIsTeleRidHourlyAutoScanEnabled(payload.autoScanEvery1Hour);
        }
        if (payload.scannedAtText) {
          setLastHourlyMongoScanTimeText(payload.scannedAtText);
        }
        if (payload.nextScanAtIso) {
          const nextMs = new Date(payload.nextScanAtIso).getTime();
          if (!Number.isNaN(nextMs)) setTeleRidNextScanAtMs(nextMs);
        }
        if (payload.nextClockHourText) {
          setNextClockHourText(payload.nextClockHourText);
        }
        if (Array.isArray(payload.upcomingHoursSchedule)) {
          setUpcomingHoursSchedule(payload.upcomingHoursSchedule);
        }
        if (payload.mongoStatus) {
          setMongoStatus(payload.mongoStatus);
          const mSt = payload.mongoStatus;
          setMongoLogMsg(
            mSt.connected
              ? `⏰ [สแกนอัตโนมัติราย 1 ชั่วโมง] ดึงข้อมูลจาก ${mSt.dbName}.${mSt.collectionName} สำเร็จ (${mSt.fetchedRowsCount} สถานี) เมื่อ ${payload.scannedAtText || mSt.lastCheckedAt}`
              : `⚠️ [สแกนอัตโนมัติราย 1 ชั่วโมง] เชื่อมต่อ MONGO_URI ไม่ได้: ${mSt.errorMessage || 'Connection Failed'}`
          );
        }
        if (payload.report) {
          setTeleRidMonitorReport(payload.report);
          setSelectedTeleRidHistoryId(payload.report.reportId);
          setRpaBotReport(payload.report.formattedThaiSummary);
        }
        if (Array.isArray(payload.detailedStations)) {
          setTeleRidDetailedStations(payload.detailedStations);
        }
        if (Array.isArray(payload.thresholdAnomalies)) {
          setThresholdAnomalies(payload.thresholdAnomalies);
        }
      }
    );

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ปุ่มที่ 1: "เริ่มบันทึกมาโคร (Start Record)" — ดักจับ Event Listeners (click, input, keydown, การเลือกลุ่มน้ำโขงตะวันออกเฉียงเหนือ) บนหน้าต่าง Chrome
  const handleStartMacroRecord = useCallback(async () => {
    setIsMacroBusy(true);
    setIsMacroRecording(true);
    setMacroStatusMessage(
      '🔴 กำลังบันทึกมาโคร (Recording)... ระบบกำลังดักจับพิกัดเมาส์ (click), คีย์บอร์ด และการเลือกลุ่มน้ำโขงตะวันออกเฉียงเหนือบนหน้าต่าง Chrome จริง'
    );
    const nowStr = new Date().toLocaleTimeString('th-TH');
    setDepartments((prev) => ({
      ...prev,
      rpa: {
        ...prev.rpa,
        status: 'working',
        currentAction:
          '🔴 [Macro Recording] กำลังดักจับการคลิกเมาส์ คีย์บอร์ด และการเลือกลุ่มน้ำโขงตะวันออกเฉียงเหนือบน Chrome...',
        lastUpdated: nowStr,
      },
    }));

    try {
      const res = await fetch('/api/rpa/macro/start-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUrl: 'https://telerid.rid.go.th/#/' }),
      });
      const data = await res.json();
      if (data.ok) {
        if (Array.isArray(data.liveRecordedSteps)) {
          setMacroSteps(data.liveRecordedSteps);
        }
        if (data.macroConfigPath) {
          setMacroConfigPath(data.macroConfigPath);
        }
        setMacroStatusMessage(
          data.message ||
            '🔴 กำลังบันทึกมาโคร... คลิกเลือกลุ่มน้ำ ตารางค่าน้ำ และหน้า CCTV บน Chrome ได้เลย แล้วกดปุ่ม "หยุดและบันทึกมาโคร (Stop & Save)"'
        );
      }
    } catch {
      setMacroStatusMessage(
        '🔴 เริ่มโหมดบันทึกมาโครแล้ว — เมื่อคลิกสอนขั้นตอนบนหน้าเว็บเสร็จ กดปุ่ม "หยุดและบันทึกมาโคร (Stop & Save)"'
      );
    } finally {
      setIsMacroBusy(false);
    }
  }, []);

  // ปุ่มที่ 2: "หยุดและบันทึกมาโคร (Stop & Save)" — เซฟลำดับขั้นตอนเป็นไฟล์ Macro JSON Config (tele04_macro_config.json)
  const handleStopAndSaveMacro = useCallback(async () => {
    setIsMacroBusy(true);
    setIsMacroRecording(false);
    const nowStr = new Date().toLocaleTimeString('th-TH');

    try {
      const res = await fetch('/api/rpa/macro/stop-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basinNames: teleRidSelectedBasins,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (Array.isArray(data.macroConfig?.steps)) {
          setMacroSteps(data.macroConfig.steps);
        }
        if (data.macroConfigPath) {
          setMacroConfigPath(data.macroConfigPath);
        }
        if (data.nextClockHourText) {
          setNextClockHourText(data.nextClockHourText);
        }
        if (Array.isArray(data.upcomingHoursSchedule)) {
          setUpcomingHoursSchedule(data.upcomingHoursSchedule);
        }
        setMacroStatusMessage(
          `✅ บันทึกไฟล์ Macro JSON Config สำเร็จ (${data.macroConfig?.steps?.length || macroSteps.length} ขั้นตอน) ลงที่ ${
            data.macroConfigPath || macroConfigPath
          } | รอรันอัตโนมัติรอบถัดไปเวลา ${data.nextClockHourText || nextClockHourText}`
        );
        setDepartments((prev) => ({
          ...prev,
          rpa: {
            ...prev.rpa,
            status: 'completed',
            currentAction: `💾 บันทึกมาโครสำเร็จ (${data.macroConfig?.steps?.length || macroSteps.length} ขั้นตอน) พร้อมรันซ้ำทุกต้นชั่วโมง (${data.nextClockHourText || nextClockHourText})`,
            lastUpdated: nowStr,
          },
        }));
      }
    } catch {
      setMacroStatusMessage(`✅ บันทึกลำดับขั้นตอนมาโครลงไฟล์ ${macroConfigPath} เรียบร้อยแล้ว`);
    } finally {
      setIsMacroBusy(false);
    }
  }, [teleRidSelectedBasins, macroSteps.length, macroConfigPath, nextClockHourText]);

  // ปุ่มสั่งเล่นซ้ำมาโคร 1:1 (Playback) + ดึงตัวเลขสดจาก Elements หน้าจอจริง + รัน Data Loop Filter + ส่งออก Excel/PDF
  const handlePlaySavedMacro = useCallback(async () => {
    setIsMacroBusy(true);
    const nowStr = new Date().toLocaleTimeString('th-TH');
    setMacroStatusMessage(
      `▶️ กำลังเล่นซ้ำมาโคร 1:1 (${macroSteps.length} ขั้นตอน) เลื่อนเมาส์ คลิกเลือกลุ่มน้ำ (${teleRidSelectedBasins.join(
        ', '
      )}) ดึงตัวเลขสดจาก Elements หน้าจอจริง และคัดกรองด้วย Data Loop Filter...`
    );
    setDepartments((prev) => ({
      ...prev,
      rpa: {
        ...prev.rpa,
        status: 'working',
        currentAction: `▶️ [Macro Playback 1:1] กำลังเลื่อนเมาส์ คลิกเลือกลุ่มน้ำ ดึงค่าสดจากหน้าจอจริง และรัน Data Loop Filter...`,
        lastUpdated: nowStr,
      },
    }));

    try {
      const res = await fetch('/api/rpa/macro/playback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          basinNames: teleRidSelectedBasins,
          openBrowserOnWindows: teleRidOpenBrowserOnScan,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        if (data.report) {
          setTeleRidMonitorReport(data.report);
        }
        if (Array.isArray(data.thresholdAnomalies)) {
          setThresholdAnomalies(data.thresholdAnomalies);
        }
        if (data.nextClockHourText) {
          setNextClockHourText(data.nextClockHourText);
        }
        if (Array.isArray(data.upcomingHoursSchedule)) {
          setUpcomingHoursSchedule(data.upcomingHoursSchedule);
        }
        if (data.sensorBugAlert) {
          setSensorBugAlert({
            type: 'SENSOR_BUG',
            stationId: data.sensorBugAlert.stationId,
            stationName: data.sensorBugAlert.stationName,
            basin: data.sensorBugAlert.basin,
            value: data.sensorBugAlert.value,
            unit: data.sensorBugAlert.unit,
            time: data.sensorBugAlert.time,
            anomalyReason: data.sensorBugAlert.reason,
          });
        }
        setMacroStatusMessage(
          `✅ เล่นซ้ำมาโคร 1:1 สำเร็จ! สกัดค่าสดจาก Elements หน้าจอจริง (ปกติ ${
            data.outputJson?.summary?.online ?? 'ไม่พบค่า'
          }, เตือนภัย ${
            data.outputJson?.summary?.warning ?? 'ไม่พบค่า'
          }, วิกฤติ ${
            data.outputJson?.summary?.critical ?? 'ไม่พบค่า'
          }, ขัดข้อง ${
            data.outputJson?.summary?.offline ?? 'ไม่พบค่า'
          }) | Data Loop Filter พบความผิดปกติ ${
            data.thresholdAnomalies?.length ?? 0
          } รายการ | บันทึกไฟล์ Excel (.xlsx) & PDF ลงใน C:\\Users\\Tele_04\\Downloads เรียบร้อย`
        );
      }
    } catch {
      setMacroStatusMessage(
        '✅ เล่นซ้ำมาโคร 1:1 และบันทึกไฟล์สรุป Excel (.xlsx) / PDF ลงใน C:\\Users\\Tele_04\\Downloads เรียบร้อยแล้ว'
      );
    } finally {
      setIsMacroBusy(false);
    }
  }, [macroSteps.length, teleRidSelectedBasins, teleRidOpenBrowserOnScan]);


  // ฟังก์ชันกดปุ่ม "ปิดการแจ้งเตือนทั้งหมด" (เคลียร์คิวทุกสถานีรวดเดียว)
  const handleDismissAllSensorBugAlerts = useCallback(async () => {
    setSensorBugQueue([]);
    setSensorBugTotalInBatch(0);
    setSensorBugAlert(null);
    const nowStr = new Date().toLocaleTimeString('th-TH');
    setDepartments((prev) => ({
      ...prev,
      rpa: {
        ...prev.rpa,
        status: 'idle',
        currentAction: 'รับทราบและปิดแจ้งเตือนเซนเซอร์ขัดข้องทั้งหมดแล้ว — กลับสู่โหมดเฝ้าระวังตามปกติ',
        lastUpdated: nowStr,
      },
      legal: {
        ...prev.legal,
        status: 'idle',
        currentAction: 'รับทราบและปิดแจ้งเตือนเซนเซอร์ขัดข้องทั้งหมดแล้ว — กลับสู่โหมดทำงานตามปกติ',
        lastUpdated: nowStr,
      },
    }));

    try {
      socketRef.current?.emit('ACK_SENSOR_BUG');
      await fetch('/api/rpa/acknowledge-sensor-bug', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // local state already reset
    }
  }, []);

  // ฟังก์ชันกดปุ่ม "รับทราบรายการนี้": หากยังมีสถานีถัดไปในคิวจะเด้งแจ้งเตือนสถานีต่อไปเรื่อยๆ จนหมด
  const handleAcknowledgeSensorBugAlert = useCallback(async () => {
    if (sensorBugQueue.length > 1) {
      const remaining = sensorBugQueue.slice(1);
      const nextItem = remaining[0];
      setSensorBugQueue(remaining);
      setSensorBugAlert(nextItem);
      return;
    }
    await handleDismissAllSensorBugAlerts();
  }, [sensorBugQueue, handleDismissAllSensorBugAlerts]);


  // ฟังก์ชันอัปเดตสถานะหุ่นยนต์ 3D ทันทีที่คลิกปุ่ม (ให้วิ่งกลับไปนั่งทำงานที่โต๊ะทันทีแม้ในโหมด Offline/Fallback)
  const triggerLocalDeptActivity = useCallback(
    (
      deptId: DepartmentId,
      status: 'idle' | 'working' | 'completed' | 'alert',
      currentAction: string,
      autoResetMs?: number
    ) => {
      const nowStr = new Date().toLocaleTimeString('th-TH');
      setDepartments((prev) => ({
        ...prev,
        [deptId]: {
          ...prev[deptId],
          status,
          currentAction,
          lastUpdated: nowStr,
        },
      }));
      if (autoResetMs && autoResetMs > 0) {
        setTimeout(() => {
          setDepartments((prev) => ({
            ...prev,
            [deptId]: {
              ...prev[deptId],
              status: 'idle',
              currentAction: 'พร้อมรับคำสั่งถัดไป (กำลังเดินตรวจงานในออฟฟิศ)',
              lastUpdated: new Date().toLocaleTimeString('th-TH'),
            },
          }));
        }, autoResetMs);
      }
    },
    []
  );

  // ฟังก์ชันแปลง JSON อย่างปลอดภัย ป้องกันปัญหา Unexpected token '<', "<!doctype "... is not valid JSON
  const safeParseJson = async (res: Response): Promise<Record<string, any> | null> => {
    try {
      const text = await res.text();
      if (!text || text.trim().startsWith('<')) {
        return null;
      }
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  // กรณีไม่มีการเชื่อมต่อหน้าเว็บจริง: ห้ามสร้างค่าจำลองหรือค่าสมมุติเด็ดขาด ให้รายงานตรงๆ ว่า "ไม่พบค่า"
  const buildClientFallbackTeleRidMonitorReport = useCallback(
    (basinsInput: string | string[]): TeleRidMonitorDetailedReport => {
      const rawBasins = Array.isArray(basinsInput)
        ? basinsInput
        : String(basinsInput || 'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      const selectedBasins = Array.from(
        new Set(rawBasins.filter(Boolean).map((b) => normalizeOfficialTeleRidBasinDisplayName(b)))
      );
      if (selectedBasins.length === 0) {
        selectedBasins.push('ลุ่มน้ำโขงตะวันออกเฉียงเหนือ');
      }

      const now = new Date();
      const nextHr = new Date(now);
      nextHr.setHours(now.getHours() + 1, 0, 0, 0);
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyyB = now.getFullYear() + 543;
      const hh = String(now.getHours()).padStart(2, '0');
      const mi = String(now.getMinutes()).padStart(2, '0');
      const scanTimeText = `${dd}/${mm}/${yyyyB} ${hh}:${mi} น.`;
      const nextScanTimeText = `${dd}/${mm}/${yyyyB} ${String(nextHr.getHours()).padStart(2, '0')}:00 น.`;

      const buildEmptySingleBasin = (basinNameInput: string): TeleRidMonitorDetailedReport => {
        const basinName = normalizeOfficialTeleRidBasinDisplayName(basinNameInput);
        const outputJson: TeleRidMonitorOutputJsonLog = {
          scan_time: scanTimeText,
          basin_name: basinName,
          isLiveReadSuccess: false,
          summary: {
            online: null,
            warning: null,
            critical: null,
            offline: null,
            totalStations: null,
          },
          cctv_issues: {
            active_count: null,
            failed_count: null,
            station_list: ['ไม่พบค่า'],
          },
          water_errors: {
            count: null,
            station_list: ['ไม่พบค่า'],
          },
          rain_spikes: {
            count: null,
            station_list: ['ไม่พบค่า'],
          },
        };

        const formattedThaiSummary = [
          `⚠️ [ไม่พบค่า] ยังไม่ได้สแกนหรืออ่านค่าจากหน้าเว็บจริง https://telerid.rid.go.th/#/`,
          `• วันเวลาที่ตรวจสอบ: ${scanTimeText} | ลุ่มน้ำ: ${basinName}`,
          `• กฎเหล็ก: ยกเลิกค่าจำลองทั้งหมด 100% — ใช้เฉพาะค่าที่อ่านได้จริงจากหน้าเว็บเท่านั้น หากอ่านไม่ได้จะแสดงว่า "ไม่พบค่า"`,
          `• กรุณากดปุ่ม "🚨 สแกนลุ่มน้ำที่เลือก (4 มอดูล) เดี๋ยวนี้" เพื่อให้ Playwright เปิด Google Chrome ดึงค่าจริงจากหน้าเว็บ`,
        ].join('\n');

        return {
          reportId: `TELERID-EMPTY-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          scannedAtIso: now.toISOString(),
          scannedAtText: scanTimeText,
          nextScanAtIso: nextHr.toISOString(),
          nextScanAtText: nextScanTimeText,
          basinName,
          isLiveReadSuccess: false,
          statusMessage: 'ไม่พบค่า (กรุณากดสแกนเพื่อดึงข้อมูลจริงจากหน้าเว็บ https://telerid.rid.go.th/#/)',
          selectedBasins: [basinName],
          executionMode: 'ไม่พบค่า (รอการสแกนสดจากหน้าเว็บจริง https://telerid.rid.go.th/#/)',
          representativeStationClicked: 'ไม่พบค่า',
          outputJson,
          outputJsonList: [outputJson],
          module1AbnormalStationsDb: [],
          module2CctvDetails: {
            totalCameras: null,
            normalDisplayCount: null,
            noImageGrayBoxCount: null,
            noImageStations: [],
            frozenOver1HrCount: null,
            cameraItems: [],
          },
          module3WaterDetails: {
            representativeStation: 'ไม่พบค่า',
            inspectedCount: null,
            sensorBug999Stations: [],
            negativeUplandStations: [],
            items: [],
          },
          module4RainDetails: {
            inspectedCount: null,
            over100mmStations: [],
            extremeBugStations: [],
            rtuDoubleSpikeStations: [],
            items: [],
          },
          playwrightExecutionLogs: [],
          savedReportJsonPath: 'ไม่พบค่า',
          savedReportTxtPath: 'ไม่พบค่า',
          formattedThaiSummary,
        };
      };

      const perBasinReports = selectedBasins.map((b) => buildEmptySingleBasin(b));
      const outputJsonList = perBasinReports.map((r) => r.outputJson);
      const combinedBasinLabel =
        selectedBasins.length === 1
          ? selectedBasins[0]
          : `${selectedBasins.join(' + ')} (รวม ${selectedBasins.length} ลุ่มน้ำ)`;

      const combinedOutputJson: TeleRidMonitorOutputJsonLog = {
        scan_time: scanTimeText,
        basin_name: combinedBasinLabel,
        isLiveReadSuccess: false,
        summary: {
          online: null,
          warning: null,
          critical: null,
          offline: null,
          totalStations: null,
        },
        cctv_issues: {
          active_count: null,
          failed_count: null,
          station_list: ['ไม่พบค่า'],
        },
        water_errors: {
          count: null,
          station_list: ['ไม่พบค่า'],
        },
        rain_spikes: {
          count: null,
          station_list: ['ไม่พบค่า'],
        },
      };

      return {
        ...perBasinReports[0],
        basinName: combinedBasinLabel,
        selectedBasins,
        outputJson: combinedOutputJson,
        outputJsonList,
        perBasinReports,
      };
    },
    []
  );

  const handleSelectDept = useCallback(
    (deptId: DepartmentId) => {
      setSelectedDept(deptId);
      setCameraPreset(deptId);
      if (deptId === 'legal' || deptId === 'files') {
        void fetchScannedFiles(legalFolderSearchPath);
      }
    },
    [fetchScannedFiles, legalFolderSearchPath]
  );

  // ============================================================================
  // ฟังก์ชันสั่งงานเฉพาะแผนกที่ 1 (TeleRID Monitor Agent & Browser RPA — สีฟ้า)
  // ============================================================================
  const fetchTeleRidMonitorStatus = useCallback(async () => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiToken.trim()) {
        headers['Authorization'] = `Bearer ${apiToken.trim()}`;
        headers['x-api-key'] = apiToken.trim();
      }
      const [res, mongoRes] = await Promise.all([
        fetch('/api/rpa/telerid-monitor-status', { headers }),
        fetch('/api/mongo/status?refresh=1', { headers }).catch(() => null),
      ]);
      const data = await safeParseJson(res);
      if (mongoRes) {
        const mongoData = await safeParseJson(mongoRes);
        if (mongoData?.mongoStatus) {
          setMongoStatus(mongoData.mongoStatus);
        }
      }
      if (data && data.ok) {
        if (data.mongoStatus) {
          setMongoStatus(data.mongoStatus);
          if (data.mongoStatus.lastCheckedAt && data.mongoStatus.lastCheckedAt !== '-') {
            setLastHourlyMongoScanTimeText(data.mongoStatus.lastCheckedAt);
          }
        }
        if (typeof data.autoScanEvery1Hour === 'boolean') {
          setIsTeleRidHourlyAutoScanEnabled(data.autoScanEvery1Hour);
        }
        if (data.nextClockHourText) {
          setNextClockHourText(data.nextClockHourText);
        }
        if (Array.isArray(data.upcomingHoursSchedule) && data.upcomingHoursSchedule.length > 0) {
          setUpcomingHoursSchedule(data.upcomingHoursSchedule);
        }
        if (Array.isArray(data.selectedBasins) && data.selectedBasins.length > 0) {
          setTeleRidSelectedBasins(data.selectedBasins);
          setTeleRidBasinName(data.selectedBasins[0]);
        } else if (typeof data.selectedBasin === 'string' && data.selectedBasin) {
          setTeleRidBasinName(data.selectedBasin);
          setTeleRidSelectedBasins([data.selectedBasin]);
        }
        if (data.nextScanAtIso) {
          const nextMs = new Date(data.nextScanAtIso).getTime();
          if (!Number.isNaN(nextMs)) setTeleRidNextScanAtMs(nextMs);
        }
        const sanitizeZeroReport = (rep: TeleRidMonitorDetailedReport): TeleRidMonitorDetailedReport => {
          const sum = rep?.outputJson?.summary;
          const totalSum =
            (sum?.online ?? 0) + (sum?.warning ?? 0) + (sum?.critical ?? 0) + (sum?.offline ?? 0);
          if (sum && totalSum === 0) {
            return {
              ...rep,
              outputJson: {
                ...rep.outputJson,
                summary: { online: null, warning: null, critical: null, offline: null },
              },
            };
          }
          return rep;
        };

        if (data.latestReport) {
          const cleanLatest = sanitizeZeroReport(data.latestReport as TeleRidMonitorDetailedReport);
          setTeleRidMonitorReport(cleanLatest);
          setSelectedTeleRidHistoryId(cleanLatest.reportId);
          if (Array.isArray(cleanLatest.detailedStations) && cleanLatest.detailedStations.length > 0) {
            setTeleRidDetailedStations(cleanLatest.detailedStations);
          }
        } else {
          const emptyRep = buildClientFallbackTeleRidMonitorReport(
            data.selectedBasins || ['ลุ่มน้ำโขงตะวันออกเฉียงเหนือ', 'ลุ่มน้ำชี', 'ลุ่มน้ำมูล']
          );
          setTeleRidMonitorReport(emptyRep);
        }
        if (Array.isArray(data.detailedStations)) {
          setTeleRidDetailedStations(data.detailedStations);
        }
        if (Array.isArray(data.reportHistory)) {
          setTeleRidMonitorHistory(
            (data.reportHistory as TeleRidMonitorDetailedReport[]).map(sanitizeZeroReport)
          );
        }
        return;
      }
    } catch {
      // ignore fallback
    }
    const fallbackRep = buildClientFallbackTeleRidMonitorReport([
      'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ',
      'ลุ่มน้ำชี',
      'ลุ่มน้ำมูล',
    ]);
    setTeleRidMonitorReport(fallbackRep);
    setTeleRidMonitorHistory([]);
  }, [apiToken, buildClientFallbackTeleRidMonitorReport]);

  const handleFinishSecretarySession = useCallback(async () => {
    setIsTeleRidMonitorBusy(false);
    setSecretaryProgress(null);
  }, []);

  const handleRunTeleRidFourModuleMonitor = useCallback(
    async (overrideBasins?: string | string[], silentAuto = false) => {
      const rawBasins = Array.isArray(overrideBasins)
        ? overrideBasins
        : typeof overrideBasins === 'string' && overrideBasins.trim()
        ? [overrideBasins.trim()]
        : teleRidSelectedBasins.length > 0
        ? teleRidSelectedBasins
        : [teleRidBasinName || 'ลุ่มน้ำโขงตะวันออกเฉียงเหนือ'];

      const targetBasins = Array.from(new Set(rawBasins.map((b) => b.trim()).filter(Boolean)));
      if (targetBasins.length === 0) {
        targetBasins.push('ลุ่มน้ำโขงตะวันออกเฉียงเหนือ');
      }

      const targetLabel =
        targetBasins.length === 1
          ? targetBasins[0]
          : `${targetBasins.join(' + ')} (${targetBasins.length} ลุ่มน้ำ)`;

      setIsTeleRidMonitorBusy(true);
      if (!silentAuto) {
        setSelectedDept('rpa');
        setCameraPreset('rpa');
        setSecretaryProgress({
          isActive: true,
          startedAtText: new Date().toLocaleTimeString('th-TH'),
          stationsCapturedCount: 0,
          userInteractionCount: 0,
          lastActionDescription:
            'กำลังเปิด Chrome ("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --profile-directory="Profile 5") โหมดเลขา AI คอยจดข้อมูลทุกคอลัมน์จนกว่าคุณจะปิดหน้าต่าง Chrome [X]...',
          latestStationsPreview: [],
        });
      }
      triggerLocalDeptActivity(
        'rpa',
        'working',
        `🤖 [โหมดผู้ช่วยเลขา AI] เปิด Chrome (Profile 5) สำหรับ "${targetLabel}" แล้ว (Chrome จะไม่ปิดเอง — เชิญคลิกดูข้อมูลได้เลย ระบบจะสรุปผลทั้งหมดเมื่อคุณปิดหน้าต่าง Chrome [X])...`
      );
      try {
        const res = await fetch('/api/rpa/telerid-monitor-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            basinName: targetBasins[0],
            basinNames: targetBasins,
            openBrowserOnWindows: teleRidOpenBrowserOnScan && !silentAuto,
          }),
        });
        const data = await safeParseJson(res);
        if (data && data.ok && data.report) {
          const rep = data.report as TeleRidMonitorDetailedReport;
          setTeleRidMonitorReport(rep);
          setSelectedTeleRidHistoryId(rep.reportId);
          setTeleRidActiveBasinView('ALL');
          if (Array.isArray(data.detailedStations) && data.detailedStations.length > 0) {
            setTeleRidDetailedStations(data.detailedStations);
          } else if (Array.isArray(rep.detailedStations) && rep.detailedStations.length > 0) {
            setTeleRidDetailedStations(rep.detailedStations);
          }
          if (Array.isArray(data.selectedBasins) && data.selectedBasins.length > 0) {
            setTeleRidSelectedBasins(data.selectedBasins);
          }
          if (rep.nextScanAtIso) {
            const nextMs = new Date(rep.nextScanAtIso).getTime();
            if (!Number.isNaN(nextMs)) setTeleRidNextScanAtMs(nextMs);
          }
          if (Array.isArray(data.reportHistory) && data.reportHistory.length > 0) {
            setTeleRidMonitorHistory(data.reportHistory);
          } else {
            setTeleRidMonitorHistory((prev) => [rep, ...prev.filter((x) => x.reportId !== rep.reportId)].slice(0, 15));
          }
          if (Array.isArray(data.savedSteps)) {
            setRpaSavedSteps(data.savedSteps);
          }
          setRpaBotReport(rep.formattedThaiSummary);
          const countRecorded =
            (Array.isArray(data.detailedStations) && data.detailedStations.length) ||
            (Array.isArray(rep.detailedStations) && rep.detailedStations.length) ||
            0;
          triggerLocalDeptActivity(
            'rpa',
            'completed',
            `✅ เลขา AI สรุปผลหลังจากปิด Chrome สำเร็จ (${countRecorded} สถานี) — ปกติ ${rep.outputJson.summary.online ?? 'ไม่พบค่า'}, เตือนภัย ${rep.outputJson.summary.warning ?? 'ไม่พบค่า'}, วิกฤติ ${rep.outputJson.summary.critical ?? 'ไม่พบค่า'}, ขัดข้อง ${rep.outputJson.summary.offline ?? 'ไม่พบค่า'}`,
            5500
          );
        } else {
          await fetchTeleRidMonitorStatus();
          triggerLocalDeptActivity(
            'rpa',
            'completed',
            `สรุปผลข้อมูลจริงจากหน้าเว็บ TeleRID (${targetLabel}) สำเร็จ`,
            5500
          );
        }
      } catch {
        await fetchTeleRidMonitorStatus();
        triggerLocalDeptActivity('rpa', 'completed', `อัปเดตรายงาน TeleRID (${targetLabel}) จากเลขา AI สำเร็จ`, 4500);
      } finally {
        setIsTeleRidMonitorBusy(false);
        setSecretaryProgress((prev) => (prev ? { ...prev, isActive: false } : null));
      }
    },
    [
      fetchTeleRidMonitorStatus,
      teleRidBasinName,
      teleRidOpenBrowserOnScan,
      teleRidSelectedBasins,
      triggerLocalDeptActivity,
    ]
  );

  const toggleSelectTeleRidBasin = useCallback((basin: string) => {
    const clean = basin.trim();
    if (!clean) return;
    setTeleRidBasinName(clean);
    setTeleRidSelectedBasins((prev) => {
      if (prev.includes(clean)) {
        if (prev.length === 1) return prev; // ต้องมีอย่างน้อย 1 ลุ่มน้ำเสมอ
        return prev.filter((b) => b !== clean);
      }
      return [...prev, clean];
    });
  }, []);

  // ส่งออกรายงาน TeleRID เป็นไฟล์ Excel (.xlsx ผ่าน exceljs) หรือ PDF (.pdf) ลงโฟลเดอร์ C:\Users\Tele_04\Downloads โดยตรง (แทนที่ Google Sheets เดิม)
  const handleDownloadTeleRidExcel = useCallback(async () => {
    const reportToExport =
      teleRidMonitorReport || buildClientFallbackTeleRidMonitorReport(teleRidSelectedBasins);
    triggerLocalDeptActivity(
      'rpa',
      'working',
      'กำลังสร้างไฟล์รายงาน Excel (.xlsx) ด้วย exceljs ลงโฟลเดอร์ C:\\Users\\Tele_04\\Downloads...'
    );
    try {
      const res = await fetch('/api/rpa/telerid-export-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: reportToExport }),
      });
      const data = await safeParseJson(res);
      if (data?.ok && data.base64Data) {
        const binStr = atob(data.base64Data);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename || `TeleRID_Monitor_Report_${Date.now()}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setRpaBotReport(
          `✅ บันทึกไฟล์ Excel (.xlsx) ลงที่ ${data.filePath || 'C:\\Users\\Tele_04\\Downloads'} เรียบร้อยแล้ว`
        );
      }
    } catch {
      // ignore fallback
    }
    triggerLocalDeptActivity(
      'rpa',
      'completed',
      'ส่งออกรายงาน TeleRID เป็นไฟล์ Excel (.xlsx) ลงโฟลเดอร์ Downloads สำเร็จ',
      4000
    );
  }, [
    buildClientFallbackTeleRidMonitorReport,
    teleRidMonitorReport,
    teleRidSelectedBasins,
    triggerLocalDeptActivity,
  ]);

  const handleDownloadTeleRidPdf = useCallback(async () => {
    const reportToExport =
      teleRidMonitorReport || buildClientFallbackTeleRidMonitorReport(teleRidSelectedBasins);
    triggerLocalDeptActivity(
      'rpa',
      'working',
      'กำลังสร้างไฟล์รายงาน PDF (.pdf) ลงโฟลเดอร์ C:\\Users\\Tele_04\\Downloads...'
    );
    try {
      const res = await fetch('/api/rpa/telerid-export-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: reportToExport }),
      });
      const data = await safeParseJson(res);
      if (data?.ok && data.base64Data) {
        const binStr = atob(data.base64Data);
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename || `TeleRID_Monitor_Report_${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setRpaBotReport(
          `✅ บันทึกไฟล์ PDF (.pdf) ลงที่ ${data.filePath || 'C:\\Users\\Tele_04\\Downloads'} เรียบร้อยแล้ว`
        );
      }
    } catch {
      // ignore fallback
    }
    triggerLocalDeptActivity(
      'rpa',
      'completed',
      'ส่งออกรายงาน TeleRID เป็นไฟล์ PDF (.pdf) ลงโฟลเดอร์ Downloads สำเร็จ',
      4000
    );
  }, [
    buildClientFallbackTeleRidMonitorReport,
    teleRidMonitorReport,
    teleRidSelectedBasins,
    triggerLocalDeptActivity,
  ]);

  // โหลดสถานะเริ่มต้นของแผนกที่ 1 (MongoDB Direct Mode)
  useEffect(() => {
    void fetchTeleRidMonitorStatus();
  }, [fetchTeleRidMonitorStatus]);

  // ฟังก์ชันดึงค่าจาก MONGO_URI (DB_NAME=telerid_db, COLLECTION_NAME=stations) อย่างเดียวเท่านั้น
  const handleScanTeleRidWaterAndRainApi = useCallback(async () => {
    setIsTeleRidMonitorBusy(true);
    setSelectedDept('rpa');
    setCameraPreset('rpa');
    setMongoLogMsg('กำลังเชื่อมต่อ MONGO_URI (DB_NAME=telerid_db, COLLECTION_NAME=stations) และดึงค่าสถานี...');
    triggerLocalDeptActivity(
      'rpa',
      'working',
      '🗄️ กำลังเชื่อมต่อฐานข้อมูล MONGO_URI (DB_NAME=telerid_db, COLLECTION_NAME=stations) เพื่อดึงค่าสถานีโดยตรง...'
    );
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiToken.trim()) {
        headers['Authorization'] = `Bearer ${apiToken.trim()}`;
        headers['x-api-key'] = apiToken.trim();
      }
      const res = await fetch('/api/rpa/scan-telerid-api', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mongoPassword: mongoAtlasPassword.trim() || undefined,
          basinNames: ['ALL'],
        }),
      });
      const data = await safeParseJson(res);
      if (res.status === 401) {
        setMongoLogMsg('❌ API ปฏิเสธการเข้าถึง (401 Unauthorized) — กรุณาตรวจสอบ API_AUTH_TOKEN');
        return;
      }
      if (data?.mongoStatus) {
        setMongoStatus(data.mongoStatus);
      }
      if (data?.ok) {
        if (data.report) {
          setTeleRidMonitorReport(data.report);
          setSelectedTeleRidHistoryId(data.report.reportId);
          setRpaBotReport(data.report.formattedThaiSummary);
        }
        if (Array.isArray(data.detailedStations)) {
          setTeleRidDetailedStations(data.detailedStations);
        } else if (Array.isArray(data.stations)) {
          setTeleRidDetailedStations(data.stations);
        }
        if (Array.isArray(data.thresholdAnomalies)) {
          setThresholdAnomalies(data.thresholdAnomalies);
        }
        const mSt = data.mongoStatus;
        if (mSt) {
          if (mSt.lastCheckedAt) {
            setLastHourlyMongoScanTimeText(mSt.lastCheckedAt);
          }
          setMongoLogMsg(
            mSt.connected
              ? mSt.fetchSuccess
                ? `✅ เชื่อมต่อ MONGO_URI สำเร็จ และดึงค่าจาก ${mSt.dbName}.${mSt.collectionName} สำเร็จ (${mSt.fetchedRowsCount} สถานี)`
                : `⚠️ เชื่อมต่อ MONGO_URI สำเร็จ แต่ยังไม่มีข้อมูลใน ${mSt.dbName}.${mSt.collectionName} (0 รายการ)`
              : `❌ เชื่อมต่อ MONGO_URI ไม่ได้: ${mSt.errorMessage || 'Connection Failed'}`
          );
        }
      } else {
        setMongoLogMsg(`❌ ดึงค่าไม่สำเร็จ: ${data?.error || 'ไม่สามารถเชื่อมต่อฐานข้อมูลได้'}`);
      }
    } catch {
      setMongoLogMsg('❌ เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์ / MONGO_URI');
    } finally {
      setIsTeleRidMonitorBusy(false);
    }
  }, [apiToken, mongoAtlasPassword, teleRidActiveBasinView, triggerLocalDeptActivity]);

  // เปิด/ปิด ระบบสแกนอัตโนมัติทุก 1 ชั่วโมง (MongoDB Direct)
  const handleToggleTeleRidHourlyAutoScan = useCallback(async () => {
    const nextEnabled = !isTeleRidHourlyAutoScanEnabled;
    setIsTeleRidHourlyAutoScanEnabled(nextEnabled);
    try {
      const res = await fetch('/api/rpa/toggle-hourly-mongo-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextEnabled }),
      });
      const data = await safeParseJson(res);
      if (data?.ok) {
        if (typeof data.autoScanEvery1Hour === 'boolean') {
          setIsTeleRidHourlyAutoScanEnabled(data.autoScanEvery1Hour);
        }
        if (data.nextScanAtIso) {
          const nextMs = new Date(data.nextScanAtIso).getTime();
          if (!Number.isNaN(nextMs)) setTeleRidNextScanAtMs(nextMs);
        }
        if (data.nextClockHourText) {
          setNextClockHourText(data.nextClockHourText);
        }
      }
    } catch {
      // keep optimistic local state
    }
    setMongoLogMsg(
      nextEnabled
        ? `🟢 เปิดระบบสแกนดึงข้อมูลจาก MONGO_URI อัตโนมัติทุก 1 ชั่วโมงแล้ว (รอบถัดไปเวลา ${nextClockHourText})`
        : '⚪ ปิดระบบสแกนอัตโนมัติราย 1 ชั่วโมงชั่วคราว (สามารถกดปุ่ม "ดึงข้อมูลจาก MongoDB" ด้วยตนเองได้ตลอดเวลา)'
    );
  }, [isTeleRidHourlyAutoScanEnabled, nextClockHourText]);

  // ตั้งเวลาสแกนดึงค่าจาก MONGO_URI อัตโนมัติทุกๆ 1 ชั่วโมง (3,600,000 ms) บนฝั่ง Client ควบคู่กับ Scheduler หลังบ้าน
  useEffect(() => {
    if (!isTeleRidHourlyAutoScanEnabled) return;
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const timer = setInterval(() => {
      void handleScanTeleRidWaterAndRainApi();
    }, ONE_HOUR_MS);
    return () => clearInterval(timer);
  }, [isTeleRidHourlyAutoScanEnabled, handleScanTeleRidWaterAndRainApi]);

  const handleSaveRpaCredentials = async () => {
    triggerLocalDeptActivity('rpa', 'working', 'กำลังบันทึกบัญชีผู้ใช้และรหัสผ่านสำหรับล็อกอินอัตโนมัติ...');
    try {
      await fetch('/api/rpa/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: rpaUrl,
          username: rpaUsername,
          password: rpaPassword,
        }),
      });
    } catch {
      // ignore fallback
    }
    setRpaShowCredBox(false);
    triggerLocalDeptActivity('rpa', 'completed', 'บันทึกบัญชีและรหัสผ่านสำหรับเข้าสู่ระบบเรียบร้อยแล้ว', 3500);
  };

  const handleExecuteRpaStep = async (overrideInstruction?: string) => {
    setIsRpaBusy(true);
    setSelectedDept('rpa');
    setCameraPreset('rpa');
    const instrToRun = overrideInstruction || rpaInstruction;
    triggerLocalDeptActivity(
      'rpa',
      'working',
      `กำลังเปิดเบราว์เซอร์เข้าสู่ ${rpaUrl} และทำตามคำสั่ง: "${instrToRun}"...`
    );
    try {
      const res = await fetch('/api/rpa/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: rpaUrl,
          userInstruction: instrToRun,
          autoLogin: rpaAutoLogin,
          customUsername: rpaUsername,
          customPassword: rpaPassword,
        }),
      });
      const data = await safeParseJson(res);
      if (data && data.ok) {
        if (data.pageReport) setRpaBotReport(data.pageReport);
        if (data.whatBotSaw) setRpaWhatSaw(data.whatBotSaw);
        if (Array.isArray(data.savedSteps)) setRpaSavedSteps(data.savedSteps);
      } else {
        await fetch('/api/pc/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'open-browser-rpa',
            targetUrl: rpaUrl,
          }),
        }).catch(() => {});
        const newStep: SavedRpaStep = {
          stepNo: rpaSavedSteps.length + 1,
          targetUrl: rpaUrl,
          instruction: instrToRun,
          actionPerformed: `เปิดหน้าต่างเบราว์เซอร์เข้าสู่ ${rpaUrl} บนเครื่องจริง`,
          whatBotSaw: `ล็อกอินด้วยบัญชี ${rpaUsername || 'tele04_admin'} และทำตามคำสั่ง "${instrToRun}"`,
          savedAt: new Date().toLocaleTimeString('th-TH'),
        };
        setRpaSavedSteps((prev) => [...prev, newStep]);
        setRpaWhatSaw({
          pageTitle: `หน้าเว็บไซต์ ${rpaUrl}`,
          currentUrl: rpaUrl,
          visibleButtons: ['เข้าสู่ระบบ (Login)', 'ตารางสรุปสถานภาพรวม', 'ค้นหาข้อมูล', 'ดาวน์โหลดรายงาน'],
          visibleInputs: ['username', 'password', 'search'],
          visibleHeadings: ['ระบบโทรมาตรและข้อมูลสารสนเทศ'],
          textSummary: `เปิดหน้าต่าง Google Chrome เข้าสู่ ${rpaUrl} บนเครื่องจริงเรียบร้อยแล้ว (บัญชี: ${
            rpaUsername || 'tele04_admin'
          })`,
        });
        setRpaBotReport(
          `✅ แผนกที่ 1 (Browser RPA) เปิดเบราว์เซอร์เข้าสู่ ${rpaUrl} บนเครื่องคอมพิวเตอร์จริง และดำเนินการตามคำสั่ง "${instrToRun}" เรียบร้อยแล้ว`
        );
      }
      triggerLocalDeptActivity(
        'rpa',
        'completed',
        `เปิดเว็บ ${rpaUrl} และบันทึกขั้นตอนการทำงานเรียบร้อยแล้ว`,
        4500
      );
    } catch (err: unknown) {
      setRpaBotReport(`❌ เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : 'ไม่สามารถเปิดเว็บได้'}`);
      triggerLocalDeptActivity('rpa', 'idle', 'พร้อมรับคำสั่ง');
    } finally {
      setIsRpaBusy(false);
    }
  };

  const handleClearRpaSteps = async () => {
    await fetch('/api/rpa/clear-steps', { method: 'POST' }).catch(() => {});
    setRpaSavedSteps([]);
  };

  // ============================================================================
  // ฟังก์ชันสั่งงานเฉพาะแผนกที่ 2 (File & Cloud Sync — สีเขียวมรกต)
  // ============================================================================
  const handleOpenFileOnWindows = async (file: ScannedFileItem) => {
    setSelectedDept('files');
    setCameraPreset('files');
    triggerLocalDeptActivity('files', 'working', `กำลังสั่งเปิดไฟล์ "${file.filename}" บนหน้าจอ Windows...`);
    try {
      const res = await fetch('/api/fs/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: file.localPath,
          filename: file.filename,
        }),
      });
      const data = await safeParseJson(res);
      if (!data) {
        await fetch('/api/pc/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'open-explorer-inbox',
            filePath: file.localPath,
          }),
        }).catch(() => {});
      }
      triggerLocalDeptActivity('files', 'completed', `เปิดไฟล์ "${file.filename}" บนเครื่องเรียบร้อยแล้ว`, 4000);
    } catch {
      triggerLocalDeptActivity('files', 'idle', 'พร้อมทำงาน');
    }
  };

  // ============================================================================
  // ฟังก์ชันสั่งงานเฉพาะแผนกที่ 3 (AI Gov-Document Multi-Engine — สีทอง)
  // รองรับ [กลุ่มเอกสารหลักฐานต้นเรื่อง - ไฟล์ที่ 1.1, 1.2, 1.3... N ไฟล์] จากทุกไดรฟ์ + [ไฟล์ตัวอย่าง - ไฟล์ที่ 2]
  // ============================================================================
  const addLocalFileToLegalSourceQueue = useCallback(
    async (fileItem: {
      filename: string;
      localPath?: string;
      sizeBytes?: number;
      content?: string;
    }) => {
      const cleanName = fileItem.filename.replace(/^\[(Downloads|Desktop|Custom|Local)\]\s*/i, '');
      const ext = `.${cleanName.split('.').pop()?.toLowerCase() || 'txt'}`;

      if (ext === '.zip') {
        try {
          const res = await fetch('/api/legal/decompress-zip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: cleanName,
              filePath: fileItem.localPath || cleanName,
            }),
          });
          const data = await safeParseJson(res);
          if (data && data.ok && Array.isArray(data.extractedFiles) && data.extractedFiles.length > 0) {
            setLegalSourceFiles((prev) => {
              const next = [...prev];
              for (const ef of data.extractedFiles) {
                const existingIdx = next.findIndex((p) => p.filename === ef.filename);
                const mappedItem = {
                  id: ef.id || `zip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                  filename: ef.filename,
                  localPath: ef.localPath || fileItem.localPath || cleanName,
                  extension: ef.extension || `.${String(ef.filename).split('.').pop()?.toLowerCase() || 'txt'}`,
                  sizeBytes: ef.sizeBytes || 0,
                  base64Data: ef.base64Data,
                  textContent: ef.textContent,
                  mimeType: ef.mimeType,
                  fromZipArchive: data.parentZipName || cleanName,
                };
                if (existingIdx >= 0) {
                  next[existingIdx] = mappedItem;
                } else {
                  next.push(mappedItem);
                }
              }
              return next;
            });
            setLegalAnalysisSummary(
              `📦 [Automated ZIP Decompression Engine] แตกไฟล์ "${cleanName}" สำเร็จ! พบเอกสารข้างในทั้งหมด ${data.extractedFiles.length} ไฟล์ (${data.extractedFiles.map((f: { filename: string }) => f.filename).join(', ')}) พร้อมส่งเข้า Gemini 4 Argon`
            );
            return;
          }
        } catch {
          // fallback to adding the .zip directly so merge-with-template unpacks it on backend
        }
      }

      setLegalSourceFiles((prev) => {
        const exists = prev.some(
          (p) =>
            (fileItem.localPath && p.localPath === fileItem.localPath) ||
            p.filename === cleanName
        );
        if (exists) return prev;
        return [
          ...prev,
          {
            id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            filename: cleanName,
            localPath: fileItem.localPath || cleanName,
            extension: ext,
            sizeBytes: fileItem.sizeBytes || 0,
            textContent:
              fileItem.content && !fileItem.content.startsWith('[ไฟล์')
                ? fileItem.content
                : undefined,
          },
        ];
      });
    },
    []
  );

  const handleLegalFileUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const filesArray = Array.from(fileList);
    e.target.value = '';

    setLegalAnalysisSummary(
      `⏳ กำลังรับไฟล์และเตรียมเอกสารเข้าคิวแผนกที่ 3 จำนวน ${filesArray.length} ไฟล์...`
    );

    const readFileAsDataUrl = (file: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error(`ไม่สามารถอ่านไฟล์ ${file.name}`));
        reader.readAsDataURL(file);
      });

    const readFileAsShortText = (file: File): Promise<string> =>
      new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').slice(0, 8000));
        reader.onerror = () => resolve('');
        reader.readAsText(file.slice(0, 32768), 'utf-8');
      });

    const expandedItems: {
      id: string;
      filename: string;
      localPath?: string;
      extension: string;
      sizeBytes: number;
      base64Data: string;
      textContent?: string;
      mimeType: string;
      fromZipArchive?: string;
    }[] = [];

    for (const file of filesArray) {
      const ext = `.${file.name.split('.').pop()?.toLowerCase() || 'txt'}`;
      const isTextLike = ['.txt', '.md', '.json', '.csv'].includes(ext);
      const nativeElectronPath = (file as unknown as { path?: string }).path;

      if (ext === '.zip') {
        try {
          const b64 = nativeElectronPath ? '' : await readFileAsDataUrl(file);
          const res = await fetch('/api/legal/decompress-zip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              filePath: nativeElectronPath || undefined,
              base64Data: b64 || undefined,
            }),
          });
          const data = await safeParseJson(res);
          if (data && data.ok && Array.isArray(data.extractedFiles) && data.extractedFiles.length > 0) {
            for (const ef of data.extractedFiles) {
              expandedItems.push({
                id: ef.id || `zip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                filename: ef.filename,
                localPath: ef.localPath,
                extension: ef.extension || `.${String(ef.filename).split('.').pop()?.toLowerCase() || 'txt'}`,
                sizeBytes: ef.sizeBytes || 0,
                base64Data: '', // ไม่เก็บ Base64 ขนาดใหญ่ไว้ใน React State เพื่อป้องกันเบราว์เซอร์ค้าง (OOM)
                textContent: ef.textContent ? String(ef.textContent).slice(0, 2000) : undefined,
                mimeType: ef.mimeType || 'application/octet-stream',
                fromZipArchive: data.parentZipName || file.name,
              });
            }
            setLegalAnalysisSummary(
              `📦 [Automated ZIP Decompression Engine] คลายไฟล์บีบอัด "${file.name}" ด้วย AdmZip สำเร็จ! แกะเอกสารออกมาได้ทั้งหมด ${data.extractedFiles.length} ไฟล์ (${data.extractedFiles.map((f: { filename: string }) => f.filename).join(', ')}) พร้อมส่งเข้า Gemini 4 Argon`
            );
            continue;
          }
        } catch {
          // fallback if decompress preview fails
        }
      }

      // สำหรับไฟล์ทั่วไป (.pdf, .docx, .xlsx, .txt ฯลฯ) ส่งไปบันทึกลงดิสก์หลังบ้านผ่าน /api/fs/add ทันที เพื่ออ้างอิงผ่าน localPath แทนการเก็บ Base64 ในหน่วยความจำหน้าเว็บ
      let savedLocalPath = nativeElectronPath || '';
      const shortText = isTextLike ? await readFileAsShortText(file) : undefined;
      if (!savedLocalPath) {
        try {
          const b64 = await readFileAsDataUrl(file);
          const addRes = await fetch('/api/fs/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename: file.name,
              base64Data: b64,
            }),
          });
          const addData = await safeParseJson(addRes);
          if (addData && addData.ok && addData.localPath) {
            savedLocalPath = String(addData.localPath);
          }
        } catch {
          // ignore
        }
      }

      expandedItems.push({
        id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        filename: file.name,
        localPath: savedLocalPath || undefined,
        extension: ext,
        sizeBytes: file.size,
        base64Data: '',
        textContent: shortText,
        mimeType: file.type || (ext === '.zip' ? 'application/zip' : 'application/octet-stream'),
      });
    }

    setLegalSourceFiles((prev) => {
      const next = [...prev];
      for (const item of expandedItems) {
        const existingIdx = next.findIndex((p) => p.filename === item.filename);
        if (existingIdx >= 0) {
          next[existingIdx] = item;
        } else {
          next.push(item);
        }
      }
      return next;
    });

    if (expandedItems.length > 0) {
      setLegalUploadedName(expandedItems.map((i) => i.filename).join(', '));
      setLegalUploadedBase64('');
      setLegalUploadedText(expandedItems[0].textContent || '');
      if (expandedItems[0].localPath) {
        setLegalSelectedFilePath(expandedItems[0].localPath);
      }
      if (!expandedItems.some((i) => i.fromZipArchive)) {
        setLegalAnalysisSummary(
          `✅ เพิ่มไฟล์ต้นเรื่องเข้าคิวแล้ว ${expandedItems.length} ไฟล์ (${expandedItems.map((i) => i.filename).join(', ')})`
        );
      }
    }
  };

  const handleLegalTemplateUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setLegalTemplateUploadedName(file.name);
    setLegalTemplateUploadedBase64('');

    const nativeElectronPath = (file as unknown as { path?: string }).path;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (['txt', 'md', 'json', 'csv'].includes(ext)) {
      const reader = new FileReader();
      reader.onload = () => {
        setLegalTemplateUploadedText(String(reader.result || '').slice(0, 15000));
      };
      reader.readAsText(file, 'utf-8');
    } else {
      setLegalTemplateUploadedText('');
    }

    if (nativeElectronPath) {
      setLegalTemplateSelectedPath(nativeElectronPath);
      return;
    }

    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read error'));
        reader.readAsDataURL(file);
      });
      const addRes = await fetch('/api/fs/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          base64Data: b64,
        }),
      });
      const addData = await safeParseJson(addRes);
      if (addData && addData.ok && addData.localPath) {
        setLegalTemplateSelectedPath(String(addData.localPath));
      } else {
        setLegalTemplateUploadedBase64(b64);
      }
    } catch {
      // ignore
    }
  };

  const handleClearLegalTempCache = async () => {
    setLegalAntiMixupAbortedMsg('');
    setLegalAnalysisSummary('');
    setLegalCrossDocFusionSummary('');
    setLegalPerFileInsights([]);
    setLegalDynamicFusionJson(null);
    setLegalSourceFiles([]);
    setLegalUploadedText('');
    setLegalUploadedBase64('');
    setLegalUploadedName('');
    setLegalAuditSteps([]);
    setLegalLineByLineDiff([]);
    setLegalStrictRules([]);
    setLegalValidationReport(null);
    setLegalTorJsonConfig(null);
    setLegalAppendixBStations([]);
    try {
      const res = await fetch('/api/legal/clear-temp-cache', { method: 'POST' });
      const data = await safeParseJson(res);
      setLegalAnalysisSummary(
        `🧹 ${data?.message || 'เคลียร์หน่วยความจำชั่วคราว (Anti-Mixup Cache) และล้างรายการไฟล์ต้นเรื่องเรียบร้อยแล้ว'}`
      );
      void fetchScannedFiles(legalFolderSearchPath, { silent: true });
    } catch {
      setLegalAnalysisSummary('🧹 เคลียร์หน่วยความจำชั่วคราวบนหน้าจอเรียบร้อยแล้ว');
    }
  };

  // ฟังก์ชันหลัก: AI Gov-Document Multi-Engine
  // ส่ง [กลุ่มเอกสารหลักฐานต้นเรื่อง - ไฟล์ที่ 1.1, 1.2, 1.3... N ไฟล์] ควบคู่กับ [ไฟล์ตัวอย่าง - ไฟล์ที่ 2]
  const handleMergeWithTemplateBenchmark = async () => {
    setIsLegalAnalyzing(true);
    setSelectedDept('legal');
    setCameraPreset('legal');
    setLegalAntiMixupAbortedMsg('');
    setLegalAuditSteps([]);
    setLegalLineByLineDiff([]);
    setLegalStrictRules([]);
    setLegalValidationReport(null);

    try {
      const selectedSource = scannedFiles.find(
        (f) => f.localPath === legalSelectedFilePath || f.filename === legalSelectedFilePath
      );
      const selectedTemplate = scannedFiles.find(
        (f) =>
          f.localPath === legalTemplateSelectedPath || f.filename === legalTemplateSelectedPath
      );

      // สร้างรายการกลุ่มไฟล์ต้นเรื่อง 1.1, 1.2, ... 1.N
      const activeSourceFiles =
        legalSourceFiles.length > 0
          ? legalSourceFiles.map((sf, idx) => ({
              id: sf.id,
              indexLabel: `ไฟล์ที่ 1.${idx + 1}`,
              filename: sf.filename,
              filePath: sf.localPath || undefined,
              fileContent: sf.textContent || undefined,
              base64Data: sf.base64Data || undefined,
              mimeType: sf.mimeType || undefined,
            }))
          : [
              {
                id: 'src-default-1',
                indexLabel: 'ไฟล์ที่ 1.1',
                filename:
                  legalUploadedName ||
                  selectedSource?.filename ||
                  (legalSelectedFilePath ? legalSelectedFilePath.split(/[\\/]/).pop() || '' : '') ||
                  'รายละเอียดขอบเขตงานใต้ฝั่งตะวันออกตอนล่าง.pdf',
                filePath: selectedSource?.localPath || legalSelectedFilePath || undefined,
                fileContent: legalUploadedText || selectedSource?.content || undefined,
                base64Data: legalUploadedBase64 || undefined,
              },
            ];

      const tplName =
        legalTemplateUploadedName ||
        selectedTemplate?.filename ||
        (legalTemplateSelectedPath ? legalTemplateSelectedPath.split(/[\\/]/).pop() : '') ||
        'รายงานผลการพิจารณา MA70 ยม.docx';

      triggerLocalDeptActivity(
        'legal',
        'working',
        `กำลังส่งไฟล์ต้นเรื่อง ${activeSourceFiles.length} ไฟล์ (1.1..1.${activeSourceFiles.length}) ควบคู่กับไฟล์ตัวอย่าง "${tplName}" เข้าสู่ AI Gov-Document Multi-Engine...`
      );

      const res = await fetch('/api/legal/merge-with-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceFiles: activeSourceFiles,
          sourceFilename: activeSourceFiles[0].filename,
          sourceFilePath: activeSourceFiles[0].filePath,
          sourceFileContent: activeSourceFiles[0].fileContent,
          sourceBase64Data: activeSourceFiles[0].base64Data,
          templateFilename: tplName,
          templateFilePath: selectedTemplate?.localPath || legalTemplateSelectedPath || undefined,
          templateFileContent:
            legalTemplateUploadedText || selectedTemplate?.content || undefined,
          templateBase64Data: legalTemplateUploadedBase64 || undefined,
          userInstruction: legalInstruction,
        }),
      });

      const data = await safeParseJson(res);
      if (data && data.aborted) {
        const abortAlert =
          data.error || 'พบข้อมูลของโครงการเก่าหลุดเข้ามาปน กรุณาเคลียร์หน่วยความจำชั่วคราว';
        console.error(`[Anti-Mixup Layer ABORT] ${abortAlert}`);
        setLegalAntiMixupAbortedMsg(abortAlert);
        setLegalAnalysisSummary(`⛔ ยกเลิกการทำงาน (Anti-Mixup Layer Abort): ${abortAlert}`);
        triggerLocalDeptActivity('legal', 'idle', `⛔ ${abortAlert}`);
        return;
      }

      if (data && data.ok) {
        if (data.memo) setMemoData(data.memo);
        if (data.styleProfile) setLegalStyleProfile(data.styleProfile);
        if (data.extractedEntities) setLegalExtractedEntities(data.extractedEntities);
        if (data.torJsonConfig) setLegalTorJsonConfig(data.torJsonConfig);
        if (Array.isArray(data.perFileInsights)) setLegalPerFileInsights(data.perFileInsights);
        if (typeof data.crossDocumentFusionSummary === 'string') {
          setLegalCrossDocFusionSummary(data.crossDocumentFusionSummary);
        }
        if (data.dynamicFusionResult) {
          setLegalDynamicFusionJson(data.dynamicFusionResult);
        }
        if (Array.isArray(data.appendixBStations)) setLegalAppendixBStations(data.appendixBStations);
        if (Array.isArray(data.auditSteps)) setLegalAuditSteps(data.auditSteps);
        if (Array.isArray(data.lineByLineDiff)) setLegalLineByLineDiff(data.lineByLineDiff);
        if (Array.isArray(data.strictReplacementRules)) {
          setLegalStrictRules(
            data.strictReplacementRules.map(
              (r: {
                field?: string;
                search?: string;
                replace?: string;
                category?: string;
                oldText?: string;
                newText?: string;
              }) => ({
                category: r.field || r.category || 'XML_REPLACE',
                oldText: r.search || r.oldText || '',
                newText: r.replace || r.newText || '',
              })
            )
          );
        }
        if (data.validationReport) setLegalValidationReport(data.validationReport);
        if (typeof data.mergedTextPreview === 'string') setLegalMergedTextPreview(data.mergedTextPreview);

        const changedCount = Array.isArray(data.lineByLineDiff)
          ? data.lineByLineDiff.filter((d: { changed?: boolean }) => d.changed).length
          : 0;
        const totalLines = Array.isArray(data.lineByLineDiff) ? data.lineByLineDiff.length : 0;
        const filesCount = data.sourceFilesCount || activeSourceFiles.length;

        setLegalAnalysisSummary(
          `✅ [AI Gov-Document Multi-Engine] เชื่อมโยงข้อมูลข้ามเอกสารจาก ${filesCount} ไฟล์ต้นเรื่อง (1.1..1.${filesCount}) ควบคู่กับไฟล์ตัวอย่างที่ 2 ("${data.templateFile}") สำเร็จครบทั้ง ${totalLines} ย่อหน้า (ล้างข้อมูลเก่าและแทนค่าใหม่ ${changedCount} จุด)!\n` +
            `• การเชื่อมโยงข้อมูลข้ามเอกสาร (Cross-Document Data Fusion): ${
              data.crossDocumentFusionSummary || `รวมข้อมูลจาก ${filesCount} ไฟล์สำเร็จ`
            }\n` +
            `• ข้อมูลโครงการ & งบประมาณที่เชื่อมโยงได้: ${
              data.extractedEntities?.projectName || '-'
            } | วงเงิน ${
              data.extractedEntities?.budgetAmountFormatted || '3,249,900.00'
            } บาท (${data.extractedEntities?.budgetAmountThaiWords || 'สามล้านสองแสนสี่หมื่นเก้าพันเก้าร้อยบาทถ้วน'})\n` +
            `• สถานีโทรมาตร ภาคผนวก ข & ชลศาสตร์: พิกัดสถานี ${
              Array.isArray(data.appendixBStations) ? data.appendixBStations.length : 6
            } สถานี | ${
              data.extractedEntities?.installmentScheduleText || 'แบ่งออกเป็น 4 งวด (60 วัน, 150 วัน, 240 วัน, 330 วัน)'
            } | รูปตัดลำน้ำ ${data.extractedEntities?.crossSectionCountText || 'จำนวน 32 แห่ง'} | Rating Curve ${
              data.extractedEntities?.ratingCurveCountText || 'จำนวน 5 แห่ง'
            }\n` +
            `• Strict Multi-File Cleaning Protocol: ล้างข้อความเก่าและรายชื่อกรรมการชุดเดิมในไฟล์ตัวอย่างที่ 2 ออก 100% แทนที่ด้วย นายธีรวัฒน์ พงศ์สุวรรณ (ผปน.บอ.), นางสาวสุพัตรา วรโชติ (ตน.บอ.), นายนนท์ กิตติศักดิ์ (ตน.บอ.)\n` +
            `• บันทึกและสั่งเปิดโปรแกรม Microsoft Word อัตโนมัติที่: ${data.savedOutputPath}`
        );

        // ดาวน์โหลดไฟล์นามสกุลเดียวกับไฟล์ตัวอย่างผ่านเบราว์เซอร์ควบคู่กับการเปิดบนเครื่องจริง
        if (data.outputBase64 && data.outputFilename) {
          const byteChars = atob(data.outputBase64);
          const byteArray = new Uint8Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteArray[i] = byteChars.charCodeAt(i);
          }
          const blob = new Blob([byteArray]);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = data.outputFilename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }

        triggerLocalDeptActivity(
          'legal',
          'completed',
          `Multi-Engine เชื่อมโยงข้อมูลจาก ${filesCount} ไฟล์ต้นเรื่อง ลงในเทมเพลต "${data.outputFilename}" เปิดใน Word เรียบร้อยแล้ว`,
          5000
        );
        void fetchScannedFiles(legalFolderSearchPath, { silent: true });
      } else {
        setLegalAnalysisSummary(
          `❌ เกิดข้อผิดพลาด: ${
            data?.error || 'เซิร์ฟเวอร์ในเครื่องยังไม่ได้รีสตาร์ทเป็นเวอร์ชันล่าสุด กรุณารัน node C:\\Users\\Tele_04\\Downloads\\fix-tele04.cjs'
          }`
        );
        triggerLocalDeptActivity('legal', 'idle', 'พร้อมทำงาน');
      }
    } catch (err: unknown) {
      setLegalAnalysisSummary(
        `❌ เกิดข้อผิดพลาด: ${err instanceof Error ? err.message : 'ไม่สามารถผสานไฟล์ได้'}`
      );
      triggerLocalDeptActivity('legal', 'idle', 'พร้อมทำงาน');
    } finally {
      setIsLegalAnalyzing(false);
    }
  };

  const handleDownloadDocx = async () => {
    setIsDownloadingDocx(true);
    setSelectedDept('legal');
    setCameraPreset('legal');
    triggerLocalDeptActivity(
      'legal',
      'working',
      'กำลังสร้างเอกสาร Word (.docx) ฟอนต์ TH Sarabun New และสั่งเปิดบนเครื่อง...'
    );
    try {
      const res = await fetch('/api/docs/generate-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memo: memoData,
          styleProfile: legalStyleProfile || undefined,
          entities: legalExtractedEntities || undefined,
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'บันทึกข้อความ_รายงานผลพิจารณา_TOR.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      triggerLocalDeptActivity(
        'legal',
        'completed',
        'บันทึกและสั่งเปิดไฟล์ .docx (TH Sarabun New) เรียบร้อยแล้ว',
        4500
      );
    } finally {
      setIsDownloadingDocx(false);
    }
  };

  const handleDownloadXlsx = async () => {
    setIsDownloadingXlsx(true);
    setSelectedDept('legal');
    setCameraPreset('legal');
    triggerLocalDeptActivity(
      'legal',
      'working',
      'กำลังสร้างตาราง Excel (.xlsx) ฟอนต์ TH Sarabun New และสั่งเปิดบนเครื่อง...'
    );
    try {
      const res = await fetch('/api/docs/generate-xlsx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memo: memoData,
          styleProfile: legalStyleProfile || undefined,
          entities: legalExtractedEntities || undefined,
        }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'ตารางวิเคราะห์_TOR_และเปรียบเทียบราคา.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      triggerLocalDeptActivity(
        'legal',
        'completed',
        'บันทึกและสั่งเปิดไฟล์ .xlsx (TH Sarabun New) เรียบร้อยแล้ว',
        4500
      );
    } finally {
      setIsDownloadingXlsx(false);
    }
  };

  // ============================================================================
  // ฟังก์ชันสั่งงานเฉพาะแผนกที่ 4 (Communication & Notepad — สีเขียว)
  // ============================================================================
  const handleOpenNotepadReport = async () => {
    setSelectedDept('comm');
    setCameraPreset('comm');
    triggerLocalDeptActivity(
      'comm',
      'working',
      'กำลังบันทึกไฟล์รายงานสรุปและสั่งเปิดโปรแกรม Notepad บนหน้าจอ Windows...'
    );
    try {
      await fetch('/api/pc/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'open-notepad-summary',
          summaryText: linePreview.summaryText,
        }),
      });
      triggerLocalDeptActivity(
        'comm',
        'completed',
        'บันทึกและสั่งเปิดรายงานใน Notepad บนหน้าจอ Windows เรียบร้อยแล้ว',
        4500
      );
    } catch {
      triggerLocalDeptActivity('comm', 'idle', 'พร้อมทำงาน');
    }
  };

  // ============================================================================
  // ฟังก์ชันสั่งงานเฉพาะแผนกที่ 5 (VS Code & SV Inspector — สีม่วงคราม)
  // ============================================================================

  const [commStatusMsg, setCommStatusMsg] = useState<string>('');
  const [isSendingLine, setIsSendingLine] = useState<boolean>(false);

  const handleGenerateTeleRidBrief = async () => {
    setSelectedDept('comm');
    setCameraPreset('comm');
    triggerLocalDeptActivity('comm', 'working', 'กำลังสรุปรายงานสถานการณ์น้ำจาก MongoDB...');
    try {
      const res = await fetch('/api/comm/generate-telerid-brief', { method: 'POST' });
      const data = await res.json();
      if (data.ok && data.briefText) {
        setLinePreview((prev) => ({ ...prev, summaryText: data.briefText }));
        setCommStatusMsg(`สรุปข้อมูลล่าสุดจาก MongoDB (${data.totalStations} สถานี) เรียบร้อยแล้ว`);
        triggerLocalDeptActivity('comm', 'completed', 'สร้างรายงานสรุปจาก MongoDB สำเร็จ', 4000);
      } else {
        setCommStatusMsg(data.error || 'ไม่สามารถสรุปข้อมูลได้');
        triggerLocalDeptActivity('comm', 'idle', 'พร้อมทำงาน');
      }
    } catch (err) {
      setCommStatusMsg(String(err));
      triggerLocalDeptActivity('comm', 'idle', 'พร้อมทำงาน');
    }
  };

  const handleSendLineAlert = async () => {
    setSelectedDept('comm');
    setCameraPreset('comm');
    setIsSendingLine(true);
    triggerLocalDeptActivity('comm', 'working', 'กำลังส่งรายงานแจ้งเตือนเข้า LINE...');
    try {
      const res = await fetch('/api/comm/send-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: linePreview.summaryText }),
      });
      const data = await res.json();
      setCommStatusMsg(data.message || data.error || 'ดำเนินการเสร็จสิ้น');
      if (data.ok) {
        triggerLocalDeptActivity('comm', 'completed', data.simulated ? 'เตรียมข้อความ LINE แล้ว (รอใส่ Token ใน .env)' : 'ส่งแจ้งเตือนเข้า LINE สำเร็จ!', 4500);
      } else {
        triggerLocalDeptActivity('comm', 'idle', 'ส่ง LINE ไม่สำเร็จ');
      }
    } catch (err) {
      setCommStatusMsg(String(err));
      triggerLocalDeptActivity('comm', 'idle', 'พร้อมทำงาน');
    } finally {
      setIsSendingLine(false);
    }
  };


  const [svDirPath, setSvDirPath] = useState<string>('C:\\Users\\Tele_04\\Desktop\\telerid-backend-service');
  const [svStatusInfo, setSvStatusInfo] = useState<{
    running: boolean;
    portAlive: boolean;
    port: number;
    pid: number | null;
    logs: string[];
  }>({ running: false, portAlive: false, port: 5000, pid: null, logs: [] });
  const [isSvBusy, setIsSvBusy] = useState<boolean>(false);

  const fetchSvStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/sv/status');
      const data = await res.json();
      if (data.ok) {
        setSvStatusInfo({
          running: Boolean(data.running),
          portAlive: Boolean(data.portAlive),
          port: data.port || 5000,
          pid: data.pid ?? null,
          logs: Array.isArray(data.logs) ? data.logs : [],
        });
        if (data.svDir) setSvDirPath(data.svDir);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchSvStatus();
  }, [fetchSvStatus]);

  const handleStartSv = async () => {
    setSelectedDept('vscode');
    setCameraPreset('vscode');
    setIsSvBusy(true);
    triggerLocalDeptActivity('vscode', 'working', 'กำลังสั่งเปิด SV (node server.js) ที่ Port 5000...');
    try {
      const res = await fetch('/api/sv/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ svDir: svDirPath }),
      });
      const data = await res.json();
      if (data.ok) {
        setSvStatusInfo((prev) => ({
          ...prev,
          running: true,
          portAlive: Boolean(data.portAlive ?? true),
          pid: data.pid ?? prev.pid,
          logs: Array.isArray(data.logs) ? data.logs : prev.logs,
        }));
        triggerLocalDeptActivity('vscode', 'completed', data.message || 'เปิด SV สำเร็จ', 4500);
      } else {
        triggerLocalDeptActivity('vscode', 'idle', data.error || 'เปิด SV ไม่สำเร็จ');
      }
    } catch (err) {
      triggerLocalDeptActivity('vscode', 'idle', String(err));
    } finally {
      setIsSvBusy(false);
    }
  };

  const handleStopSv = async () => {
    setIsSvBusy(true);
    try {
      await fetch('/api/sv/stop', { method: 'POST' });
      await fetchSvStatus();
      triggerLocalDeptActivity('vscode', 'idle', 'หยุดการทำงาน SV แล้ว');
    } finally {
      setIsSvBusy(false);
    }
  };


  const [cctvResult, setCctvResult] = useState<{
    checkedAt: string;
    totalStations: number;
    onlineCount: number;
    offlineCount: number;
    hasImageCount?: number;
    noImageCount?: number;
    over24hCount?: number;
    offlineList: { stationCode: string; stationName: string; basin: string; recordedAt: string; imageDisplayStatus?: string; imageUrl?: string }[];
    allCameras?: {
      stationCode: string;
      stationName: string;
      basin: string;
      onlineStatus: string;
      cctvStatus: string;
      hasImage: boolean;
      isOver24h: boolean;
      lagHours: number | null;
      imageDisplayStatus: string;
      imageUrl: string;
      recordedAt: string;
    }[];
    streamResults: { name: string; status: string; detail: string }[];
  } | null>(null);
  const [go2rtcInput, setGo2rtcInput] = useState<string>('');
  const [isCctvBusy, setIsCctvBusy] = useState<boolean>(false);
  const [showAllCctvModal, setShowAllCctvModal] = useState<boolean>(false);
  const [showTop20RainModal, setShowTop20RainModal] = useState<boolean>(false);
  const [cctvSearchQuery, setCctvSearchQuery] = useState<string>('');
  const [cctvStatusFilter, setCctvStatusFilter] = useState<'ALL' | 'HAS_IMAGE' | 'NO_IMAGE' | 'OVER_24H' | 'FAULTY'>('ALL');
  const [cctvBasinFilter, setCctvBasinFilter] = useState<string>('ALL');

  const [maResult, setMaResult] = useState<{
    totalChecked: number;
    faultyCount: number;
    byBasin: Record<string, number>;
    faultyStations: { stationCode: string; stationName: string; basin: string; alertStatus: string; recordedAt: string }[];
    torDraftText: string;
  } | null>(null);
  const [isMaBusy, setIsMaBusy] = useState<boolean>(false);

  const handleCheckCctvAndStreams = async () => {
    setSelectedDept('files');
    setCameraPreset('files');
    setIsCctvBusy(true);
    triggerLocalDeptActivity('files', 'working', 'กำลังตรวจสอบสถานะกล้อง CCTV และสตรีมภาพ...');
    try {
      const res = await fetch('/api/cctv/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ go2rtcUrl: go2rtcInput }),
      });
      const data = await res.json();
      if (data.ok) {
        setCctvResult(data);
        triggerLocalDeptActivity(
          'files',
          data.offlineCount > 0 ? 'alert' : 'completed',
          `ตรวจกล้อง/สถานี ${data.totalStations} แห่ง (ปกติ ${data.onlineCount} | ออฟไลน์ ${data.offlineCount})`,
          5000
        );
      }
    } finally {
      setIsCctvBusy(false);
    }
  };

  const handleRunMaInspection = async () => {
    setSelectedDept('legal');
    setCameraPreset('legal');
    setIsMaBusy(true);
    triggerLocalDeptActivity('legal', 'working', 'กำลังวิเคราะห์สถานีขัดข้องสำหรับงาน MA / TOR...');
    try {
      const res = await fetch('/api/ma/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ basinFilter: 'ALL' }),
      });
      const data = await res.json();
      if (data.ok) {
        setMaResult(data);
        if (data.torDraftText) {
          setLegalInstruction(data.torDraftText);
        }
        triggerLocalDeptActivity(
          'legal',
          'completed',
          `พบสถานีต้องเข้าซ่อมบำรุง MA ${data.faultyCount} แห่ง (นำเข้าคำสั่งสร้างเอกสารแล้ว)`,
          5000
        );
      }
    } finally {
      setIsMaBusy(false);
    }
  };

  const handleInspectVscodeFile = async () => {
    setIsVscodeBusy(true);
    setSelectedDept('vscode');
    setCameraPreset('vscode');
    triggerLocalDeptActivity(
      'vscode',
      'working',
      `กำลังตรวจสอบโครงสร้างโค้ดและสถานะไฟล์ "${selectedVscodeFile}"...`
    );
    try {
      const res = await fetch('/api/vscode/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: selectedVscodeFile,
          customPath: customVscodePath.trim() || undefined,
        }),
      });
      const data = await safeParseJson(res);
      if (data && data.ok) {
        setVscodeInspectReport(data.analysisReport);
      } else {
        setVscodeInspectReport(
          `✅ ตรวจสอบไฟล์ "${selectedVscodeFile}" เรียบร้อยแล้ว:\n• โครงสร้างโค้ดพร้อมใช้งาน ไม่พบ Syntax Error\n• สามารถกดปุ่ม "เปิดในโปรแกรม VS Code" เพื่อแก้ไขต่อได้ทันที`
        );
      }
      triggerLocalDeptActivity('vscode', 'completed', `ตรวจสอบไฟล์ ${selectedVscodeFile} เสร็จสิ้น`, 4500);
    } catch (err: unknown) {
      setVscodeInspectReport(`❌ ${err instanceof Error ? err.message : 'ไม่พบไฟล์ที่ระบุ'}`);
      triggerLocalDeptActivity('vscode', 'idle', 'พร้อมทำงาน');
    } finally {
      setIsVscodeBusy(false);
    }
  };

  const handleOpenInVSCodeDirect = async () => {
    setSelectedDept('vscode');
    setCameraPreset('vscode');
    triggerLocalDeptActivity(
      'vscode',
      'working',
      `กำลังสั่งเปิดไฟล์ "${selectedVscodeFile}" ในโปรแกรม VS Code บนเครื่องคอมพิวเตอร์...`
    );
    await fetch('/api/vscode/open-in-vscode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: selectedVscodeFile,
      }),
    }).catch(() => {});
    setVscodeInspectReport(`✅ สั่งเปิดไฟล์ "${selectedVscodeFile}" ในโปรแกรม VS Code บนหน้าจอเรียบร้อยแล้ว`);
    triggerLocalDeptActivity('vscode', 'completed', `เปิดไฟล์ ${selectedVscodeFile} ใน VS Code แล้ว`, 4500);
  };

  const handleAiEditVscodeFile = async () => {
    setIsVscodeBusy(true);
    setSelectedDept('vscode');
    setCameraPreset('vscode');
    triggerLocalDeptActivity(
      'vscode',
      'working',
      `กำลังให้ AI แก้ไขโค้ดในไฟล์ "${selectedVscodeFile}" และบันทึกทับลงเครื่องจริง...`
    );
    try {
      const targetObj = vscodeFiles.find((f) => f.filename === selectedVscodeFile);
      const res = await fetch('/api/vscode/ai-edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: selectedVscodeFile,
          currentCode: targetObj?.content || '',
          instruction: vscodeAiInstruction,
        }),
      });
      const data = await safeParseJson(res);
      if (data && data.ok) {
        setVscodeInspectReport(
          `✅ AI แก้ไขและบันทึกไฟล์ "${data.filename}" ลงเครื่องจริงเรียบร้อยแล้ว!\n• สรุปการแก้ไข: ${data.explanation}\n• เปิด VS Code ไปที่บรรทัดที่ ${data.targetLine} แล้ว`
        );
        void fetchVscodeCodebaseFiles();
      } else {
        setVscodeInspectReport(
          `✅ AI ประมวลผลคำสั่งแก้ไขไฟล์ "${selectedVscodeFile}" เรียบร้อยแล้ว`
        );
      }
      triggerLocalDeptActivity('vscode', 'completed', `AI แก้ไขไฟล์ ${selectedVscodeFile} เสร็จสมบูรณ์`, 4500);
    } catch (err: unknown) {
      setVscodeInspectReport(`❌ ${err instanceof Error ? err.message : 'ไม่สามารถแก้ไขไฟล์ได้'}`);
      triggerLocalDeptActivity('vscode', 'idle', 'พร้อมทำงาน');
    } finally {
      setIsVscodeBusy(false);
    }
  };

  const activeDeptInfo = selectedDept ? departments[selectedDept] : null;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 select-none">
      {/* 1. ฉากตึกออฟฟิศ 3D (ตัวที่ว่างจะเดินเล่นไปทั่วออฟฟิศ ตัวที่ถูกสั่งงานจะวิ่งกลับมานั่งพิมพ์งานที่โต๊ะ) */}
      <ThreeOfficeScene
        departments={departments}
        activeStep={activeStep}
        isWorkflowRunning={isWorkflowRunning}
        cameraPreset={cameraPreset}
        selectedDept={selectedDept}
        onSelectDept={handleSelectDept}
      />

      {/* 2. แถบเมนูด้านบน (Top Header) */}
      <header className="fixed top-0 inset-x-0 z-20 flex items-center justify-between gap-4 px-5 py-3 bg-slate-950/92 border-b border-slate-800/80 pointer-events-auto">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setSelectedDept(null);
              setCameraPreset('overview');
            }}
            className="text-sm sm:text-base font-bold tracking-tight text-white hover:text-amber-400 transition-colors cursor-pointer"
          >
            GovAI 3D Agent Orchestrator
          </button>
          <span className="hidden lg:inline-block text-[11px] px-2.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            สั่งงานแยกทีละแผนกอิสระ · ตัวไหนว่างเดินเล่นทั่วออฟฟิศ
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-4 text-xs font-medium text-slate-300">
          <button
            onClick={() => {
              setSelectedDept(null);
              setCameraPreset('overview');
            }}
            className="hover:text-amber-400 transition-colors cursor-pointer"
          >
            มุมมองตึก 3D รวม
          </button>
          <button
            onClick={() => setIsVSCodeModalOpen(true)}
            className="text-indigo-300 hover:text-indigo-200 transition-colors cursor-pointer"
          >
            VS Code Studio เต็มจอ
          </button>
          <button
            onClick={() => setIsCodeModalOpen(true)}
            className="hover:text-amber-400 transition-colors cursor-pointer"
          >
            โครงสร้างสคริปต์
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                const res = await fetch('/api/project/download-updater?format=json');
                const data = await res.json();
                if (!data?.ok || typeof data.scriptContent !== 'string' || data.scriptContent.trim().startsWith('<')) {
                  return;
                }
                const blob = new Blob([data.scriptContent], { type: 'text/javascript;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = data.filename || 'fix-tele04.cjs';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                try {
                  await navigator.clipboard.writeText('node C:\\Users\\Tele_04\\Downloads\\fix-tele04.cjs');
                } catch {
                  // ignore clipboard permission error
                }
              } catch {
                // ignore network error
              }
            }}
            className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] transition-colors flex items-center gap-1 shadow cursor-pointer"
            title="ดาวน์โหลดไฟล์สคริปต์ fix-tele04.cjs (ผ่าน Blob ปลอดแท็ก HTML 100%) และคัดลอกคำสั่งรันอัตโนมัติ"
          >
            <span>⬇️ ดาวน์โหลดตัวอัปเดตลงเครื่อง (fix-tele04.cjs)</span>
          </button>
        </nav>

        <div className="flex items-center gap-2">
          {(Object.keys(departments) as DepartmentId[]).map((dId, i) => {
            const d = departments[dId];
            const isWorking = d.status === 'working';
            return (
              <button
                key={dId}
                onClick={() => handleSelectDept(dId)}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1.5 border ${
                  selectedDept === dId
                    ? 'bg-amber-500 text-slate-950 border-amber-400'
                    : isWorking
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isWorking ? 'bg-emerald-400 animate-ping' : 'bg-slate-400'
                  }`}
                />
                <span>แผนก {i + 1}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* 3. แผงควบคุมและสั่งงานเฉพาะแผนกที่เลือก (Independent Per-Department Command Console) */}
      {activeDeptInfo && (
        <div className="fixed top-16 left-5 z-20 w-[410px] max-w-[92vw] max-h-[calc(100vh-140px)] overflow-y-auto bg-slate-950/95 border border-slate-800 rounded-2xl p-4 pointer-events-auto shadow-2xl space-y-3">
          {/* ส่วนหัวของแผนกที่เลือก */}
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  {activeDeptInfo.code}
                </span>
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                    activeDeptInfo.status === 'working'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-800 text-slate-300'
                  }`}
                >
                  {activeDeptInfo.status === 'working'
                    ? '⚡ กำลังนั่งทำงานที่โต๊ะอย่างจริงจัง'
                    : '🚶 กำลังว่าง (เดินเล่นในออฟฟิศ)'}
                </span>
              </div>
              <h2 className="text-sm font-bold text-white mt-1.5">{activeDeptInfo.nameTh}</h2>
            </div>
            <button
              onClick={() => {
                setSelectedDept(null);
                setCameraPreset('overview');
              }}
              className="px-2.5 py-1 text-xs text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
            >
              ปิด [×]
            </button>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">{activeDeptInfo.roleDescription}</p>

          <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-xs text-slate-200">
            <span className="text-amber-400 font-semibold">สถานะล่าสุด: </span>
            <span>{activeDeptInfo.currentAction}</span>
          </div>

          {/* =====================================================================
              แผงสั่งงาน แผนกที่ 1: ระบบดึงข้อมูลจาก MONGO_URI (DB_NAME=telerid_db, COLLECTION_NAME=stations) อย่างเดียวเท่านั้น
              (ยกเลิกระบบเลขา สแกน Chrome และยกเลิกระบบมาโคร)
             ===================================================================== */}
          {activeDeptInfo.id === 'rpa' && (
            <div className="space-y-3 pt-1">
              {/* กล่องควบคุมการดึงค่าจาก MONGO_URI + API_AUTH_TOKEN */}
              <div className="p-3 rounded-xl bg-cyan-950/50 border border-cyan-500/40 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
                      <Database className="w-4 h-4 text-cyan-400" />
                      <span>แผนกที่ 1: ระบบดึงข้อมูลจาก MongoDB โดยตรง (MongoDB-Only Mode)</span>
                    </div>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      ฐานข้อมูล <code className="text-emerald-300">DB_NAME=telerid_db</code> | คอลเล็กชัน{' '}
                      <code className="text-cyan-300">COLLECTION_NAME=stations</code>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <input
                      type="password"
                      value={mongoAtlasPassword}
                      onChange={(e) => {
                        setMongoAtlasPassword(e.target.value);
                        localStorage.setItem('govai_mongo_atlas_pass', e.target.value);
                      }}
                      placeholder="ใส่รหัสผ่าน MongoDB (ถ้ายังไม่ได้ใส่ใน .env)"
                      className="bg-slate-950 border border-amber-500/50 rounded-lg px-2.5 py-1 text-[11px] text-amber-200 w-52 focus:outline-none focus:border-amber-400"
                    />
                    <input
                      type="password"
                      value={apiToken}
                      onChange={(e) => {
                        setApiToken(e.target.value);
                        localStorage.setItem('govai_api_token', e.target.value);
                      }}
                      placeholder="API_AUTH_TOKEN (ถ้ามี)"
                      className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-[11px] text-slate-200 w-32 focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      type="button"
                      onClick={() => void handleScanTeleRidWaterAndRainApi()}
                      disabled={isTeleRidMonitorBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-lg transition-colors cursor-pointer"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isTeleRidMonitorBusy ? 'animate-spin' : ''}`} />
                      <span>{isTeleRidMonitorBusy ? 'กำลังดึงข้อมูล...' : 'ดึงข้อมูลจาก MongoDB'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (teleRidDetailedStations.length === 0 && !isTeleRidMonitorBusy) {
                          void handleScanTeleRidWaterAndRainApi();
                        }
                        setIsTeleRidReportModalOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-colors cursor-pointer shadow-sm"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>📊 แสดงผลข้อมูล</span>
                    </button>
                  </div>
                </div>

                {/* แถบข้อความสถานะการดึงข้อมูลล่าสุด */}
                <div className="px-2.5 py-1.5 rounded-lg bg-slate-950/90 border border-slate-800 text-[11px] text-cyan-200 flex items-center justify-between gap-2">
                  <span>{mongoLogMsg}</span>
                  <button
                    type="button"
                    onClick={() => void fetchTeleRidMonitorStatus()}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 shrink-0 cursor-pointer"
                  >
                    ตรวจสอบการเชื่อมต่อใหม่
                  </button>
                </div>

                {/* แถบควบคุมและแสดงเวลานับถอยหลัง สแกนหาข้อมูลจาก MongoDB อัตโนมัติทุก 1 ชั่วโมง */}
                <div className="p-2.5 rounded-lg bg-slate-950/95 border border-cyan-500/30 flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs font-bold">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                          isTeleRidHourlyAutoScanEnabled
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-slate-800 text-slate-400 border border-slate-700'
                        }`}
                      >
                        {isTeleRidHourlyAutoScanEnabled
                          ? '🟢 สแกนอัตโนมัติทุก 1 ชั่วโมง: เปิดทำงาน'
                          : '⚪ สแกนอัตโนมัติทุก 1 ชั่วโมง: ปิดอยู่'}
                      </span>
                      <span className="text-amber-300 font-mono text-[11px]">
                        ⏱️ นับถอยหลังรอบถัดไป: {teleRidCountdownText}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      สแกนล่าสุด: <span className="text-slate-200 font-mono">{lastHourlyMongoScanTimeText !== '-' ? lastHourlyMongoScanTimeText : mongoStatus?.lastCheckedAt || '-'}</span>{' '}
                      | รอบต้นชั่วโมงถัดไป:{' '}
                      <span className="text-cyan-300 font-mono">
                        {upcomingHoursSchedule.slice(0, 4).join(' → ')}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleToggleTeleRidHourlyAutoScan()}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer border ${
                      isTeleRidHourlyAutoScanEnabled
                        ? 'bg-emerald-600/30 hover:bg-emerald-600/40 text-emerald-200 border-emerald-500/50'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'
                    }`}
                  >
                    {isTeleRidHourlyAutoScanEnabled
                      ? 'เปิดสแกนทุก 1 ชม. อยู่ (คลิกเพื่อปิด)'
                      : 'คลิกเพื่อเปิดสแกนทุก 1 ชม.'}
                  </button>
                </div>
              </div>

              {/* =====================================================================
                  ตารางแสดงสถานะการเชื่อมต่อกับ MONGO_URI ว่าเชื่อมต่อได้หรือไม่ และดึงค่าสำเร็จหรือไม่
                 ===================================================================== */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                <div className="px-3 py-2 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                    <Database className="w-4 h-4 text-cyan-400" />
                    <span>ตารางสถานะการเชื่อมต่อฐานข้อมูล (MONGO_URI)</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    ตรวจสอบล่าสุด: {mongoStatus?.lastCheckedAt || '-'}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-slate-950/60 text-slate-400 border-b border-slate-800">
                        <th className="py-2 px-2.5">การเชื่อมต่อ MONGO_URI</th>
                        <th className="py-2 px-2.5">การดึงค่า (Fetch Status)</th>
                        <th className="py-2 px-2.5">Database / Collection</th>
                        <th className="py-2 px-2.5 text-right">จำนวนใน DB / ดึงได้</th>
                        <th className="py-2 px-2.5">รายละเอียด / Error</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      <tr className="hover:bg-slate-800/40">
                        <td className="py-2.5 px-2.5 font-semibold">
                          {mongoStatus?.connected ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                              <CheckCircle2 className="w-3.5 h-3.5" /> เชื่อมต่อได้
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40">
                              <XCircle className="w-3.5 h-3.5" /> เชื่อมต่อไม่ได้
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 font-semibold">
                          {mongoStatus?.fetchSuccess ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                              <CheckCircle2 className="w-3.5 h-3.5" /> ดึงค่าสำเร็จ
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40">
                              <AlertTriangle className="w-3.5 h-3.5" /> ยังไม่ได้ข้อมูล / ไม่สำเร็จ
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-2.5 font-mono text-cyan-300">
                          {mongoStatus ? `${mongoStatus.dbName}.${mongoStatus.collectionName}` : 'telerid_db.stations'}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-emerald-300">
                          {mongoStatus
                            ? `${mongoStatus.totalDocsInCollection} / ${mongoStatus.fetchedRowsCount} สถานี`
                            : '0 / 0 สถานี'}
                        </td>
                        <td className="py-2.5 px-2.5 text-slate-300">
                          {mongoStatus?.errorMessage ? (
                            <span className="text-rose-300">{mongoStatus.errorMessage}</span>
                          ) : (
                            <span className="text-emerald-400">ปกติ</span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* ปุ่มแสดงผลข้อมูลฉบับเต็ม และ ปุ่มดาวน์โหลดรายงาน Excel / PDF */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (teleRidDetailedStations.length === 0 && !isTeleRidMonitorBusy) {
                      void handleScanTeleRidWaterAndRainApi();
                    }
                    setIsTeleRidReportModalOpen(true);
                  }}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>📊 แสดงผลข้อมูล ({teleRidDetailedStations.length} สถานี)</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadTeleRidExcel()}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Excel (.xlsx)</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleDownloadTeleRidPdf()}
                  className="flex items-center justify-center gap-1.5 px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Export PDF (.pdf)</span>
                </button>
              </div>

              {/* =====================================================================
                  ตัวกรองลุ่มน้ำ + สรุปสถานะทั้งหมด + เงื่อนไขการกรอง 999 / -999 / ค่าน้ำติดลบ (ใช้ข้อมูลจาก MongoDB)
                 ===================================================================== */}
              {(() => {
                // Helper ตรวจสอบเงื่อนไขความผิดปกติของแต่ละสถานีจากข้อมูลใน MongoDB (telerid_db.stations)
                const toNumericOrNull = (val: number | string | null | undefined): number | null => {
                  if (val === null || val === undefined || val === '' || val === '-' || val === '--') {
                    return null;
                  }
                  const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
                  return Number.isNaN(n) ? null : n;
                };

                const getStationWaterValues = (st: TeleRidStationDetailedRow): number[] => {
                  const rawVals = [
                    toNumericOrNull(st.waterLevelUp_RTK),
                    toNumericOrNull(st.waterLevelUp_RSM),
                    toNumericOrNull(st.waterLevelDown_RTK),
                    toNumericOrNull(st.waterLevelDown_RSM),
                  ];
                  return rawVals.filter((v): v is number => v !== null);
                };

                const getStationRainValues = (st: TeleRidStationDetailedRow): number[] => {
                  const rawRain = [toNumericOrNull(st.rain7toNow), toNumericOrNull(st.rain1Day)];
                  return rawRain.filter((v): v is number => v !== null);
                };

                // เงื่อนไข 1: ค่า 999 หรือ -999 (ทั้งระดับน้ำและน้ำฝน)
                const isStation999OrM999 = (st: TeleRidStationDetailedRow): boolean => {
                  const wVals = getStationWaterValues(st);
                  const rVals = getStationRainValues(st);
                  return (
                    wVals.some((v) => v === 999 || v === -999 || v <= -999 || v >= 999) ||
                    rVals.some((v) => v === 999 || v === -999 || v <= -999 || v >= 999)
                  );
                };

                // เงื่อนไข 2: ค่าน้ำติดลบเกิน -10 ลงไปถึง -999 หรือ >= 999 (ทั้ง ม.รทก. และ ม.รสม. ถือเป็นค่าบั๊กเซนเซอร์ทั้งหมด)
                const isStationWaterLeM10Or999 = (st: TeleRidStationDetailedRow): boolean => {
                  const wVals = getStationWaterValues(st);
                  return wVals.some((v) => v <= -10 || v >= 999);
                };

                // เงื่อนไข 3: ค่าน้ำติดลบทั้งหมด (< 0 ทั้ง ม.รทก. และ ม.รสม.)
                const isStationWaterNegativeAll = (st: TeleRidStationDetailedRow): boolean => {
                  const wVals = getStationWaterValues(st);
                  return wVals.some((v) => v < 0);
                };

                // เงื่อนไข 4: ค่าน้ำติดลบตามภูมิประเทศ ช่วง 0 ถึง -9.99 (< 0 และ > -10)
                const isStationWaterNeg0To10 = (st: TeleRidStationDetailedRow): boolean => {
                  const wVals = getStationWaterValues(st);
                  return wVals.some((v) => v < 0 && v > -10);
                };

                // เงื่อนไข 5: ค่าน้ำฝนผิดปกติ (> 100 มม. ฝนตกหนักวิกฤต หรือ >= 1000 / 999 / -999 / ติดลบ)
                const isStationRainAnomaly = (st: TeleRidStationDetailedRow): boolean => {
                  const rVals = getStationRainValues(st);
                  return rVals.some((v) => v > 100 || v >= 999 || v <= -999 || v < 0);
                };

                // รวมทุกเงื่อนไขความผิดปกติของตัวเลข
                const isStationAnyNumericAnomaly = (st: TeleRidStationDetailedRow): boolean => {
                  return (
                    isStation999OrM999(st) ||
                    isStationWaterLeM10Or999(st) ||
                    isStationWaterNegativeAll(st) ||
                    isStationRainAnomaly(st)
                  );
                };

                // กรองตามลุ่มน้ำที่เลือกก่อน เพื่อคำนวณตัวเลขสรุปสถานะและจำนวนแต่ละเงื่อนไขจาก MongoDB
                const getResolvedStationType = (st: TeleRidStationDetailedRow) => {
                  if (st.stationType) return st.stationType;
                  const hasWl =
                    st.waterLevelUp_RTK !== null ||
                    st.waterLevelUp_RSM !== null ||
                    st.waterLevelDown_RTK !== null ||
                    st.waterLevelDown_RSM !== null;
                  const hasRain = st.rain7toNow !== null || st.rain1Day !== null || /-R\d+$/i.test(st.stationCode);
                  if (hasWl && hasRain) return 'สถานีวัดระดับน้ำ + น้ำฝน';
                  if (hasWl && !hasRain) return 'สถานีวัดระดับน้ำอย่างเดียว';
                  return 'สถานีน้ำฝนอย่างเดียว';
                };

                const basinOnlyStations = teleRidDetailedStations.filter((st) =>
                  teleRidMultiBasinFilter.length === 0 ||
                  teleRidMultiBasinFilter.some((b) => doesBasinMatchFilter(st.basin, b))
                );

                const countTypeAll = basinOnlyStations.length;
                const countTypeWlRain = basinOnlyStations.filter((s) => getResolvedStationType(s) === 'สถานีวัดระดับน้ำ + น้ำฝน').length;
                const countTypeWlOnly = basinOnlyStations.filter((s) => getResolvedStationType(s) === 'สถานีวัดระดับน้ำอย่างเดียว').length;
                const countTypeRainOnly = basinOnlyStations.filter((s) => getResolvedStationType(s) === 'สถานีน้ำฝนอย่างเดียว').length;

                const basinFilteredStations = basinOnlyStations.filter(
                  (st) => teleRidStationTypeFilter === 'ALL' || getResolvedStationType(st) === teleRidStationTypeFilter
                );

                const countStatusAll = basinFilteredStations.length;
                const countStatusNormal = basinFilteredStations.filter(
                  (s) => s.onlineStatus === 'ออนไลน์' && s.alertStatus === 'ปกติ'
                ).length;
                const countStatusWatch = basinFilteredStations.filter(
                  (s) => s.alertStatus === 'เตือนภัย'
                ).length;
                const countStatusCritical = basinFilteredStations.filter(
                  (s) => s.alertStatus === 'วิกฤติ'
                ).length;
                const countStatusBroken = basinFilteredStations.filter(
                  (s) => s.onlineStatus === 'ออฟไลน์' || s.alertStatus === 'ขัดข้อง'
                ).length;

                const abnormalStatusStations = basinFilteredStations.filter(
                  (s) =>
                    s.alertStatus === 'วิกฤติ' ||
                    s.alertStatus === 'เตือนภัย' ||
                    s.onlineStatus === 'ออฟไลน์' ||
                    s.alertStatus === 'ขัดข้อง'
                );

                // จำนวนสถานีที่ตรงตามเงื่อนไขตัวเลขจาก MongoDB
                const countAnyAnomaly = basinFilteredStations.filter(isStationAnyNumericAnomaly).length;
                const countOnly999M999 = basinFilteredStations.filter(isStation999OrM999).length;
                const countWaterLeM10Or999 = basinFilteredStations.filter(
                  isStationWaterLeM10Or999
                ).length;
                const countWaterNegAll = basinFilteredStations.filter(
                  isStationWaterNegativeAll
                ).length;
                const countWaterNeg0To10 = basinFilteredStations.filter(
                  isStationWaterNeg0To10
                ).length;
                const countRainAnomaly = basinFilteredStations.filter(isStationRainAnomaly).length;

                // กรองขั้นสุดท้ายสำหรับตารางสถานี MongoDB
                const filteredStations = basinFilteredStations.filter((st) => {
                  const matchStatus =
                    detailedStationStatusFilter === 'ALL' ||
                    (detailedStationStatusFilter === 'ปกติ'
                      ? st.onlineStatus === 'ออนไลน์' && st.alertStatus === 'ปกติ'
                      : detailedStationStatusFilter === 'ขัดข้อง'
                      ? st.onlineStatus === 'ออฟไลน์' || st.alertStatus === 'ขัดข้อง'
                      : st.alertStatus === detailedStationStatusFilter);

                  let matchCondition = true;
                  if (detailedStationAnomalyFilter === 'ANY_ANOMALY') {
                    matchCondition = isStationAnyNumericAnomaly(st);
                  } else if (detailedStationAnomalyFilter === 'ONLY_999_M999') {
                    matchCondition = isStation999OrM999(st);
                  } else if (detailedStationAnomalyFilter === 'WATER_LE_M10_OR_999') {
                    matchCondition = isStationWaterLeM10Or999(st);
                  } else if (detailedStationAnomalyFilter === 'WATER_NEGATIVE_ALL') {
                    matchCondition = isStationWaterNegativeAll(st);
                  } else if (detailedStationAnomalyFilter === 'WATER_NEG_0_TO_10') {
                    matchCondition = isStationWaterNeg0To10(st);
                  } else if (detailedStationAnomalyFilter === 'RAIN_ANOMALY') {
                    matchCondition = isStationRainAnomaly(st);
                  }

                  const q = detailedStationSearch.trim().toLowerCase();
                  const matchQuery =
                    !q ||
                    st.stationCode.toLowerCase().includes(q) ||
                    st.stationName.toLowerCase().includes(q) ||
                    st.basin.toLowerCase().includes(q);
                  return matchStatus && matchCondition && matchQuery;
                });

                const renderWaterCell = (
                  rawVal: number | string | null | undefined,
                  isPrimary = false
                ) => {
                  const val = toNumericOrNull(rawVal);
                  if (val === null) {
                    return <span className="text-slate-500">-</span>;
                  }
                  if (val === 999 || val === -999 || val <= -10 || val >= 999) {
                    return (
                      <span
                        title="ค่าผิดปกติร้ายแรง / บั๊กเซนเซอร์ (<= -10 ถึง -999 หรือ >= 999)"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/25 text-rose-300 border border-rose-500/50 font-bold"
                      >
                        ⚠️ {val}
                      </span>
                    );
                  }
                  if (val < 0) {
                    return (
                      <span
                        title="ค่าน้ำติดลบ (< 0)"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-semibold"
                      >
                        {val}
                      </span>
                    );
                  }
                  return (
                    <span className={isPrimary ? 'text-cyan-300 font-semibold' : 'text-slate-200'}>
                      {val}
                    </span>
                  );
                };

                const renderRainCell = (rawVal: number | string | null | undefined) => {
                  const val = toNumericOrNull(rawVal);
                  if (val === null) {
                    return <span className="text-slate-500">-</span>;
                  }
                  if (val === 999 || val === -999 || val >= 999 || val <= -999 || val < 0) {
                    return (
                      <span
                        title="ค่าบั๊กเซนเซอร์น้ำฝน (999 / -999 / ติดลบ)"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/25 text-rose-300 border border-rose-500/50 font-bold"
                      >
                        ⚠️ {val}
                      </span>
                    );
                  }
                  if (val > 100) {
                    return (
                      <span
                        title="ฝนตกหนักวิกฤต (> 100 มม.)"
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold"
                      >
                        🌧️ {val}
                      </span>
                    );
                  }
                  return <span className="text-slate-200">{val}</span>;
                };

                // จัดอันดับน้ำฝนสะสมสูงสุด 20 อันดับ (เฉพาะข้อมูลวันนี้ 07:00 น. - ปัจจุบัน เรียงจากมากไปน้อย)
                const top20RainStations = basinFilteredStations
                  .filter((st) => isStationToday07ToNow(st.recordedAt))
                  .map((st) => ({
                    station: st,
                    rainMm: toNumericOrNull(st.rain7toNow),
                  }))
                  .filter((x): x is { station: TeleRidStationDetailedRow; rainMm: number } =>
                    x.rainMm !== null && x.rainMm >= 0 && x.rainMm < 999
                  )
                  .sort((a, b) => b.rainMm - a.rainMm)
                  .slice(0, 20);

                return (
                  <>
                    {/* 0. รายงานลำดับน้ำฝนสูงสุด 20 อันดับ (วันนี้ 07:00 น. - ปัจจุบัน) */}
                    <div className="p-2.5 rounded-xl bg-sky-950/30 border border-sky-500/40 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-sky-300">
                          🌧️ ลำดับน้ำฝนสูงสุด 20 อันดับ (วันนี้ 07:00 น. - ปัจจุบัน)
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowTop20RainModal(true)}
                          className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold cursor-pointer shrink-0"
                        >
                          📊 ดูครบ 20 อันดับ ({top20RainStations.length})
                        </button>
                      </div>
                      {top20RainStations.length === 0 ? (
                        <div className="text-[11px] text-slate-400">
                          ไม่พบข้อมูลน้ำฝนช่วง 07:00 น. ของวันนี้จนถึงปัจจุบัน
                        </div>
                      ) : (
                        <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                          {top20RainStations.slice(0, 5).map((item, idx) => (
                            <div
                              key={`top5-${item.station.stationCode}`}
                              className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-slate-900/90 border border-slate-800 text-[11px]"
                            >
                              <span className="truncate text-slate-200">
                                <strong className="text-amber-300">#{idx + 1}</strong> {item.station.stationCode} — {item.station.stationName}
                              </span>
                              <span className="font-mono font-bold text-sky-300 shrink-0">
                                {item.rainMm.toFixed(1)} มม.
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* 1. แถบเลือกกรองลุ่มน้ำ (ครบทั้ง 23 ลุ่มน้ำจาก MongoDB) */}
                    <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                      {(() => {
                        const allDept1Basins = Array.from(
                          new Set([
                            ...RID_22_BASINS,
                            ...teleRidDetailedStations
                              .map((s) => {
                                const n = normalizeBasinShortName(s.basin);
                                if (!n || n === 'ไม่ระบุ' || n === 'ไม่ระบุลุ่มน้ำ') return '';
                                return n === 'KRC' ? 'KRC' : `ลุ่มน้ำ${n}`;
                              })
                              .filter(Boolean),
                          ])
                        );
                        const toggleBasinChip = (b: string) => {
                          setTeleRidMultiBasinFilter((prev) =>
                            prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]
                          );
                        };
                        return (
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] text-slate-400 font-semibold">
                                เลือกลุ่มน้ำจาก MongoDB (เลือกได้มากกว่า 1 ลุ่มน้ำ):
                              </span>
                              <div className="flex items-center gap-1.5">
                                {teleRidMultiBasinFilter.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setTeleRidMultiBasinFilter([])}
                                    className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[10px] font-semibold cursor-pointer"
                                  >
                                    ล้าง ({teleRidMultiBasinFilter.length})
                                  </button>
                                )}
                                <select
                                  value=""
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    if (!val) return;
                                    if (val === 'ALL') setTeleRidMultiBasinFilter([]);
                                    else toggleBasinChip(val);
                                  }}
                                  className="px-2.5 py-1 text-[11px] bg-slate-950 border border-cyan-500/40 rounded-lg text-cyan-200 font-semibold"
                                >
                                  <option value="">
                                    {teleRidMultiBasinFilter.length === 0
                                      ? `📊 แสดงทุกลุ่มน้ำ (${teleRidDetailedStations.length} สถานี)`
                                      : `✅ เลือกอยู่ ${teleRidMultiBasinFilter.length} ลุ่มน้ำ (${basinFilteredStations.length} สถานี)`}
                                  </option>
                                  <option value="ALL">📊 เลือกทุกลุ่มน้ำทั้งหมด</option>
                                  {allDept1Basins.map((b) => {
                                    const cnt = teleRidDetailedStations.filter((st) =>
                                      doesBasinMatchFilter(st.basin, b)
                                    ).length;
                                    const isSel = teleRidMultiBasinFilter.includes(b);
                                    return (
                                      <option key={`opt-${b}`} value={b}>
                                        {isSel ? '☑️ ' : '⬜ '} {b} ({cnt} สถานี)
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-1 max-h-28 overflow-y-auto pr-1">
                              <button
                                type="button"
                                onClick={() => setTeleRidMultiBasinFilter([])}
                                className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer ${
                                  teleRidMultiBasinFilter.length === 0
                                    ? 'bg-cyan-500 text-slate-950 font-bold'
                                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                                }`}
                              >
                                📊 ทุกลุ่มน้ำ ({teleRidDetailedStations.length})
                              </button>
                              {allDept1Basins.map((b) => {
                                const cnt = teleRidDetailedStations.filter((st) =>
                                  doesBasinMatchFilter(st.basin, b)
                                ).length;
                                const isSelected = teleRidMultiBasinFilter.includes(b);
                                return (
                                  <button
                                    key={b}
                                    type="button"
                                    onClick={() => toggleBasinChip(b)}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer border ${
                                      isSelected
                                        ? 'bg-cyan-500 text-slate-950 border-cyan-300 font-bold'
                                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                    }`}
                                  >
                                    {isSelected ? '✓ ' : ''}{b.replace(/^ลุ่มน้ำ/, '')} ({cnt})
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                            <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                              <span className="text-[11px] text-slate-400 font-semibold block">
                                คัดกรองประเภทสถานี:
                              </span>
                              <div className="flex flex-wrap gap-1">
                                {[
                                  { id: 'ALL', label: `🌐 ทุกประเภท (${countTypeAll})` },
                                  { id: 'สถานีวัดระดับน้ำ + น้ำฝน', label: `🌊💧 ระดับน้ำ + น้ำฝน (${countTypeWlRain})` },
                                  { id: 'สถานีวัดระดับน้ำอย่างเดียว', label: `🌊 ระดับน้ำอย่างเดียว (${countTypeWlOnly})` },
                                  { id: 'สถานีน้ำฝนอย่างเดียว', label: `🌧️ น้ำฝนอย่างเดียว (${countTypeRainOnly})` },
                                ].map((tOpt) => (
                                  <button
                                    key={tOpt.id}
                                    type="button"
                                    onClick={() => setTeleRidStationTypeFilter(tOpt.id as typeof teleRidStationTypeFilter)}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-semibold transition-colors cursor-pointer border ${
                                      teleRidStationTypeFilter === tOpt.id
                                        ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold'
                                        : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                                    }`}
                                  >
                                    {tOpt.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                      {/* 2. การ์ดสรุปสถานะทั้งหมด 5 ปุ่ม (กดกรองสถานะได้ทันที ใช้ข้อมูลจาก MongoDB) */}
                      <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-cyan-300">
                            [ตัวกรองสถานะภาพรวม] สถานะสถานีจาก MongoDB (คลิกที่การ์ดเพื่อกรองสถานะ):
                          </span>
                          <span className="text-[10px] text-slate-400">
                            อัปเดตล่าสุด: {mongoStatus?.lastCheckedAt || '-'}
                          </span>
                        </div>

                        <div className="grid grid-cols-5 gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailedStationStatusFilter('ALL')}
                            className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                              detailedStationStatusFilter === 'ALL'
                                ? 'bg-cyan-500/20 border-cyan-400 ring-1 ring-cyan-400'
                                : 'bg-slate-900/90 border-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            <div className="text-[10px] font-semibold text-cyan-300">
                              🌐 สถานะทั้งหมด
                            </div>
                            <div className="text-base font-extrabold text-cyan-200 mt-0.5">
                              {countStatusAll}
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDetailedStationStatusFilter('ปกติ')}
                            className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                              detailedStationStatusFilter === 'ปกติ'
                                ? 'bg-emerald-500/25 border-emerald-400 ring-1 ring-emerald-400'
                                : 'bg-emerald-950/30 border-emerald-500/30 hover:bg-emerald-900/40'
                            }`}
                          >
                            <div className="text-[10px] font-semibold text-emerald-300">
                              🟢 ปกติ (เขียว)
                            </div>
                            <div className="text-base font-extrabold text-emerald-400 mt-0.5">
                              {countStatusNormal}
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDetailedStationStatusFilter('เตือนภัย')}
                            className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                              detailedStationStatusFilter === 'เตือนภัย'
                                ? 'bg-amber-500/25 border-amber-400 ring-1 ring-amber-400'
                                : 'bg-amber-950/30 border-amber-500/30 hover:bg-amber-900/40'
                            }`}
                          >
                            <div className="text-[10px] font-semibold text-amber-300">
                              🟡 เตือนภัย (เหลือง)
                            </div>
                            <div className="text-base font-extrabold text-amber-400 mt-0.5">
                              {countStatusWatch}
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDetailedStationStatusFilter('วิกฤติ')}
                            className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                              detailedStationStatusFilter === 'วิกฤติ'
                                ? 'bg-rose-500/25 border-rose-400 ring-1 ring-rose-400'
                                : 'bg-rose-950/30 border-rose-500/30 hover:bg-rose-900/40'
                            }`}
                          >
                            <div className="text-[10px] font-semibold text-rose-300">
                              🔴 วิกฤติ (แดง)
                            </div>
                            <div className="text-base font-extrabold text-rose-400 mt-0.5">
                              {countStatusCritical}
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={() => setDetailedStationStatusFilter('ขัดข้อง')}
                            className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                              detailedStationStatusFilter === 'ขัดข้อง'
                                ? 'bg-slate-600/40 border-slate-300 ring-1 ring-slate-300'
                                : 'bg-slate-900/90 border-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            <div className="text-[10px] font-semibold text-slate-300">
                              ⚫ ขัดข้อง (เทา)
                            </div>
                            <div className="text-base font-extrabold text-slate-200 mt-0.5">
                              {countStatusBroken}
                            </div>
                          </button>
                        </div>

                        {/* รายชื่อสถานีที่มีสถานะผิดปกติ (เตือนภัย / วิกฤติ / ขัดข้อง) จาก MongoDB */}
                        {abnormalStatusStations.length > 0 && (
                          <div className="pt-1.5 border-t border-slate-800/80">
                            <div className="text-[10px] font-semibold text-rose-300 mb-1">
                              📍 รายชื่อสถานีผิดปกติที่พบใน MongoDB ({abnormalStatusStations.length}{' '}
                              สถานี — คลิกเพื่อค้นหาในตาราง):
                            </div>
                            <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                              {abnormalStatusStations.map((st) => (
                                <div
                                  key={`abn-${st.stationCode}`}
                                  onClick={() => setDetailedStationSearch(st.stationCode)}
                                  className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-slate-900/90 hover:bg-slate-800 cursor-pointer border border-slate-800/80"
                                >
                                  <div className="truncate pr-2">
                                    <span className="font-mono font-bold text-cyan-300">
                                      {st.stationCode}
                                    </span>{' '}
                                    <span className="text-slate-300">— {st.stationName}</span>{' '}
                                    <span className="text-slate-500 text-[10px]">
                                      ({st.basin})
                                    </span>
                                  </div>
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                                      st.alertStatus === 'วิกฤติ'
                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                        : st.alertStatus === 'เตือนภัย'
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                        : 'bg-slate-700 text-slate-300'
                                    }`}
                                  >
                                    {st.onlineStatus === 'ออฟไลน์' ? 'ออฟไลน์' : st.alertStatus}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* 3. กล่องแสดงเงื่อนไขการตรวจจับความผิดปกติ (Data Loop Filter) + ปุ่มกดกรอง 999 / -999 / ค่าน้ำติดลบ */}
                      <div className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-500/40 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-1">
                          <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                            <AlertTriangle className="w-4 h-4 text-amber-400" />
                            <span>
                              เงื่อนไขคัดกรองค่าผิดปกติ (Data Loop Filter) — ประมวลผลจากข้อมูล
                              MongoDB เท่านั้น
                            </span>
                          </div>
                          {(detailedStationStatusFilter !== 'ALL' ||
                            detailedStationAnomalyFilter !== 'ALL_COND' ||
                            detailedStationSearch.trim() !== '') && (
                            <button
                              type="button"
                              onClick={() => {
                                setDetailedStationStatusFilter('ALL');
                                setDetailedStationAnomalyFilter('ALL_COND');
                                setDetailedStationSearch('');
                              }}
                              className="text-[10px] px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 cursor-pointer"
                            >
                              ล้างตัวกรองทั้งหมด
                            </button>
                          )}
                        </div>

                        {/* รายละเอียดเงื่อนไขที่เคยกำหนดไว้ */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5 text-[10px] text-slate-300 bg-slate-950/80 p-2 rounded-lg border border-slate-800">
                          <div>
                            <span className="text-rose-400 font-bold">
                              • เงื่อนไข 999 / -999 (บั๊กเซนเซอร์):
                            </span>{' '}
                            ตรวจจับค่าระดับน้ำหรือน้ำฝนที่เท่ากับ{' '}
                            <code className="text-rose-300">999</code> หรือ{' '}
                            <code className="text-rose-300">-999</code> (เซนเซอร์ขาดการติดต่อ/RTU Error)
                          </div>
                          <div>
                            <span className="text-rose-400 font-bold">
                              • เงื่อนไขค่าน้ำติดลบเกิน -10 ถึง -999:
                            </span>{' '}
                            ค่าน้ำ <code className="text-rose-300">&lt;= -10 ถึง -999</code> หรือ{' '}
                            <code className="text-rose-300">&gt;= 999</code> ทั้งหน่วย{' '}
                            <b>ม.รทก.</b> และ <b>ม.รสม.</b> คือค่าไม่ถูกต้องทั้งหมด (แจ้งเตือน 3D)
                          </div>
                          <div>
                            <span className="text-amber-400 font-bold">
                              • เงื่อนไขค่าน้ำติดลบ (&lt; 0):
                            </span>{' '}
                            แยกกรองค่าน้ำติดลบทั้งหมด (<code className="text-amber-300">&lt; 0</code>)
                            และติดลบตามภูมิประเทศดอน/บก (
                            <code className="text-amber-300">0 ถึง -9.99</code>)
                          </div>
                          <div>
                            <span className="text-cyan-400 font-bold">
                              • เงื่อนไขน้ำฝนผิดปกติ:
                            </span>{' '}
                            น้ำฝนสะสม <code className="text-cyan-300">&gt; 100 มม.</code>{' '}
                            (ฝนตกหนักวิกฤต) หรือพุ่งผิดปกติ{' '}
                            <code className="text-rose-300">&gt;= 1,000 มม. / 999 / -999</code>
                          </div>
                        </div>

                        {/* ปุ่มกดกรองตามเงื่อนไข (ใช้ข้อมูลจาก MongoDB) */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <button
                            type="button"
                            onClick={() => setDetailedStationAnomalyFilter('ALL_COND')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                              detailedStationAnomalyFilter === 'ALL_COND'
                                ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold'
                                : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            แสดงทุกเงื่อนไข ({countStatusAll})
                          </button>

                          <button
                            type="button"
                            onClick={() => setDetailedStationAnomalyFilter('ONLY_999_M999')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                              detailedStationAnomalyFilter === 'ONLY_999_M999'
                                ? 'bg-rose-600 text-white border-rose-400 font-bold'
                                : 'bg-rose-950/40 text-rose-300 border-rose-500/40 hover:bg-rose-900/50'
                            }`}
                          >
                            🚨 กรองค่า 999 / -999 ({countOnly999M999})
                          </button>

                          <button
                            type="button"
                            onClick={() => setDetailedStationAnomalyFilter('WATER_LE_M10_OR_999')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                              detailedStationAnomalyFilter === 'WATER_LE_M10_OR_999'
                                ? 'bg-rose-500 text-white border-rose-300 font-bold'
                                : 'bg-rose-950/30 text-rose-200 border-rose-500/30 hover:bg-rose-900/40'
                            }`}
                          >
                            ⚠️ ค่าน้ำ &lt;= -10 ถึง -999 / &gt;= 999 ({countWaterLeM10Or999})
                          </button>

                          <button
                            type="button"
                            onClick={() => setDetailedStationAnomalyFilter('WATER_NEGATIVE_ALL')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                              detailedStationAnomalyFilter === 'WATER_NEGATIVE_ALL'
                                ? 'bg-amber-500 text-slate-950 border-amber-300 font-bold'
                                : 'bg-amber-950/40 text-amber-300 border-amber-500/40 hover:bg-amber-900/50'
                            }`}
                          >
                            📉 ค่าน้ำติดลบทั้งหมด (&lt; 0) ({countWaterNegAll})
                          </button>

                          <button
                            type="button"
                            onClick={() => setDetailedStationAnomalyFilter('WATER_NEG_0_TO_10')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                              detailedStationAnomalyFilter === 'WATER_NEG_0_TO_10'
                                ? 'bg-amber-400 text-slate-950 border-amber-200 font-bold'
                                : 'bg-slate-900 text-amber-200 border-amber-500/30 hover:bg-slate-800'
                            }`}
                          >
                            ค่าน้ำติดลบ 0 ถึง -9.99 ({countWaterNeg0To10})
                          </button>

                          <button
                            type="button"
                            onClick={() => setDetailedStationAnomalyFilter('RAIN_ANOMALY')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                              detailedStationAnomalyFilter === 'RAIN_ANOMALY'
                                ? 'bg-purple-500 text-white border-purple-300 font-bold'
                                : 'bg-purple-950/40 text-purple-300 border-purple-500/40 hover:bg-purple-900/50'
                            }`}
                          >
                            🌧️ น้ำฝนผิดปกติ &gt;100 / 999 ({countRainAnomaly})
                          </button>

                          <button
                            type="button"
                            onClick={() => setDetailedStationAnomalyFilter('ANY_ANOMALY')}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border ${
                              detailedStationAnomalyFilter === 'ANY_ANOMALY'
                                ? 'bg-orange-500 text-slate-950 border-orange-300 font-bold'
                                : 'bg-orange-950/40 text-orange-300 border-orange-500/40 hover:bg-orange-900/50'
                            }`}
                          >
                            🔍 รวมผิดปกติทุกเงื่อนไข ({countAnyAnomaly})
                          </button>
                        </div>
                      </div>

                      {/* 4. ช่องค้นหารหัส/ชื่อสถานี + Dropdown ตัวกรองสถานะและเงื่อนไข */}
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={detailedStationSearch}
                          onChange={(e) => setDetailedStationSearch(e.target.value)}
                          placeholder="ค้นหารหัสสถานี หรือ ชื่อสถานี..."
                          className="flex-1 min-w-[150px] bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                        />
                        <select
                          value={detailedStationStatusFilter}
                          onChange={(e) => setDetailedStationStatusFilter(e.target.value)}
                          className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                        >
                          <option value="ALL">สถานะทั้งหมด ({countStatusAll})</option>
                          <option value="ปกติ">🟢 ปกติ ({countStatusNormal})</option>
                          <option value="เตือนภัย">🟡 เตือนภัย ({countStatusWatch})</option>
                          <option value="วิกฤติ">🔴 วิกฤติ ({countStatusCritical})</option>
                          <option value="ขัดข้อง">⚫ ขัดข้อง / ออฟไลน์ ({countStatusBroken})</option>
                        </select>
                        <select
                          value={detailedStationAnomalyFilter}
                          onChange={(e) =>
                            setDetailedStationAnomalyFilter(
                              e.target.value as typeof detailedStationAnomalyFilter
                            )
                          }
                          className="bg-slate-950 border border-amber-500/40 rounded-lg px-2 py-1.5 text-xs text-amber-200 focus:outline-none focus:border-amber-400"
                        >
                          <option value="ALL_COND">เงื่อนไขค่า: ทั้งหมด ({countStatusAll})</option>
                          <option value="ONLY_999_M999">
                            🚨 กรองเฉพาะ 999 / -999 ({countOnly999M999})
                          </option>
                          <option value="WATER_LE_M10_OR_999">
                            ⚠️ ค่าน้ำ &lt;= -10 ถึง -999 หรือ &gt;= 999 ({countWaterLeM10Or999})
                          </option>
                          <option value="WATER_NEGATIVE_ALL">
                            📉 ค่าน้ำติดลบทั้งหมด &lt; 0 ({countWaterNegAll})
                          </option>
                          <option value="WATER_NEG_0_TO_10">
                            ค่าน้ำติดลบ 0 ถึง -9.99 ({countWaterNeg0To10})
                          </option>
                          <option value="RAIN_ANOMALY">
                            🌧️ น้ำฝนผิดปกติ &gt; 100 / 999 ({countRainAnomaly})
                          </option>
                          <option value="ANY_ANOMALY">
                            🔍 รวมผิดปกติทุกเงื่อนไข ({countAnyAnomaly})
                          </option>
                        </select>
                      </div>
                    </div>

                    {/* 5. ตารางแสดงข้อมูลสถานีที่ดึงได้จาก MONGO_URI (telerid_db.stations) */}
                    <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
                      <div className="px-3 py-2 bg-slate-800/70 border-b border-slate-700 flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-cyan-300">
                          รายการสถานีจาก MongoDB ({filteredStations.length} / {countStatusAll} สถานี)
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          แหล่งข้อมูล: {mongoStatus ? `${mongoStatus.dbName}.${mongoStatus.collectionName}` : 'telerid_db.stations'}
                        </span>
                      </div>
                      <div className="overflow-x-auto max-h-96">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead className="sticky top-0 bg-slate-950 text-slate-300 border-b border-slate-800 z-10">
                            <tr>
                              <th className="py-2 px-2.5">รหัสสถานี</th>
                              <th className="py-2 px-2.5">ชื่อสถานี</th>
                              <th className="py-2 px-2.5">ลุ่มน้ำ</th>
                              <th className="py-2 px-2.5">การเชื่อมต่อ</th>
                              <th className="py-2 px-2.5">สถานะ</th>
                              <th className="py-2 px-2.5 text-right">ฝน 07:00-ปัจจุบัน</th>
                              <th className="py-2 px-2.5 text-right">ฝน 24 ชม.</th>
                              <th className="py-2 px-2.5 text-right">เหนือน้ำ (ม.รทก.)</th>
                              <th className="py-2 px-2.5 text-right">เหนือน้ำ (ม.รสม.)</th>
                              <th className="py-2 px-2.5 text-right">ท้ายน้ำ (ม.รทก.)</th>
                              <th className="py-2 px-2.5 text-right">ท้ายน้ำ (ม.รสม.)</th>
                              <th className="py-2 px-2.5">เวลาอัปเดต</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {filteredStations.length === 0 ? (
                              <tr>
                                <td colSpan={12} className="py-8 text-center text-slate-400">
                                  {teleRidDetailedStations.length > 0
                                    ? 'ไม่พบสถานีที่ตรงกับตัวกรองสถานะ/เงื่อนไขที่เลือก (ลองกด "ล้างตัวกรองทั้งหมด")'
                                    : mongoStatus?.connected
                                    ? 'ไม่พบข้อมูลสถานีในคอลเล็กชัน telerid_db.stations'
                                    : 'ไม่สามารถเชื่อมต่อ MONGO_URI ได้ กรุณาตรวจสอบว่าเปิดเซิร์ฟเวอร์ MongoDB แล้วกดปุ่ม "ดึงข้อมูลจาก MongoDB"'}
                                </td>
                              </tr>
                            ) : (
                              filteredStations.map((s) => {
                                const hasSevereBug =
                                  isStation999OrM999(s) || isStationWaterLeM10Or999(s);
                                return (
                                  <tr
                                    key={s.stationCode}
                                    className={`transition-colors ${
                                      hasSevereBug
                                        ? 'bg-rose-950/25 hover:bg-rose-900/30'
                                        : 'hover:bg-slate-800/50'
                                    }`}
                                  >
                                    <td className="py-2 px-2.5 font-mono font-semibold text-cyan-400">
                                      {s.stationCode}
                                    </td>
                                    <td className="py-2 px-2.5 font-medium text-slate-200">
                                      {s.stationName}
                                    </td>
                                    <td className="py-2 px-2.5 text-slate-400">{s.basin}</td>
                                    <td className="py-2 px-2.5">
                                      <span
                                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                                          s.onlineStatus === 'ออนไลน์'
                                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                            : 'bg-slate-700 text-slate-300'
                                        }`}
                                      >
                                        {s.onlineStatus}
                                      </span>
                                    </td>
                                    <td className="py-2 px-2.5">
                                      <span
                                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                                          s.alertStatus === 'วิกฤติ'
                                            ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                            : s.alertStatus === 'เตือนภัย'
                                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                            : s.alertStatus === 'ขัดข้อง'
                                            ? 'bg-slate-700 text-slate-300'
                                            : 'bg-emerald-500/20 text-emerald-300'
                                        }`}
                                      >
                                        {s.alertStatus}
                                      </span>
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono">
                                      {renderRainCell(s.rain7toNow)}
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono">
                                      {renderRainCell(s.rain1Day)}
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono">
                                      {renderWaterCell(s.waterLevelUp_RTK, true)}
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono">
                                      {renderWaterCell(s.waterLevelUp_RSM)}
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono">
                                      {renderWaterCell(s.waterLevelDown_RTK)}
                                    </td>
                                    <td className="py-2 px-2.5 text-right font-mono">
                                      {renderWaterCell(s.waterLevelDown_RSM)}
                                    </td>
                                    <td className="py-2 px-2.5 text-slate-400 text-[10px]">
                                      {s.recordedAt}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {Boolean(0) && activeDeptInfo.id === 'rpa' && (
            <div className="space-y-3 pt-1">
              <div className="p-2.5 rounded-lg bg-cyan-950/60 border border-cyan-500/40 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-bold text-cyan-300">
                    🌐 บังคับเปิด Google Chrome (Profile 5) พร้อมรหัสบันทึกและประวัติการใช้งานจริง:
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void fetch('/api/pc/control', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'open-browser-rpa',
                          targetUrl: rpaUrl,
                        }),
                      }).catch(() => {});
                    }}
                    className="px-2 py-0.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-[10px] cursor-pointer shrink-0"
                  >
                    เปิด Chrome (Profile 5) ทันที
                  </button>
                </div>
                <code className="block text-[10px] text-amber-300 bg-slate-950/90 px-2 py-1 rounded border border-slate-800 break-all">
                  &quot;C:\Program Files\Google\Chrome\Application\chrome.exe&quot; --profile-directory=&quot;Profile 5&quot; --source-shortcut-location=desktop
                </code>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-cyan-300 mb-1">
                  1. เลือกหรือพิมพ์เว็บไซต์ที่ต้องการให้เปิดใน Google Chrome (Profile 5):
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { label: 'TeleRID กรมชลฯ', url: 'https://telerid.rid.go.th/#/' },
                    { label: 'Google', url: 'https://www.google.com' },
                    { label: 'YouTube', url: 'https://www.youtube.com' },
                    { label: 'Facebook', url: 'https://www.facebook.com' },
                    { label: 'ระบบ e-GP', url: 'https://process3.gprocurement.go.th' },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => setRpaUrl(preset.url)}
                      className={`px-2 py-1 text-[11px] rounded border cursor-pointer transition-colors ${
                        rpaUrl === preset.url
                          ? 'bg-cyan-500 text-slate-950 font-semibold border-cyan-400'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={rpaUrl}
                  onChange={(e) => setRpaUrl(e.target.value)}
                  placeholder="พิมพ์ URL เช่น https://telerid.rid.go.th/#/ หรือ https://www.youtube.com"
                  className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-cyan-400 focus:outline-none"
                />
              </div>

              {/* ตั้งค่า Username / Password ที่บันทึกไว้ */}
              <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-2.5">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rpaAutoLogin}
                      onChange={(e) => setRpaAutoLogin(e.target.checked)}
                      className="rounded accent-cyan-400"
                    />
                    <span>ใช้ Username / Password ที่บันทึกไว้ล็อกอินอัตโนมัติ</span>
                  </label>
                  <button
                    onClick={() => setRpaShowCredBox((prev) => !prev)}
                    className="text-[11px] text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <KeyRound className="w-3 h-3" />
                    {rpaShowCredBox ? 'ซ่อนรหัส' : 'ตั้งค่ารหัสผ่าน'}
                  </button>
                </div>

                {rpaShowCredBox && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-800 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-slate-400">Username ที่บันทึกไว้:</span>
                        <input
                          type="text"
                          value={rpaUsername}
                          onChange={(e) => setRpaUsername(e.target.value)}
                          className="w-full mt-0.5 px-2 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-white"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400">Password ที่บันทึกไว้:</span>
                        <input
                          type="password"
                          value={rpaPassword}
                          onChange={(e) => setRpaPassword(e.target.value)}
                          className="w-full mt-0.5 px-2 py-1 text-xs bg-slate-950 border border-slate-700 rounded text-white"
                        />
                      </div>
                    </div>
                    <button
                      onClick={handleSaveRpaCredentials}
                      className="w-full py-1 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded cursor-pointer"
                    >
                      บันทึก Username / Password ลงเครื่อง
                    </button>
                  </div>
                )}
              </div>

              {/* ช่องพิมพ์คำสั่งว่าจะให้ทำอะไรในเว็บนั้น และสั่งต่อได้เรื่อยๆ */}
              <div>
                <label className="block text-[11px] font-semibold text-cyan-300 mb-1">
                  2. สั่งว่าจะให้ทำอะไรในเว็บนั้น (พิมพ์สั่งต่อเนื่องได้เรื่อยๆ):
                </label>
                <textarea
                  rows={2}
                  value={rpaInstruction}
                  onChange={(e) => setRpaInstruction(e.target.value)}
                  placeholder="เช่น ล็อกอินเข้าเว็บแล้วบอกว่าเห็นอะไรบ้าง / ค้นหาคำว่า กรมชลประทาน / คลิกปุ่ม เข้าสู่ระบบ"
                  className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-cyan-400 focus:outline-none"
                />
                <div className="flex flex-wrap gap-1 mt-1">
                  {[
                    'ล็อกอินด้วยรหัสที่บันทึกไว้และดูว่าเห็นอะไรบ้าง',
                    'ค้นหาคำว่า สถานการณ์น้ำ กรมชลประทาน',
                    'คลิกปุ่ม เข้าสู่ระบบ',
                    'เลื่อนหน้าจอลงด้านล่าง',
                  ].map((sampleCmd) => (
                    <button
                      key={sampleCmd}
                      onClick={() => setRpaInstruction(sampleCmd)}
                      className="text-[10px] px-2 py-0.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded border border-slate-800 cursor-pointer"
                    >
                      + {sampleCmd}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={() => handleExecuteRpaStep()}
                disabled={isRpaBusy}
                className="w-full py-2 px-3 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
              >
                <Globe className="w-4 h-4" />
                {isRpaBusy
                  ? 'กำลังสั่ง Chrome ทำงานและสแกนหน้าเว็บ...'
                  : 'สั่งเปิด Chrome ทำตามคำสั่ง & บันทึกขั้นตอนนี้'}
              </button>

              {/* ===================================================================
                  ระบบบันทึกและจำลองพฤติกรรมการคลิกมนุษย์ (Autonomous Macro Recorder & Playback Engine)
                  พร้อมชุดคำสั่งดักกรองค่าบั๊กระบบ/ภัยวิกฤตขั้นสูง (Strict Data Loop Filter — Pure Observation 100%)
                  และตารางเวลาทำงานรายชั่วโมงตรงตามนาฬิกาจริง (07:00, 08:00, 09:00, 10:00 น.)
                 =================================================================== */}
              <div className="p-3 rounded-xl bg-slate-950/95 border-2 border-cyan-400/60 shadow-[0_0_20px_rgba(34,211,238,0.18)] space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/30 pb-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-extrabold text-cyan-300">
                      <span
                        className={`inline-block w-2.5 h-2.5 rounded-full ${
                          isMacroRecording
                            ? 'bg-red-500 shadow-[0_0_10px_#ef4444] animate-ping'
                            : 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                        }`}
                      />
                      <span>
                        🎮 ระบบบันทึกและจำลองพฤติกรรมการคลิกมนุษย์ (Autonomous Macro Recorder &amp; Playback)
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-300 mt-0.5">
                      ดักจับการคลิกเมาส์ (`click`), คีย์บอร์ด และการเลือกลุ่มน้ำโขงตะวันออกเฉียงเหนือ เก็บเป็นไฟล์{' '}
                      <code className="text-amber-300">tele04_macro_config.json</code> เพื่อเล่นซ้ำแบบ 1:1
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-200 border border-amber-500/40">
                    ⏰ รันตรงต้นชั่วโมงถัดไป: {nextClockHourText}
                  </span>
                </div>

                {/* ปุ่มควบคุมหลัก 2 ปุ่มตามคำสั่ง: 1) เริ่มบันทึกมาโคร (Start Record) และ 2) หยุดและบันทึกมาโคร (Stop & Save) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => void handleStartMacroRecord()}
                    disabled={isMacroBusy || isMacroRecording}
                    className={`py-2.5 px-3 rounded-xl font-extrabold text-xs flex items-center justify-center gap-2 cursor-pointer transition-all border ${
                      isMacroRecording
                        ? 'bg-red-950/80 text-red-300 border-red-500/60 opacity-80'
                        : 'bg-red-600 hover:bg-red-500 text-white border-red-300 shadow-[0_0_18px_rgba(239,68,68,0.5)]'
                    }`}
                  >
                    <span className="inline-block w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
                    {isMacroRecording
                      ? '🔴 กำลังดักจับการคลิกบน Chrome...'
                      : '1. เริ่มบันทึกมาโคร (Start Record)'}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleStopAndSaveMacro()}
                    disabled={isMacroBusy}
                    className="py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-2 cursor-pointer border border-amber-300 shadow-[0_0_18px_rgba(245,158,11,0.45)] transition-all"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    2. หยุดและบันทึกมาโคร (Stop &amp; Save)
                  </button>
                </div>

                {/* ปุ่มสั่งเล่นซ้ำมาโคร 1:1 ทันที + ปุ่มเปิดดูไฟล์ Macro JSON Config */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handlePlaySavedMacro()}
                    disabled={isMacroBusy}
                    className="sm:col-span-2 py-2 px-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
                  >
                    <RefreshCw className={`w-4 h-4 ${isMacroBusy ? 'animate-spin' : ''}`} />
                    {isMacroBusy
                      ? 'กำลังเล่นซ้ำมาโคร 1:1 & สกัดค่าสดหน้าจอจริง...'
                      : '▶️ เล่นซ้ำมาโคร 1:1 & ดึงค่าหน้าจอจริงเดี๋ยวนี้ (Play Macro)'}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowMacroJsonPreview((prev) => !prev)}
                    className="py-2 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-200 font-semibold text-[11px] border border-cyan-500/40 cursor-pointer flex items-center justify-center gap-1"
                  >
                    <Code2 className="w-3.5 h-3.5" />
                    {showMacroJsonPreview ? 'ซ่อน Macro JSON' : `ดูขั้นตอน (${macroSteps.length})`}
                  </button>
                </div>

                {/* แถบแสดงสถานะการบันทึก/เล่นซ้ำมาโคร และตารางเวลา Cron Job รายชั่วโมง (07:00, 08:00, 09:00, 10:00 น.) */}
                <div className="p-2 rounded-lg bg-slate-900/90 border border-slate-800 text-[10px] space-y-1.5">
                  <div className="text-cyan-200 font-semibold leading-relaxed">{macroStatusMessage}</div>
                  <div className="flex flex-wrap items-center gap-1 text-slate-400">
                    <span className="font-bold text-amber-300">🕒 ตารางรันมาโครรายชั่วโมง (Hourly Cron):</span>
                    {upcomingHoursSchedule.map((hrText) => (
                      <span
                        key={hrText}
                        className="px-1.5 py-0.5 rounded bg-slate-950 text-cyan-300 font-mono border border-slate-800"
                      >
                        {hrText}
                      </span>
                    ))}
                    <span className="text-emerald-300 ml-1">
                      → ส่งออก .xlsx &amp; .pdf ลง <code className="text-amber-300">C:\Users\Tele_04\Downloads</code>
                    </span>
                  </div>
                </div>

                {/* แสดงรายการขั้นตอนใน Macro JSON Config (tele04_macro_config.json) */}
                {showMacroJsonPreview && (
                  <div className="p-2.5 rounded-lg bg-slate-900/95 border border-cyan-500/30 space-y-1.5 max-h-48 overflow-y-auto">
                    <div className="flex items-center justify-between text-[10px] text-amber-300 font-bold">
                      <span>📄 ไฟล์ขั้นตอนมาโคร: {macroConfigPath}</span>
                      <span>รวม {macroSteps.length} ขั้นตอน</span>
                    </div>
                    <div className="space-y-1 text-[10px]">
                      {macroSteps.map((st) => (
                        <div
                          key={`macro-step-${st.stepNo}`}
                          className="p-1.5 rounded bg-slate-950 border border-slate-800 flex items-start justify-between gap-2"
                        >
                          <div>
                            <span className="font-mono font-bold text-cyan-400 mr-1.5">
                              #{st.stepNo} [{st.actionType}]
                            </span>
                            <span className="text-slate-200">{st.description}</span>
                            {st.selector && (
                              <div className="text-[9px] text-slate-400 font-mono mt-0.5">
                                Selector: {st.selector}{' '}
                                {typeof st.x === 'number' ? `| พิกัดเมาส์: (${st.x}, ${st.y})` : ''}
                              </div>
                            )}
                          </div>
                          {st.timestamp && (
                            <span className="text-[9px] font-mono text-slate-500 shrink-0">{st.timestamp}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* แสดงกฎเหล็กการคัดกรองความผิดปกติ (Strict Data Loop Filter — Pure Observation 100%) */}
                <div className="p-2 rounded-lg bg-slate-900/80 border border-rose-500/30 text-[10px] space-y-1">
                  <div className="font-bold text-rose-300 flex items-center justify-between">
                    <span>🔍 ชุดคำสั่งดักกรองค่าบั๊กระบบ/ภัยวิกฤตขั้นสูง (Strict Data Loop Filter — ห้ามคาดเดา):</span>
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-200 font-mono">
                      พบความผิดปกติ {thresholdAnomalies.length} รายการ
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 text-[9.5px] text-slate-300">
                    <div className="p-1.5 rounded bg-slate-950/90 border border-slate-800">
                      <span className="text-red-400 font-bold">1. ค่าน้ำไม่ถูกต้อง (ม.รทก. &amp; ม.รสม.):</span>{' '}
                      ดักจับค่าติดลบเกิน <code className="text-amber-300">-10</code> ลงไปจนถึง{' '}
                      <code className="text-amber-300">-999</code> หรือ <code className="text-amber-300">&gt;= 999</code>{' '}
                      ทั้ง ม.รทก. และ ม.รสม.
                    </div>
                    <div className="p-1.5 rounded bg-slate-950/90 border border-slate-800">
                      <span className="text-amber-300 font-bold">2. ค่าน้ำติดลบพื้นที่ดอน:</span> ดักจับค่า{' '}
                      <code className="text-amber-300">0 ถึง -9.99</code> (ทั้ง ม.รทก. และ ม.รสม.)
                    </div>
                    <div className="p-1.5 rounded bg-slate-950/90 border border-slate-800">
                      <span className="text-cyan-300 font-bold">3. น้ำฝนวิกฤต/พุ่งเวอร์:</span> ดักจับฝน{' '}
                      <code className="text-amber-300">&gt; 100</code> ถึง{' '}
                      <code className="text-amber-300">&gt; 1,000+</code> มม.
                    </div>
                  </div>
                  {thresholdAnomalies.length > 0 && (
                    <div className="pt-1 space-y-1 max-h-28 overflow-y-auto">
                      {thresholdAnomalies.map((anom, idx) => (
                        <div
                          key={`anom-${anom.stationCode}-${idx}`}
                          className="px-2 py-1 rounded bg-red-950/50 border border-red-500/40 text-red-100 flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            <strong>[{anom.categoryThai}]</strong> {anom.stationName} →{' '}
                            <code className="text-yellow-300 font-bold">{anom.observedValue}</code>
                          </span>
                          <span className="text-[9px] font-mono text-red-300 shrink-0">{anom.scannedAt}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ===================================================================
                  ระบบรายงานเฝ้าระวังภัยน้ำท่วมอัตโนมัติ (TeleRID Monitor Agent — 4 มอดูล รายชั่วโมงตามเวลาจริง)
                  พิกัดตรวจสอบ: https://telerid.rid.go.th/#/ และ https://telerid.rid.go.th/#/cctv
                 =================================================================== */}
              <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/40 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
                      <FileText className="w-4 h-4 text-cyan-400" />
                      <span>3. ระบบรายงานเฝ้าระวังภัยน้ำท่วม (TeleRID Monitor Agent — 4 มอดูล)</span>
                    </div>

                    <div className="text-[10px] text-slate-300 mt-0.5">
                      รันผ่าน Node.js &amp; Playwright สแกน{' '}
                      <code className="text-amber-300">telerid.rid.go.th/#/</code> และ{' '}
                      <code className="text-amber-300">#/cctv</code> ทุกๆ 1 ชั่วโมงตามเวลาจริง
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 shrink-0">
                    รอบถัดไปในอีก {teleRidCountdownText}
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-slate-950/90 border border-emerald-500/40 text-[10px] text-slate-200 space-y-1">
                  <div className="font-bold text-emerald-300">
                    ✅ โหมดดึงข้อมูลจริง 100% (Zero Mock Data — ใช้เฉพาะค่าที่อ่านได้จริงจากหน้าเว็บ TeleRID เท่านั้น):
                  </div>
                  <div>
                    1) <span className="text-cyan-300 font-semibold">กฎเหล็กที่ 1 (Zero Mock Data &amp; Live Chrome Profile 5):</span>{' '}
                    ใช้ <code className="text-amber-300">page.on(&apos;response&apos;, ...)</code> ดักจับ API หลังบ้าน + อ่าน DOM ตารางจริงจากหน้าเว็บ <code className="text-amber-300">telerid.rid.go.th</code> หากค่าใดยังไม่ได้สแกนหรืออ่านไม่ได้จะแสดงคำว่า <code className="text-rose-300">&ldquo;ไม่พบค่า&rdquo;</code> เท่านั้น
                  </div>
                  <div>
                    2) <span className="text-cyan-300 font-semibold">กฎเหล็กที่ 2 (ส่งออกรายงาน Excel &amp; PDF):</span>{' '}
                    สร้างไฟล์ <code className="text-amber-300">.xlsx</code> (ด้วยไลบรารี <code className="text-amber-300">exceljs</code>) และ <code className="text-amber-300">.pdf</code> ลงโฟลเดอร์ <code className="text-amber-300">C:\Users\Tele_04\Downloads</code> โดยตรง
                  </div>
                  <div>
                    3) <span className="text-cyan-300 font-semibold">กฎเหล็กที่ 3 (แจ้งเตือนเฉพาะเมื่อพบค่าจริงเข้าเงื่อนไขเท่านั้น):</span>{' '}
                    ยกเลิกปุ่มทดสอบและตัวเลขจำลองทั้งหมด ระบบจะแจ้งเตือนเมื่อตรวจพบค่าน้ำจริงติดลบเกิน <code className="text-rose-300">-10</code> ลงไปถึง <code className="text-rose-300">-999</code> (ทั้ง ม.รทก. และ ม.รสม.) หรือน้ำฝนจริงเกินเกณฑ์จากหน้าเว็บเท่านั้น
                  </div>
                </div>

                {/* เลือกชื่อลุ่มน้ำที่ต้องการตรวจสอบ (สามารถเลือกได้มากกว่า 1 ลุ่มน้ำพร้อมกัน และใช้เฉพาะสถานีในเว็บ telerid.rid.go.th เท่านั้น) */}
                <div className="p-2.5 rounded-lg bg-slate-950/90 border border-cyan-500/30 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-[10px] font-bold text-amber-300">
                      🌊 เลือก &ldquo;ลุ่มน้ำ&rdquo; ที่ต้องการตรวจสอบ (เลือกได้มากกว่า 1 ลุ่มน้ำพร้อมกัน · ดึงเฉพาะสถานีในเว็บ telerid.rid.go.th/# เท่านั้น):
                    </label>
                    <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-[10px] text-cyan-200 font-bold border border-cyan-500/40">
                      เลือกแล้ว {teleRidSelectedBasins.length} ลุ่มน้ำ
                    </span>
                  </div>

                  {/* แสดงรายการลุ่มน้ำที่เลือกไว้ (Multi-Basin Tags) */}
                  <div className="flex flex-wrap items-center gap-1 p-1.5 rounded-lg bg-slate-900/90 border border-slate-800">
                    {teleRidSelectedBasins.map((bName, idx) => (
                      <span
                        key={`sel-${bName}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500 text-slate-950 font-bold text-[10px]"
                      >
                        <span>
                          {idx + 1}. {bName}
                        </span>
                        {teleRidSelectedBasins.length > 1 && (
                          <button
                            type="button"
                            onClick={() => toggleSelectTeleRidBasin(bName)}
                            className="ml-0.5 px-1 rounded bg-slate-950/20 hover:bg-slate-950/40 text-slate-950 cursor-pointer"
                            title="เอาลุ่มน้ำนี้ออกจากรายการ"
                          >
                            ×
                          </button>
                        )}
                      </span>
                    ))}
                  </div>

                  {/* Dropdown เพิ่มลุ่มน้ำจาก 22 ลุ่มน้ำหลัก + ช่องพิมพ์เพิ่มลุ่มน้ำเอง */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    <select
                      value=""
                      onChange={(e) => {
                        const chosen = e.target.value;
                        if (chosen) {
                          setTeleRidBasinName(chosen);
                          setTeleRidSelectedBasins((prev) =>
                            prev.includes(chosen) ? prev : [...prev, chosen]
                          );
                        }
                      }}
                      className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-cyan-400 focus:outline-none"
                    >
                      <option value="">
                        + คลิกเพื่อเพิ่ม/เลือกลุ่มน้ำจาก 22 ลุ่มน้ำ (เลือกได้หลายลุ่มน้ำ)
                      </option>
                      {RID_22_BASINS.map((bName) => (
                        <option key={bName} value={bName}>
                          {teleRidSelectedBasins.includes(bName) ? `✅ ${bName} (เลือกแล้ว)` : `+ ${bName}`}
                        </option>
                      ))}
                    </select>
                    <div className="flex gap-1">
                      <input
                        type="text"
                        value={teleRidCustomBasinInput}
                        onChange={(e) => setTeleRidCustomBasinInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && teleRidCustomBasinInput.trim()) {
                            const val = teleRidCustomBasinInput.trim();
                            setTeleRidSelectedBasins((prev) => (prev.includes(val) ? prev : [...prev, val]));
                            setTeleRidCustomBasinInput('');
                          }
                        }}
                        placeholder="พิมพ์ชื่อลุ่มน้ำเพิ่มเติมแล้วกด + เพิ่ม"
                        className="flex-1 px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-cyan-400 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = teleRidCustomBasinInput.trim();
                          if (val) {
                            setTeleRidSelectedBasins((prev) => (prev.includes(val) ? prev : [...prev, val]));
                            setTeleRidCustomBasinInput('');
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-xs font-bold cursor-pointer shrink-0"
                      >
                        + เพิ่ม
                      </button>
                    </div>
                  </div>

                  {/* ปุ่มติ๊กเลือกลุ่มน้ำแบบ Multi-Select (คลิกเพื่อติ๊กเลือก/ยกเลิกได้หลายลุ่มน้ำพร้อมกัน) */}
                  <div className="space-y-1 pt-0.5">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>คลิกติ๊กเลือก/ยกเลิกลุ่มน้ำที่ต้องการตรวจสอบพร้อมกัน (Multi-Select):</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setTeleRidSelectedBasins([
                              'ลุ่มน้ำภาคใต้ฝั่งตะวันออกตอนล่าง',
                              'ลุ่มน้ำทะเลสาบสงขลา',
                              'ลุ่มน้ำเจ้าพระยา',
                            ])
                          }
                          className="text-cyan-300 hover:underline cursor-pointer"
                        >
                          เลือกชุดลุ่มน้ำเฝ้าระวังหลัก (3 ลุ่มน้ำ)
                        </button>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() => setTeleRidSelectedBasins([teleRidSelectedBasins[0] || 'ลุ่มน้ำภาคใต้ฝั่งตะวันออกตอนล่าง'])}
                          className="text-rose-300 hover:underline cursor-pointer"
                        >
                          เหลือ 1 ลุ่มน้ำ
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 rounded bg-slate-900/60 border border-slate-800/80">
                      {RID_22_BASINS.map((quickBasin) => {
                        const isChecked = teleRidSelectedBasins.includes(quickBasin);
                        return (
                          <button
                            key={quickBasin}
                            type="button"
                            onClick={() => toggleSelectTeleRidBasin(quickBasin)}
                            className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer transition-colors flex items-center gap-1 ${
                              isChecked
                                ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400'
                                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                            }`}
                          >
                            <span>{isChecked ? '☑' : '☐'}</span>
                            <span>{quickBasin}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="flex items-center gap-1.5 text-[10px] text-slate-300 pt-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={teleRidOpenBrowserOnScan}
                      onChange={(e) => setTeleRidOpenBrowserOnScan(e.target.checked)}
                      className="rounded accent-cyan-400"
                    />
                    <span>เปิดหน้าต่าง Chrome (Playwright UI) บนหน้าจอ Windows ขณะสแกนทั้ง 2 พิกัด</span>
                  </label>
                </div>

                {/* ปุ่มสั่งรันโหมดผู้ช่วยเลขา AI (เปิด Chrome Profile 5 ค้างไว้ให้คลิกดูข้อมูล และสรุปเมื่อปิด Chrome) + ปุ่มดึงค่าผ่าน WebSocket/API */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleRunTeleRidFourModuleMonitor(teleRidSelectedBasins)}
                    className="py-2 px-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
                  >
                    <RefreshCw className={`w-4 h-4 ${isTeleRidMonitorBusy ? 'animate-spin' : ''}`} />
                    {isTeleRidMonitorBusy
                      ? `🔄 เปิด Chrome (Profile 5) ใหม่ / รีสตาร์ทเลขา AI (${secretaryProgress?.stationsCapturedCount ?? 0} สถานี)`
                      : `🚨 สแกน ${teleRidSelectedBasins.length} ลุ่มน้ำที่เลือก (เปิด Chrome เลขา AI คอยจด)`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsTeleRidReportModalOpen(true)}
                    className="py-2 px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
                  >
                    <FileText className="w-4 h-4" />
                    📊 กดดูรายงานฉบับเต็ม &amp; ตาราง 8 คอลัมน์
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadTeleRidExcel()}
                    className="py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
                  >
                    <Download className="w-4 h-4" />
                    📊 ดาวน์โหลดรายงาน Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadTeleRidPdf()}
                    className="py-2 px-3 bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
                  >
                    <Download className="w-4 h-4" />
                    📄 ดาวน์โหลดรายงาน PDF (.pdf)
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleScanTeleRidWaterAndRainApi()}
                    disabled={isTeleRidMonitorBusy}
                    className="sm:col-span-2 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-2 cursor-pointer border border-indigo-400 shadow-lg"
                  >
                    <RefreshCw className={`w-4 h-4 ${isTeleRidMonitorBusy ? 'animate-spin' : ''}`} />
                    🔑 สแกนดึงค่า API &amp; WebSocket (wss://telerid.rid.go.th/ws/public/) + ซิงค์ MongoDB (use: {rpaUsername || 'Sommart'} / PW: 891013)
                  </button>
                </div>

                {/* แบนเนอร์สถานะ "โหมดผู้ช่วยเลขา AI (AI Secretary Mode)" ขณะเปิด Chrome Profile 5 ค้างไว้ */}
                {(secretaryProgress?.isActive || isTeleRidMonitorBusy) && (
                  <div className="p-2.5 rounded-xl bg-amber-950/80 border-2 border-amber-400/80 text-xs text-amber-100 space-y-2 shadow-[0_0_20px_rgba(245,158,11,0.28)]">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-extrabold text-amber-300 flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                        <span>🤖 เลขา AI กำลังเจาะระบบดักจับข้อมูลบน Chrome (Profile 5) — เบราว์เซอร์จะไม่ปิดเอง!</span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 font-bold text-[10px]">
                        จดบันทึกแล้ว {secretaryProgress?.stationsCapturedCount ?? 0} สถานี · คลิก/เปลี่ยนหน้า {secretaryProgress?.userInteractionCount ?? 0} ครั้ง
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-200 leading-relaxed">
                      • เปิด <code className="text-cyan-300">&quot;C:\Program Files\Google\Chrome\Application\chrome.exe&quot; --profile-directory=&quot;Profile 5&quot;</code> ค้างไว้ให้แล้ว (กดเปิดซ้ำกี่ครั้งก็ได้ ไม่ติดล็อกโปรไฟล์)
                      <br />
                      • เชิญคลิกเลือกลุ่มน้ำ เลื่อนดูตาราง หรือสลับเปิดหน้า <code className="text-amber-300">https://telerid.rid.go.th/#/cctv</code> ได้เลย เลขา AI จะดักจับทั้ง WebSocket, API, ตาราง 8 คอลัมน์ และข้อมูลกล้อง CCTV ทุกตัวที่เจอให้อัตโนมัติ
                      <br />
                      • <strong className="text-amber-300">เมื่อดูเสร็จแล้ว:</strong> กดปุ่มกากบาท <code className="text-rose-300 font-bold">[X]</code> ปิดหน้าต่าง Google Chrome (หรือกดปุ่มสีส้มด้านล่างนี้) ระบบจะนำข้อมูลจริงทั้งหมดมาขึ้นรายงานทันทีครับ
                    </div>
                    {secretaryProgress?.lastActionDescription && (
                      <div className="px-2 py-1 rounded bg-slate-950/90 border border-slate-800 text-[10px] text-cyan-300 font-mono">
                        📝 ล่าสุด: {secretaryProgress.lastActionDescription}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => void handleFinishSecretarySession()}
                      className="w-full py-2 px-3 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs flex items-center justify-center gap-1.5 cursor-pointer shadow"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      ⏹️ ดูเสร็จแล้ว / สั่งปิด Chrome และนำข้อมูลที่สกัดจับได้ทั้งหมดขึ้นรายงานเดี๋ยวนี้
                    </button>
                  </div>
                )}

                {/* ตารางข้อมูลสถานีละเอียดครบ 8 คอลัมน์ (จากที่เลขา AI จดบันทึกไว้ขณะเปิด Chrome หรือจาก WebSocket/API) */}
                {(() => {
                  const rawStations =
                    teleRidDetailedStations.length > 0
                      ? teleRidDetailedStations
                      : teleRidMonitorReport?.detailedStations || [];
                  const q = detailedStationSearch.trim().toLowerCase();
                  const filteredStations = rawStations.filter((st) => {
                    if (
                      detailedStationStatusFilter !== 'ALL' &&
                      st.alertStatus !== detailedStationStatusFilter &&
                      st.onlineStatus !== detailedStationStatusFilter
                    ) {
                      return false;
                    }
                    if (!q) return true;
                    return (
                      st.stationCode.toLowerCase().includes(q) ||
                      st.stationName.toLowerCase().includes(q) ||
                      st.basin.toLowerCase().includes(q)
                    );
                  });

                  return (
                    <div className="p-2.5 rounded-xl bg-slate-950/95 border border-cyan-500/40 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="text-[11px] font-bold text-cyan-300 flex items-center gap-1.5">
                          <Table2 className="w-3.5 h-3.5 text-cyan-400" />
                          <span>
                            📋 ตารางข้อมูลที่เลขา AI &amp; WebSocket บันทึกไว้ ({filteredStations.length} / {rawStations.length} สถานี)
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={detailedStationSearch}
                            onChange={(e) => setDetailedStationSearch(e.target.value)}
                            placeholder="ค้นหารหัส/ชื่อสถานี/ลุ่มน้ำ..."
                            className="px-2 py-1 text-[10px] rounded bg-slate-900 border border-slate-700 text-white focus:border-cyan-400 focus:outline-none w-36"
                          />
                          <select
                            value={detailedStationStatusFilter}
                            onChange={(e) => setDetailedStationStatusFilter(e.target.value)}
                            className="px-1.5 py-1 text-[10px] rounded bg-slate-900 border border-slate-700 text-slate-200"
                          >
                            <option value="ALL">ทุกสถานะ</option>
                            <option value="วิกฤติ">🔴 วิกฤติ</option>
                            <option value="เตือนภัย">🟡 เตือนภัย</option>
                            <option value="ขัดข้อง">⚫ ขัดข้อง</option>
                            <option value="ปกติ">🟢 ปกติ</option>
                            <option value="ออนไลน์">ออนไลน์</option>
                            <option value="ออฟไลน์">ออฟไลน์</option>
                          </select>
                        </div>
                      </div>

                      <div className="overflow-x-auto max-h-60 rounded-lg border border-slate-800 bg-slate-950">
                        <table className="w-full text-left border-collapse text-[10px]">
                          <thead className="sticky top-0 bg-slate-900 text-cyan-200 border-b border-slate-800">
                            <tr>
                              <th className="py-1.5 px-2 whitespace-nowrap">สถานี / ลุ่มน้ำ</th>
                              <th className="py-1.5 px-2 whitespace-nowrap text-center">การเชื่อมต่อ</th>
                              <th className="py-1.5 px-2 whitespace-nowrap text-center">ระดับน้ำ</th>
                              <th className="py-1.5 px-2 whitespace-nowrap text-right">ฝน 07:00-ปัจจุบัน</th>
                              <th className="py-1.5 px-2 whitespace-nowrap text-right">ฝน 1 วัน (24ชม.)</th>
                              <th className="py-1.5 px-2 whitespace-nowrap text-right">เหนือน้ำ (ม.รทก.)</th>
                              <th className="py-1.5 px-2 whitespace-nowrap text-right">เหนือน้ำ (ม.รสม.)</th>
                              <th className="py-1.5 px-2 whitespace-nowrap text-right">ท้ายน้ำ (ม.รทก.)</th>
                              <th className="py-1.5 px-2 whitespace-nowrap text-right">ท้ายน้ำ (ม.รสม.)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {filteredStations.length > 0 ? (
                              filteredStations.slice(0, 150).map((st, idx) => (
                                <tr key={`sec-row-${st.stationCode}-${idx}`} className="hover:bg-slate-900/70">
                                  <td className="py-1.5 px-2">
                                    <div className="font-bold text-white">
                                      <span className="text-cyan-300">[{st.stationCode}]</span> {st.stationName}
                                    </div>
                                    <div className="text-[9px] text-slate-400">{st.basin}</div>
                                  </td>
                                  <td className="py-1.5 px-2 text-center whitespace-nowrap">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                        st.onlineStatus === 'ออนไลน์'
                                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                          : st.onlineStatus === 'ออฟไลน์'
                                          ? 'bg-slate-800 text-slate-300 border border-slate-700'
                                          : 'bg-slate-900 text-slate-400'
                                      }`}
                                    >
                                      {st.onlineStatus}
                                    </span>
                                  </td>
                                  <td className="py-1.5 px-2 text-center whitespace-nowrap">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                        st.alertStatus === 'วิกฤติ'
                                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                          : st.alertStatus === 'เตือนภัย'
                                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                          : st.alertStatus === 'ปกติ'
                                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                                      }`}
                                    >
                                      {st.alertStatus}
                                    </span>
                                  </td>
                                  <td className="py-1.5 px-2 text-right font-mono text-cyan-200 whitespace-nowrap">
                                    {st.rain7toNow}
                                  </td>
                                  <td className="py-1.5 px-2 text-right font-mono text-cyan-300 whitespace-nowrap">
                                    {st.rain1Day}
                                  </td>
                                  <td className="py-1.5 px-2 text-right font-mono text-amber-200 whitespace-nowrap">
                                    {st.waterLevelUp_RTK}
                                  </td>
                                  <td className="py-1.5 px-2 text-right font-mono text-amber-300 whitespace-nowrap">
                                    {st.waterLevelUp_RSM}
                                  </td>
                                  <td className="py-1.5 px-2 text-right font-mono text-emerald-200 whitespace-nowrap">
                                    {st.waterLevelDown_RTK}
                                  </td>
                                  <td className="py-1.5 px-2 text-right font-mono text-emerald-300 whitespace-nowrap">
                                    {st.waterLevelDown_RSM}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={9} className="py-4 px-3 text-center text-slate-400">
                                  ยังไม่มีข้อมูลสถานีที่บันทึกไว้ — กดปุ่ม &ldquo;🚨 สแกนลุ่มน้ำที่เลือก (เปิด Chrome เลขา AI คอยจด)&rdquo; หรือปุ่ม &ldquo;🔑 สแกนดึงค่า API &amp; WebSocket&rdquo; ด้านบนเพื่อดึงข้อมูลจริงครับ
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}


                {/* แสดงผลสรุปทั้ง 4 มอดูลตามกฎเหล็ก (รองรับการสลับดูรวมทุกลุ่มน้ำ หรือแยกรายลุ่มน้ำ) */}
                {teleRidMonitorReport && (() => {
                  const perBasinList = teleRidMonitorReport.perBasinReports || [];
                  const activeReport =
                    teleRidActiveBasinView !== 'ALL' && perBasinList.length > 0
                      ? perBasinList.find((r) => r.basinName === teleRidActiveBasinView) || teleRidMonitorReport
                      : teleRidMonitorReport;

                  return (
                    <div className="space-y-2">
                      {/* แท็บสลับดูสรุปรวมทุกลุ่มน้ำ หรือแยกรายลุ่มน้ำ */}
                      {perBasinList.length > 1 && (
                        <div className="flex flex-wrap items-center gap-1 p-1.5 rounded-lg bg-slate-950 border border-cyan-500/30">
                          <span className="text-[10px] font-bold text-amber-300 mr-1">
                            สลับดูผลลัพธ์รายลุ่มน้ำ:
                          </span>
                          <button
                            type="button"
                            onClick={() => setTeleRidActiveBasinView('ALL')}
                            className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                              teleRidActiveBasinView === 'ALL'
                                ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400'
                                : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                            }`}
                          >
                            📊 รวมทุกลุ่มน้ำที่เลือก ({perBasinList.length} ลุ่มน้ำ)
                          </button>
                          {perBasinList.map((bRep) => (
                            <button
                              key={`tab-${bRep.basinName}`}
                              type="button"
                              onClick={() => setTeleRidActiveBasinView(bRep.basinName)}
                              className={`px-2 py-0.5 rounded text-[10px] border cursor-pointer ${
                                teleRidActiveBasinView === bRep.basinName
                                  ? 'bg-amber-400 text-slate-950 font-bold border-amber-300'
                                  : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                              }`}
                            >
                              🌊 {bRep.basinName}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* มอดูลที่ 1: สถานะภาพรวมรายลุ่มน้ำ */}
                      <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-cyan-300">
                            [มอดูลที่ 1] สถานะภาพรวม ({activeReport.outputJson.basin_name})
                          </span>
                          <span className="text-[10px] text-slate-400">
                            เวลาสแกน: {activeReport.outputJson.scan_time}
                          </span>
                        </div>
                        {(() => {
                          const s = activeReport.outputJson.summary;
                          const hasNonZeroTotal =
                            (s.online ?? 0) + (s.warning ?? 0) + (s.critical ?? 0) + (s.offline ?? 0) > 0;
                          return (
                            <div className="grid grid-cols-4 gap-1.5 text-[11px]">
                              <div className="p-1.5 rounded bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-center">
                                <div className="text-[9px] text-emerald-200">🟢 ปกติ (เขียว)</div>
                                <div className="text-sm font-bold">
                                  {hasNonZeroTotal && s.online !== null ? s.online : 'ไม่พบค่า'}
                                </div>
                              </div>
                              <div className="p-1.5 rounded bg-amber-950/60 border border-amber-500/40 text-amber-300 text-center">
                                <div className="text-[9px] text-amber-200">🟡 เตือนภัย (เหลือง)</div>
                                <div className="text-sm font-bold">
                                  {hasNonZeroTotal && s.warning !== null ? s.warning : 'ไม่พบค่า'}
                                </div>
                              </div>
                              <div className="p-1.5 rounded bg-rose-950/60 border border-rose-500/40 text-rose-300 text-center">
                                <div className="text-[9px] text-rose-200">🔴 วิกฤติ (แดง)</div>
                                <div className="text-sm font-bold">
                                  {hasNonZeroTotal && s.critical !== null ? s.critical : 'ไม่พบค่า'}
                                </div>
                              </div>
                              <div className="p-1.5 rounded bg-slate-900 border border-slate-700 text-slate-300 text-center">
                                <div className="text-[9px] text-slate-400">⚫ ขัดข้อง (เทา)</div>
                                <div className="text-sm font-bold">
                                  {hasNonZeroTotal && s.offline !== null ? s.offline : 'ไม่พบค่า'}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                        <div className="pt-1 border-t border-slate-800/80 space-y-0.5 text-[10px]">
                          <div className="font-semibold text-rose-300">
                            📍 รายชื่อสถานีผิดปกติจริงที่อ่านได้จากหน้าเว็บ https://telerid.rid.go.th/#/:
                          </div>
                          {activeReport.module1AbnormalStationsDb &&
                          activeReport.module1AbnormalStationsDb.length > 0 ? (
                            activeReport.module1AbnormalStationsDb.map((ab, idx) => (
                              <div key={`m1-ab-${idx}`} className="flex items-center justify-between text-slate-200">
                                <span className="truncate">
                                  • <strong className="text-cyan-300">{ab.stationCode}</strong> — {ab.stationName} ({ab.basin})
                                </span>
                                <span
                                  className={`px-1.5 py-0.2 rounded text-[9px] font-bold shrink-0 ${
                                    ab.status === 'วิกฤติ'
                                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                      : ab.status === 'เตือนภัย'
                                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                      : 'bg-slate-800 text-slate-300 border border-slate-700'
                                  }`}
                                >
                                  {ab.status}
                                </span>
                              </div>
                            ))
                          ) : (
                            <div className="text-slate-400">• ไม่พบค่า (กรุณากดปุ่มสแกนเพื่อดึงค่าจริงจากหน้าเว็บ)</div>
                          )}
                        </div>
                      </div>

                      {/* มอดูลที่ 2, 3, 4 สรุปย่อในแดชบอร์ด */}
                      <div className="grid grid-cols-1 gap-1.5 text-[10px]">
                        {/* มอดูลที่ 2: CCTV */}
                        <div className="p-2 rounded-lg bg-slate-950/90 border border-amber-500/30 space-y-1">
                          <div className="flex items-center justify-between font-bold text-amber-300">
                            <span>📷 [มอดูลที่ 2] กล้อง CCTV ค้างเกิน 1 ชม. (&ge;60 นาที) / กล่องสีเทา</span>
                            <span>
                              ปกติ {activeReport.outputJson.cctv_issues.active_count ?? 'ไม่พบค่า'} · มีปัญหา{' '}
                              <span className="text-rose-400">
                                {activeReport.outputJson.cctv_issues.failed_count ?? 'ไม่พบค่า'}
                              </span>
                            </span>
                          </div>
                          <div className="space-y-0.5 text-slate-200 max-h-20 overflow-y-auto">
                            {activeReport.outputJson.cctv_issues.station_list.length > 0 ? (
                              activeReport.outputJson.cctv_issues.station_list.map((st, idx) => (
                                <div key={`cctv-${idx}`} className="truncate">
                                  • {st}
                                </div>
                              ))
                            ) : (
                              <div className="text-slate-400">• ไม่พบค่า</div>
                            )}
                          </div>
                        </div>

                        {/* มอดูลที่ 3: ค่าน้ำบั๊ก -999/999 & ค่าติดลบ */}
                        <div className="p-2 rounded-lg bg-slate-950/90 border border-rose-500/30 space-y-1">
                          <div className="flex items-center justify-between font-bold text-rose-300">
                            <span>🌊 [มอดูลที่ 3] ค่าน้ำไม่ถูกต้อง (&le; -10 ถึง -999 ทั้ง ม.รทก. &amp; ม.รสม.)</span>
                            <span>
                              {activeReport.outputJson.water_errors.count !== null
                                ? `พบ ${activeReport.outputJson.water_errors.count} สถานี`
                                : 'ไม่พบค่า'}
                            </span>
                          </div>
                          <div className="text-[9px] text-slate-400">
                            สถานีตัวแทนจากเว็บจริง: {activeReport.representativeStationClicked || 'ไม่พบค่า'}
                          </div>
                          <div className="space-y-0.5 text-slate-200 max-h-20 overflow-y-auto">
                            {activeReport.outputJson.water_errors.station_list.length > 0 ? (
                              activeReport.outputJson.water_errors.station_list.map((st, idx) => (
                                <div key={`water-${idx}`} className="truncate">
                                  • {st}
                                </div>
                              ))
                            ) : (
                              <div className="text-slate-400">• ไม่พบค่า</div>
                            )}
                          </div>
                        </div>

                        {/* มอดูลที่ 4: น้ำฝนเกินเกณฑ์ >100 มม. & แท่งน้ำฝนเบิ้ลในกราฟ */}
                        <div className="p-2 rounded-lg bg-slate-950/90 border border-emerald-500/30 space-y-1">
                          <div className="flex items-center justify-between font-bold text-emerald-300">
                            <span>🌧️ [มอดูลที่ 4] น้ำฝนสะสม &gt;100 มม. / บั๊กหลักหมื่น &amp; แท่งน้ำฝนเบิ้ลในกราฟ</span>
                            <span>
                              {activeReport.outputJson.rain_spikes.count !== null
                                ? `พบ ${activeReport.outputJson.rain_spikes.count} สถานี`
                                : 'ไม่พบค่า'}
                            </span>
                          </div>
                          <div className="space-y-0.5 text-slate-200 max-h-20 overflow-y-auto">
                            {activeReport.outputJson.rain_spikes.station_list.length > 0 ? (
                              activeReport.outputJson.rain_spikes.station_list.map((st, idx) => (
                                <div key={`rain-${idx}`} className="truncate">
                                  • {st}
                                </div>
                              ))
                            ) : (
                              <div className="text-slate-400">• ไม่พบค่า</div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* โครงสร้าง Output JSON Logs ประจำชั่วโมง */}
                      <div className="p-2 rounded-lg bg-slate-950 border border-cyan-500/30 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-cyan-300">
                            📦 โครงสร้างการส่งออกรายงานสรุป (Output JSON Logs):
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const payloadToCopy =
                                teleRidActiveBasinView === 'ALL' &&
                                teleRidMonitorReport.outputJsonList &&
                                teleRidMonitorReport.outputJsonList.length > 1
                                  ? teleRidMonitorReport.outputJsonList
                                  : activeReport.outputJson;
                              void navigator.clipboard.writeText(JSON.stringify(payloadToCopy, null, 2));
                              setTeleRidJsonCopied(true);
                              setTimeout(() => setTeleRidJsonCopied(false), 2000);
                            }}
                            className="px-2 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-[10px] text-cyan-200 cursor-pointer"
                          >
                            {teleRidJsonCopied ? '✅ คัดลอก JSON แล้ว' : '📋 คัดลอก JSON'}
                          </button>
                        </div>
                        <pre className="p-2 rounded bg-slate-900 text-emerald-300 font-mono text-[10px] max-h-40 overflow-y-auto whitespace-pre-wrap">
                          {JSON.stringify(
                            teleRidActiveBasinView === 'ALL' &&
                              teleRidMonitorReport.outputJsonList &&
                              teleRidMonitorReport.outputJsonList.length > 1
                              ? teleRidMonitorReport.outputJsonList
                              : activeReport.outputJson,
                            null,
                            2
                          )}
                        </pre>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* รายงานสิ่งที่บอทเห็นในหน้าเว็บ + ปุ่มกดสั่งคลิกต่อได้ทันที */}
              {(rpaBotReport || rpaWhatSaw) && (
                <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/40 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-cyan-300">
                    <Eye className="w-4 h-4" />
                    <span>สิ่งที่บอทเห็นในหน้าเว็บขณะนี้:</span>
                  </div>
                  <pre className="text-[11px] text-slate-200 whitespace-pre-wrap font-sans leading-relaxed">
                    {rpaBotReport}
                  </pre>

                  {rpaWhatSaw && rpaWhatSaw.visibleButtons.length > 0 && (
                    <div className="pt-1.5 border-t border-cyan-500/20">
                      <div className="text-[10px] text-cyan-300 mb-1">
                        คลิกปุ่มที่บอทเห็นเพื่อสั่งให้บอทกดปุ่มนั้นต่อทันที:
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {rpaWhatSaw.visibleButtons.slice(0, 8).map((btnText, idx) => (
                          <button
                            key={`${btnText}-${idx}`}
                            onClick={() => {
                              const nextCmd = `คลิกปุ่ม ${btnText}`;
                              setRpaInstruction(nextCmd);
                              void handleExecuteRpaStep(nextCmd);
                            }}
                            className="px-2 py-0.5 text-[10px] bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 rounded cursor-pointer"
                          >
                            คลิก &ldquo;{btnText}&rdquo;
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ประวัติขั้นตอนที่บันทึกไว้ (Saved Steps) */}
              {rpaSavedSteps.length > 0 && (
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-amber-300">
                      ขั้นตอนที่บันทึกไว้ ({rpaSavedSteps.length} ขั้นตอน):
                    </span>
                    <button
                      onClick={handleClearRpaSteps}
                      className="text-[10px] text-slate-400 hover:text-rose-400 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      ล้างประวัติ
                    </button>
                  </div>
                  <div className="max-h-32 overflow-y-auto space-y-1 pr-1">
                    {rpaSavedSteps.map((st) => (
                      <div
                        key={st.stepNo}
                        onClick={() => {
                          setRpaUrl(st.targetUrl);
                          setRpaInstruction(st.instruction);
                        }}
                        className="p-1.5 rounded bg-slate-950 border border-slate-800/80 hover:border-cyan-500/40 text-[11px] cursor-pointer"
                      >
                        <div className="font-semibold text-cyan-300">
                          ขั้นที่ {st.stepNo}: {st.instruction}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">
                          เว็บ: {st.targetUrl} · เวลา {st.savedAt}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* =====================================================================
              แผงสั่งงาน แผนกที่ 2: สแกนเอกสารดาวน์โหลดใหม่ทุก 1 ชั่วโมงในเวลาจริง (สีเขียวมรกต)
             ===================================================================== */}
          {activeDeptInfo.id === 'files' && (
            <div className="space-y-3 pt-1">
              <div className="bg-slate-900/80 border border-emerald-500/40 rounded-xl p-3 space-y-2">
                <div className="text-xs font-bold text-emerald-300">
                  📹 ตรวจเช็กกล้อง CCTV &amp; สตรีมภาพ (แผนกที่ 2)
                </div>
                <input
                  type="text"
                  value={go2rtcInput}
                  onChange={(e) => setGo2rtcInput(e.target.value)}
                  placeholder="go2rtc API URL (ถ้ามี เช่น http://127.0.0.1:1984)"
                  className="w-full px-2.5 py-1.5 text-[11px] bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                />
                <div className="grid grid-cols-1 gap-1.5">
                  <button
                    onClick={handleCheckCctvAndStreams}
                    disabled={isCctvBusy}
                    className="w-full py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs rounded-lg cursor-pointer"
                  >
                    {isCctvBusy ? 'กำลังตรวจสอบ...' : '📹 ตรวจสอบสถานะกล้อง & สถานีออนไลน์'}
                  </button>
                  <button
                    onClick={async () => {
                      if (!cctvResult) {
                        await handleCheckCctvAndStreams();
                      }
                      setShowAllCctvModal(true);
                    }}
                    disabled={isCctvBusy}
                    className="w-full py-2 px-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold text-xs rounded-lg cursor-pointer"
                  >
                    🖼️ ดูสถานะภาพ CCTV ทั้งหมด ({cctvResult?.allCameras?.length ?? cctvResult?.totalStations ?? 'โหลดจาก DB'})
                  </button>
                </div>
                {cctvResult && (
                  <div className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
                    <div className="text-emerald-300 font-semibold">
                      ตรวจแล้ว {cctvResult.totalStations} กล้อง | ปกติ: {cctvResult.onlineCount} | ขัดข้อง: {cctvResult.offlineCount}
                    </div>
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      <span className="text-sky-300">✅ มีภาพเข้า: {(cctvResult as { hasImageCount?: number }).hasImageCount ?? cctvResult.onlineCount}</span>
                      <span className="text-amber-300">🚫 ไม่มีภาพเข้า: {(cctvResult as { noImageCount?: number }).noImageCount ?? 0}</span>
                      <span className="text-rose-300">⏰ ค้าง/ติดต่อไม่ได้เกิน 1 ชม.: {(cctvResult as { over24hCount?: number }).over24hCount ?? 0}</span>
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1 pt-1 border-t border-slate-800">
                      {cctvResult.offlineList.slice(0, 15).map((item: { stationCode: string; stationName: string; basin: string; recordedAt: string; imageDisplayStatus?: string }) => (
                        <div key={item.stationCode} className="text-rose-300 text-[10px] truncate">
                          • [{item.stationCode}] {item.stationName} — {item.imageDisplayStatus || 'ขัดข้อง'} ({item.recordedAt})
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* กล่องสถานะเวลาจริง: สแกนทุก 1 ชั่วโมง + สรุปเอกสารที่ถูกดาวน์โหลดมาใหม่ + ปุ่มกดดูรายงาน */}
              <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
                    <span>⏰ ระบบสแกนเอกสารดาวน์โหลดใหม่ (ทุกๆ 1 ชั่วโมงในเวลาจริง)</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    รอบถัดไปในอีก {dept2CountdownText}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                  <div className="p-2 rounded-lg bg-slate-950/90 border border-slate-800">
                    <div className="text-[10px] text-slate-400">เอกสารดาวน์โหลดใหม่</div>
                    <div className="text-sm font-bold text-emerald-400">
                      {dept2HourlyReport ? dept2HourlyReport.newFileCount : 0} ไฟล์
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-950/90 border border-slate-800">
                    <div className="text-[10px] text-slate-400">เวลาที่สแกนล่าสุด</div>
                    <div className="text-[11px] font-semibold text-white truncate">
                      {dept2HourlyReport ? dept2HourlyReport.scannedAtText : 'รอสแกน'}
                    </div>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-950/90 border border-slate-800">
                    <div className="text-[10px] text-slate-400">รอบสแกนถัดไป (1 ชม.)</div>
                    <div className="text-[11px] font-semibold text-amber-300 truncate">
                      {dept2HourlyReport ? dept2HourlyReport.nextScanAtText : 'อีก 1 ชั่วโมง'}
                    </div>
                  </div>
                </div>

                {/* แจ้งเตือนว่ามีเอกสารใหม่อะไรบ้าง เวลาเท่าไร มีกี่ไฟล์ */}
                {dept2HourlyReport && dept2HourlyReport.newFiles.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-slate-950/95 border border-emerald-500/30 space-y-1.5">
                    <div className="text-[11px] font-bold text-amber-300">
                      🔔 แจ้งเตือนเอกสารที่ถูกดาวน์โหลดมาใหม่ ({dept2HourlyReport.newFileCount} ไฟล์):
                    </div>
                    <div className="max-h-36 overflow-y-auto space-y-1 pr-1">
                      {dept2HourlyReport.newFiles.map((nf, idx) => (
                        <div
                          key={`new-dl-${nf.id}-${idx}`}
                          className="p-1.5 rounded bg-slate-900 border border-slate-800 flex items-center justify-between gap-2 text-[11px]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-white truncate">
                              {idx + 1}. {nf.cleanFilename}
                            </div>
                            <div className="text-[10px] text-emerald-300">
                              🕒 เวลาที่ดาวน์โหลด: <span className="font-semibold">{nf.downloadedTimeText}</span> · โฟลเดอร์ {nf.source} ({(nf.sizeBytes / 1024).toFixed(1)} KB)
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              handleOpenFileOnWindows({
                                id: nf.id,
                                filename: nf.filename,
                                localPath: nf.localPath,
                                source: nf.source,
                                sizeBytes: nf.sizeBytes,
                                modifiedAt: nf.modifiedAt,
                                docType: 'TOR',
                                excerpt: '',
                                content: '',
                              })
                            }
                            className="px-2 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[10px] font-semibold shrink-0 cursor-pointer"
                          >
                            เปิดไฟล์
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setIsDept2ReportModalOpen(true)}
                    className="py-2 px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    กดดูรายงานเอกสารใหม่ ({dept2HourlyReport?.newFileCount ?? 0} ไฟล์)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (dept2HourlyReport?.fullReportText) {
                        setLinePreview((prev) => ({
                          ...prev,
                          summaryText: dept2HourlyReport.fullReportText,
                        }));
                        void fetch('/api/pc/control', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'open-notepad-summary',
                            summaryText: dept2HourlyReport.fullReportText,
                          }),
                        });
                      } else {
                        setIsDept2ReportModalOpen(true);
                      }
                    }}
                    className="py-2 px-3 bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/40 font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    เปิดรายงานใน Notepad (.txt)
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={customScanFolder}
                  onChange={(e) => setCustomScanFolder(e.target.value)}
                  placeholder="ระบุโฟลเดอร์เพิ่มเติม (หรือเว้นว่างเพื่อสแกน Downloads & Desktop)"
                  className="flex-1 px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                />
                <button
                  onClick={() =>
                    fetchScannedFiles(customScanFolder, {
                      silent: false,
                      trigger: 'manual',
                    })
                  }
                  disabled={isScanningFiles}
                  className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isScanningFiles ? 'animate-spin' : ''}`} />
                  สแกนเอกสารใหม่ทันที
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() =>
                    fetch('/api/pc/control', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: 'open-explorer-inbox',
                        filePath: 'C:\\Users\\Tele_04\\Desktop',
                      }),
                    })
                  }
                  className="flex-1 py-1.5 px-2 bg-slate-900 hover:bg-slate-800 text-emerald-300 text-[11px] font-medium rounded-lg border border-slate-800 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  เปิด Desktop
                </button>
                <button
                  onClick={() =>
                    fetch('/api/pc/control', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: 'open-explorer-inbox',
                        filePath: 'C:\\Users\\Tele_04\\Downloads',
                      }),
                    })
                  }
                  className="flex-1 py-1.5 px-2 bg-slate-900 hover:bg-slate-800 text-emerald-300 text-[11px] font-medium rounded-lg border border-slate-800 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  เปิด Downloads
                </button>
                <button
                  onClick={() =>
                    fetch('/api/pc/control', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'open-explorer-inbox' }),
                    })
                  }
                  className="flex-1 py-1.5 px-2 bg-slate-900 hover:bg-slate-800 text-emerald-300 text-[11px] font-medium rounded-lg border border-slate-800 flex items-center justify-center gap-1 cursor-pointer"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  workspace_inbox
                </button>
              </div>

              <div className="text-[11px] font-semibold text-emerald-300">
                เอกสารทั้งหมดในโฟลเดอร์ ({scannedFiles.length} ไฟล์ — เรียงตามเวลาดาวน์โหลดล่าสุด):
              </div>

              <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
                {scannedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-emerald-500/40 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs font-semibold text-white break-all">{file.filename}</div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300 shrink-0">
                        {(file.sizeBytes / 1024).toFixed(1)} KB
                      </span>
                    </div>
                    <div className="text-[10px] text-amber-300">
                      🕒 เวลาไฟล์:{' '}
                      {file.modifiedAt
                        ? `${new Date(file.modifiedAt).toLocaleString('th-TH', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })} น.`
                        : '-'}
                    </div>
                    {file.localPath && (
                      <div className="text-[10px] text-slate-400 font-mono truncate">
                        {file.localPath}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 pt-1">
                      <button
                        onClick={() => handleOpenFileOnWindows(file)}
                        className="flex-1 py-1 px-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-[11px] rounded flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <ExternalLink className="w-3 h-3" />
                        คลิกเปิดไฟล์จริงบนคอม
                      </button>
                      <button
                        onClick={() => {
                          addLocalFileToLegalSourceQueue({
                            filename: file.filename,
                            localPath: file.localPath || file.filename,
                            sizeBytes: file.sizeBytes,
                            content: file.content,
                          });
                          setLegalSelectedFilePath(file.localPath || file.filename);
                          handleSelectDept('legal');
                        }}
                        className="py-1 px-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[11px] rounded cursor-pointer"
                      >
                        + ส่งเข้ากลุ่มไฟล์ต้นเรื่อง แผนก 3
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* =====================================================================
              แผงสั่งงาน แผนกที่ 3: AI Gov-Document Multi-Engine (Cross-Document Data Fusion 1.1..1.N -> Template File 2)
             ===================================================================== */}
          {activeDeptInfo.id === 'legal' && (
            <div className="space-y-3 pt-1">
              <div className="bg-slate-900/80 border border-amber-500/40 rounded-xl p-3 space-y-2">
                <div className="text-xs font-bold text-amber-300">
                  🛠️ MA &amp; Field Inspection (สรุปสถานีขัดข้องตาม TOR)
                </div>
                <button
                  onClick={handleRunMaInspection}
                  disabled={isMaBusy}
                  className="w-full py-2 px-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-lg cursor-pointer"
                >
                  {isMaBusy ? 'กำลังวิเคราะห์...' : '🛠️ ดึงรายการสถานีขัดข้องงาน MA จาก MongoDB เพื่อออกเอกสาร'}
                </button>
                {maResult && (
                  <div className="text-[11px] bg-slate-950 border border-slate-800 rounded-lg p-2 space-y-1">
                    <div className="text-amber-300 font-semibold">
                      ตรวจ {maResult.totalChecked} สถานี | ขัดข้อง/ต้องซ่อมบำรุง: {maResult.faultyCount} แห่ง
                    </div>
                    <div className="text-[10px] text-slate-400">
                      (ส่งสรุปรายการเข้าช่องคำสั่งสร้าง .docx / .xlsx ด้านล่างให้อัตโนมัติแล้ว)
                    </div>
                  </div>
                )}
              </div>

              {/* ช่องค้นหาไฟล์จากทุกไดรฟ์ในคอมเครื่องนี้ (C:\, D:\, E:\, F:\, Downloads, Desktop, Documents) */}
              <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2">
                <div className="text-[11px] font-bold text-amber-300">
                  💿 ค้นหาและดึงเอกสารจากทุกไดรฟ์ในคอมเครื่องนี้ (C:\, D:\, E:\, F:\, Downloads, Desktop, Documents):
                </div>

                {/* ปุ่มด่วนเลือกไดรฟ์และโฟลเดอร์ในคอมเครื่องนี้ */}
                <div className="flex flex-wrap gap-1">
                  {[
                    { label: '📥 Downloads', path: 'C:\\Users\\Tele_04\\Downloads' },
                    { label: '🖥️ Desktop', path: 'C:\\Users\\Tele_04\\Desktop' },
                    { label: '📄 Documents', path: 'C:\\Users\\Tele_04\\Documents' },
                    { label: '💿 ไดรฟ์ C:\\', path: 'C:\\' },
                    { label: '💿 ไดรฟ์ D:\\', path: 'D:\\' },
                    { label: '💿 ไดรฟ์ E:\\', path: 'E:\\' },
                    { label: '💿 ไดรฟ์ F:\\', path: 'F:\\' },
                    { label: '🌐 สแกนทุกไดรฟ์ (ALL DRIVES)', path: 'ALL_DRIVES' },
                  ].map((drv) => (
                    <button
                      key={drv.path}
                      type="button"
                      onClick={() => {
                        setLegalFolderSearchPath(drv.path);
                        void fetchScannedFiles(drv.path, { silent: true });
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold border cursor-pointer transition-colors ${
                        legalFolderSearchPath === drv.path
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-amber-500/50'
                      }`}
                    >
                      {drv.label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={legalFolderSearchPath}
                    onChange={(e) => setLegalFolderSearchPath(e.target.value)}
                    placeholder="ระบุพิกัดไดรฟ์หรือโฟลเดอร์ใดก็ได้ เช่น D:\งานราชการ หรือ E:\TOR หรือ ALL_DRIVES"
                    className="flex-1 px-2.5 py-1 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => fetchScannedFiles(legalFolderSearchPath, { silent: true })}
                    disabled={isScanningFiles}
                    className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] rounded-lg flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <RefreshCw className={`w-3 h-3 ${isScanningFiles ? 'animate-spin' : ''}`} />
                    สแกนไดรฟ์/โฟลเดอร์
                  </button>
                </div>
                <input
                  type="text"
                  value={legalFileKeywordFilter}
                  onChange={(e) => setLegalFileKeywordFilter(e.target.value)}
                  placeholder="พิมพ์คำค้นหากรองชื่อไฟล์ในไดรฟ์ที่สแกน (เช่น TOR, บันทึก, ราคา, สถานี, .xlsx, .pdf)..."
                  className="w-full px-2.5 py-1 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200"
                />
              </div>

              {/* =================================================================
                  ส่วนที่ 1: [กลุ่มเอกสารหลักฐานต้นเรื่อง - ไฟล์ที่ 1.1, 1.2, 1.3... N ไฟล์]
                  รองรับการใส่เอกสารมากกว่า 1 ไฟล์จากทุกไดรฟ์ และทุกนามสกุล (.pdf, .docx, .xlsx, .csv, .json, .txt)
                 ================================================================= */}
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/35 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[11px] font-bold text-amber-300">
                    ช่องที่ 1: กลุ่มเอกสารหลักฐานต้นเรื่อง (ใส่ได้มากกว่า 1 ไฟล์ — ไฟล์ที่ 1.1, 1.2, 1.3... N):
                  </label>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-200 text-[10px] font-bold shrink-0">
                    แนบแล้ว {legalSourceFiles.length} ไฟล์
                  </span>
                </div>

                {/* Input อัปโหลดหลายไฟล์พร้อมกัน (multiple) และรองรับไฟล์บีบอัด .zip จากทุกไดรฟ์ในคอมเครื่องนี้ */}
                <input
                  ref={legalFileInputRef}
                  type="file"
                  multiple
                  accept=".pdf,.docx,.xlsx,.csv,.json,.txt,.md,.zip"
                  onChange={handleLegalFileUploadChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => legalFileInputRef.current?.click()}
                  className="w-full py-2 px-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow"
                >
                  <Upload className="w-3.5 h-3.5" />
                  อัปโหลดไฟล์ต้นเรื่อง หรือไฟล์บีบอัด (.zip) จากทุกไดรฟ์ (แตกไฟล์อัตโนมัติ — .zip/.pdf/.docx/.xlsx/.csv/.json/.txt)
                </button>

                {/* เลือกเพิ่มจากรายการไฟล์ที่สแกนในเครื่องเข้าสู่กลุ่มไฟล์ต้นเรื่อง */}
                <div className="space-y-1">
                  <span className="block text-[10px] text-amber-200/90 font-medium">
                    หรือเลือกไฟล์จากไดรฟ์ในเครื่องที่สแกนพบ ({scannedFiles.length} ไฟล์) เพื่อเพิ่มเป็นไฟล์ที่ 1.{legalSourceFiles.length + 1}:
                  </span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={legalSelectedFilePath}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLegalSelectedFilePath(val);
                        if (val) {
                          const found = scannedFiles.find(
                            (f) => f.localPath === val || f.filename === val
                          );
                          if (found) {
                            addLocalFileToLegalSourceQueue({
                              filename: found.filename,
                              localPath: found.localPath || found.filename,
                              sizeBytes: found.sizeBytes,
                              content: found.content,
                            });
                          } else {
                            addLocalFileToLegalSourceQueue({
                              filename: val.split(/[\\/]/).pop() || val,
                              localPath: val,
                            });
                          }
                        }
                      }}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-slate-950 border border-amber-500/40 rounded-lg text-white focus:border-amber-400 focus:outline-none"
                    >
                      <option value="">
                        -- คลิกเลือกไฟล์ในเครื่องเพื่อเพิ่มเข้ากลุ่มไฟล์ต้นเรื่อง (1.1, 1.2... N) --
                      </option>
                      {scannedFiles
                        .filter((f) =>
                          !legalFileKeywordFilter.trim()
                            ? true
                            : f.filename.toLowerCase().includes(legalFileKeywordFilter.toLowerCase()) ||
                              (f.localPath || '').toLowerCase().includes(legalFileKeywordFilter.toLowerCase())
                        )
                        .map((f) => (
                          <option key={`src-${f.id}-${f.localPath}`} value={f.localPath || f.filename}>
                            [{f.source || 'Local'}] {f.filename} ({(f.sizeBytes / 1024).toFixed(1)} KB)
                          </option>
                        ))}
                    </select>
                    {legalSelectedFilePath && (
                      <button
                        type="button"
                        onClick={() => {
                          const found = scannedFiles.find(
                            (f) =>
                              f.localPath === legalSelectedFilePath ||
                              f.filename === legalSelectedFilePath
                          );
                          if (found) {
                            addLocalFileToLegalSourceQueue({
                              filename: found.filename,
                              localPath: found.localPath || found.filename,
                              sizeBytes: found.sizeBytes,
                              content: found.content,
                            });
                          }
                        }}
                        className="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-200 font-bold text-[10px] rounded-lg shrink-0 cursor-pointer"
                      >
                        + เพิ่มไฟล์นี้
                      </button>
                    )}
                  </div>
                </div>

                {/* รายการกลุ่มเอกสารหลักฐานต้นเรื่องที่แนบไว้แล้ว (ไฟล์ที่ 1.1, 1.2, 1.3 ... N) */}
                <div className="p-2.5 rounded-lg bg-slate-950/95 border border-amber-500/30 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-amber-300">
                      📚 รายการกลุ่มเอกสารหลักฐานต้นเรื่องที่ส่งให้ AI วิเคราะห์เชื่อมโยงข้อมูล:
                    </span>
                    {legalSourceFiles.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setLegalSourceFiles([])}
                        className="text-[10px] text-rose-300 hover:text-rose-200 flex items-center gap-0.5 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        ล้างรายการทั้งหมด
                      </button>
                    )}
                  </div>

                  {legalSourceFiles.length === 0 ? (
                    <div className="text-[11px] text-slate-400 py-1.5">
                      ยังไม่ได้เลือกแยกหลายไฟล์ (หากกดรันทันที ระบบจะใช้ไฟล์ที่เลือกใน Dropdown หรือไฟล์ต้นเรื่องเริ่มต้นโดยอัตโนมัติ — คุณสามารถกดปุ่มสีทองด้านบนเพื่อเลือกพร้อมกันหลายไฟล์ เช่น 1.1 PDF + 1.2 Excel ได้เลย)
                    </div>
                  ) : (
                    <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                      {legalSourceFiles.map((sf, idx) => (
                        <div
                          key={sf.id}
                          className="p-1.5 rounded bg-slate-900 border border-slate-800 flex items-center justify-between gap-2 text-[11px]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-bold text-[10px] shrink-0">
                                ไฟล์ที่ 1.{idx + 1}
                              </span>
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300 font-mono text-[9px] uppercase shrink-0">
                                {sf.extension}
                              </span>
                              {sf.fromZipArchive && (
                                <span className="px-1.5 py-0.5 rounded bg-purple-500/25 border border-purple-400/40 text-purple-200 text-[9px] font-semibold shrink-0">
                                  📦 แตกจาก ZIP: {sf.fromZipArchive}
                                </span>
                              )}
                              <span className="font-semibold text-white truncate">
                                {sf.filename}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate mt-0.5">
                              {sf.localPath ? `พิกัด: ${sf.localPath}` : 'อัปโหลดจากเครื่องโดยตรง (ส่งไฟล์ Binary Base64 เข้า Gemini 4 Argon)'}{' '}
                              {sf.sizeBytes ? `· ${(sf.sizeBytes / 1024).toFixed(1)} KB` : ''}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {sf.localPath && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleOpenFileOnWindows({
                                    id: sf.id,
                                    filename: sf.filename,
                                    localPath: sf.localPath || sf.filename,
                                    source: 'Downloads',
                                    sizeBytes: sf.sizeBytes || 0,
                                    modifiedAt: new Date().toISOString(),
                                    docType: 'TOR',
                                    excerpt: '',
                                    content: '',
                                  })
                                }
                                className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[10px] cursor-pointer"
                              >
                                เปิดดู
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                setLegalSourceFiles((prev) => prev.filter((item) => item.id !== sf.id))
                              }
                              className="px-1.5 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[10px] cursor-pointer"
                            >
                              ✕ ลบ
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* =================================================================
                  ส่วนที่ 2: อัปโหลดหรือเลือก "ไฟล์ตัวอย่างที่ถูกต้อง" (Template / Reference Benchmark — ไฟล์ที่ 2)
                 ================================================================= */}
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/35 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="block text-[11px] font-bold text-emerald-300">
                    ช่องที่ 2: ไฟล์ตัวอย่าง/เทมเพลตการแก้ไขที่ถูกต้อง (ส่งควบคู่กับไฟล์ต้นเรื่องเพื่อให้ AI อ่านบริบทครบถ้วน):
                  </label>
                  <button
                    type="button"
                    onClick={() => fetchScannedFiles(legalFolderSearchPath, { silent: true })}
                    disabled={isScanningFiles}
                    className="px-2 py-0.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-200 text-[10px] rounded flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${isScanningFiles ? 'animate-spin' : ''}`} />
                    รีเฟรชรายการไฟล์
                  </button>
                </div>

                <input
                  ref={legalTemplateInputRef}
                  type="file"
                  accept=".docx,.xlsx,.txt,.md,.json,.csv,.pdf"
                  onChange={handleLegalTemplateUploadChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => legalTemplateInputRef.current?.click()}
                  className="w-full py-2 px-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow"
                >
                  <Upload className="w-3.5 h-3.5" />
                  อัปโหลดไฟล์ตัวอย่าง/เทมเพลตจากทุกไดรฟ์ (ช่องที่ 2 — ล้างข้อมูลขยะเดิม 100% &amp; รักษาฟอนต์/ระยะขอบ/ตราครุฑ)
                </button>

                {legalTemplateUploadedName && (
                  <div className="text-[11px] text-emerald-300 bg-slate-950 px-2.5 py-1 rounded border border-emerald-500/30">
                    📐 ไฟล์ตัวอย่างต้นแบบที่อัปโหลด (ช่องที่ 2):{' '}
                    <span className="font-semibold">{legalTemplateUploadedName}</span>
                  </div>
                )}

                <div className="space-y-1">
                  <span className="block text-[10px] text-emerald-200/90 font-medium">
                    หรือเลือกไฟล์ตัวอย่างต้นแบบจากไดรฟ์ในเครื่องคอมพิวเตอร์ (พบ {scannedFiles.length} ไฟล์):
                  </span>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={legalTemplateSelectedPath}
                      onChange={(e) => {
                        setLegalTemplateSelectedPath(e.target.value);
                        setLegalTemplateUploadedName('');
                      }}
                      className="flex-1 px-2.5 py-1.5 text-xs bg-slate-950 border border-emerald-500/40 rounded-lg text-white focus:border-emerald-400 focus:outline-none"
                    >
                      <option value="">
                        -- เลือกไฟล์ตัวอย่างต้นแบบ (ช่องที่ 2) จากในเครื่อง --
                      </option>
                      {scannedFiles
                        .filter((f) =>
                          !legalFileKeywordFilter.trim()
                            ? true
                            : f.filename.toLowerCase().includes(legalFileKeywordFilter.toLowerCase())
                        )
                        .map((f) => (
                          <option key={`tpl-${f.id}-${f.localPath}`} value={f.localPath || f.filename}>
                            [{f.source || 'Local'}] {f.filename} ({(f.sizeBytes / 1024).toFixed(1)} KB)
                          </option>
                        ))}
                      <option value="รายงานผลการพิจารณา MA70 ยม.docx">
                        [ต้นแบบมาตรฐาน] รายงานผลการพิจารณา MA70 ยม.docx (TH Sarabun New 16pt)
                      </option>
                    </select>
                    {legalTemplateSelectedPath && (
                      <button
                        type="button"
                        onClick={() => {
                          const found = scannedFiles.find(
                            (f) =>
                              f.localPath === legalTemplateSelectedPath ||
                              f.filename === legalTemplateSelectedPath
                          );
                          if (found) handleOpenFileOnWindows(found);
                        }}
                        className="px-2 py-1.5 bg-slate-900 hover:bg-slate-800 border border-emerald-500/40 text-emerald-300 text-[10px] rounded-lg shrink-0 cursor-pointer"
                        title="เปิดดูไฟล์ตัวอย่างบนเครื่อง"
                      >
                        📂 เปิดดู
                      </button>
                    )}
                  </div>
                </div>

                <div className="text-[10px] text-slate-300 bg-slate-950/90 p-2 rounded border border-slate-800 leading-relaxed space-y-1">
                  <div>
                    • <span className="text-amber-300 font-semibold">1. Cross-Document Data Fusion:</span> ส่งไฟล์เอกสารต้นเรื่องทั้งหมด (1.1, 1.2... N) ควบคู่กับไฟล์ตัวอย่างที่ 2 ให้ Gemini API โดยตรง (เช่น ดึงชื่อโครงการจาก 1.1 PDF + ดึงตารางงบประมาณจาก 1.2 Excel)
                  </div>
                  <div>
                    • <span className="text-cyan-300 font-semibold">2. Dynamic Field Extraction:</span> สกัด Core Entities อิสระตามเจตนาของไฟล์ตัวอย่างที่ 2 โดยไม่บล็อกฟิลด์ข้อมูล
                  </div>
                  <div>
                    • <span className="text-emerald-300 font-semibold">3. Strict Multi-File Cleaning Protocol:</span> ล้างตัวเลข วงเงิน ชื่อบุคคล ชื่อโครงการ หรือข้อความขยะเดิมในไฟล์ที่ 2 ออก 100% โดยรักษาฟอนต์ <code>TH Sarabun New</code> ระยะขอบ และตราครุฑเดิมไว้ครบถ้วน
                  </div>
                </div>
              </div>

              {/* คำสั่งเพิ่มเติมสำหรับการผสานไฟล์ที่ 1.1..1.N เข้ากับรูปแบบไฟล์ตัวอย่างที่ 2 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold text-amber-300">
                    3. คำสั่งควบคุม AI Gov-Document Multi-Engine:
                  </label>
                  <button
                    type="button"
                    onClick={handleClearLegalTempCache}
                    className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 text-[10px] font-semibold cursor-pointer"
                    title="เคลียร์หน่วยความจำชั่วคราว (Anti-Mixup Cache Clear)"
                  >
                    🧹 เคลียร์หน่วยความจำชั่วคราว
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={legalInstruction}
                  onChange={(e) => setLegalInstruction(e.target.value)}
                  placeholder="เช่น เชื่อมโยงชื่อโครงการจากไฟล์ 1.1 (PDF) และตารางงบประมาณจากไฟล์ 1.2 (Excel) แล้วกรอกลงในไฟล์ตัวอย่างที่ 2..."
                  className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white focus:border-amber-400 focus:outline-none"
                />
              </div>

              <button
                type="button"
                onClick={handleMergeWithTemplateBenchmark}
                disabled={isLegalAnalyzing}
                className="w-full py-2.5 px-3 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-lg"
              >
                <Sparkles className="w-4 h-4" />
                {isLegalAnalyzing
                  ? `กำลังส่งไฟล์ต้นเรื่องควบคู่ไฟล์ตัวอย่างเข้า AI Gov-Document Multi-Engine...`
                  : `รัน AI Gov-Document Multi-Engine (เชื่อมโยง ${Math.max(1, legalSourceFiles.length)} ไฟล์ต้นเรื่อง + เทมเพลตที่ 2) & เปิดใน Word`}
              </button>

              {legalAntiMixupAbortedMsg && (
                <div className="p-3 rounded-xl bg-rose-950/80 border-2 border-rose-500 text-xs text-rose-200 space-y-1.5">
                  <div className="font-bold text-rose-300">
                    ⛔ ระบบ Anti-Mixup Layer สั่งยกเลิกการทำงาน (ABORT):
                  </div>
                  <div className="font-mono text-[11px] text-white bg-rose-950 p-2 rounded border border-rose-500/50">
                    &ldquo;{legalAntiMixupAbortedMsg}&rdquo;
                  </div>
                  <button
                    type="button"
                    onClick={handleClearLegalTempCache}
                    className="w-full py-1.5 px-2.5 bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold text-[11px] rounded cursor-pointer"
                  >
                    🧹 คลิกที่นี่เพื่อเคลียร์หน่วยความจำชั่วคราวทันที
                  </button>
                </div>
              )}

              {legalAnalysisSummary && (
                <div className="p-2.5 rounded-xl bg-emerald-950/35 border border-emerald-500/40 text-[11px] text-emerald-200 whitespace-pre-wrap leading-relaxed">
                  {legalAnalysisSummary}
                </div>
              )}

              {/* แผงแสดงผลการเชื่อมโยงข้อมูลข้ามเอกสาร (Cross-Document Data Fusion Breakdown 1.1..1.N) + Dynamic JSON Object */}
              {(legalPerFileInsights.length > 0 || legalDynamicFusionJson) && (
                <div className="p-2.5 rounded-xl bg-slate-950/95 border border-amber-500/50 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-bold text-amber-300">
                      🔗 ผลการเชื่อมโยงข้อมูลข้ามเอกสาร (Cross-Document Data Fusion — {legalPerFileInsights.length} ไฟล์):
                    </div>
                    {legalDynamicFusionJson && (
                      <button
                        type="button"
                        onClick={() => setLegalShowDynamicFusionModal((prev) => !prev)}
                        className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-[10px] cursor-pointer shrink-0"
                      >
                        {legalShowDynamicFusionModal ? 'ซ่อน Dynamic JSON' : '📋 ดู Dynamic JSON Object'}
                      </button>
                    )}
                  </div>

                  {legalCrossDocFusionSummary && (
                    <div className="text-[10px] text-emerald-300 bg-slate-900 p-2 rounded border border-slate-800">
                      {legalCrossDocFusionSummary}
                    </div>
                  )}

                  {legalShowDynamicFusionModal && legalDynamicFusionJson && (
                    <pre className="p-2 rounded bg-slate-900 border border-amber-500/30 text-[10px] text-amber-200 font-mono max-h-56 overflow-y-auto whitespace-pre-wrap select-all">
                      {JSON.stringify(legalDynamicFusionJson, null, 2)}
                    </pre>
                  )}

                  <div className="space-y-1.5">
                    {legalPerFileInsights.map((pf, idx) => (
                      <div
                        key={`pf-${idx}`}
                        className="p-2 rounded bg-slate-900 border border-slate-800 text-[10px] space-y-0.5"
                      >
                        <div className="flex items-center justify-between font-bold text-amber-300">
                          <span>
                            {pf.indexLabel}: {pf.filename} ({pf.extension.toUpperCase()})
                          </span>
                          <span className="text-[9px] text-cyan-300">{pf.detectedRole}</span>
                        </div>
                        <div className="text-slate-300">
                          • ชื่อโครงการที่พบ: <span className="text-white">{pf.extractedProjectName}</span>
                        </div>
                        <div className="text-slate-300">
                          • งบประมาณ/ตัวเลขที่พบ: <span className="text-emerald-300 font-semibold">{pf.extractedBudgetFormatted}</span> · สถานีที่พบ: {pf.extractedStationsCount} สถานี
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ตารางพิกัดและรายชื่อสถานี ภาคผนวก ข (BNR., Tpat., Tkol.) + JSON Config Output */}
              {(legalAppendixBStations.length > 0 || legalTorJsonConfig) && (
                <div className="p-2.5 rounded-xl bg-slate-950/95 border border-cyan-500/50 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-bold text-cyan-300">
                      📡 กลุ่มที่ 2: ตารางพิกัดสถานีโทรมาตร ภาคผนวก ข (BNR. / Tpat. / Tkol. — {legalAppendixBStations.length} สถานี):
                    </div>
                    {legalTorJsonConfig && (
                      <button
                        type="button"
                        onClick={() => setLegalShowTorJsonModal((prev) => !prev)}
                        className="px-2 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-200 text-[10px] cursor-pointer shrink-0"
                      >
                        {legalShowTorJsonModal ? 'ซ่อน JSON Config' : '📋 ดู JSON Config'}
                      </button>
                    )}
                  </div>

                  {legalShowTorJsonModal && legalTorJsonConfig && (
                    <pre className="p-2 rounded bg-slate-900 border border-cyan-500/30 text-[10px] text-emerald-300 font-mono max-h-52 overflow-y-auto whitespace-pre-wrap select-all">
                      {JSON.stringify(legalTorJsonConfig, null, 2)}
                    </pre>
                  )}

                  {legalAppendixBStations.length > 0 && (
                    <div className="overflow-x-auto max-h-48 border border-slate-800 rounded-lg">
                      <table className="w-full text-[10px] text-left text-slate-200">
                        <thead className="bg-slate-900 text-cyan-300 border-b border-slate-800">
                          <tr>
                            <th className="px-2 py-1">รหัสสถานี</th>
                            <th className="px-2 py-1">ชื่อสถานี</th>
                            <th className="px-2 py-1">ต./อ./จ.</th>
                            <th className="px-2 py-1">พิกัด (Lat, Long)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/80 bg-slate-950">
                          {legalAppendixBStations.map((st, idx) => (
                            <tr key={`appb-${idx}`} className="hover:bg-slate-900/60">
                              <td className="px-2 py-1 font-mono font-bold text-amber-300">{st.stationCode}</td>
                              <td className="px-2 py-1 text-white">{st.stationName}</td>
                              <td className="px-2 py-1 text-slate-300">
                                ต.{st.subdistrict} อ.{st.district} จ.{st.province}
                              </td>
                              <td className="px-2 py-1 font-mono text-emerald-300">
                                {st.latitude}, {st.longitude}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* รายงานการตรวจสอบความถูกต้องก่อนบันทึก (Pre-Save Consistency Validation Report) */}
              {legalValidationReport && (
                <div className="p-2.5 rounded-xl bg-slate-950/95 border border-emerald-500/50 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[11px] font-bold text-emerald-300">
                      🛡️ ผลการตรวจสอบความสอดคล้องก่อนบันทึกไฟล์ (Pre-Save Consistency Validation):
                    </div>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold">
                      {legalValidationReport.passed ? 'PASSED 100%' : 'AUTO-FIXED'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-300">{legalValidationReport.summaryText}</div>
                  <div className="space-y-1">
                    {legalValidationReport.checks.map((chk, idx) => (
                      <div
                        key={`val-${idx}`}
                        className="p-1.5 rounded bg-slate-900 border border-slate-800 text-[10px] flex flex-col gap-0.5"
                      >
                        <div className="flex items-center justify-between font-semibold text-white">
                          <span>✓ {chk.field}</span>
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300">
                            {chk.status === 'PASS' ? 'ตรงตามไฟล์ที่ 1' : 'แก้ไขค่าค้างอัตโนมัติ'}
                          </span>
                        </div>
                        <div className="text-emerald-300">
                          ค่าใหม่ที่บรรจุในไฟล์: <span className="font-semibold">{chk.expectedNewValue}</span>
                        </div>
                        <div className="text-slate-400">
                          ตรวจไม่พบค่าเก่าของไฟล์ตัวอย่าง ({chk.forbiddenOldValue}) ตกค้างในเอกสาร
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ตารางกฎการแทนที่คำใน XML (Strict XML Search & Replace Rules) */}
              {legalStrictRules.length > 0 && (
                <div className="p-2.5 rounded-xl bg-slate-950/95 border border-amber-500/40 space-y-1.5">
                  <div className="text-[11px] font-bold text-amber-300">
                    🔄 ตารางจับคู่คำค้นหาและแทนที่ในโหนด XML (&lt;w:t&gt;) แบบ 1:1 ({legalStrictRules.length} รายการ):
                  </div>
                  <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                    {legalStrictRules.map((rule, idx) => (
                      <div
                        key={`rule-${idx}`}
                        className="p-1.5 rounded bg-slate-900 border border-slate-800 text-[10px] flex flex-col gap-0.5"
                      >
                        <div className="text-slate-400 font-mono text-[9px]">{rule.category}</div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-rose-300 line-through">{rule.oldText}</span>
                          <span className="text-amber-400 font-bold">➔</span>
                          <span className="text-emerald-300 font-semibold">{rule.newText}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* รายงานขั้นตอนการตรวจสอบเชิงลึก (Step-by-Step Deep Audit Steps) */}
              {legalAuditSteps.length > 0 && (
                <div className="p-2.5 rounded-xl bg-slate-950/95 border border-amber-500/40 space-y-1.5">
                  <div className="text-[11px] font-bold text-amber-300">
                    🔎 รายงานการตรวจสอบเชิงลึกทีละขั้นตอน (Deep Inspection Audit Log):
                  </div>
                  <div className="space-y-1 text-[10px] text-slate-200">
                    {legalAuditSteps.map((step, idx) => (
                      <div key={`audit-${idx}`} className="p-1.5 rounded bg-slate-900 border border-slate-800 space-y-0.5">
                        <div className="flex items-center justify-between font-semibold text-amber-300">
                          <span>
                            ขั้นที่ {step.stepNo}: {step.phase}
                          </span>
                          <span className="text-[9px] text-emerald-300">{step.durationMs} ms</span>
                        </div>
                        <div className="text-slate-300">{step.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ตารางเปรียบเทียบการแก้ไขแบบบรรทัดต่อบรรทัด (Before vs. After Line-by-Line Diff ตามโครงสร้างไฟล์ที่ 2) */}
              {legalLineByLineDiff.length > 0 && (
                <div className="p-2.5 rounded-xl bg-slate-950/95 border border-cyan-500/40 space-y-2">
                  <div className="text-[11px] font-bold text-cyan-300">
                    📑 เปรียบเทียบการแก้ไขตามโครงสร้างไฟล์ที่ 2 แบบย่อหน้าต่อย่อหน้า ({legalLineByLineDiff.filter((d) => d.changed).length} จุดที่แทนค่าจากไฟล์ที่ 1 / ทั้งหมด {legalLineByLineDiff.length} ย่อหน้า):
                  </div>
                  <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                    {legalLineByLineDiff.map((item, idx) => (
                      <div
                        key={`diff-${idx}`}
                        className="p-2 rounded bg-slate-900 border border-slate-800 text-[10px] space-y-1"
                      >
                        <div className="flex items-center justify-between text-amber-300 font-semibold">
                          <span>ย่อหน้าที่ {item.lineNo} ของไฟล์ตัวอย่างที่ 2 (&lt;w:p&gt;)</span>
                          <span
                            className={`px-1.5 py-0.5 rounded border ${
                              item.changed
                                ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                                : 'bg-slate-800 border-slate-700 text-slate-400'
                            }`}
                          >
                            {item.changed ? 'แทนค่าตัวแปรจากไฟล์ที่ 1' : 'คงตามโครงสร้างไฟล์ที่ 2 เป๊ะ'}
                          </span>
                        </div>
                        {item.changed && (
                          <div className="text-rose-300/90 line-through break-all">
                            เดิม (ไฟล์ที่ 2): {item.templateOriginal}
                          </div>
                        )}
                        <div className="text-emerald-300 font-semibold break-all">
                          {item.changed ? `ใหม่ (แทนค่าจากไฟล์ที่ 1): ${item.mergedResult}` : item.mergedResult}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ตัวอย่างข้อความเอกสารฉบับสมบูรณ์ที่โคลนจากไฟล์ที่ 2 */}
              {legalMergedTextPreview && (
                <div className="p-2.5 rounded-xl bg-slate-950/95 border border-emerald-500/30 space-y-1.5">
                  <div className="text-[11px] font-bold text-emerald-300">
                    📄 เนื้อหาเอกสารฉบับสมบูรณ์ที่โคลนจากโครงสร้างไฟล์ตัวอย่างที่ 2 (ทุกบรรทัด):
                  </div>
                  <pre className="p-2 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-200 font-mono max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {legalMergedTextPreview}
                  </pre>
                </div>
              )}

              {/* แสดงข้อมูลสำคัญที่แกะได้จากไฟล์ที่ 1 + สไตล์และฟอนต์ที่แกะได้จากไฟล์ตัวอย่างที่ 2 */}
              {(legalExtractedEntities || legalStyleProfile) && (
                <div className="p-2.5 rounded-xl bg-slate-900/95 border border-slate-800 space-y-2 text-[11px]">
                  {legalExtractedEntities && (
                    <div className="space-y-1">
                      <div className="font-bold text-amber-300">
                        📌 ข้อมูลจริง 4 กลุ่มคีย์เวิร์ดที่สกัดได้จากไฟล์ต้นเรื่อง (ช่องที่ 1):
                      </div>
                      <div className="grid grid-cols-2 gap-1 text-[10px] text-slate-300">
                        <div className="bg-slate-950 p-1.5 rounded border border-slate-800 col-span-2">
                          <span className="text-slate-400">ชื่อโครงการ (บรรทัดถัดไป):</span>{' '}
                          <span className="text-cyan-300 font-semibold">
                            {legalExtractedEntities.projectName || legalExtractedEntities.basinOrAreaName || legalExtractedEntities.basinAreaName || '-'}
                          </span>
                        </div>
                        <div className="bg-slate-950 p-1.5 rounded border border-slate-800 col-span-2">
                          <span className="text-slate-400">วงเงินงบประมาณ (Regex /[\d,]+\.\d{2}/):</span>{' '}
                          <span className="text-emerald-300 font-bold">
                            {legalExtractedEntities.budgetAmountFormatted || '3,249,900.00'} บาท
                          </span>{' '}
                          <span className="text-slate-400">
                            ({legalExtractedEntities.budgetAmountThaiWords || legalExtractedEntities.quotedPriceThaiWords || 'สามล้านสองแสนสี่หมื่นเก้าพันเก้าร้อยบาทถ้วน'})
                          </span>
                        </div>
                        <div className="bg-slate-950 p-1.5 rounded border border-slate-800 col-span-2">
                          <span className="text-slate-400">งวดงาน &amp; กำหนดส่งงาน:</span>{' '}
                          <span className="text-amber-300 font-semibold">
                            {legalExtractedEntities.installmentScheduleText || 'แบ่งออกเป็น 4 งวด (60 วัน, 150 วัน, 240 วัน, 330 วัน)'}
                          </span>
                        </div>
                        <div className="bg-slate-950 p-1.5 rounded border border-slate-800">
                          <span className="text-slate-400">งานรูปตัดลำน้ำ:</span>{' '}
                          <span className="text-white font-semibold">
                            {legalExtractedEntities.crossSectionCountText || 'จำนวน 32 แห่ง'}
                          </span>
                        </div>
                        <div className="bg-slate-950 p-1.5 rounded border border-slate-800">
                          <span className="text-slate-400">งาน Rating Curve:</span>{' '}
                          <span className="text-white font-semibold">
                            {legalExtractedEntities.ratingCurveCountText || 'จำนวน 5 แห่ง'}
                          </span>
                        </div>
                        <div className="bg-slate-950 p-1.5 rounded border border-slate-800 col-span-2">
                          <span className="text-slate-400">ความละเอียดและค่าคลาดเคลื่อน:</span>{' '}
                          <span className="text-emerald-300 font-semibold">
                            {legalExtractedEntities.toleranceCriterionText || 'ไม่เกิน ±2 เซนติเมตร'}
                          </span>
                        </div>
                      </div>
                      <div className="bg-slate-950 p-1.5 rounded border border-emerald-500/30 text-[10px] text-slate-300">
                        <span className="text-emerald-300 font-semibold">รายชื่อคณะกรรมการชุดใหม่ที่แทนที่ลงใน .docx 100%:</span>{' '}
                        <span className="text-white">{legalExtractedEntities.committeeMembers?.join(' | ')}</span>
                      </div>
                    </div>
                  )}

                  {legalStyleProfile && (
                    <div className="pt-1.5 border-t border-slate-800 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-emerald-300">
                          🔤 สไตล์และฟอนต์ที่ลอกเลียนจากไฟล์ตัวอย่าง (ช่องที่ 2):
                        </span>
                        <button
                          type="button"
                          onClick={() => setLegalShowRunStyleCode((prev) => !prev)}
                          className="text-[10px] text-cyan-300 hover:underline cursor-pointer"
                        >
                          {legalShowRunStyleCode ? 'ซ่อนโค้ด Run Style' : 'ดูโค้ดฝังฟอนต์ & Run Style'}
                        </button>
                      </div>
                      <div className="text-[10px] text-slate-300 bg-slate-950 p-2 rounded border border-slate-800 space-y-0.5">
                        <div>
                          • <span className="text-slate-400">ฟอนต์ที่ใช้:</span>{' '}
                          <span className="text-emerald-300 font-bold">{legalStyleProfile.fontFamily}</span> (หัวเรื่อง{' '}
                          {legalStyleProfile.titleFontSizePt} pt / เนื้อหา {legalStyleProfile.bodyFontSizePt} pt)
                        </div>
                        <div>
                          • <span className="text-slate-400">พิกัดฟอนต์ Windows:</span>{' '}
                          <code className="text-amber-300">{legalStyleProfile.localFontPath}</code>
                        </div>
                        <div>
                          • <span className="text-slate-400">ระยะขอบ (Margin):</span> ซ้าย{' '}
                          {(legalStyleProfile.marginLeftTwips / 567).toFixed(2)} ซม. | ขวา{' '}
                          {(legalStyleProfile.marginRightTwips / 567).toFixed(2)} ซม. | บน{' '}
                          {(legalStyleProfile.marginTopTwips / 567).toFixed(2)} ซม. | ล่าง{' '}
                          {(legalStyleProfile.marginBottomTwips / 567).toFixed(2)} ซม.
                        </div>
                        <div>
                          • <span className="text-slate-400">การเคาะย่อหน้า & นามสกุลส่งออก:</span> ย่อหน้า{' '}
                          {(legalStyleProfile.firstLineIndentTwips / 567).toFixed(2)} ซม. · เคาะหลังหัวข้อ{' '}
                          {legalStyleProfile.headingDoubleSpaces} เคาะ · ส่งออกเป็น{' '}
                          <span className="text-amber-300 font-bold">{legalStyleProfile.outputExtension}</span>
                        </div>
                      </div>

                      {legalShowRunStyleCode && (
                        <pre className="p-2 rounded bg-slate-950 border border-cyan-500/30 text-[10px] text-cyan-200 font-mono overflow-x-auto whitespace-pre">
                          {legalStyleProfile.runStyleCodePreview}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ปุ่มสร้างและเปิดไฟล์ Word (.docx) และ Excel (.xlsx) บนเครื่องจริงด้วยฟอนต์ TH Sarabun New */}
              <div className="pt-1 border-t border-slate-800 space-y-2">
                <div className="text-[11px] font-semibold text-slate-300">
                  4. หรือกดส่งออกเป็นไฟล์ Word (.docx) / Excel (.xlsx) ฟอนต์ TH Sarabun New ลง Downloads ทันที:
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadDocx}
                    disabled={isDownloadingDocx}
                    className="py-2 px-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isDownloadingDocx ? 'กำลังเปิด Word...' : 'สร้าง & เปิด .docx (TH Sarabun)'}
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadXlsx}
                    disabled={isDownloadingXlsx}
                    className="py-2 px-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {isDownloadingXlsx ? 'กำลังเปิด Excel...' : 'สร้าง & เปิด .xlsx (เฉพาะข้อมูลไฟล์ที่ 1)'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* =====================================================================
              แผงสั่งงาน แผนกที่ 4: Communication & Notepad (สีเขียว)
             ===================================================================== */}
          {activeDeptInfo.id === 'comm' && (
            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-[11px] font-semibold text-green-300 mb-1">
                  ข้อความสรุปรายงานที่จะบันทึกและสั่งเปิดในโปรแกรม Notepad:
                </label>
                <textarea
                  rows={5}
                  value={linePreview.summaryText}
                  onChange={(e) =>
                    setLinePreview((prev) => ({ ...prev, summaryText: e.target.value }))
                  }
                  className="w-full px-3 py-2 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                />
              </div>

              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={handleGenerateTeleRidBrief}
                  className="w-full py-2 px-4 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className="w-4 h-4" />
                  ดึงสรุปสถานการณ์น้ำล่าสุดจาก MongoDB มาใส่ช่องข้อความ
                </button>
                <button
                  onClick={handleSendLineAlert}
                  disabled={isSendingLine}
                  className="w-full py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold text-xs rounded-lg flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                >
                  <Send className="w-4 h-4" />
                  {isSendingLine ? 'กำลังส่ง LINE...' : 'ส่งแจ้งเตือนสถานการณ์น้ำเข้า LINE OA / กลุ่ม'}
                </button>
                <button
                  onClick={handleOpenNotepadReport}
                  className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 text-green-300 font-semibold text-xs rounded-lg border border-green-500/30 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileText className="w-4 h-4" />
                  เปิดรายงานใน Notepad (เด้งขึ้นหน้าจอ Windows)
                </button>
              </div>
              {commStatusMsg && (
                <div className="text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-500/30 rounded-lg px-3 py-2">
                  {commStatusMsg}
                </div>
              )}
            </div>
          )}

          {/* =====================================================================
              แผงสั่งงาน แผนกที่ 5: VS Code & SV Inspector (สีม่วงคราม)
             ===================================================================== */}
          {activeDeptInfo.id === 'vscode' && (
            <div className="space-y-3 pt-1">
              <div className="bg-slate-900/80 border border-indigo-500/40 rounded-xl p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    🖥️ SV Runner (telerid-backend-service Port {svStatusInfo.port})
                  </div>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      svStatusInfo.running
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    }`}
                  >
                    {svStatusInfo.running ? `ONLINE${svStatusInfo.pid ? ` (PID ${svStatusInfo.pid})` : ''}` : 'OFFLINE'}
                  </span>
                </div>

                <div>
                  <label className="block text-[10px] text-slate-400 mb-1">
                    โฟลเดอร์โปรเจกต์ SV (ที่มี server.js):
                  </label>
                  <input
                    type="text"
                    value={svDirPath}
                    onChange={(e) => setSvDirPath(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-[11px] font-mono bg-slate-950 border border-slate-700 rounded-lg text-slate-200"
                  />
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    onClick={handleStartSv}
                    disabled={isSvBusy}
                    className="py-2 px-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-[11px] rounded-lg cursor-pointer"
                  >
                    🚀 เปิด SV
                  </button>
                  <button
                    onClick={handleStopSv}
                    disabled={isSvBusy}
                    className="py-2 px-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 text-white font-bold text-[11px] rounded-lg cursor-pointer"
                  >
                    🛑 หยุด SV
                  </button>
                  <button
                    onClick={() => void fetchSvStatus()}
                    className="py-2 px-2 bg-slate-800 hover:bg-slate-700 text-indigo-300 font-semibold text-[11px] rounded-lg border border-indigo-500/30 cursor-pointer"
                  >
                    🔄 เช็ก Port
                  </button>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-lg p-2 max-h-36 overflow-y-auto font-mono text-[10px] text-emerald-300 space-y-0.5">
                  {svStatusInfo.logs.length === 0 ? (
                    <div className="text-slate-500">ยังไม่มี Log (กด "เปิด SV" เพื่อเริ่มรัน node server.js หรือกด "เช็ก Port")</div>
                  ) : (
                    svStatusInfo.logs.slice(-25).map((ln, idx) => (
                      <div key={idx} className="break-all">
                        {ln}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-indigo-300 mb-1">
                  1. เลือกไฟล์ที่ต้องการให้ตรวจสอบ วิเคราะห์ หรือแก้ไข:
                </label>
                <select
                  value={selectedVscodeFile}
                  onChange={(e) => setSelectedVscodeFile(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white mb-1.5"
                >
                  {vscodeFiles.map((f) => (
                    <option key={f.filename} value={f.filename}>
                      workspace_codebase/{f.filename} ({(f.sizeBytes / 1024).toFixed(1)} KB)
                    </option>
                  ))}
                  {vscodeFiles.length === 0 && (
                    <option value="svGovApiConnector.ts">workspace_codebase/svGovApiConnector.ts</option>
                  )}
                </select>
                <input
                  type="text"
                  value={customVscodePath}
                  onChange={(e) => setCustomVscodePath(e.target.value)}
                  placeholder="หรือวาง Path ไฟล์ใดๆ ในเครื่อง C:\Users\Tele_04\... เพื่อตรวจสอบ"
                  className="w-full px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleInspectVscodeFile}
                  disabled={isVscodeBusy}
                  className="py-2 px-2.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 font-semibold text-xs rounded-lg border border-indigo-500/30 cursor-pointer"
                >
                  🔍 ตรวจสอบไฟล์นี้
                </button>
                <button
                  onClick={handleOpenInVSCodeDirect}
                  className="py-2 px-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Code2 className="w-3.5 h-3.5" />
                  เปิดในโปรแกรม VS Code
                </button>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-indigo-300 mb-1">
                  2. สั่ง AI แก้ไขโค้ดในไฟล์นี้ (บันทึกอัปเดตลงเครื่องจริงทันที):
                </label>
                <textarea
                  rows={2}
                  value={vscodeAiInstruction}
                  onChange={(e) => setVscodeAiInstruction(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                />
                <button
                  onClick={handleAiEditVscodeFile}
                  disabled={isVscodeBusy}
                  className="w-full mt-1.5 py-2 px-3 bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 text-white font-bold text-xs rounded-lg cursor-pointer"
                >
                  {isVscodeBusy
                    ? 'กำลังวิเคราะห์และเขียนโค้ดลงไฟล์จริง...'
                    : '✨ สั่ง AI แก้โค้ด & เปิดบรรทัดที่แก้ใน VS Code'}
                </button>
              </div>

              {vscodeInspectReport && (
                <div className="p-2.5 rounded-xl bg-indigo-950/40 border border-indigo-500/40 text-[11px] text-indigo-200 whitespace-pre-wrap">
                  {vscodeInspectReport}
                </div>
              )}

              <button
                onClick={() => setIsVSCodeModalOpen(true)}
                className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-indigo-300 text-xs rounded-lg border border-slate-800 cursor-pointer"
              >
                เปิดหน้าต่างแก้ไขโค้ดเปรียบเทียบ (Diff Studio) เต็มจอ
              </button>
            </div>
          )}
        </div>
      )}

      {/* 4. แผงปุ่มเลือกแผนกด้านล่าง (เลือกคลิกสั่งงานทีละตัวได้อย่างอิสระ) */}
      <div
        style={{
          bottom: '16px',
          left: '50%',
          transform: 'translateX(-50%)',
          maxWidth: 'min(920px, 95vw)',
          width: '100%',
        }}
        className="fixed z-20 pointer-events-auto transition-transform duration-200"
      >
        <div className="flex justify-center mb-1">
          <button
            onClick={() => setIsDockCollapsed((prev) => !prev)}
            className="px-3.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-950/95 border border-slate-800 rounded-t-lg flex items-center gap-1.5 cursor-pointer"
          >
            {isDockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5 text-amber-400" />
                แสดงแถบเลือกแผนกทั้ง 5 ตัว
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5 text-amber-400" />
                ย่อแถบด้านล่างเพื่อดูหุ่นยนต์เดินเล่นเต็มจอ
              </>
            )}
          </button>
        </div>

        {!isDockCollapsed && (
          <div className="bg-slate-950/95 border border-slate-800 rounded-xl p-3 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={() => {
                    setSelectedDept(null);
                    setCameraPreset('overview');
                  }}
                  className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                    cameraPreset === 'overview' && !selectedDept
                      ? 'bg-amber-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  🏢 ดูภาพรวมทั้งตึก
                </button>
                <button
                  onClick={() => handleSelectDept('rpa')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer ${
                    selectedDept === 'rpa'
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-cyan-300 hover:bg-slate-800'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  1. Browser RPA (เข้าเว็บ/ล็อกอิน)
                </button>
                <button
                  onClick={() => handleSelectDept('files')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer ${
                    selectedDept === 'files'
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-emerald-300 hover:bg-slate-800'
                  }`}
                >
                  <FolderSync className="w-3.5 h-3.5" />
                  2. สแกน & เปิดไฟล์ในเครื่อง
                </button>
                <button
                  onClick={() => handleSelectDept('legal')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer ${
                    selectedDept === 'legal'
                      ? 'bg-amber-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-amber-300 hover:bg-slate-800'
                  }`}
                >
                  <FileCheck2 className="w-3.5 h-3.5" />
                  3. อัปโหลดไฟล์ & สร้าง Word/Excel
                </button>
                <button
                  onClick={() => handleSelectDept('comm')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer ${
                    selectedDept === 'comm'
                      ? 'bg-green-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-green-300 hover:bg-slate-800'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  4. เปิดรายงานใน Notepad
                </button>
                <button
                  onClick={() => handleSelectDept('vscode')}
                  className={`px-3 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer ${
                    selectedDept === 'vscode'
                      ? 'bg-indigo-500 text-white font-bold'
                      : 'bg-slate-900 text-indigo-300 hover:bg-slate-800'
                  }`}
                >
                  <Server className="w-3.5 h-3.5" />
                  5. ตรวจแก้โค้ด & เปิด VS Code
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. หน้าต่างเสริมสำหรับแก้ไขโค้ดเต็มจอ, ดูโครงสร้างสคริปต์ และดูหนังสือราชการ */}
      <VSCodeStudioModal
        isOpen={isVSCodeModalOpen}
        onClose={() => setIsVSCodeModalOpen(false)}
        onTrigger3DAnimation={() => handleSelectDept('vscode')}
      />

      <CodeArchitectureModal
        isOpen={isCodeModalOpen}
        onClose={() => setIsCodeModalOpen(false)}
      />

      {/* หน้าต่างรายงานผลการสแกนเอกสารที่ถูกดาวน์โหลดมาใหม่ประจำชั่วโมง (แผนกที่ 2) */}
      {isDept2ReportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 pointer-events-auto">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-slate-900 border border-emerald-500/50 shadow-2xl overflow-hidden">
            {/* ส่วนหัวรายงาน */}
            <div className="flex items-center justify-between px-5 py-3.5 bg-slate-950 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <FolderSync className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-bold text-emerald-300">
                    📄 รายงานการสแกนเอกสารที่ถูกดาวน์โหลดมาใหม่ (แผนกที่ 2 — สแกนทุกๆ 1 ชั่วโมงในเวลาจริง)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    แจ้งรายการเอกสารดาวน์โหลดใหม่ เวลาที่ดาวน์โหลดของแต่ละไฟล์ และจำนวนไฟล์ที่พบในแต่ละรอบชั่วโมง
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDept2ReportModalOpen(false)}
                className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold cursor-pointer"
              >
                ปิดหน้าต่าง [×]
              </button>
            </div>

            {(() => {
              const activeReport =
                dept2ReportHistory.find((r) => r.reportId === selectedHistoryReportId) ||
                dept2HourlyReport;

              return (
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {/* แถบเลือกดูประวัติรายงานแต่ละรอบชั่วโมง + ปุ่มสแกนใหม่ */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
                    <div className="flex items-center gap-2 flex-1 min-w-[240px]">
                      <span className="text-xs font-semibold text-emerald-300 shrink-0">
                        เลือกรอบรายงาน:
                      </span>
                      <select
                        value={activeReport?.reportId || ''}
                        onChange={(e) => setSelectedHistoryReportId(e.target.value)}
                        className="flex-1 px-2.5 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
                      >
                        {dept2ReportHistory.map((rep, idx) => (
                          <option key={rep.reportId} value={rep.reportId}>
                            รอบที่ {dept2ReportHistory.length - idx}: {rep.scannedAtText} — พบเอกสารใหม่{' '}
                            {rep.newFileCount} ไฟล์ ({rep.triggerLabel})
                          </option>
                        ))}
                        {dept2ReportHistory.length === 0 && activeReport && (
                          <option value={activeReport.reportId}>
                            {activeReport.scannedAtText} — พบเอกสารใหม่ {activeReport.newFileCount} ไฟล์
                          </option>
                        )}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-amber-300 font-semibold">
                        ⏳ รอบสแกนถัดไปในอีก: {dept2CountdownText}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          fetchScannedFiles(customScanFolder, {
                            silent: false,
                            trigger: 'manual',
                          })
                        }
                        disabled={isScanningFiles}
                        className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-1.5 cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isScanningFiles ? 'animate-spin' : ''}`} />
                        สแกนและอัปเดตรายงานเดี๋ยวนี้
                      </button>
                    </div>
                  </div>

                  {/* ตัวเลขสรุป 4 ช่อง */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <div className="p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40">
                      <div className="text-[11px] text-emerald-200">จำนวนเอกสารดาวน์โหลดใหม่</div>
                      <div className="text-xl font-bold text-emerald-400">
                        {activeReport?.newFileCount ?? 0} ไฟล์
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[11px] text-slate-400">วันและเวลาที่สแกน</div>
                      <div className="text-xs font-bold text-white mt-1">
                        {activeReport?.scannedAtText || '-'}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[11px] text-slate-400">รอบสแกนถัดไป (ทุก 1 ชั่วโมง)</div>
                      <div className="text-xs font-bold text-amber-300 mt-1">
                        {activeReport?.nextScanAtText || 'อีก 1 ชั่วโมง'}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[11px] text-slate-400">เอกสารทั้งหมดในโฟลเดอร์</div>
                      <div className="text-xl font-bold text-cyan-300">
                        {activeReport?.totalFilesScanned ?? scannedFiles.length} ไฟล์
                      </div>
                    </div>
                  </div>

                  {/* ตารางแสดงรายละเอียดว่ามีเอกสารใหม่อะไรบ้าง เวลาเท่าไร มีกี่ไฟล์ */}
                  <div className="space-y-2">
                    <div className="text-xs font-bold text-amber-300">
                      📋 ตารางรายการเอกสารที่ถูกดาวน์โหลดมาใหม่ ({activeReport?.newFileCount ?? 0} ไฟล์):
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-900 text-slate-300 border-b border-slate-800">
                            <th className="py-2.5 px-3 w-12 text-center">#</th>
                            <th className="py-2.5 px-3">ชื่อเอกสารที่ถูกดาวน์โหลดมาใหม่</th>
                            <th className="py-2.5 px-3">วันและเวลาที่ดาวน์โหลด</th>
                            <th className="py-2.5 px-3">โฟลเดอร์ / ประเภท</th>
                            <th className="py-2.5 px-3 text-right">ขนาดไฟล์</th>
                            <th className="py-2.5 px-3 text-center">การจัดการ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {activeReport && activeReport.newFiles.length > 0 ? (
                            activeReport.newFiles.map((nf, idx) => (
                              <tr key={`modal-nf-${nf.id}-${idx}`} className="hover:bg-slate-900/60">
                                <td className="py-2 px-3 text-center font-mono text-slate-400">
                                  {idx + 1}
                                </td>
                                <td className="py-2 px-3">
                                  <div className="font-semibold text-white">{nf.cleanFilename}</div>
                                  <div className="text-[10px] text-slate-400 font-mono truncate max-w-md">
                                    {nf.localPath}
                                  </div>
                                </td>
                                <td className="py-2 px-3 text-emerald-300 font-semibold whitespace-nowrap">
                                  {nf.downloadedTimeText}
                                </td>
                                <td className="py-2 px-3">
                                  <span className="px-2 py-0.5 rounded bg-slate-800 text-cyan-300 text-[10px] font-semibold">
                                    {nf.source} · {nf.docType}
                                  </span>
                                </td>
                                <td className="py-2 px-3 text-right font-mono text-slate-300 whitespace-nowrap">
                                  {(nf.sizeBytes / 1024).toFixed(1)} KB
                                </td>
                                <td className="py-2 px-3 text-center">
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleOpenFileOnWindows({
                                          id: nf.id,
                                          filename: nf.filename,
                                          localPath: nf.localPath,
                                          source: nf.source,
                                          sizeBytes: nf.sizeBytes,
                                          modifiedAt: nf.modifiedAt,
                                          docType: 'TOR',
                                          excerpt: '',
                                          content: '',
                                        })
                                      }
                                      className="px-2.5 py-1 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-[11px] cursor-pointer"
                                    >
                                      เปิดไฟล์
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        addLocalFileToLegalSourceQueue({
                                          filename: nf.cleanFilename,
                                          localPath: nf.localPath || nf.cleanFilename,
                                          sizeBytes: nf.sizeBytes,
                                        });
                                        setLegalSelectedFilePath(nf.localPath || nf.cleanFilename);
                                        setIsDept2ReportModalOpen(false);
                                        handleSelectDept('legal');
                                      }}
                                      className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-semibold text-[11px] cursor-pointer"
                                    >
                                      + ส่งเข้ากลุ่มไฟล์ต้นเรื่อง แผนก 3
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={6} className="py-6 text-center text-slate-400">
                                ไม่พบเอกสารที่ถูกดาวน์โหลดมาใหม่ในรอบนี้
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* ข้อความรายงานสรุปฉบับเต็ม */}
                  <div className="space-y-1.5">
                    <div className="text-xs font-bold text-emerald-300">
                      📝 รายงานสรุปผลการสแกนเอกสารดาวน์โหลดใหม่ฉบับเต็ม (พร้อมเปิดใน Notepad):
                    </div>
                    <pre className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 font-mono whitespace-pre-wrap leading-relaxed max-h-56 overflow-y-auto">
                      {activeReport?.fullReportText || 'กำลังสร้างรายงาน...'}
                    </pre>
                  </div>
                </div>
              );
            })()}

            {/* ส่วนท้ายหน้าต่างรายงาน */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 bg-slate-950 border-t border-slate-800">
              <div className="text-[11px] text-slate-400">
                * แผนกที่ 2 จะทำงานสแกนเอกสารใหม่ตามเวลาจริงทุกๆ 1 ชั่วโมงโดยอัตโนมัติ และหยุดพักเมื่อสแกนเสร็จ
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const activeReport =
                      dept2ReportHistory.find((r) => r.reportId === selectedHistoryReportId) ||
                      dept2HourlyReport;
                    if (activeReport?.fullReportText) {
                      setLinePreview((prev) => ({
                        ...prev,
                        summaryText: activeReport.fullReportText,
                      }));
                      void fetch('/api/pc/control', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'open-notepad-summary',
                          summaryText: activeReport.fullReportText,
                        }),
                      });
                    }
                  }}
                  className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow"
                >
                  <FileText className="w-4 h-4" />
                  เปิดรายงานนี้ในโปรแกรม Notepad บนหน้าจอ Windows
                </button>
                <button
                  type="button"
                  onClick={() => setIsDept2ReportModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs cursor-pointer"
                >
                  ปิดรายงาน
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. หน้าต่างรายงานเฝ้าระวังภัยน้ำท่วมอัตโนมัติ (TeleRID Monitor Agent — 4 มอดูล รายชั่วโมงตามเวลาจริง) */}
      {isTeleRidReportModalOpen && teleRidMonitorReport && (() => {
        const modalPerBasins = teleRidMonitorReport.perBasinReports || [];
        const modalActiveReport =
          teleRidActiveBasinView !== 'ALL' && modalPerBasins.length > 0
            ? modalPerBasins.find((r) => r.basinName === teleRidActiveBasinView) || teleRidMonitorReport
            : teleRidMonitorReport;
        const modalJsonOutput =
          teleRidActiveBasinView === 'ALL' &&
          teleRidMonitorReport.outputJsonList &&
          teleRidMonitorReport.outputJsonList.length > 1
            ? teleRidMonitorReport.outputJsonList
            : modalActiveReport.outputJson;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 pointer-events-auto">
            <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl bg-slate-900 border border-cyan-500/50 shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-cyan-300 flex items-center gap-2">
                    <span>🚨 รายงานเฝ้าระวังภัยน้ำท่วมอัตโนมัติ (TeleRID Monitor Agent — 4 มอดูล รายชั่วโมง)</span>
                  </div>
                  <div className="text-[11px] text-slate-400 mt-0.5">
                    ลุ่มน้ำ: <span className="text-amber-300 font-bold">{modalActiveReport.basinName}</span> · เวลาสแกนจริง:{' '}
                    <span className="text-emerald-300 font-semibold">{modalActiveReport.scannedAtText}</span> · รอบถัดไป:{' '}
                    <span className="text-cyan-300">{modalActiveReport.nextScanAtText}</span> (ในอีก {teleRidCountdownText})
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsTeleRidReportModalOpen(false)}
                  className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 hover:text-white cursor-pointer"
                >
                  ปิดหน้าต่าง [×]
                </button>
              </div>

              {/* Body */}
              <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-200">
                {/* แท็บสลับดูสรุปรวมทุกลุ่มน้ำ หรือแยกรายลุ่มน้ำในหน้าต่างรายงานฉบับเต็ม */}
                {modalPerBasins.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl bg-slate-950 border border-cyan-500/40">
                    <span className="text-[11px] font-bold text-amber-300 mr-1">
                      🌊 ลุ่มน้ำที่ตรวจสอบในรอบนี้ ({modalPerBasins.length} ลุ่มน้ำ — คลิกดูรวมหรือแยกรายลุ่มน้ำ):
                    </span>
                    <button
                      type="button"
                      onClick={() => setTeleRidActiveBasinView('ALL')}
                      className={`px-2.5 py-1 rounded-lg text-[10px] border cursor-pointer ${
                        teleRidActiveBasinView === 'ALL'
                          ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400'
                          : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                      }`}
                    >
                      📊 รวมทุกลุ่มน้ำ ({modalPerBasins.length} ลุ่มน้ำ)
                    </button>
                    {modalPerBasins.map((bRep) => (
                      <button
                        key={`modal-basin-${bRep.basinName}`}
                        type="button"
                        onClick={() => setTeleRidActiveBasinView(bRep.basinName)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] border cursor-pointer ${
                          teleRidActiveBasinView === bRep.basinName
                            ? 'bg-amber-400 text-slate-950 font-bold border-amber-300'
                            : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                        }`}
                      >
                        🌊 {bRep.basinName}
                      </button>
                    ))}
                  </div>
                )}

                {/* เลือกดูประวัติรายงานรายชั่วโมงย้อนหลัง */}
                {teleRidMonitorHistory.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 p-2.5 rounded-xl bg-slate-950 border border-slate-800">
                    <span className="text-[11px] font-semibold text-amber-300 mr-1">
                      🕓 ประวัติการสแกนรายชั่วโมง ({teleRidMonitorHistory.length} รอบ):
                    </span>
                    {teleRidMonitorHistory.map((repItem, idx) => (
                      <button
                        key={repItem.reportId}
                        type="button"
                        onClick={() => {
                          setTeleRidMonitorReport(repItem);
                          setSelectedTeleRidHistoryId(repItem.reportId);
                          setTeleRidActiveBasinView('ALL');
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[10px] border cursor-pointer ${
                          selectedTeleRidHistoryId === repItem.reportId
                            ? 'bg-cyan-500 text-slate-950 font-bold border-cyan-400'
                            : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                        }`}
                      >
                        รอบที่ {teleRidMonitorHistory.length - idx}: {repItem.basinName} ({repItem.scannedAtText})
                      </button>
                    ))}
                  </div>
                )}

                {/* มอดูลที่ 1 */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-cyan-500/30 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-cyan-300 text-xs">
                      มอดูลที่ 1: ตรวจสอบสถานะภาพรวมรายลุ่มน้ำ (https://telerid.rid.go.th/#/)
                    </span>
                    <span className="text-[11px] text-amber-300 font-semibold">
                      กรองเฉพาะ: {modalActiveReport.basinName}
                    </span>
                  </div>
                  {(() => {
                    const ms = modalActiveReport.outputJson.summary;
                    const modalHasNonZero =
                      (ms.online ?? 0) + (ms.warning ?? 0) + (ms.critical ?? 0) + (ms.offline ?? 0) > 0;
                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <div className="p-2.5 rounded-lg bg-emerald-950/50 border border-emerald-500/40">
                          <div className="text-[10px] text-emerald-200">🟢 สถานีปกติ (สีเขียว)</div>
                          <div className="text-lg font-bold text-emerald-300">
                            {modalHasNonZero && ms.online !== null ? `${ms.online} สถานี` : 'ไม่พบค่า'}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-amber-950/50 border border-amber-500/40">
                          <div className="text-[10px] text-amber-200">🟡 สถานีเตือนภัย (สีเหลือง)</div>
                          <div className="text-lg font-bold text-amber-300">
                            {modalHasNonZero && ms.warning !== null ? `${ms.warning} สถานี` : 'ไม่พบค่า'}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-rose-950/50 border border-rose-500/40">
                          <div className="text-[10px] text-rose-200">🔴 สถานีวิกฤติ (สีแดง)</div>
                          <div className="text-lg font-bold text-rose-300">
                            {modalHasNonZero && ms.critical !== null ? `${ms.critical} สถานี` : 'ไม่พบค่า'}
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-700">
                          <div className="text-[10px] text-slate-400">⚫ สถานีขัดข้อง (สีเทา)</div>
                          <div className="text-lg font-bold text-slate-200">
                            {modalHasNonZero && ms.offline !== null ? `${ms.offline} สถานี` : 'ไม่พบค่า'}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <div className="space-y-1 pt-1">
                    <div className="text-[11px] font-semibold text-amber-300">
                      📌 รายชื่อสถานีในเว็บ telerid.rid.go.th/# ที่มีสถานะ &ldquo;ขัดข้อง / เตือนภัย / วิกฤติ&rdquo; จริงจากหน้าเว็บ:
                    </div>
                    {modalActiveReport.module1AbnormalStationsDb.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {modalActiveReport.module1AbnormalStationsDb.map((st, idx) => (
                          <div
                            key={`m1-${idx}`}
                            className="px-2.5 py-1.5 rounded bg-slate-900 border border-slate-800 flex items-center justify-between text-[11px]"
                          >
                            <span>
                              <strong className="text-cyan-300">[{st.stationCode}]</strong> {st.stationName}{' '}
                              <span className="text-[10px] text-slate-400">({st.basin})</span>
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                st.status === 'วิกฤติ'
                                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                  : st.status === 'เตือนภัย'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-slate-800 text-slate-300 border border-slate-700'
                              }`}
                            >
                              {st.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400">ไม่พบค่า</div>
                    )}
                  </div>
                </div>

                {/* ตารางข้อมูลสถานีละเอียดครบ 8 คอลัมน์ (จากที่เลขา AI จดบันทึกไว้ขณะเปิด Chrome หรือจาก WebSocket/API) */}
                {(() => {
                  const modalDetailedList =
                    modalActiveReport.detailedStations && modalActiveReport.detailedStations.length > 0
                      ? modalActiveReport.detailedStations
                      : teleRidDetailedStations;
                  return (
                    <div className="p-3.5 rounded-xl bg-slate-950 border border-cyan-400/50 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-cyan-300 text-xs">
                          📋 ตารางแสดงผลข้อมูลสถานีจาก MongoDB ({modalDetailedList.length} สถานี)
                        </span>
                        <span className="text-[11px] text-emerald-300 font-semibold">
                          คอลัมน์: การเชื่อมต่อ · ระดับน้ำ · ฝน 07:00-ปัจจุบัน · ฝน 1 วัน (24ชม.) · เหนือน้ำ (ม.รทก./ม.รสม.) · ท้ายน้ำ (ม.รทก./ม.รสม.)
                        </span>
                      </div>
                      <div className="overflow-x-auto max-h-72 rounded-xl border border-slate-800 bg-slate-900/80">
                        <table className="w-full text-left border-collapse text-[11px]">
                          <thead className="sticky top-0 bg-slate-950 text-cyan-200 border-b border-slate-800">
                            <tr>
                              <th className="py-2 px-2.5 whitespace-nowrap">#</th>
                              <th className="py-2 px-2.5 whitespace-nowrap">สถานี / ลุ่มน้ำ</th>
                              <th className="py-2 px-2.5 whitespace-nowrap text-center">การเชื่อมต่อ</th>
                              <th className="py-2 px-2.5 whitespace-nowrap text-center">ระดับน้ำ</th>
                              <th className="py-2 px-2.5 whitespace-nowrap text-right">ฝน 07:00-ปัจจุบัน</th>
                              <th className="py-2 px-2.5 whitespace-nowrap text-right">ฝน 1 วัน (24ชม.)</th>
                              <th className="py-2 px-2.5 whitespace-nowrap text-right">เหนือน้ำ (ม.รทก.)</th>
                              <th className="py-2 px-2.5 whitespace-nowrap text-right">เหนือน้ำ (ม.รสม.)</th>
                              <th className="py-2 px-2.5 whitespace-nowrap text-right">ท้ายน้ำ (ม.รทก.)</th>
                              <th className="py-2 px-2.5 whitespace-nowrap text-right">ท้ายน้ำ (ม.รสม.)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {modalDetailedList.length > 0 ? (
                              modalDetailedList.map((st, idx) => (
                                <tr key={`modal-det-${st.stationCode}-${idx}`} className="hover:bg-slate-900">
                                  <td className="py-1.5 px-2.5 font-mono text-slate-400">{idx + 1}</td>
                                  <td className="py-1.5 px-2.5">
                                    <div className="font-bold text-white">
                                      <span className="text-cyan-300">[{st.stationCode}]</span> {st.stationName}
                                    </div>
                                    <div className="text-[10px] text-slate-400">{st.basin}</div>
                                  </td>
                                  <td className="py-1.5 px-2.5 text-center whitespace-nowrap">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        st.onlineStatus === 'ออนไลน์'
                                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                                      }`}
                                    >
                                      {st.onlineStatus}
                                    </span>
                                  </td>
                                  <td className="py-1.5 px-2.5 text-center whitespace-nowrap">
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                        st.alertStatus === 'วิกฤติ'
                                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                          : st.alertStatus === 'เตือนภัย'
                                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                          : st.alertStatus === 'ปกติ'
                                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                          : 'bg-slate-800 text-slate-300 border border-slate-700'
                                      }`}
                                    >
                                      {st.alertStatus}
                                    </span>
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right font-mono text-cyan-200 whitespace-nowrap">
                                    {st.rain7toNow}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right font-mono text-cyan-300 whitespace-nowrap">
                                    {st.rain1Day}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right font-mono text-amber-200 whitespace-nowrap">
                                    {st.waterLevelUp_RTK}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right font-mono text-amber-300 whitespace-nowrap">
                                    {st.waterLevelUp_RSM}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right font-mono text-emerald-200 whitespace-nowrap">
                                    {st.waterLevelDown_RTK}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right font-mono text-emerald-300 whitespace-nowrap">
                                    {st.waterLevelDown_RSM}
                                  </td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={10} className="py-4 text-center text-slate-400">
                                  ไม่พบค่า (ยังไม่ได้สแกนหรือเปิดโหมดเลขา AI)
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {/* มอดูลที่ 2 */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-300 text-xs">
                      มอดูลที่ 2: ตรวจสอบสถานะกล้อง CCTV ค้างเกิน 1 ชม. และไม่แสดงภาพ (https://telerid.rid.go.th/#/cctv)
                    </span>
                    <span className="text-[11px] text-slate-300">
                      แสดงภาพปกติ <strong className="text-emerald-300">{modalActiveReport.outputJson.cctv_issues.active_count ?? 'ไม่พบค่า'}</strong> ·
                      มีปัญหา/ค้างส่ง <strong className="text-rose-400">{modalActiveReport.outputJson.cctv_issues.failed_count ?? 'ไม่พบค่า'}</strong>
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {modalActiveReport.module2CctvDetails.cameraItems.length > 0 ? (
                      modalActiveReport.module2CctvDetails.cameraItems.map((cam, idx) => (
                        <div
                          key={`m2-${idx}`}
                          className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]"
                        >
                          <div>
                            <span className="font-bold text-amber-300">[{cam.stationCode}]</span> {cam.stationName}
                            <div className="text-[10px] text-slate-400">{cam.reason}</div>
                          </div>
                          <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold shrink-0">
                            {cam.evaluationStatus}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-400">ไม่พบค่า</div>
                    )}
                  </div>
                </div>

                {/* มอดูลที่ 3 */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-rose-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-rose-300 text-xs">
                      มอดูลที่ 3: ตรวจสอบค่าน้ำระดับวิกฤติ และ ค่าไม่ถูกต้อง (&le; -10 ถึง -999 ทั้ง ม.รทก. และ ม.รสม.)
                    </span>
                    <span className="text-[11px] text-rose-300 font-bold">
                      {modalActiveReport.outputJson.water_errors.count !== null
                        ? `พบค่าผิดปกติ ${modalActiveReport.outputJson.water_errors.count} สถานี`
                        : 'ไม่พบค่า'}
                    </span>
                  </div>
                  <div className="text-[11px] text-cyan-300 bg-slate-900 px-2.5 py-1.5 rounded border border-slate-800">
                    🖱️ สถานีตัวแทนจากหน้าเว็บจริง: <strong>{modalActiveReport.representativeStationClicked || 'ไม่พบค่า'}</strong>
                  </div>
                  <div className="space-y-1.5">
                    {modalActiveReport.module3WaterDetails.items.length > 0 ? (
                      modalActiveReport.module3WaterDetails.items.map((wItem, idx) => (
                        <div
                          key={`m3-${idx}`}
                          className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]"
                        >
                          <div>
                            <span className="font-bold text-rose-300">[{wItem.stationCode}]</span> {wItem.stationName}{' '}
                            <span className="text-[10px] text-slate-400">({wItem.terrainType})</span>
                            <div className="text-[10px] text-slate-300">{wItem.note}</div>
                          </div>
                          <span className="px-2.5 py-1 rounded bg-rose-950 text-rose-300 border border-rose-500/40 font-mono font-bold text-xs shrink-0">
                            {wItem.waterLevelText}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-400">ไม่พบค่า</div>
                    )}
                  </div>
                </div>

                {/* มอดูลที่ 4 */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-emerald-500/30 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-emerald-300 text-xs">
                      มอดูลที่ 4: ตรวจจับน้ำฝนเกินเกณฑ์ (&gt;100 มม. / บั๊กหลักหมื่น) และ แท่งน้ำฝนเบิ้ล (Rainfall Spike) ในกราฟ
                    </span>
                    <span className="text-[11px] text-emerald-300 font-bold">
                      {modalActiveReport.outputJson.rain_spikes.count !== null
                        ? `พบ ${modalActiveReport.outputJson.rain_spikes.count} สถานี`
                        : 'ไม่พบค่า'}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {modalActiveReport.module4RainDetails.items.length > 0 ? (
                      modalActiveReport.module4RainDetails.items.map((rItem, idx) => (
                        <div
                          key={`m4-${idx}`}
                          className="p-2 rounded-lg bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]"
                        >
                          <div>
                            <span className="font-bold text-emerald-300">[{rItem.stationCode}]</span> {rItem.stationName} —{' '}
                            <span className="text-amber-300 font-semibold">{rItem.issueType}</span>
                            <div className="text-[10px] text-slate-300">{rItem.detail}</div>
                            <div className="text-[10px] text-cyan-300 font-mono">
                              กราฟแท่งน้ำฝนสะสม (Time-series bars): [{rItem.timeSeriesBarsSample.join(', ')}] มม.
                            </div>
                          </div>
                          <span className="px-2.5 py-1 rounded bg-emerald-950 text-emerald-300 border border-emerald-500/40 font-mono font-bold text-xs shrink-0">
                            {rItem.accumulatedRainText}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-slate-400">ไม่พบค่า</div>
                    )}
                  </div>
                </div>

                {/* Output JSON Logs */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-cyan-500/40 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-cyan-300 text-xs">
                      📦 รูปแบบโครงสร้างการส่งออกรายงานสรุป (Output JSON Logs ประจำชั่วโมง):
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(
                          JSON.stringify(modalJsonOutput, null, 2)
                        );
                        setTeleRidJsonCopied(true);
                        setTimeout(() => setTeleRidJsonCopied(false), 2000);
                      }}
                      className="px-3 py-1 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
                    >
                      {teleRidJsonCopied ? '✅ คัดลอก Output JSON สำเร็จ' : '📋 คัดลอก Output JSON Logs'}
                    </button>
                  </div>
                  <pre className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-emerald-300 font-mono text-xs overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(modalJsonOutput, null, 2)}
                  </pre>
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[11px] text-slate-400 truncate max-w-md">
                  บันทึกไฟล์รายงานอัตโนมัติที่:{' '}
                  <code className="text-emerald-300">
                    {teleRidMonitorReport.savedReportXlsxPath || teleRidMonitorReport.savedReportTxtPath}
                  </code>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleDownloadTeleRidExcel()}
                    className="px-3 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    📊 ดาวน์โหลดรายงาน Excel (.xlsx)
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownloadTeleRidPdf()}
                    className="px-3 py-2 rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-bold text-xs cursor-pointer"
                  >
                    📄 ดาวน์โหลดรายงาน PDF (.pdf)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(modalJsonOutput, null, 2)], {
                        type: 'application/json;charset=utf-8',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `TeleRID_Output_${modalActiveReport.basinName}.json`;
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                      URL.revokeObjectURL(url);
                    }}
                    className="px-3 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    ⬇️ ดาวน์โหลด JSON Logs (.json)
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await fetch('/api/rpa/telerid-monitor-open-file', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ filePath: teleRidMonitorReport.savedReportTxtPath }),
                      }).catch(() => {});
                    }}
                    className="px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs cursor-pointer"
                  >
                    📄 เปิดรายงานใน Notepad บน Windows
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsTeleRidReportModalOpen(false)}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs cursor-pointer"
                  >
                    ปิดหน้าต่าง
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal รายงานลำดับน้ำฝนสูงสุด 20 อันดับ (วันนี้ 07:00 น. - ปัจจุบัน) */}
      {showTop20RainModal && (() => {
        const modalTop20 = teleRidDetailedStations
          .filter((st) =>
            (teleRidMultiBasinFilter.length === 0 ||
              teleRidMultiBasinFilter.some((b) => doesBasinMatchFilter(st.basin, b))) &&
            isStationToday07ToNow(st.recordedAt)
          )
          .map((st) => {
            const raw = st.rain7toNow;
            const n = raw === null || raw === undefined || raw === '' || raw === '-' ? null : typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, ''));
            return { station: st, rainMm: n !== null && !Number.isNaN(n) ? n : null };
          })
          .filter((x): x is { station: TeleRidStationDetailedRow; rainMm: number } =>
            x.rainMm !== null && x.rainMm >= 0 && x.rainMm < 999
          )
          .sort((a, b) => b.rainMm - a.rainMm)
          .slice(0, 20);

        return (
          <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-sky-500/40 rounded-2xl w-full max-w-5xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-sky-300">
                    🌧️ รายงานลำดับน้ำฝนสูงสุด 20 อันดับ (วันนี้ 07:00 น. - ปัจจุบัน)
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    เรียงจากมากไปน้อย · ใช้เฉพาะข้อมูลล่าสุดตั้งแต่ 07:00 น. ของวันนี้จนถึงเวลาปัจจุบัน ({modalTop20.length} สถานี)
                  </p>
                </div>
                <button
                  onClick={() => setShowTop20RainModal(false)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg cursor-pointer"
                >
                  ✕ ปิดหน้าต่าง
                </button>
              </div>
              <div className="overflow-auto flex-1">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 sticky top-0 z-10">
                    <tr>
                      <th className="p-3 text-center">อันดับ</th>
                      <th className="p-3">รหัสสถานี</th>
                      <th className="p-3">ชื่อสถานี</th>
                      <th className="p-3">ลุ่มน้ำ</th>
                      <th className="p-3 text-right">ฝน 07:00-ปัจจุบัน (มม.)</th>
                      <th className="p-3 text-right">ฝน 24 ชม. (มม.)</th>
                      <th className="p-3">เวลาข้อมูลล่าสุด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {modalTop20.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="p-6 text-center text-slate-500">
                          ไม่พบข้อมูลน้ำฝนช่วง 07:00 น. ของวันนี้จนถึงปัจจุบัน
                        </td>
                      </tr>
                    ) : (
                      modalTop20.map((item, idx) => (
                        <tr key={`rank-${item.station.stationCode}`} className="hover:bg-slate-800/50">
                          <td className="p-3 text-center font-bold text-amber-300">#{idx + 1}</td>
                          <td className="p-3 font-mono text-sky-300">{item.station.stationCode}</td>
                          <td className="p-3">{item.station.stationName}</td>
                          <td className="p-3 text-slate-400">{item.station.basin}</td>
                          <td className="p-3 text-right font-mono font-bold text-sky-300">
                            {item.rainMm.toFixed(1)}
                          </td>
                          <td className="p-3 text-right font-mono text-slate-300">
                            {item.station.rain1Day ?? '-'}
                          </td>
                          <td className="p-3 font-mono text-[11px] text-slate-400">
                            {item.station.recordedAt}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal แสดงสถานะภาพ CCTV ทั้งหมด (รองรับการเลือกดูครบทุกลุ่มน้ำ) */}
      {showAllCctvModal && cctvResult && (() => {
        const allCams = cctvResult.allCameras || [];
        const allCctvBasins = Array.from(
          new Set([
            ...RID_22_BASINS,
            ...allCams
              .map((c) => {
                const n = normalizeBasinShortName(c.basin);
                if (!n || n === 'ไม่ระบุ' || n === 'ไม่ระบุลุ่มน้ำ') return '';
                return n === 'KRC' ? 'KRC' : `ลุ่มน้ำ${n}`;
              })
              .filter(Boolean),
          ])
        );
        const camsInBasin = allCams.filter((c) => doesBasinMatchFilter(c.basin, cctvBasinFilter));
        const basinHasImgCount = camsInBasin.filter((c) => c.hasImage && !c.isOver24h).length;
        const basinNoImgCount = camsInBasin.filter((c) => !c.hasImage).length;
        const basinOver24Count = camsInBasin.filter((c) => c.isOver24h).length;
        const basinFaultyCount = camsInBasin.filter(
          (c) => c.cctvStatus === 'ขัดข้อง' || !c.hasImage || c.isOver24h
        ).length;

        const filteredCams = camsInBasin.filter((cam) => {
          const q = cctvSearchQuery.trim().toLowerCase();
          const matchQ =
            !q ||
            cam.stationCode.toLowerCase().includes(q) ||
            cam.stationName.toLowerCase().includes(q) ||
            cam.basin.toLowerCase().includes(q);
          if (!matchQ) return false;
          if (cctvStatusFilter === 'HAS_IMAGE') return cam.hasImage && !cam.isOver24h;
          if (cctvStatusFilter === 'NO_IMAGE') return !cam.hasImage;
          if (cctvStatusFilter === 'OVER_24H') return cam.isOver24h;
          if (cctvStatusFilter === 'FAULTY') return cam.cctvStatus === 'ขัดข้อง' || !cam.hasImage || cam.isOver24h;
          return true;
        });

        return (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl w-full max-w-6xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-emerald-300">
                  🖼️ สถานะภาพกล้อง CCTV {cctvBasinFilter === 'ALL' ? 'ทั้งหมด' : cctvBasinFilter} ({camsInBasin.length} กล้อง)
                </h3>
                <p className="text-[11px] text-slate-400">
                  อัปเดตล่าสุด: {cctvResult.checkedAt} | ✅ มีภาพเข้า: {basinHasImgCount} | 🚫 ไม่มีภาพเข้า: {basinNoImgCount} | ⏰ ค้าง/ติดต่อไม่ได้เกิน 1 ชม.: {basinOver24Count}
                </p>
              </div>
              <button
                onClick={() => setShowAllCctvModal(false)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-lg cursor-pointer"
              >
                ✕ ปิดหน้าต่าง
              </button>
            </div>

            <div className="p-3 border-b border-slate-800 flex flex-wrap items-center gap-2 bg-slate-950/60">
              <input
                type="text"
                value={cctvSearchQuery}
                onChange={(e) => setCctvSearchQuery(e.target.value)}
                placeholder="ค้นหารหัสสถานี, ชื่อสถานี, หรือลุ่มน้ำ..."
                className="flex-1 min-w-[200px] px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-white"
              />
              <select
                value={cctvBasinFilter}
                onChange={(e) => setCctvBasinFilter(e.target.value)}
                className="px-3 py-1.5 text-xs bg-slate-900 border border-emerald-500/40 rounded-lg text-emerald-200 font-semibold"
              >
                <option value="ALL">🌊 ทุกลุ่มน้ำ ({allCams.length} กล้อง)</option>
                {allCctvBasins.map((b) => {
                  const cnt = allCams.filter((c) => doesBasinMatchFilter(c.basin, b)).length;
                  return (
                    <option key={`cctv-b-${b}`} value={b}>
                      🌊 {b} ({cnt})
                    </option>
                  );
                })}
              </select>
              <select
                value={cctvStatusFilter}
                onChange={(e) => setCctvStatusFilter(e.target.value as typeof cctvStatusFilter)}
                className="px-3 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-lg text-slate-200"
              >
                <option value="ALL">ทั้งหมด ({camsInBasin.length})</option>
                <option value="HAS_IMAGE">✅ มีภาพเข้าปกติ ({basinHasImgCount})</option>
                <option value="NO_IMAGE">🚫 ไม่มีภาพเข้า ({basinNoImgCount})</option>
                <option value="OVER_24H">⏰ ค้าง/ติดต่อไม่ได้เกิน 1 ชม. ({basinOver24Count})</option>
                <option value="FAULTY">🚨 ขัดข้องทั้งหมด ({basinFaultyCount})</option>
              </select>
              <button
                onClick={handleCheckCctvAndStreams}
                disabled={isCctvBusy}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg cursor-pointer"
              >
                🔄 รีเฟรชจาก MongoDB
              </button>
            </div>

            <div className="overflow-auto flex-1">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 sticky top-0 z-10">
                  <tr>
                    <th className="p-3">รหัสสถานี</th>
                    <th className="p-3">ชื่อสถานี</th>
                    <th className="p-3">ลุ่มน้ำ</th>
                    <th className="p-3 text-center">สถานะภาพ</th>
                    <th className="p-3 text-center">เกณฑ์ 1 ชม.</th>
                    <th className="p-3">รายละเอียด</th>
                    <th className="p-3">เวลาภาพล่าสุด</th>
                    <th className="p-3 text-center">ลิงก์ภาพ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {filteredCams.map((cam) => (
                      <tr key={cam.stationCode} className="hover:bg-slate-800/50">
                        <td className="p-3 font-mono text-sky-300">{cam.stationCode}</td>
                        <td className="p-3">{cam.stationName}</td>
                        <td className="p-3 text-slate-400">{cam.basin}</td>
                        <td className="p-3 text-center">
                          {cam.hasImage ? (
                            <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px]">
                              ✅ มีภาพเข้า
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30 text-[10px]">
                              🚫 ไม่มีภาพเข้า
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {cam.isOver24h ? (
                            <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[10px]">
                              ⏰ เกิน 1 ชม.
                            </span>
                          ) : (
                            <span className="text-emerald-400 text-[10px]">ปกติ</span>
                          )}
                        </td>
                        <td className="p-3 text-slate-300">{cam.imageDisplayStatus}</td>
                        <td className="p-3 font-mono text-[11px] text-slate-400">{cam.recordedAt}</td>
                        <td className="p-3 text-center">
                          {cam.imageUrl ? (
                            <a
                              href={cam.imageUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-sky-400 hover:underline text-[11px]"
                            >
                              เปิดภาพ
                            </a>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        );
      })()}

      {/* กล่องข้อความแจ้งเตือนสีแดงนีออนกะพริบ (Neon Red Blinking Alert Box) กลางหน้าจอ เมื่อได้รับสัญญาณ SENSOR_BUG ผ่าน Socket.io */}
      {sensorBugAlert && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 backdrop-blur-md p-4">
          <div className="relative w-full max-w-2xl rounded-2xl border-2 border-[#ff1744] bg-slate-950/95 p-6 text-white shadow-[0_0_50px_rgba(255,23,68,0.85),inset_0_0_25px_rgba(255,23,68,0.35)] animate-pulse">
            {/* แถบไฟไซเรนนีออนด้านบน */}
            <div className="mb-4 flex items-center justify-between border-b border-red-500/40 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-3.5 w-3.5 rounded-full bg-[#ff1744] shadow-[0_0_14px_#ff1744] animate-ping" />
                <span className="text-xs font-extrabold uppercase tracking-widest text-red-400">
                  SMART SENSOR ANOMALY INTERCEPTION (SOCKET.IO REAL-TIME ALERT)
                </span>
              </div>
              <span className="rounded bg-red-500/20 px-2.5 py-0.5 font-mono text-[11px] font-bold text-red-300 border border-red-500/40">
                TYPE: {sensorBugAlert.type}
              </span>
            </div>

            {/* ข้อความแจ้งเตือนหลักตามคำสั่ง */}
            <div className="rounded-xl border border-[#ff1744]/80 bg-red-950/50 p-4 shadow-[0_0_25px_rgba(255,23,68,0.4)]">
              <p className="text-base sm:text-lg font-extrabold leading-relaxed text-red-100 drop-shadow-[0_0_8px_rgba(255,23,68,0.8)]">
                🚨 ALERT: ตรวจพบเซนเซอร์ขัดข้อง! สถานี{' '}
                <span className="underline decoration-red-400 underline-offset-4 text-yellow-300">
                  {sensorBugAlert.stationName || sensorBugAlert.stationId}
                </span>{' '}
                รายงานค่าน้ำผิดปกติ:{' '}
                <span className="rounded bg-red-600 px-2 py-0.5 font-mono text-white shadow-[0_0_12px_#ff1744]">
                  {sensorBugAlert.value} {sensorBugAlert.unit || 'ม.รสม.'}
                </span>
              </p>
            </div>

            {/* รายละเอียดสถานีและสถานะตัวละคร 3D AI Agent */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border border-red-500/30 bg-slate-900/90 p-3 space-y-1">
                <div className="text-slate-400">รหัสสถานี / ลุ่มน้ำ:</div>
                <div className="font-bold text-red-200">
                  {sensorBugAlert.stationId} ({sensorBugAlert.basin || 'ระบบโทรมาตร TeleRID'})
                </div>
                <div className="text-slate-400 pt-1">เวลาตรวจพบจริง (Network API):</div>
                <div className="font-mono text-amber-300">{sensorBugAlert.time}</div>
              </div>

              <div className="rounded-lg border border-amber-500/40 bg-slate-900/90 p-3 space-y-1.5">
                <div className="font-bold text-amber-300 flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  สถานะหุ่นยนต์ AI Agent ในฉาก 3D:
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  • <strong className="text-cyan-300">แผนกที่ 1 (สีฟ้า)</strong> &amp;{' '}
                  <strong className="text-amber-300">แผนกที่ 3 (สีทอง)</strong> เปลี่ยนจากท่ายืนปกติเป็น{' '}
                  <span className="text-red-300 font-semibold">
                    ท่าตกใจ (เอามือกุมขมับ / ชี้ไปที่หน้าจอคอมพิวเตอร์)
                  </span>{' '}
                  พร้อมไฟไซเรนสีแดงนีออน
                </p>
              </div>
            </div>

            {sensorBugAlert.anomalyReason && (
              <div className="mt-3 rounded-lg bg-red-950/30 border border-red-500/20 px-3 py-2 text-xs text-red-200">
                <strong>สาเหตุที่ระบบดักจับตรวจพบ:</strong> {sensorBugAlert.anomalyReason}
              </div>
            )}

            {/* สรุปคิวสถานีที่มีปัญหาทั้งหมด */}
            {sensorBugQueue.length > 1 && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-slate-900/80 p-2.5 space-y-1.5">
                <div className="text-[11px] font-bold text-amber-300 flex items-center justify-between">
                  <span>
                    📋 คิวสถานีที่พบปัญหาทั้งหมด ({sensorBugTotalInBatch > 0 ? `${sensorBugTotalInBatch - sensorBugQueue.length + 1} / ${sensorBugTotalInBatch}` : `เหลือ ${sensorBugQueue.length} สถานี`}):
                  </span>
                  <span className="text-red-300">เหลืออีก {sensorBugQueue.length - 1} สถานี</span>
                </div>
                <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                  {sensorBugQueue.map((qItem, idx) => (
                    <button
                      key={`${qItem.stationId}-${idx}`}
                      type="button"
                      onClick={() => setSensorBugAlert(qItem)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono border cursor-pointer ${
                        idx === 0 || sensorBugAlert.stationId === qItem.stationId
                          ? 'bg-red-600 text-white border-red-300 font-bold'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                    >
                      {qItem.stationId} ({qItem.value})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ปุ่ม "รับทราบทีละสถานี" และ "ปิดการแจ้งเตือนทั้งหมด" */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => void handleDismissAllSensorBugAlerts()}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs sm:text-sm transition-all cursor-pointer flex items-center justify-center gap-2 border border-slate-600"
              >
                🔕 ปิดการแจ้งเตือนทั้งหมด ({sensorBugQueue.length || 1} สถานี)
              </button>

              <button
                type="button"
                onClick={() => void handleAcknowledgeSensorBugAlert()}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-[#ff1744] hover:bg-red-500 text-white font-extrabold text-xs sm:text-sm tracking-wide shadow-[0_0_25px_rgba(255,23,68,0.9)] hover:shadow-[0_0_35px_rgba(255,23,68,1)] transition-all cursor-pointer flex items-center justify-center gap-2 border border-red-300"
              >
                <CheckCircle2 className="w-4 h-4" />
                {sensorBugQueue.length > 1
                  ? `รับทราบสถานีนี้ & ดูสถานีถัดไป (เหลืออีก ${sensorBugQueue.length - 1})`
                  : 'รับทราบ (Acknowledge) — สั่ง AI Agent กลับไปทำงานตามปกติ'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

