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

export type BotGender = 'M' | 'F';

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

export interface AIArchetypeProfile {
  id: string;
  gender: BotGender;
  thaiLabel: string;
  englishTitle: string;
  avatarColor: string;
  personaTrait: string;
  behaviorGuide: string;
}

// 4 Core Male Archetypes + 1 Wildcard Male (for 9-bot solo matches)
export const MALE_ARCHETYPES: AIArchetypeProfile[] = [
  {
    id: 'M_HOTHEAD',
    gender: 'M',
    thaiLabel: 'สายบวกหัวร้อน',
    englishTitle: 'The Aggressive Hothead',
    avatarColor: '#EF4444',
    personaTrait: 'ใจร้อน เสียงดัง ด่วนสรุป ชอบเปิดบวกจี้คนเงียบก่อนใคร',
    behaviorGuide:
      'Impatient, loud, hot-headed Thai male friend. Jumps to conclusions quickly, hates silent players, aggressively points fingers and shouts accusations in raw กู-มึง slang. If accused, erupts defensively and immediately counter-accuses.',
  },
  {
    id: 'M_TROLL',
    gender: 'M',
    thaiLabel: 'สายปั่นขี้แกล้ง',
    englishTitle: 'The Chaotic Troll',
    avatarColor: '#F97316',
    personaTrait: 'ชอบปั่นประสาท ขี้แกล้ง ขำทุกเรื่อง แม้เป็นชาวบ้านก็ยังแกล้งโยนขี้เอาฮา',
    behaviorGuide:
      'Chaotic, mischievous Thai male troll. Laughs with 5555 at deaths, baits friends into losing their temper, stirs the pot even as a Villager, playfully threatens random votes to test reactions.',
  },
  {
    id: 'M_DETECTIVE',
    gender: 'M',
    thaiLabel: 'สายวิเคราะห์จริงจัง',
    englishTitle: 'The Cold Detective',
    avatarColor: '#38BDF8',
    personaTrait: 'ยึดตรรกะ รอยโหวต และคำพูดที่ขัดแย้ง หงุดหงิดง่ายเวลาเพื่อนโหวตมั่ว',
    behaviorGuide:
      'Sharp, logical Thai male detective who tracks exact voting records, contradictions, and timing. Gets visibly annoyed when friends make dumb emotional plays and demands everyone look at facts.',
  },
  {
    id: 'M_MANIPULATOR',
    gender: 'M',
    thaiLabel: 'สายเนียนหน้านิ่ง',
    englishTitle: 'The Calm Manipulator',
    avatarColor: '#14B8A6',
    personaTrait: 'พูดนิ่ง ใจเย็น ดูมีเหตุผล แต่แอบหยอดความสงสัยป้ายสีคนอื่นเนียนๆ',
    behaviorGuide:
      'Composed, calculating Thai male manipulator. Speaks calmly like the voice of reason to earn trust, asks leading questions, and subtly plants seeds of doubt against targets without sounding panicked.',
  },
];

// 4 Core Female Archetypes + 1 Wildcard Female (for 9-bot solo matches)
export const FEMALE_ARCHETYPES: AIArchetypeProfile[] = [
  {
    id: 'F_DRAMA',
    gender: 'F',
    thaiLabel: 'สายโวยวายขี้ระแวง',
    englishTitle: 'The Paranoid Drama Queen',
    avatarColor: '#EC4899',
    personaTrait: 'ขี้ตกใจ โวยวายเสียงดัง ระแวงทุกคนรอบโต๊ะทุกครั้งที่มีคนตาย',
    behaviorGuide:
      'Dramatic, easily panicked Thai female friend. Gasps and freaks out loudly whenever someone dies, trusts nobody, dramatically suspects everyone around her and demands confessions in raw close-friend slang.',
  },
  {
    id: 'F_ROASTER',
    gender: 'F',
    thaiLabel: 'สายปากแจ๋วตอกกลับแรง',
    englishTitle: 'The Sassy Roaster',
    avatarColor: '#A855F7',
    personaTrait: 'ปากจัด ไม่เคยยอมคน ใครป้ายสีโดนตอกกลับยับ จิกกัดเรื่องความเหลี่ยมเก่งสุด',
    behaviorGuide:
      'Fierce, razor-sharp Thai female roaster. Never backs down when accused, instantly claps back with savage humor, calls out fake excuses (ตอแหล/เหลี่ยมจัด) mercilessly.',
  },
  {
    id: 'F_INNOCENT',
    gender: 'F',
    thaiLabel: 'สายแอ๊บใสซื่อ',
    englishTitle: 'The Innocent Actor',
    avatarColor: '#F59E0B',
    personaTrait: 'ชอบทำหน้างงๆ แกล้งใสซื่อหลบเป้าสงสัย บลัฟฟ์เนียนมากเวลาได้เป็นหมาป่า',
    behaviorGuide:
      'Clever Thai female who acts confused, sleepy, and totally innocent to deflect suspicion. As a Werewolf she bluffs effortlessly behind cute/confused excuses while still using raw close-friend กู-มึง slang.',
  },
  {
    id: 'F_OBSERVER',
    gender: 'F',
    thaiLabel: 'สายสังเกตจับผิดเก่ง',
    englishTitle: 'The Sharp Observer',
    avatarColor: '#8B5CF6',
    personaTrait: 'ซุ่มฟังเงียบๆ แล้วทิ้งบอมบ์จับโป๊ะคู่ที่แอบพูดเข้าข้างหรือปกป้องกันเอง',
    behaviorGuide:
      'Perceptive Thai female observer. Watches social alliances closely, notices who defends whom or shifts topics suspiciously, and drops sharp truth bombs calling out secret pairs.',
  },
];

