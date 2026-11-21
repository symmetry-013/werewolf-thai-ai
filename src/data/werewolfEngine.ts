// Resilient image loader: automatically bundles generated .jpg artwork when present,
// and gracefully falls back without failing Vite production builds if a binary asset wasn't committed.
const assetImageModules = import.meta.glob(
  '../assets/images/*.{jpg,jpeg,png,webp}',
  { eager: true, import: 'default' }
) as Record<string, string>;

const resolveCardImage = (filename: string, fallback: string): string =>
  assetImageModules[`../assets/images/${filename}`] || fallback;

const HUMAN_WOLF_SVG_FALLBACK = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1E0B18"/>
        <stop offset="55%" stop-color="#0D1324"/>
        <stop offset="100%" stop-color="#070910"/>
      </linearGradient>
      <radialGradient id="moon" cx="50%" cy="22%" r="36%">
        <stop offset="0%" stop-color="#F43F5E" stop-opacity="0.72"/>
        <stop offset="60%" stop-color="#991B1B" stop-opacity="0.24"/>
        <stop offset="100%" stop-color="#0D1324" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="lantern" cx="24%" cy="52%" r="32%">
        <stop offset="0%" stop-color="#F59E0B" stop-opacity="0.55"/>
        <stop offset="100%" stop-color="#F59E0B" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="600" height="800" fill="url(#bg)"/>
    <rect width="600" height="800" fill="url(#moon)"/>
    <rect width="600" height="800" fill="url(#lantern)"/>
    <circle cx="300" cy="165" r="78" fill="#E11D48" opacity="0.28"/>
    <circle cx="300" cy="165" r="56" fill="#FB7185" opacity="0.5"/>
    <path d="M360 440 L430 330 L455 375 L515 355 L485 450 L525 560 L380 620 Z" fill="#4C0519" opacity="0.75"/>
    <path d="M165 760 L205 450 Q230 335 300 315 Q370 335 395 450 L435 760 Z" fill="#171E31" stroke="#334155" stroke-width="4"/>
    <path d="M225 385 Q240 245 300 228 Q360 245 375 385 Q340 420 300 425 Q260 420 225 385 Z" fill="#0F172A" stroke="#F43F5E" stroke-opacity="0.45" stroke-width="3"/>
    <ellipse cx="300" cy="340" rx="46" ry="56" fill="#1E293B"/>
    <path d="M300 284 A46 56 0 0 1 300 396 Z" fill="#111827"/>
    <ellipse cx="282" cy="336" rx="7" ry="4" fill="#FDE68A"/>
    <ellipse cx="318" cy="336" rx="8" ry="4.5" fill="#F43F5E"/>
    <circle cx="318" cy="336" r="2.2" fill="#FFF1F2"/>
    <path d="M286 364 Q300 370 314 363" stroke="#94A3B8" stroke-width="3" fill="none" stroke-linecap="round"/>
  </svg>`
)}`;

const werewolfCardImg = resolveCardImage('role_card_werewolf_1793769760093.jpg', HUMAN_WOLF_SVG_FALLBACK);
const wolfCubCardImg = resolveCardImage('role_card_wolf_cub_1793783231025.jpg', werewolfCardImg);
const humanWolfCardImg = resolveCardImage('role_card_human_wolf_1795231094178.jpg', HUMAN_WOLF_SVG_FALLBACK);
const seerCardImg = resolveCardImage('role_card_seer_1793769760933.jpg', '');
const bodyguardCardImg = resolveCardImage('role_card_bodyguard_1793769761764.jpg', '');
const beggarCardImg = resolveCardImage('role_card_beggar_1793783231788.jpg', '');
const villagerCardImg = resolveCardImage('role_card_villager_1793769761504.jpg', '');
const villageBackdropImg = resolveCardImage('werewolf_village_backdrop_1793769757998.jpg', '');

export type RoleType =
  | 'WEREWOLF'
  | 'WOLF_CUB'
  | 'HUMAN_WOLF'
  | 'SEER'
  | 'BODYGUARD'
  | 'BEGGAR'
  | 'VILLAGER';

export type PhaseType =
  | 'NIGHT_ACTION'
  | 'DAY_DISCUSSION'
  | 'DAY_VOTING'
  | 'DAY_RESULT'
  | 'GAME_OVER';

export const ABSTAIN_VOTE_ID = '__ABSTAIN__';

export interface RoleMetadata {
  id: RoleType;
  thaiName: string;
  englishName: string;
  team: 'VILLAGE' | 'WEREWOLF';
  teamThai: string;
  image: string;
  summary: string;
  nightPrompt: string;
  accentColor: string;
}

export const WOLF_ROLE_CANDIDATES: RoleType[] = [
  'WEREWOLF',
  'WOLF_CUB',
  'HUMAN_WOLF',
];

export const isWerewolfTeam = (role: RoleType): boolean =>
  role === 'WEREWOLF' || role === 'WOLF_CUB' || role === 'HUMAN_WOLF';

// Seer inspection rule: HUMAN_WOLF (หมาป่ามนุษย์) disguises as a Villager and scans as non-werewolf!
export const appearsAsWerewolfToSeer = (role: RoleType): boolean =>
  role === 'WEREWOLF' || role === 'WOLF_CUB';

export const ROLE_INFO: Record<RoleType, RoleMetadata> = {
  WEREWOLF: {
    id: 'WEREWOLF',
    thaiName: 'พ่อหมาป่า',
    englishName: 'Father Werewolf',
    team: 'WEREWOLF',
    teamThai: 'ฝ่ายมนุษย์หมาป่า',
    image: werewolfCardImg,
    summary:
      'จ่าฝูงหมาป่า ออกล่าเหยื่อในยามวิกาลร่วมกับเพื่อนร่วมฝูง หากลูกหมาป่าอยู่ในเกมและเสียชีวิต คืนถัดไปหมาป่าที่เหลือจะสามารถสังหารเหยื่อได้ถึง 2 คน!',
    nightPrompt:
      'ดวงจันทร์สีเลือดส่องสว่าง... พ่อหมาป่าโปรดเลือกเหยื่อที่ต้องการขย้ำในคืนนี้',
    accentColor: '#DC2626',
  },
  WOLF_CUB: {
    id: 'WOLF_CUB',
    thaiName: 'ลูกหมาป่า',
    englishName: 'Wolf Cub',
    team: 'WEREWOLF',
    teamThai: 'ฝ่ายมนุษย์หมาป่า',
    image: wolfCubCardImg,
    summary:
      'ออกล่ายามวิกาลพร้อมเพื่อนร่วมฝูงหมาป่า หากคุณถูกโหวตประหารหรือตาย คืนถัดไปหมาป่าที่เหลืออยู่จะได้สิทธิ์สังหารเหยื่อถึง 2 คน!',
    nightPrompt:
      'คุณตื่นขึ้นมาพร้อมเพื่อนร่วมฝูง... โปรดเลือกเหยื่อที่ฝูงของคุณต้องการขย้ำในคืนนี้',
    accentColor: '#F97316',
  },
  HUMAN_WOLF: {
    id: 'HUMAN_WOLF',
    thaiName: 'หมาป่ามนุษย์',
    englishName: 'Human Werewolf',
    team: 'WEREWOLF',
    teamThai: 'ฝ่ายมนุษย์หมาป่า',
    image: humanWolfCardImg,
    summary:
      'หมาป่าในคราบมนุษย์ที่แฝงตัวแนบเนียนที่สุด! ออกล่าเหยื่อร่วมกับฝูงหมาป่าในยามวิกาล แต่มีความสามารถพิเศษคือ "หมอดู (เทพพยากรณ์) ส่องดูแล้วจะเห็นเป็นฝ่ายชาวบ้าน" ไม่สามารถสแกนจับได้!',
    nightPrompt:
      'กลิ่นอายมนุษย์ช่วยอำพรางตัวตนของคุณจากหมอดู... หมาป่ามนุษย์โปรดเลือกเหยื่อที่ฝูงของคุณต้องการขย้ำในคืนนี้',
    accentColor: '#F43F5E',
  },
  SEER: {
    id: 'SEER',
    thaiName: 'เทพพยากรณ์',
    englishName: 'Seer',
    team: 'VILLAGE',
    teamThai: 'ฝ่ายชาวบ้าน',
    image: seerCardImg,
    summary:
      'ใช้ลูกแก้วพยากรณ์ตรวจสอบตัวตนของผู้เล่นได้คืนละ 1 คน ว่าอยู่ฝ่ายมนุษย์หมาป่าหรือฝ่ายชาวบ้าน (ระวัง! "หมาป่ามนุษย์" จะสแกนเห็นเป็นชาวบ้าน)',
    nightPrompt:
      'ลูกแก้วพยากรณ์เรืองแสงขึ้นในความมืด... โปรดเลือกผู้เล่น 1 คนที่คุณต้องการส่องดูตัวตนที่แท้จริง',
    accentColor: '#F59E0B',
  },
  BODYGUARD: {
    id: 'BODYGUARD',
    thaiName: 'บอดี้การ์ด',
    englishName: 'Bodyguard',
    team: 'VILLAGE',
    teamThai: 'ฝ่ายชาวบ้าน',
    image: bodyguardCardImg,
    summary:
      'เลือกคุ้มกันผู้เล่นได้คืนละ 1 คน (รวมถึงตัวเองได้) หากเป้าหมายถูกหมาป่าโจมตีในคืนนั้นจะรอดตาย (ห้ามปกป้องคนเดิม 2 คืนติดกัน)',
    nightPrompt:
      'คุณกระชับโล่เหล็กในความมืด... โปรดเลือกผู้เล่น 1 คนที่คุณต้องการคุ้มกันในคืนนี้ (ห้ามซ้ำคนเดิมติดกัน)',
    accentColor: '#10B981',
  },
  BEGGAR: {
    id: 'BEGGAR',
    thaiName: 'ยาจก / คนงี่เง่า',
    englishName: 'Beggar / Idiot',
    team: 'VILLAGE',
    teamThai: 'ฝ่ายชาวบ้าน',
    image: beggarCardImg,
    summary:
      'ไม่มีแอ็กชันตอนกลางคืน แต่หากถูกชาวบ้านโหวตประหารในตอนกลางวัน การ์ดของคุณจะถูกเปิดเผยและคุณจะรอดตายทันที! (แลกกับการเสียสิทธิ์โหวตไปตลอดเกม)',
    nightPrompt:
      'คุณเป็นยาจก/คนงี่เง่าของหมู่บ้าน ซุกตัวนอนพักผ่อนในตรอกมืดแล้วกด "เข้านอนและรอจนถึงรุ่งสาง"',
    accentColor: '#EAB308',
  },
  VILLAGER: {
    id: 'VILLAGER',
    thaiName: 'ชาวบ้าน',
    englishName: 'Villager',
    team: 'VILLAGE',
    teamThai: 'ฝ่ายชาวบ้าน',
    image: villagerCardImg,
    summary:
      'ไม่มีพลังพิเศษในตอนกลางคืน อาวุธเดียวของคุณคือการจับพิรุธ วิเคราะห์ตรรกะ และลงคะแนนโหวตในตอนกลางวัน',
    nightPrompt:
      'คุณเป็นชาวบ้านธรรมดา ปิดประตูลงกลอนให้แน่นหนา แล้วกด "เข้านอนและรอจนถึงรุ่งสาง"',
    accentColor: '#38BDF8',
  },
};