export const BONUS_WILDCARD_ARCHETYPES: AIArchetypeProfile[] = [
  {
    id: 'M_GAMBLER',
    gender: 'M',
    thaiLabel: 'สายเดือดแทงสวน',
    englishTitle: 'The Wildcard Gambler',
    avatarColor: '#10B981',
    personaTrait: 'ชอบแทงสวนกระแสวง เชื่อสัญชาตญาณตัวเอง กล้าเปิดประเด็นวัดใจ',
    behaviorGuide:
      'Bold, contrarian Thai male friend who hates sheep voting, loves challenging the loudest accuser, trusts gut instinct, and makes risky high-stakes calls in raw กู-มึง banter.',
  },
  {
    id: 'F_INSTIGATOR',
    gender: 'F',
    thaiLabel: 'สายขี้เสี้ยมปั่นวง',
    englishTitle: 'The Sharp Instigator',
    avatarColor: '#F43F5E',
    personaTrait: 'ชอบจุดไฟให้เพื่อนตีกันเอง ยุให้คนสงสัยกันเพื่อดูพิรุธตอนลน',
    behaviorGuide:
      'Witty Thai female instigator who loves pitting two suspects against each other to see who panics first, poking holes in weak alibis with biting friend-group banter.',
  },
];

export const MALE_THAI_NAMES: string[] = [
  'บอส',
  'ต้น',
  'แบงค์',
  'เจมส์',
  'อาร์ต',
  'ภูมิ',
  'เต้',
  'กอล์ฟ',
  'นนท์',
  'ฟลุ๊ค',
  'วิน',
  'ก้อง',
  'เตอร์',
  'โอ๊ต',
  'เบียร์',
  'นัท',
];

export const FEMALE_THAI_NAMES: string[] = [
  'มิ้นท์',
  'พลอย',
  'แพรว',
  'ฝ้าย',
  'เมย์',
  'โบว์',
  'แนน',
  'นิว',
  'จอย',
  'เฟิร์น',
  'ฟ้า',
  'นิดา',
  'กิ๊ฟ',
  'ปาย',
  'ไอซ์',
  'มุก',
];

export interface Player {
  id: string;
  name: string;
  shortName: string;
  isHuman: boolean;
  gender?: BotGender;
  archetypeId?: string;
  archetypeName?: string;
  archetypeGuide?: string;
  role: RoleType;
  alive: boolean;
  deathCause?: 'WOLF_KILL' | 'DAY_EXECUTION' | null;
  deathDay?: number | null;
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
  savedAttack?: boolean;
}

export interface WolfKillRecord {
  night: number;
  targetIds: string[];
  targetNames: string[];
  killedTargetNames: string[];
  blockedTargetNames: string[];
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderPersona?: string;
  senderGender?: BotGender;
  text: string;
  phaseLabel: string;
  tone?: string;
  isSecret?: boolean;
  visibleToPlayerId?: string;
  gmType?: 'PHASE' | 'READY' | 'TEASE' | 'EVENT' | 'SECRET';
  timestamp: string;
}