export const VILLAGE_BACKDROP_IMAGE = villageBackdropImg;

export interface HumanParticipant {
  id: string;
  name: string;
  isOnline?: boolean;
}

export interface Player {
  id: string;
  name: string;
  shortName: string;
  isHuman: boolean;
  role: RoleType;
  alive: boolean;
  canVote: boolean;
  revealedBeggar: boolean;
  personaLabel: string;
  personaTrait: string;
  avatarColor: string;
  seatAngle: number;
  suspicionScore: number;
}

export interface SeerRecord {
  night: number;
  targetId: string;
  targetName: string;
  isWerewolf: boolean;
}

export interface BodyguardRecord {
  night: number;
  targetId: string;
  targetName: string;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderPersona?: string;
  text: string;
  phaseLabel: string;
  tone?: string;
  isSecret?: boolean;
  visibleToPlayerId?: string;
  timestamp: string;
}

export interface VoteRecord {
  voterId: string;
  voterName: string;
  targetId: string;
  targetName: string;
  reason: string;
}

export const AI_ROSTER_TEMPLATES = [
  {
    id: 'ai-1',
    name: 'วิน (Win)',
    shortName: 'วิน',
    personaLabel: 'ผู้เล่นร่วมโต๊ะ',
    personaTrait: 'ชอบตั้งคำถามตรงๆ สังเกตคนที่เงียบและคนที่รีบออกตัว',
    avatarColor: '#EF4444',
  },
  {
    id: 'ai-2',
    name: 'แพรว (Praew)',
    shortName: 'แพรว',
    personaLabel: 'ผู้เล่นร่วมโต๊ะ',
    personaTrait: 'เน้นเชื่อมโยงเหตุผล ลำดับเหตุการณ์ และรอยโหวต',
    avatarColor: '#38BDF8',
  },
  {
    id: 'ai-3',
    name: 'ก้อง (Kong)',
    shortName: 'ก้อง',
    personaLabel: 'ผู้เล่นร่วมโต๊ะ',
    personaTrait: 'ช่างระแวง สังเกตท่าทีคนที่เปลี่ยนคำพูดไว',
    avatarColor: '#F59E0B',
  },
  {
    id: 'ai-4',
    name: 'นิดา (Nida)',
    shortName: 'นิดา',
    personaLabel: 'ผู้เล่นร่วมโต๊ะ',
    personaTrait: 'ฟังคนอื่นพูดก่อนแล้วค่อยสรุปจุดที่ขัดแย้งกัน',
    avatarColor: '#A855F7',
  },
  {
    id: 'ai-5',
    name: 'เตอร์ (Ter)',
    shortName: 'เตอร์',
    personaLabel: 'ผู้เล่นร่วมโต๊ะ',
    personaTrait: 'ชอบลองเชิงถามหยั่งเชิงดูปฏิกิริยาคนในวง',
    avatarColor: '#10B981',
  },
  {
    id: 'ai-6',
    name: 'เมย์ (May)',
    shortName: 'เมย์',
    personaLabel: 'ผู้เล่นร่วมโต๊ะ',
    personaTrait: 'สังเกตว่าใครพยายามปกป้องใครหรือโยนความผิดให้ใคร',
    avatarColor: '#EC4899',
  },
  {
    id: 'ai-7',
    name: 'ภูมิ (Phoom)',
    shortName: 'ภูมิ',
    personaLabel: 'ผู้เล่นร่วมโต๊ะ',
    personaTrait: 'รอบคอบ ไม่เชื่อคำกล่าวหาลอยๆ ที่ไม่มีเหตุผลรองรับ',
    avatarColor: '#14B8A6',
  },
  {
    id: 'ai-8',
    name: 'ฟ้า (Fah)',
    shortName: 'ฟ้า',
    personaLabel: 'ผู้เล่นร่วมโต๊ะ',
    personaTrait: 'จับสังเกตจังหวะการตามน้ำของคนในสภา',
    avatarColor: '#8B5CF6',
  },
  {
    id: 'ai-9',
    name: 'เอก (Ek)',
    shortName: 'เอก',
    personaLabel: 'ผู้เล่นร่วมโต๊ะ',
    personaTrait: 'ชอบประเมินภาพรวมจำนวนผู้รอดชีวิตและทิศทางเสียงโหวต',
    avatarColor: '#F97316',
  },
];

const HUMAN_COLORS = [
  '#FBBF24',
  '#22D3EE',
  '#4ADE80',
  '#F472B6',
  '#A78BFA',
  '#FB923C',
  '#38BDF8',
  '#E879F9',
  '#34D399',
  '#F87171',
];

export function pickRandomTwoWolfRoles(): [RoleType, RoleType] {
  const candidates: RoleType[] = [...WOLF_ROLE_CANDIDATES];
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return [candidates[0], candidates[1]];
}

export function buildRolePoolForCount(totalPlayers: number): RoleType[] {
  const clamped = Math.max(6, Math.min(10, totalPlayers));
  // Always 2 werewolves per match, randomly drawn from the 3 wolf roles:
  // 1. WEREWOLF (พ่อหมาป่า), 2. WOLF_CUB (ลูกหมาป่า), 3. HUMAN_WOLF (หมาป่ามนุษย์)
  const [wolf1, wolf2] = pickRandomTwoWolfRoles();
  const pool: RoleType[] = [wolf1, wolf2, 'SEER', 'BODYGUARD'];
  if (clamped >= 7) {
    pool.push('BEGGAR');
  }
  while (pool.length < clamped) {
    pool.push('VILLAGER');
  }
  return pool;
}

export function createInitialPlayers(params?: {
  totalPlayers?: number;
  humanParticipants?: HumanParticipant[];
}): Player[] {
  const rawHumans: HumanParticipant[] =
    params?.humanParticipants && params.humanParticipants.length > 0
      ? params.humanParticipants.slice(0, 10)
      : [{ id: 'human-1', name: 'ผู้เล่น 1' }];

  const totalCount = Math.max(
    6,
    Math.min(10, Math.max(params?.totalPlayers ?? 10, rawHumans.length))
  );
  const humans = rawHumans.slice(0, totalCount);

  const pool = buildRolePoolForCount(totalCount);

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Randomly reduce / pick AI players to fill only the remaining seats after real humans
  const aiNeeded = Math.max(0, totalCount - humans.length);
  const shuffledAITemplates = [...AI_ROSTER_TEMPLATES];
  for (let i = shuffledAITemplates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledAITemplates[i], shuffledAITemplates[j]] = [
      shuffledAITemplates[j],
      shuffledAITemplates[i],
    ];
  }
  const selectedAIs = shuffledAITemplates.slice(0, aiNeeded);

  const combinedEntries: {
    id: string;
    name: string;
    shortName: string;
    isHuman: boolean;
    personaLabel: string;
    personaTrait: string;
    avatarColor: string;
  }[] = [
    ...humans.map((h, idx) => {
      const cleanName = h.name.trim() || `ผู้เล่น ${idx + 1}`;
      return {
        id: h.id,
        name: cleanName,
        shortName: cleanName.slice(0, 12),
        isHuman: true,
        personaLabel: 'ผู้เล่นคนจริง',
        personaTrait: 'ผู้เล่นที่เป็นมนุษย์เข้าร่วมโต๊ะสภา',
        avatarColor: HUMAN_COLORS[idx % HUMAN_COLORS.length],
      };
    }),
    ...selectedAIs.map((tpl) => ({
      id: tpl.id,
      name: tpl.name,
      shortName: tpl.shortName,
      isHuman: false,
      personaLabel: tpl.personaLabel,
      personaTrait: tpl.personaTrait,
      avatarColor: tpl.avatarColor,
    })),
  ];

  return combinedEntries.map((entry, seatIdx) => {
    const angle = Math.PI / 2 + (seatIdx * (2 * Math.PI)) / totalCount;
    return {
      id: entry.id,
      name: entry.name,
      shortName: entry.shortName,
      isHuman: entry.isHuman,
      role: pool[seatIdx],
      alive: true,
      canVote: true,
      revealedBeggar: false,
      personaLabel: entry.personaLabel,
      personaTrait: entry.personaTrait,
      avatarColor: entry.avatarColor,
      seatAngle: angle,
      suspicionScore: 15 + Math.floor(Math.random() * 15),
    };
  });
}

export function checkWinCondition(players: Player[]): {
  isOver: boolean;
  winner: 'VILLAGE' | 'WEREWOLF' | null;
  reasonThai: string;
} {
  const alive = players.filter((p) => p.alive);
  const aliveWolves = alive.filter((p) => isWerewolfTeam(p.role)).length;
  const aliveVillagers = alive.length - aliveWolves;

  if (aliveWolves === 0) {
    return {
      isOver: true,
      winner: 'VILLAGE',
      reasonThai:
        'พ่อหมาป่าและลูกหมาป่าถูกกำจัดออกจากหมู่บ้านจันทร์ทมิฬจนหมดสิ้น! ฝ่ายชาวบ้านเป็นฝ่ายชนะและนำความสงบสุขกลับคืนมาได้สำเร็จ',
    };
  }

  if (aliveWolves >= aliveVillagers) {
    return {
      isOver: true,
      winner: 'WEREWOLF',
      reasonThai: `จำนวนฝ่ายมนุษย์หมาป่าที่รอดชีวิต (${aliveWolves} ตน) เท่ากับหรือมากกว่าฝ่ายชาวบ้านที่เหลืออยู่ (${aliveVillagers} คน)! ฝูงหมาป่าเข้ายึดครองหมู่บ้านจันทร์ทมิฬในความมืดมิด`,
    };
  }

  return {
    isOver: false,
    winner: null,
    reasonThai: '',
  };
}

export function resolveNightPhase(params: {
  nightNumber: number;
  players: Player[];
  humanActions: Record<string, { primary: string | null; secondary?: string | null }>;
  doubleKillActive: boolean;
  seerKnowledge: SeerRecord[];
  bodyguardKnowledge: BodyguardRecord[];
  lastProtectedId: string | null;
}): {
  wolfTargetIds: string[];
  protectedId: string | null;
  victimPlayers: Player[];
  savedPlayers: Player[];
  cubDiedTonight: boolean;
  newSeerRecord: SeerRecord | null;
  newBodyguardRecord: BodyguardRecord | null;
  secretMessages: { text: string; tone: string; visibleToPlayerId?: string }[];
} {
  const {
    nightNumber,
    players,
    humanActions,
    doubleKillActive,
    seerKnowledge,
    lastProtectedId,
  } = params;

  const alive = players.filter((p) => p.alive);
  const secretMessages: { text: string; tone: string; visibleToPlayerId?: string }[] = [];

  // 1. Determine Werewolf Target(s)
  const wolfTargetIds: string[] = [];
  const aliveWolves = alive.filter((p) => isWerewolfTeam(p.role));
  const aliveNonWolves = alive.filter((p) => !isWerewolfTeam(p.role));
  const killCount = doubleKillActive ? 2 : 1;

  const humanWolvesWithAction = aliveWolves.filter(
    (w) => w.isHuman && humanActions[w.id]?.primary
  );

  if (humanWolvesWithAction.length > 0) {
    // Prefer agreed target when 2 living human wolves both submitted
    const primaryChoices = humanWolvesWithAction
      .map((w) => humanActions[w.id]?.primary)
      .filter((id): id is string => Boolean(id));
    const chosenPrimary =
      primaryChoices.length >= 2 && primaryChoices[0] === primaryChoices[1]
        ? primaryChoices[0]
        : primaryChoices[0];
    const leadAct = humanActions[humanWolvesWithAction[0].id];

    if (chosenPrimary) wolfTargetIds.push(chosenPrimary);
    if (killCount === 2) {
      if (leadAct.secondary && leadAct.secondary !== chosenPrimary) {
        wolfTargetIds.push(leadAct.secondary);
      } else {
        const extra = aliveNonWolves.find((p) => p.id !== chosenPrimary);
        if (extra) wolfTargetIds.push(extra.id);
      }
    }
    const targetNames = wolfTargetIds
      .map((id) => alive.find((p) => p.id === id)?.name)
      .filter(Boolean)
      .join(' และ ');
    aliveWolves
      .filter((w) => w.isHuman)
      .forEach((hw) => {
        secretMessages.push({
          text: `[กระซิบจากฝูงหมาป่า] คืนที่ ${nightNumber}: ฝูงหมาป่าตัดสินใจบุกขย้ำ ${targetNames} ในยามวิกาล!`,
          tone: doubleKillActive ? 'ล้างแค้นลูกหมาป่า (2 ศพ)' : 'ลับเฉพาะฝูงหมาป่า',
          visibleToPlayerId: hw.id,
        });
      });
  } else {
    const candidates = aliveNonWolves.length > 0 ? aliveNonWolves : alive;
    const sorted = [...candidates].sort((a, b) => {
      if (nightNumber === 1 && a.isHuman) return 1;
      if (nightNumber === 1 && b.isHuman) return -1;
      return b.suspicionScore - a.suspicionScore;
    });
    const shuffledTop = sorted
      .slice(0, Math.min(4, sorted.length))
      .sort(() => Math.random() - 0.5);
    for (let i = 0; i < killCount && i < shuffledTop.length; i++) {
      wolfTargetIds.push(shuffledTop[i].id);
    }
  }

  // 2. Determine Bodyguard Protection
  let protectedId: string | null = null;
  let newBodyguardRecord: BodyguardRecord | null = null;
  const bodyguard = alive.find((p) => p.role === 'BODYGUARD');

  if (bodyguard) {
    if (bodyguard.isHuman && humanActions[bodyguard.id]?.primary) {
      protectedId = humanActions[bodyguard.id].primary;
    } else if (!bodyguard.isHuman) {
      const validTargets = alive.filter((p) => p.id !== lastProtectedId);
      const chosen =
        validTargets[Math.floor(Math.random() * validTargets.length)] || bodyguard;
      protectedId = chosen.id;
    }

    if (protectedId) {
      const protPlayer = alive.find((p) => p.id === protectedId);
      if (protPlayer) {
        newBodyguardRecord = {
          night: nightNumber,
          targetId: protPlayer.id,
          targetName: protPlayer.name,
        };
        if (bodyguard.isHuman) {
          secretMessages.push({
            text: `[บันทึกบอดี้การ์ด] คืนที่ ${nightNumber}: คุณยืนเฝ้าคุ้มกันหน้าบ้านของ ${protPlayer.name} ตลอดทั้งคืนพร้อมโล่เหล็กคู่ใจ`,
            tone: 'ลับเฉพาะบอดี้การ์ด',
            visibleToPlayerId: bodyguard.id,
          });
        }
      }
    }
  }

  // 3. Determine Seer Inspection
  let newSeerRecord: SeerRecord | null = null;
  const seer = alive.find((p) => p.role === 'SEER');

  if (seer) {
    let inspectId: string | null = null;
    if (seer.isHuman && humanActions[seer.id]?.primary) {
      inspectId = humanActions[seer.id].primary;
    } else if (!seer.isHuman) {
      const inspectedIds = new Set(seerKnowledge.map((k) => k.targetId));
      const uninspected = alive.filter(
        (p) => p.id !== seer.id && !inspectedIds.has(p.id)
      );
      const pool =
        uninspected.length > 0
          ? uninspected
          : alive.filter((p) => p.id !== seer.id);
      if (pool.length > 0) {
        inspectId = pool[Math.floor(Math.random() * pool.length)].id;
      }
    }

    if (inspectId) {
      const inspectedPlayer = alive.find((p) => p.id === inspectId);
      if (inspectedPlayer) {
        // HUMAN_WOLF (หมาป่ามนุษย์) scans as a Villager (false) to the Seer!
        const isWolf = appearsAsWerewolfToSeer(inspectedPlayer.role);
        newSeerRecord = {
          night: nightNumber,
          targetId: inspectedPlayer.id,
          targetName: inspectedPlayer.name,
          isWerewolf: isWolf,
        };
        if (seer.isHuman) {
          secretMessages.push({
            text: `[นิมิตจากเทพพยากรณ์] คืนที่ ${nightNumber}: คุณเพ่งมองลูกแก้วไปที่ ${inspectedPlayer.name} ... ผลปรากฏว่าเขาอยู่ "${
              isWolf ? 'ฝ่ายมนุษย์หมาป่า! (อันตราย)' : 'ฝ่ายชาวบ้าน (ผู้บริสุทธิ์)'
            }"`,
            tone: isWolf ? 'พบฝ่ายหมาป่า!' : 'ผู้บริสุทธิ์',
            visibleToPlayerId: seer.id,
          });
        }
      }
    }
  }

  // 4. Resolve Attacks vs Protection
  const victimPlayers: Player[] = [];
  const savedPlayers: Player[] = [];

  for (const tId of wolfTargetIds) {
    const targetObj = alive.find((p) => p.id === tId);
    if (!targetObj) continue;
    if (protectedId && tId === protectedId) {
      savedPlayers.push(targetObj);
    } else {
      victimPlayers.push(targetObj);
    }
  }

  const cubDiedTonight = victimPlayers.some((v) => v.role === 'WOLF_CUB');

  return {
    wolfTargetIds,
    protectedId,
    victimPlayers,
    savedPlayers,
    cubDiedTonight,
    newSeerRecord,
    newBodyguardRecord,
    secretMessages,
  };
}