export interface VoteRecord {
  voterId: string;
  voterName: string;
  targetId: string;
  targetName: string;
  reason: string;
}

export interface RoundVoteHistory {
  day: number;
  votes: VoteRecord[];
  executedName: string | null;
  beggarRevealedName: string | null;
}

export interface PostGameReaction {
  speakerId: string;
  speakerName: string;
  role: RoleType;
  alive: boolean;
  gender?: BotGender;
  archetypeName?: string;
  moodTag: string;
  sentiment: 'praise' | 'roast' | 'shock' | 'proud';
  text: string;
}

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

function shuffleArray<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function pickRandomTwoWolfRoles(): [RoleType, RoleType] {
  const candidates = shuffleArray<RoleType>(WOLF_ROLE_CANDIDATES);
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

function generateDynamicAIBots(
  aiNeeded: number,
  reservedNames: Set<string>
): {
  id: string;
  name: string;
  shortName: string;
  gender: BotGender;
  archetype: AIArchetypeProfile;
}[] {
  if (aiNeeded <= 0) return [];

  // Select balanced male & female archetypes:
  // - 8 bots -> exact 4 Males + 4 Females (all 8 core archetypes)
  // - 9 bots -> 4 Males + 4 Females + 1 random bonus wildcard (5M/4F or 4M/5F)
  // - Fewer than 8 -> balanced M/F split from shuffled core archetypes
  const shuffledMales = shuffleArray(MALE_ARCHETYPES);
  const shuffledFemales = shuffleArray(FEMALE_ARCHETYPES);
  const selectedArchetypes: AIArchetypeProfile[] = [];

  if (aiNeeded >= 8) {
    selectedArchetypes.push(...shuffledMales.slice(0, 4), ...shuffledFemales.slice(0, 4));
    if (aiNeeded > 8) {
      const bonusPool = shuffleArray(BONUS_WILDCARD_ARCHETYPES);
      for (let i = 0; i < aiNeeded - 8; i++) {
        selectedArchetypes.push(bonusPool[i % bonusPool.length]);
      }
    }
  } else {
    const maleCount = Math.ceil(aiNeeded / 2);
    const femaleCount = aiNeeded - maleCount;
    selectedArchetypes.push(
      ...shuffledMales.slice(0, maleCount),
      ...shuffledFemales.slice(0, femaleCount)
    );
  }

  // Shuffle seating order of archetypes so males and females are naturally mixed around the table
  const orderedArchetypes = shuffleArray(selectedArchetypes);

  const maleNameQueue = shuffleArray(
    MALE_THAI_NAMES.filter((n) => !reservedNames.has(n.toLowerCase()))
  );
  const femaleNameQueue = shuffleArray(
    FEMALE_THAI_NAMES.filter((n) => !reservedNames.has(n.toLowerCase()))
  );

  let mIdx = 0;
  let fIdx = 0;

  return orderedArchetypes.map((archetype, idx) => {
    const isMale = archetype.gender === 'M';
    const pickedName = isMale
      ? maleNameQueue[mIdx++] || `บอส${idx + 1}`
      : femaleNameQueue[fIdx++] || `มิ้นท์${idx + 1}`;

    return {
      id: `ai-${idx + 1}`,
      name: pickedName,
      shortName: pickedName,
      gender: archetype.gender,
      archetype,
    };
  });
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

  const pool = shuffleArray(buildRolePoolForCount(totalCount));

  const reservedNames = new Set(
    humans.map((h) => h.name.trim().toLowerCase()).filter(Boolean)
  );
  const aiNeeded = Math.max(0, totalCount - humans.length);
  const dynamicAIs = generateDynamicAIBots(aiNeeded, reservedNames);

  const combinedEntries: {
    id: string;
    name: string;
    shortName: string;
    isHuman: boolean;
    gender?: BotGender;
    archetypeId?: string;
    archetypeName?: string;
    archetypeGuide?: string;
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
    ...dynamicAIs.map((bot) => ({
      id: bot.id,
      name: bot.name,
      shortName: bot.shortName,
      isHuman: false,
      gender: bot.gender,
      archetypeId: bot.archetype.id,
      archetypeName: `${bot.archetype.thaiLabel} (${bot.archetype.englishTitle})`,
      archetypeGuide: bot.archetype.behaviorGuide,
      personaLabel: bot.archetype.thaiLabel,
      personaTrait: bot.archetype.personaTrait,
      avatarColor: bot.archetype.avatarColor,
    })),
  ];

  return combinedEntries.map((entry, seatIdx) => {
    const angle = Math.PI / 2 + (seatIdx * (2 * Math.PI)) / totalCount;
    return {
      id: entry.id,
      name: entry.name,
      shortName: entry.shortName,
      isHuman: entry.isHuman,
      gender: entry.gender,
      archetypeId: entry.archetypeId,
      archetypeName: entry.archetypeName,
      archetypeGuide: entry.archetypeGuide,
      role: pool[seatIdx],
      alive: true,
      deathCause: null,
      deathDay: null,
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
        'ฝ่ายหมาป่าถูกกำจัดออกจากหมู่บ้านจันทร์ทมิฬจนหมดสิ้น! ฝ่ายชาวบ้านเป็นฝ่ายชนะและนำความสงบสุขกลับคืนมาได้สำเร็จ',
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

export interface AINightPlanOverrides {
  wolfTargetIds?: string[];
  bodyguardTargetId?: string | null;
  seerTargetId?: string | null;
}

export function resolveNightPhase(params: {
  nightNumber: number;
  players: Player[];
  humanActions: Record<string, { primary: string | null; secondary?: string | null }>;
  aiNightPlan?: AINightPlanOverrides | null;
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
  newWolfKillRecord: WolfKillRecord | null;
  secretMessages: { text: string; tone: string; visibleToPlayerId?: string }[];
} {
  const {
    nightNumber,
    players,
    humanActions,
    aiNightPlan,
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
    // Prefer autonomous LLM night plan targets if valid
    const validPreyIds = new Set(aliveNonWolves.map((p) => p.id));
    const llmWolfChoices = (aiNightPlan?.wolfTargetIds || []).filter(
      (id) => validPreyIds.has(id)
    );
    for (const id of llmWolfChoices) {
      if (wolfTargetIds.length < killCount && !wolfTargetIds.includes(id)) {
        wolfTargetIds.push(id);
      }
    }
    // Mechanical fill only if LLM missed a second double-kill slot
    if (wolfTargetIds.length < killCount) {
      const remainingPrey = shuffleArray(
        aliveNonWolves.filter((p) => !wolfTargetIds.includes(p.id))
      );
      for (const prey of remainingPrey) {
        if (wolfTargetIds.length >= killCount) break;
        wolfTargetIds.push(prey.id);
      }
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
      const llmPick = aiNightPlan?.bodyguardTargetId;
      if (llmPick && validTargets.some((p) => p.id === llmPick)) {
        protectedId = llmPick;
      } else {
        const chosen =
          validTargets[Math.floor(Math.random() * validTargets.length)] || bodyguard;
        protectedId = chosen.id;
      }
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
      const validSeerTargets = alive.filter((p) => p.id !== seer.id);
      const llmPick = aiNightPlan?.seerTargetId;
      if (llmPick && validSeerTargets.some((p) => p.id === llmPick)) {
        inspectId = llmPick;
      } else {
        const inspectedIds = new Set(seerKnowledge.map((k) => k.targetId));
        const uninspected = validSeerTargets.filter((p) => !inspectedIds.has(p.id));
        const pool = uninspected.length > 0 ? uninspected : validSeerTargets;
        if (pool.length > 0) {
          inspectId = pool[Math.floor(Math.random() * pool.length)].id;
        }
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

  if (newBodyguardRecord && savedPlayers.some((s) => s.id === newBodyguardRecord!.targetId)) {
    newBodyguardRecord.savedAttack = true;
  }

  const newWolfKillRecord: WolfKillRecord | null =
    wolfTargetIds.length > 0
      ? {
          night: nightNumber,
          targetIds: wolfTargetIds,
          targetNames: wolfTargetIds
            .map((id) => alive.find((p) => p.id === id)?.name || id),
          killedTargetNames: victimPlayers.map((v) => v.name),
          blockedTargetNames: savedPlayers.map((s) => s.name),
        }
      : null;

  const cubDiedTonight = victimPlayers.some((v) => v.role === 'WOLF_CUB');

  return {
    wolfTargetIds,
    protectedId,
    victimPlayers,
    savedPlayers,
    cubDiedTonight,
    newSeerRecord,
    newBodyguardRecord,
    newWolfKillRecord,
    secretMessages,
  };
}