// Helper to pick a random item from an array
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Dynamic, unscripted Thai close-friend banter generator (used when offline or no API key)
export function generateLocalDayDiscussion(params: {
  dayNumber: number;
  players: Player[];
  victimPlayers: Player[];
  seerKnowledge: SeerRecord[];
  bodyguardKnowledge: BodyguardRecord[];
  cubRageTriggeredLastRound: boolean;
  previousVotes?: VoteRecord[];
}): { speakerId: string; speakerName: string; text: string; tone: string }[] {
  const {
    dayNumber,
    players,
    victimPlayers,
    seerKnowledge,
    bodyguardKnowledge,
    previousVotes = [],
  } = params;

  const aliveAI = players.filter((p) => p.alive && !p.isHuman);
  const aliveAll = players.filter((p) => p.alive);
  if (aliveAI.length === 0) return [];

  const lines: { speakerId: string; speakerName: string; text: string; tone: string }[] = [];
  const victimNames = victimPlayers.map((v) => `ไอ้${v.shortName}`).join(' กับ ');

  // Shuffle alive AI speakers so the order is always organic
  const shuffledAI = [...aliveAI].sort(() => Math.random() - 0.5);
  const aiSeer = shuffledAI.find((p) => p.role === 'SEER');
  const latestWolfFound = seerKnowledge.find(
    (k) => k.isWerewolf && aliveAll.some((p) => p.id === k.targetId)
  );
  const latestGoodFound = seerKnowledge.find(
    (k) => !k.isWerewolf && aliveAll.some((p) => p.id === k.targetId)
  );

  // Pick 4 to 5 speakers who will roast and accuse each other in sequence
  const speakers = shuffledAI.slice(0, Math.min(5, shuffledAI.length));
  if (aiSeer && latestWolfFound && !speakers.some((s) => s.id === aiSeer.id)) {
    speakers[0] = aiSeer;
  }

  let accusedPlayer: Player | null = null;

  speakers.forEach((speaker, idx) => {
    const others = aliveAll.filter((p) => p.id !== speaker.id);
    const nonWolfOthers = others.filter((p) => !isWerewolfTeam(p.role));
    const prevSpeaker = idx > 0 ? speakers[idx - 1] : null;

    // 1. If speaker is Seer and found a live werewolf, call them out hard!
    if (speaker.role === 'SEER' && latestWolfFound) {
      const wolfPlayer = aliveAll.find((p) => p.id === latestWolfFound.targetId);
      if (wolfPlayer) {
        accusedPlayer = wolfPlayer;
        const seerOpenings = [
          `เห้ยพวกมึงฟังกูก่อน! เมื่อคืนกูส่องเจอเต็มตาเลย ไอ้${wolfPlayer.shortName} แม่งเป็นหมาป่าชัวร์ 100% อย่าไปเชื่อมันตอแหล วันนี้โหวตแม่งออกเลย!`,
          `เชี่ยเอ๊ย พวกมึงอย่าเพิ่งโง่ไปโหวตมั่ว กูเช็กมาแล้ว ไอ้${wolfPlayer.shortName} นี่แหละตัวหมาป่า โคตรเหลี่ยม ปล่อยไว้คืนหน้าตายห่ากันหมดแน่!`,
          `กูไม่อ้อมค้อมละนะพวกมึง ไอ้${wolfPlayer.shortName} แม่งหมาป่าแท้ๆ กูมีข้อมูลในมือ ถ้าวันนี้ไม่โหวตไอ้${wolfPlayer.shortName} ออก พวกมึงแม่งโง่ชิบหายแน่!`,
        ];
        lines.push({
          speakerId: speaker.id,
          speakerName: speaker.name,
          text: pickRandom(seerOpenings),
          tone: 'เปิดโปงเดือดๆ',
        });
        return;
      }
    }

    // 2. If this speaker was just accused by an earlier speaker, clap back hard!
    if (accusedPlayer && accusedPlayer.id === speaker.id && prevSpeaker) {
      const nextSuspect =
        others.find((p) => p.id !== prevSpeaker.id) || prevSpeaker;
      const defenses = [
        `ตอแหลละไอ้สัส! ไอ้${prevSpeaker.shortName} มึงมั่วเหี้ยไรเนี่ย กูชาวบ้านบริสุทธิ์ มึงนั่นแหละตัวเปิด ปั่นเก่งชิบหาย เดี๋ยวกูว่าไอ้${nextSuspect.shortName} กับมึงอะร่วมมือกัน!`,
        `เห้ยไอ้${prevSpeaker.shortName} อย่ามาปั่นกู! กูอยู่เฉยๆ แม่งโยนขี้มาให้กูเฉย โคตรเหลี่ยมเลยมึงอะ พวกมึงอย่าโง่เชื่อมันนะ กูไม่ใช่หมาป่าโว้ย!`,
        `ควายเอ๊ย ไอ้${prevSpeaker.shortName} มึงเอาเหี้ยไรมามั่นใจว่ากูเป็นหมาป่า? รีบโยนเป้าแต่เช้าแบบนี้ มึงนั่นแหละเนียนเหี้ยๆ พวกมึงดูทรงมันดิ เลิ่กลั่กชิบหาย!`,
      ];
      lines.push({
        speakerId: speaker.id,
        speakerName: speaker.name,
        text: pickRandom(defenses),
        tone: 'สวนกลับหัวร้อน',
      });
      accusedPlayer = prevSpeaker;
      return;
    }

    // 3. First speaker of the morning reacts chaotically to last night
    if (idx === 0) {
      const targetToQuestion = isWerewolfTeam(speaker.role)
        ? pickRandom(nonWolfOthers.length > 0 ? nonWolfOthers : others)
        : pickRandom(others);
      accusedPlayer = targetToQuestion;

      if (victimPlayers.length > 0) {
        const morningAnalyses = [
          `เชี่ยเอ๊ย เมื่อคืน${victimNames}โดนหมาป่าแดกไปเฉย! ว่าแต่ไอ้${targetToQuestion.shortName} มึงเงียบทำเหี้ยไร รอบที่แล้วมึงก็เลิ่กลั่ก อย่ามาเนียน!`,
          `สัสเอ๊ย ${victimNames}ตายโง่ๆ เลยเมื่อคืน กูว่าแล้วหมาป่าแม่งเก็บคนฉลาดก่อน ไอ้${targetToQuestion.shortName} มึงดูโคตรเหลี่ยมอะวันนี้ พูดมาดิ๊มึงทำไรเมื่อคืน!`,
          `ฉิบหายละพวกมึง เหลือกันแค่ ${aliveAll.length} คนเอง ไอ้${targetToQuestion.shortName} มึงอย่ามานั่งเงียบทำเนียน ตอบกูมาซิว่าทำไม${victimNames}ถึงโดนเก็บ!`,
        ];
        lines.push({
          speakerId: speaker.id,
          speakerName: speaker.name,
          text: pickRandom(morningAnalyses),
          tone: 'เปิดวงด่าทันที',
        });
      } else {
        const savedAnalyses = [
          `เห้ยเชี่ย! เมื่อคืนไม่มีใครตายโว้ยย บอดี้การ์ดแม่งโคตรตึง! แต่หมาป่ายังอยู่ครบ 2 ตัว ไอ้${targetToQuestion.shortName} มึงทำหน้าเลิ่กลั่กทำเหี้ยไร หรือเมื่อคืนมึงกัดไม่เข้าวะ!`,
          `5555 หมาป่าแม่งกัดว่าวเมื่อคืน บอดี้การ์ดแบกจัด! ว่าแต่ไอ้${targetToQuestion.shortName} มึงเงียบผิดปกติเลยนะมึง อย่ามาตอแหล พูดมาว่ามึงสงสัยใคร!`,
        ];
        lines.push({
          speakerId: speaker.id,
          speakerName: speaker.name,
          text: pickRandom(savedAnalyses),
          tone: 'แซวหมาป่ากัดว่าว',
        });
      }
      return;
    }

    // 4. Subsequent speakers jump into the chaotic argument
    const suspectPool = isWerewolfTeam(speaker.role)
      ? nonWolfOthers.length > 0
        ? nonWolfOthers
        : others
      : speaker.role === 'SEER' && latestGoodFound
      ? others.filter((p) => p.id !== latestGoodFound.targetId)
      : others;

    const chosenSuspect =
      accusedPlayer &&
      accusedPlayer.id !== speaker.id &&
      !(isWerewolfTeam(speaker.role) && isWerewolfTeam(accusedPlayer.role)) &&
      Math.random() > 0.45
        ? accusedPlayer
        : pickRandom(suspectPool.length > 0 ? suspectPool : others);

    accusedPlayer = chosenSuspect;

    const yesterdayVote =
      previousVotes.length > 0 ? pickRandom(previousVotes) : null;

    if (yesterdayVote && dayNumber > 1 && Math.random() > 0.5) {
      lines.push({
        speakerId: speaker.id,
        speakerName: speaker.name,
        text: `พวกมึงดูรอบที่แล้วดิ ไอ้${yesterdayVote.voterName} แม่งโหวตไปหาไอ้${yesterdayVote.targetName} โคตรแปลก แต่ตอนนี้กูว่าไอ้${chosenSuspect.shortName} อะเนียนเหี้ยๆ ดูทรงแม่งโคตรเหลี่ยม!`,
        tone: 'ขุดแผลรอบก่อน',
      });
      return;
    }

    if (speaker.role === 'BODYGUARD' && bodyguardKnowledge.length > 0 && victimPlayers.length === 0) {
      const lastSaved = bodyguardKnowledge[bodyguardKnowledge.length - 1];
      lines.push({
        speakerId: speaker.id,
        speakerName: speaker.name,
        text: `เออพวกมึง กูว่าไอ้${lastSaved.targetName} แม่งคนดีชัวร์ไม่ต้องไปยุ่งกับมัน ไปบี้ไอ้${chosenSuspect.shortName} ดีกว่า แม่งเงียบชิบหายน่าสงสัยสุดละ!`,
        tone: 'ชี้เป้าช่วยเพื่อน',
      });
      return;
    }

    const followUpThoughts = [
      `จริงของไอ้${prevSpeaker?.shortName || 'เมื่อกี้'}ว่ะ กูก็ว่าไอ้${chosenSuspect.shortName} แม่งโคตรเหลี่ยม นั่งเงียบไหลตามน้ำแบบนี้ หมาป่าชัดๆ อย่ามาตอแหล!`,
      `ไอ้${chosenSuspect.shortName} มึงเงียบทำเหี้ยไร รอบที่แล้วมึงก็เลิ่กลั่ก พวกมึงอย่าปล่อยมันรอดไปง่ายๆ นะเว้ย เดี๋ยวโดนมันแดกหมดวง!`,
      `เชี่ยเอ๊ย พวกมึงอย่ามัวแต่เถียงกันโง่ๆ หมาป่าแม่งนั่งขำอยู่ละมั้ง กูเล็งไอ้${chosenSuspect.shortName} ไว้ตั้งแต่เมื่อกี้ละ ทรงแม่งเนียนเหี้ยๆ!`,
      `มึงอย่ามาปั่นพวกกูเลยไอ้${chosenSuspect.shortName} พูดจาวกไปวนมาโคตรมีพิรุธ พวกมึงว่าไง วันนี้จัดแม่งเลยป่ะ?`,
    ];

    lines.push({
      speakerId: speaker.id,
      speakerName: speaker.name,
      text: pickRandom(followUpThoughts),
      tone: 'ผสมโรงบี้หนัก',
    });
  });

  return lines;
}

export function generateLocalReplyToHuman(params: {
  players: Player[];
  speakerName: string;
  humanMessage: string;
  seerKnowledge: SeerRecord[];
}): { speakerId: string; speakerName: string; text: string; tone: string }[] {
  const { players, speakerName, humanMessage, seerKnowledge } = params;
  const aliveAI = players.filter((p) => p.alive && !p.isHuman);
  const aliveAll = players.filter((p) => p.alive);
  if (aliveAI.length === 0) return [];

  const mentionedAI = aliveAI.find(
    (ai) =>
      humanMessage.includes(ai.shortName) || humanMessage.includes(ai.name)
  );

  const replies: { speakerId: string; speakerName: string; text: string; tone: string }[] = [];

  if (mentionedAI) {
    const alternativeSuspect =
      aliveAll.find(
        (p) =>
          p.id !== mentionedAI.id &&
          !(isWerewolfTeam(mentionedAI.role) && isWerewolfTeam(p.role))
      ) || aliveAll[0];

    if (isWerewolfTeam(mentionedAI.role)) {
      const wolfDefenses = [
        `ตอแหลละไอ้สัส ไอ้${speakerName}! กูชาวบ้านบริสุทธิ์ มึงนั่นแหละตัวเปิด ปั่นเก่งชิบหาย! พวกมึงไปดูไอ้${alternativeSuspect.shortName} นู่น แม่งเนียนเงียบกว่ากูอีก!`,
        `เห้ยไอ้${speakerName} มึงมั่วเหี้ยไรวะ โยนมาให้กูเฉย! ถ้าพวกมึงโง่โหวตชาวบ้านอย่างกูออก คืนหน้าโดนหมาป่าแดกเรียบแน่ อย่าไปเชื่อไอ้${speakerName} มันปั่น!`,
      ];
      replies.push({
        speakerId: mentionedAI.id,
        speakerName: mentionedAI.name,
        text: pickRandom(wolfDefenses),
        tone: 'โวยวายกลบเกลื่อน',
      });
    } else if (mentionedAI.role === 'BEGGAR') {
      replies.push({
        speakerId: mentionedAI.id,
        speakerName: mentionedAI.name,
        text: `เอาดิไอ้${speakerName} อยากโหวตกูก็โหวตเลยสัส แต่ถ้ามึงโหวตกูออกวันนี้แม่งเสียรอบฟรีทั้งวงนะเว้ย 555 ไปโหวตไอ้${alternativeSuspect.shortName} เหอะควายเอ๊ย!`,
        tone: 'ท้าโหวตแบบกวนตีน',
      });
    } else if (mentionedAI.role === 'SEER') {
      const foundWolf = seerKnowledge.find(
        (k) => k.isWerewolf && aliveAll.some((p) => p.id === k.targetId)
      );
      replies.push({
        speakerId: mentionedAI.id,
        speakerName: mentionedAI.name,
        text: foundWolf
          ? `ไอ้${speakerName} มึงใจเย็นดิ๊โว้ย! กูฝั่งคนดีมีข้อมูลในมือ ตัวหมาป่าจริงๆ คือไอ้${foundWolf.targetName} นู่น มึงอย่ามาโง่ยิงเพื่อนกันเองดิ๊!`
          : `เชี่ยไอ้${speakerName} มึงอย่ามามั่วใส่กู กูคนดีเต็มตัว ถ้ามึงพาวงโหวตกูออกวันนี้พวกมึงตาบอดทั้งหมู่บ้านแน่!`,
        tone: 'หัวร้อนห้ามเพื่อน',
      });
    } else {
      const villagerDefenses = [
        `เอ้าไอ้${speakerName} กูเกี่ยวเหี้ยไรด้วยวะ! กูชาวบ้านธรรมดาโว้ย มึงไปจี้ไอ้${alternativeSuspect.shortName} นู่น แม่งนั่งเงียบโคตรเหลี่ยมเลย!`,
        `มึงอย่ามาปั่นกูไอ้${speakerName} กูไม่ได้ทำเหี้ยไรผิดเลย ชาวบ้านแท้ๆ 100% พวกมึงลองดูไอ้${alternativeSuspect.shortName} ดิ พิรุธกว่ากูเยอะสัส!`,
      ];
      replies.push({
        speakerId: mentionedAI.id,
        speakerName: mentionedAI.name,
        text: pickRandom(villagerDefenses),
        tone: 'เถียงคอเป็นเอ็น',
      });
    }
  }

  const otherRepliers = aliveAI
    .filter((a) => a.id !== mentionedAI?.id)
    .sort(() => Math.random() - 0.5)
    .slice(0, 2);

  otherRepliers.forEach((ai) => {
    const otherTarget =
      aliveAll.find((p) => p.id !== ai.id && p.id !== mentionedAI?.id) ||
      aliveAll[0];
    const analyticalFollowUps = [
      `เออจริงของไอ้${speakerName}ว่ะ${
        mentionedAI
          ? ` กูฟังไอ้${mentionedAI.shortName} แก้ตัวเมื่อกี้แล้วแม่งเลิ่กลั่กชิบหาย อย่าไปเชื่อมัน!`
          : ` กูก็ตะหงิดๆ อยู่เหมือนกัน พวกมึงอย่าโดนหมาป่าปั่นหัวล่ะ!`
      }`,
      `เห้ยไอ้${speakerName} มึงก็พูดมีเหตุผลนะ แต่กูว่าไอ้${otherTarget.shortName} แม่งก็น่าสงสัยไม่แพ้กัน นั่งเงียบโคตรเหลี่ยมเลยมึงเอ๊ย!`,
      `555 เอาแล้วเว้ยเถียงกันยับ! แต่กูขอดูทรงตอนโหวตก่อนนะไอ้${speakerName} ใครแม่งรีบเทเสียงแปลกๆ เดี๋ยวรู้กัน!`,
    ];
    replies.push({
      speakerId: ai.id,
      speakerName: ai.name,
      text: pickRandom(analyticalFollowUps),
      tone: 'ผสมโรงแซว',
    });
  });

  return replies;
}

export function generateLocalVotes(params: {
  players: Player[];
  humanVotesMap: Record<string, string>;
  seerKnowledge: SeerRecord[];
  bodyguardKnowledge?: BodyguardRecord[];
  recentTranscript?: string[];
}): VoteRecord[] {
  const {
    players,
    humanVotesMap,
    seerKnowledge,
    bodyguardKnowledge = [],
    recentTranscript = [],
  } = params;
  const aliveAll = players.filter((p) => p.alive);
  const eligibleAI = aliveAll.filter((p) => !p.isHuman && p.canVote);
  const eligibleHumans = aliveAll.filter((p) => p.isHuman && p.canVote);

  const votes: VoteRecord[] = [];

  for (const h of eligibleHumans) {
    const tId = humanVotesMap[h.id];
    if (tId === ABSTAIN_VOTE_ID || !tId) {
      votes.push({
        voterId: h.id,
        voterName: h.name,
        targetId: ABSTAIN_VOTE_ID,
        targetName: 'งดออกเสียง (ไม่โหวต)',
        reason: 'เลือกงดออกเสียงเพื่อเก็บไว้ตัดสินใจในวันถัดไป',
      });
      continue;
    }
    const targetObj = aliveAll.find((p) => p.id === tId);
    if (targetObj) {
      votes.push({
        voterId: h.id,
        voterName: h.name,
        targetId: targetObj.id,
        targetName: targetObj.name,
        reason: 'ตัดสินใจลงคะแนนโหวตจากการวิเคราะห์ในสภา',
      });
    }
  }

  const mentionCounts: Record<string, number> = {};
  aliveAll.forEach((p) => {
    let count = 0;
    for (const line of recentTranscript) {
      if (line.includes(p.shortName)) count += 1;
    }
    mentionCounts[p.id] = count;
  });

  const wolfIds = new Set(
    aliveAll.filter((p) => isWerewolfTeam(p.role)).map((p) => p.id)
  );

  for (const ai of eligibleAI) {
    const validTargets = aliveAll.filter(
      (p) => p.id !== ai.id && !p.revealedBeggar
    );
    let chosenTarget = validTargets[0] || aliveAll.find((p) => p.id !== ai.id)!;
    let reason = '';

    if (ai.role === 'SEER') {
      const knownAliveWolf = seerKnowledge.find(
        (k) => k.isWerewolf && validTargets.some((t) => t.id === k.targetId)
      );
      if (knownAliveWolf) {
        chosenTarget =
          validTargets.find((t) => t.id === knownAliveWolf.targetId) ||
          chosenTarget;
        reason = `กูมั่นใจ 100% ไอ้${chosenTarget.shortName} แม่งหมาป่าชัวร์ โหวตแม่งเลย!`;
      } else {
        const safeIds = new Set(
          seerKnowledge.filter((k) => !k.isWerewolf).map((k) => k.targetId)
        );
        const unknownTargets = validTargets.filter((t) => !safeIds.has(t.id));
        const ranked = [
          ...(unknownTargets.length > 0 ? unknownTargets : validTargets),
        ].sort(
          (a, b) =>
            b.suspicionScore +
            (mentionCounts[b.id] || 0) * 6 -
            (a.suspicionScore + (mentionCounts[a.id] || 0) * 6)
        );
        chosenTarget = ranked[0] || chosenTarget;
        reason = `ตัดคนชัวร์ออกแล้ว ไอ้${chosenTarget.shortName} แม่งเหลี่ยมสุดในวง!`;
      }
    } else if (ai.role === 'BODYGUARD') {
      const lastProtected =
        bodyguardKnowledge.length > 0
          ? bodyguardKnowledge[bodyguardKnowledge.length - 1].targetId
          : null;
      const candidates = validTargets.filter((t) => t.id !== lastProtected);
      const pool = candidates.length > 0 ? candidates : validTargets;
      const ranked = [...pool].sort(
        (a, b) =>
          b.suspicionScore +
          (mentionCounts[b.id] || 0) * 5 -
          (a.suspicionScore + (mentionCounts[a.id] || 0) * 5)
      );
      chosenTarget = ranked[0] || chosenTarget;
      reason = `ดูทรงทั้งวงแล้ว ไอ้${chosenTarget.shortName} แม่งเลิ่กลั่กสุด จัดไป!`;
    } else if (isWerewolfTeam(ai.role)) {
      const nonWolfTargets = validTargets.filter((t) => !wolfIds.has(t.id));
      const ranked = [
        ...(nonWolfTargets.length > 0 ? nonWolfTargets : validTargets),
      ].sort(
        (a, b) =>
          (mentionCounts[b.id] || 0) * 7 +
          b.suspicionScore -
          ((mentionCounts[a.id] || 0) * 7 + a.suspicionScore)
      );
      const topChoices = ranked.slice(0, Math.min(2, ranked.length));
      chosenTarget =
        topChoices[Math.floor(Math.random() * topChoices.length)] || chosenTarget;
      reason = pickRandom([
        `ไอ้${chosenTarget.shortName} แม่งปั่นเก่งชิบหาย โหวตแม่งออกเหอะ!`,
        `ทรงไอ้${chosenTarget.shortName} โคตรเหลี่ยม ตอแหลจัดๆ วันนี้ไม่รอดแน่!`,
        `ไอ้${chosenTarget.shortName} เงียบทำเหี้ยไร เนียนเหี้ยๆ กูโหวตมึงนี่แหละ!`,
      ]);
    } else {
      const ranked = [...validTargets].sort((a, b) => {
        const scoreA = a.suspicionScore + (mentionCounts[a.id] || 0) * 6;
        const scoreB = b.suspicionScore + (mentionCounts[b.id] || 0) * 6;
        return scoreB - scoreA;
      });
      const topSuspects = ranked.slice(0, Math.min(3, ranked.length));
      chosenTarget =
        topSuspects[Math.floor(Math.random() * topSuspects.length)] || chosenTarget;
      reason = pickRandom([
        `ไอ้${chosenTarget.shortName} แม่งเลิ่กลั่กสุดละ อย่ามาตอแหล!`,
        `กูว่าไอ้${chosenTarget.shortName} โคตรเหลี่ยม ลองเชือดแม่งดูเลย!`,
        `พูดจาแปลกชิบหาย ไอ้${chosenTarget.shortName} นี่แหละตัวหมาป่า!`,
      ]);
    }

    // Allow ordinary villagers a small chance to abstain strategically if evidence is sparse
    if (
      ai.role === 'VILLAGER' &&
      recentTranscript.length < 6 &&
      Math.random() < 0.14
    ) {
      votes.push({
        voterId: ai.id,
        voterName: ai.name,
        targetId: ABSTAIN_VOTE_ID,
        targetName: 'งดออกเสียง (ไม่โหวต)',
        reason: 'ยังไม่ชัวร์ว่ะ กลัวโหวตพลาดด่ากันยับ ขอข้ามก่อนละกัน!',
      });
      continue;
    }

    votes.push({
      voterId: ai.id,
      voterName: ai.name,
      targetId: chosenTarget.id,
      targetName: chosenTarget.name,
      reason,
    });
  }

  return votes;
}

export function generateLocalWolfPartnerReply(params: {
  aiWolf: Player;
  humanWolfName: string;
  players: Player[];
  humanMessage?: string;
  humanSignaledTargetId?: string | null;
  nightNumber: number;
  mode: 'OPEN_NIGHT' | 'HUMAN_SIGNAL' | 'HUMAN_CHAT';
}): { text: string; suggestedTargetId: string | null } {
  const {
    humanWolfName,
    players,
    humanMessage = '',
    humanSignaledTargetId,
    nightNumber,
    mode,
  } = params;

  const alivePrey = players.filter((p) => p.alive && !isWerewolfTeam(p.role));
  if (alivePrey.length === 0) {
    return { text: 'เหลือแค่นี้แดกเรียบแน่ 555 ปิดเกมเลยมึง!', suggestedTargetId: null };
  }

  // Check if human mentioned a specific living prey by name in chat
  const mentionedPrey = alivePrey.find(
    (p) => humanMessage.includes(p.shortName) || humanMessage.includes(p.name)
  );
  const signaledPrey = humanSignaledTargetId
    ? alivePrey.find((p) => p.id === humanSignaledTargetId)
    : undefined;

  if (mode === 'OPEN_NIGHT') {
    const sorted = [...alivePrey].sort((a, b) => b.suspicionScore - a.suspicionScore);
    const pick =
      sorted[Math.floor(Math.random() * Math.min(3, sorted.length))] || alivePrey[0];
    const openers = [
      `เห้ยไอ้${humanWolfName} คืนที่ ${nightNumber} แล้วโว้ย! กูเล็งไอ้"${pick.shortName}"ไว้ แม่งปากดีน่าจะอ่านเกมออก ถ้ามึงโอเคกดล็อกไอ้"${pick.shortName}"พร้อมกูเลย หรือจะแดกตัวอื่นก็ส่งซิกมา!`,
      `ไอ้${humanWolfName} คืนนี้เชือดไอ้"${pick.shortName}"ก่อนป่ะ? กูส่งซิกไว้ให้ละ แต่ถ้ามึงหมั่นไส้ตัวอื่นกดเลือกมาเลย เดี๋ยวกูกดตามมึงให้ตรงกัน!`,
    ];
    return {
      text: pickRandom(openers),
      suggestedTargetId: pick.id,
    };
  }

  if (mode === 'HUMAN_SIGNAL' && signaledPrey) {
    const agreements = [
      `จัดไปเพื่อน! กูย้ายมาล็อกไอ้"${signaledPrey.shortName}"ตามมึงแล้วไอ้${humanWolfName} ตรงกันทั้งคู่กดแดกแม่งเลย!`,
      `เออดี ไอ้"${signaledPrey.shortName}"แม่งโคตรน่ารำคาญ กูส่งซิกตามมึงละ กดยืนยันเชือดแม่งได้เลย!`,
      `5555 เอาไอ้"${signaledPrey.shortName}"นี่แหละโคตรเข้าท่า กูล็อกตรงกับมึงแล้ว คืนนี้ไม่รอดแน่สัส!`,
    ];
    return {
      text: pickRandom(agreements),
      suggestedTargetId: signaledPrey.id,
    };
  }

  // HUMAN_CHAT mode
  const target = mentionedPrey || signaledPrey || pickRandom(alivePrey);
  if (mentionedPrey) {
    return {
      text: `เอาดิไอ้${humanWolfName}! งั้นคืนนี้แดกไอ้"${mentionedPrey.shortName}"เลย กูส่งซิกล็อกให้แล้ว มึงกดตามได้เลย!`,
      suggestedTargetId: mentionedPrey.id,
    };
  }

  const chatReplies = [
    `เออเข้าใจละไอ้${humanWolfName} ตอนนี้กูเล็งไอ้"${target.shortName}"อยู่นะ ถ้ามึงเอาด้วยกดเลือกไอ้"${target.shortName}"พร้อมกูเลย หรืออยากเปลี่ยนเป้าก็ส่งซิกมา!`,
    `โอเคเพื่อน เช้ามากูกับมึงต้องเนียนๆ หน่อยนะอย่าเลิ่กลั่ก คืนนี้กูส่งซิกไปที่ไอ้"${target.shortName}"ก่อน ถ้ามึงเล็งใครอยู่กดส่งซิกมาเลยเดี๋ยวกูตาม!`,
  ];
  return {
    text: pickRandom(chatReplies),
    suggestedTargetId: target.id,
  };
}

export interface PostGameReaction {
  speakerId: string;
  speakerName: string;
  role: RoleType;
  alive: boolean;
  moodTag: string;
  sentiment: 'praise' | 'roast' | 'shock' | 'proud';
  text: string;
}

export function generateLocalPostGameDebrief(params: {
  winner: 'VILLAGE' | 'WEREWOLF';
  players: Player[];
  dayCount: number;
  seerKnowledge: SeerRecord[];
  bodyguardKnowledge: BodyguardRecord[];
}): PostGameReaction[] {
  const { winner, players, seerKnowledge, bodyguardKnowledge } = params;
  const aiPlayers = players.filter((p) => !p.isHuman);
  if (aiPlayers.length === 0) return [];

  const allWolves = players.filter((p) => isWerewolfTeam(p.role));
  const seer = players.find((p) => p.role === 'SEER');
  const bodyguard = players.find((p) => p.role === 'BODYGUARD');
  const humanPlayers = players.filter((p) => p.isHuman);
  const leadHuman = humanPlayers[0];

  const wolfNames = allWolves
    .map((w) => `ไอ้${w.shortName}`)
    .join(' กับ ');

  return aiPlayers.map((ai) => {
    const isWolf = isWerewolfTeam(ai.role);
    const partner = isWolf
      ? players.find((p) => p.id !== ai.id && isWerewolfTeam(p.role))
      : undefined;

    if (isWolf && winner === 'WEREWOLF') {
      return {
        speakerId: ai.id,
        speakerName: ai.name,
        role: ai.role,
        alive: ai.alive,
        moodTag: 'ขิงยับ / โคตรเหลี่ยม',
        sentiment: 'proud',
        text: partner
          ? `555555 โคตรโง่! โดนกูกับไอ้${partner.shortName}หลอกแดกทั้งวง เหลี่ยมจัดๆ!${leadHuman && !isWerewolfTeam(leadHuman.role) ? ` โดยเฉพาะไอ้${leadHuman.shortName} โดนกูปั่นซะหัวหมุนเลยไอ้ควายเอ๊ย!` : ' ชาวบ้านตานี้โง่ชิบหาย!'}`
          : `555555 โคตรโง่ โดนกูหลอกแดกทั้งวง เหลี่ยมจัดๆ นั่งเนียนนิดเดียวเชื่อกูหมดเลยไอ้สัส!`,
      };
    }

    if (isWolf && winner === 'VILLAGE') {
      return {
        speakerId: ai.id,
        speakerName: ai.name,
        role: ai.role,
        alive: ai.alive,
        moodTag: 'หัวร้อน / ยอมใจ',
        sentiment: 'praise',
        text: `${leadHuman && !isWerewolfTeam(leadHuman.role) ? `เชี่ยเอ๊ย ไอ้${leadHuman.shortName} มึงอ่านเกมโคตรขาด กูตอแหลแทบตายมึงยังไม่เชื่อ! ` : 'สัสเอ๊ย อุตส่าห์ตีเนียนแทบตาย! '}${seer ? `แถมไอ้${seer.shortName} (หมอดู) แม่งเสือกส่องแม่นอีก ตาหน้ากูเอาคืนแน่พวกมึง!` : 'รอบหน้ากูไม่พลาดแน่ไอ้เวร!'}`,
      };
    }

    if (ai.role === 'SEER') {
      const foundWolf = seerKnowledge.find((k) => k.isWerewolf);
      if (winner === 'VILLAGE') {
        return {
          speakerId: ai.id,
          speakerName: ai.name,
          role: ai.role,
          alive: ai.alive,
          moodTag: 'แบกหลังหัก (MVP)',
          sentiment: 'proud',
          text: foundWolf
            ? `เห็นมั้ยพวกควาย! กูบอกแล้วว่าไอ้${foundWolf.targetName}เป็นหมาป่า ดีนะพวกมึงยังฉลาดยอมเชื่อกู ไม่งั้นแพ้โง่ๆ ไปแล้ว!`
            : `กูส่องเช็กให้ทีละตัวจนจับ ${wolfNames} ได้หมด เกมนี้กูแบกหลังหักเลยโว้ย 555!`,
        };
      }
      return {
        speakerId: ai.id,
        speakerName: ai.name,
        role: ai.role,
        alive: ai.alive,
        moodTag: 'ด่าเพื่อนยับ / หัวร้อน',
        sentiment: 'roast',
        text: `ควายเอ๊ย!! กูเป็นหมอดู กูบอกแล้วว่า${wolfNames || 'มัน'}เป็นหมาป่า พวกมึงแม่งโง่ไปโหวตเพื่อนกันเอง${bodyguard ? ` แถมไอ้${bodyguard.shortName} (บอดี้การ์ด) มึงไปเซฟใครวะเนี่ย ปล่อยกูตายโง่ๆ เลยไอ้เวร!` : ' โคตรหัวร้อนเลยสัส!'}`,
      };
    }

    if (ai.role === 'BODYGUARD') {
      const savedSomeone = bodyguardKnowledge.length > 0;
      if (winner === 'VILLAGE') {
        return {
          speakerId: ai.id,
          speakerName: ai.name,
          role: ai.role,
          alive: ai.alive,
          moodTag: 'โคตรตึง / แบกทีม',
          sentiment: 'praise',
          text: savedSomeone
            ? `เชี่ยเอ๊ย ตอนกลางคืนกูเซฟจนมือสั่น ดีนะพวกมึงฉลาดรุมกระทืบ${wolfNames || 'หมาป่า'}จนชนะได้ โคตรสะใจโว้ย!`
            : `บอดี้การ์ดอย่างกูตึงจัด! จับ${wolfNames || 'หมาป่า'}ย่างสดทั้งคู่ 5555!`,
        };
      }
      return {
        speakerId: ai.id,
        speakerName: ai.name,
        role: ai.role,
        alive: ai.alive,
        moodTag: 'ช็อกตาค้าง / ด่าหมาป่า',
        sentiment: 'shock',
        text: `เชี่ยเอ๊ย!! ${wolfNames || 'คู่นั้น'}เป็นหมาป่าเหรอวะ?! มึงเนียนเหี้ยๆ เลยไอ้สัส กูดันไปเซฟผิดคนเฉย โดนมึงหลอกควายเลยตานี้!`,
      };
    }

    if (ai.role === 'BEGGAR') {
      return {
        speakerId: ai.id,
        speakerName: ai.name,
        role: ai.role,
        alive: ai.alive,
        moodTag: 'ขำลั่นวง / ปั่นจัด',
        sentiment: winner === 'VILLAGE' ? 'praise' : 'roast',
        text: ai.revealedBeggar
          ? `555555 พวกควายเอ๊ย โหวตกูทำเหี้ยไร กูแค่ยาจก! พอเห็นเฉลยว่า${wolfNames}เป็นหมาป่าแล้วกูขำท้องแข็งเลยสัส!`
          : `เชี่ย ${wolfNames} แม่งโคตรเหลี่ยม หลอกพวกมึงซะเปื่อยเลย 5555 จัดอีกตาเลยมั้ยพวกมึง!`,
      };
    }

    // Villagers: unfiltered praising or flaming friends after reveal
    if (winner === 'VILLAGE') {
      return {
        speakerId: ai.id,
        speakerName: ai.name,
        role: ai.role,
        alive: ai.alive,
        moodTag: ai.alive ? 'สะใจ / ชมเพื่อน' : 'ช็อกจัด / แก้แค้นสำเร็จ',
        sentiment: ai.alive ? 'praise' : 'shock',
        text: ai.alive
          ? `${leadHuman && !isWerewolfTeam(leadHuman.role) ? `เอาว่ะไอ้${leadHuman.shortName} โคตรตึง จับโป๊ะโคตรแม่น! ` : ''}เกือบโดน${wolfNames}ตอแหลหลอกแดกแล้วมั้ยล่ะ ดีนะไหวตัวทัน 555!`
          : `สัสเอ๊ย ${wolfNames} แม่งแอบมากัดกูตายก่อน ดีนะพวกมึงไม่โง่ตามไปเชือดมันแก้แค้นให้กูได้ สะใจชิบหาย!`,
      };
    }

    return {
      speakerId: ai.id,
      speakerName: ai.name,
      role: ai.role,
      alive: ai.alive,
      moodTag: ai.alive ? 'ด่ายับ / หัวร้อนจัด' : 'กูว่าแล้ว / ด่าเพื่อน',
      sentiment: 'roast',
      text: ai.alive
        ? `เชี่ยเอ๊ย ${wolfNames} มึงเนียนเหี้ยๆ ตอแหลหน้าตายสัส!${bodyguard ? ` ส่วนไอ้${bodyguard.shortName} บอดี้การ์ดมึงไปเซฟใครวะเนี่ย ปล่อยเซียร์ตายโง่ๆ เลยไอ้เวร!` : ' พวกมึงแม่งโง่เชื่อมันกันหมดวง ควายเอ๊ย!'}`
        : `กูบอกแล้วว่า${wolfNames}เป็นหมาป่า พวกมึงแม่งโง่ไปโหวตเพื่อนกันเอง ควายเอ๊ย! โดนมันหลอกแดกทั้งวงสมน้ำหน้าชิบหาย!`,
    };
  });
}

