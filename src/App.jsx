import { useState, useEffect, useRef, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  Trophy,
  Users,
  CalendarDays,
  Pencil,
  Check,
  Trash2,
  Plus,
  FileSpreadsheet,
  RotateCcw,
  AlertTriangle,
  X,
  Crown,
  ChevronLeft,
  ChevronRight,
  Copy,
  LogOut,
  Download,
  Upload,
  RefreshCw,
  Settings,
  KeyRound,
  BookOpen,
  HelpCircle,
  Sparkles,
  ListChecks,
  Projector,
  Lock,
} from "lucide-react";
import {
  readWorkspaceConfig,
  writeWorkspaceConfig,
  deleteWorkspaceConfig,
  watchWorkspaceConfig,
  readWorkspaceData,
  writeWorkspaceData,
  deleteWorkspaceData,
  watchWorkspaceData,
  getLocal,
  setLocal,
  removeLocal,
  getNameMap,
  setNameMap,
  mergeNameMap,
  removeNameMap,
} from "./storage";

const GENDERS = [
  { id: "M", label: "남" },
  { id: "F", label: "여" },
];
const SCHOOL_GRADES = [1, 2, 3];
const RESULT_LABELS = { win: "승", draw: "무", loss: "패", foul: "부정행위" };
const RESULT_LABELS_WITH_CUSTOM = { ...RESULT_LABELS, custom: "직접 입력" };
const DEFAULT_POINTS = { win: 2, draw: 1, loss: 0, foul: -1 };
const RESULT_DOT_COLOR = { win: "#C9A227", draw: "#9AA5B1", loss: "#D9D3C2", foul: "#8C2138", custom: "#5B7FBD" };
// 결과별 배지/드롭다운 색 — 참가자 체크 목록의 결과 선택 드롭다운과 등록된 경기 배지에서 함께 씁니다.
const RESULT_COLORS = {
  win: { bg: "#F3DA8E", text: "#5C4A0E" },
  draw: { bg: "#DDE2E6", text: "#3F454B" },
  loss: { bg: "#EFE8D8", text: "#5B584C" },
  foul: { bg: "#F2D4DC", text: "#8C2138" },
  custom: { bg: "#DCE4F5", text: "#324B7A" },
};
const EVENT_PRESETS = ["축구", "피구", "배드민턴", "농구", "발야구", "줄넘기", "티볼", "탁구"];
const LAST_CODE_KEY = "last-code";
const LAST_NAME_KEY = "last-name";
const DEVICE_ID_KEY = "device-id";

function sanitizeCode(raw) {
  return String(raw || "").trim().replace(/[\s/\\'"]+/g, "-").slice(0, 30);
}
const ROLE_LABEL = { founder: "개설자", editor: "수정 권한자", viewer: "조회 전용", pending: "승인 대기(조회 전용)" };

function uid(prefix = "id") {
  return prefix + "-" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function normalizeGender(raw) {
  const s = String(raw ?? "").trim();
  if (s === "1") return "M";
  if (s === "2") return "F";
  if (s.startsWith("남") || s.toUpperCase().startsWith("M")) return "M";
  if (s.startsWith("여") || s.toUpperCase().startsWith("F")) return "F";
  return "M";
}

function parseRowsToStudents(rows) {
  if (!rows || rows.length === 0) return [];
  const HEADER_WORDS = { grade: ["학년"], classNum: ["반"], number: ["번호", "출석번호"], name: ["이름", "성명"], gender: ["성별"] };
  const headerCells = (rows[0] || []).map((c) => String(c ?? "").trim());
  const detected = {};
  headerCells.forEach((cell, idx) => {
    Object.entries(HEADER_WORDS).forEach(([key, words]) => {
      if (words.some((w) => cell.includes(w))) detected[key] = idx;
    });
  });
  const hasHeader = detected.grade !== undefined && detected.name !== undefined;
  const colMap = hasHeader ? detected : { grade: 0, classNum: 1, number: 2, name: 3, gender: 4 };
  const startIdx = hasHeader ? 1 : isNaN(Number(headerCells[0])) ? 1 : 0;

  const result = [];
  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const nameRaw = row[colMap.name];
    if (nameRaw === undefined || String(nameRaw).trim() === "") continue;
    const grade = Number(row[colMap.grade]);
    const classNum = Number(row[colMap.classNum]);
    const number = Number(row[colMap.number]);
    if (!grade || !classNum || !number) continue;
    const gender = normalizeGender(row[colMap.gender]);
    result.push({ id: uid("stu"), grade, classNum, number, name: String(nameRaw).trim(), gender });
  }
  return result;
}

function studentKey(s) {
  return `${Number(s.grade)}-${Number(s.classNum)}-${Number(s.number)}`;
}

// 같은 학년·반·번호의 학생은 새로 만들지 않고, 기존 학생(id 유지)의 이름·성별만 갱신합니다.
// id를 유지해야 이미 입력된 경기 기록이 끊기지 않아요.
function mergeIncomingStudents(existing, incoming) {
  const incomingByKey = new Map();
  incoming.forEach((s) => incomingByKey.set(studentKey(s), s)); // 같은 파일 안에서 겹치면 마지막 줄이 우선
  const existingIdx = new Map();
  existing.forEach((s, i) => {
    const k = studentKey(s);
    if (!existingIdx.has(k)) existingIdx.set(k, i);
  });
  const next = existing.slice();
  const addedIds = [];
  const updated = []; // 되돌리기용: 바뀌기 전의 이름·성별
  let unchanged = 0;
  incomingByKey.forEach((inc, key) => {
    const idx = existingIdx.get(key);
    if (idx === undefined) {
      next.push(inc);
      addedIds.push(inc.id);
      return;
    }
    const cur = next[idx];
    if ((cur.name || "") === inc.name && cur.gender === inc.gender) {
      unchanged += 1;
      return;
    }
    updated.push({ id: cur.id, name: cur.name || "", gender: cur.gender });
    next[idx] = { ...cur, name: inc.name, gender: inc.gender };
  });
  return { next, addedIds, updated, unchanged };
}

function summarizeMerge({ addedIds, updated, unchanged }) {
  const parts = [];
  if (addedIds.length) parts.push(`신규 ${addedIds.length}명 추가`);
  if (updated.length) parts.push(`기존 ${updated.length}명 정보 갱신`);
  if (unchanged) parts.push(`변경 없음 ${unchanged}명`);
  return parts.join(" · ");
}

function groupByRank(sortedRows) {
  const groups = [];
  let prevScore = null;
  sortedRows.forEach((row, idx) => {
    if (prevScore === null || row.total !== prevScore) {
      groups.push({ rank: idx + 1, total: row.total, rows: [row] });
      prevScore = row.total;
    } else {
      groups[groups.length - 1].rows.push(row);
    }
  });
  return groups;
}

function computeStandings(students, matches, settings) {
  const byId = {};
  students.forEach((s) => {
    byId[s.id] = { student: s, total: 0, played: 0, history: [] };
  });
  const sortedMatches = [...matches].sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
  sortedMatches.forEach((m) => {
    m.participants.forEach((p) => {
      const row = byId[p.studentId];
      if (!row) return;
      row.total += pointsForParticipant(settings, m.event, p);
      row.played += 1;
      row.history.push({ result: p.result, event: m.event, date: m.date });
    });
  });
  const sorted = Object.values(byId).sort(
    (a, b) => b.total - a.total || a.student.name.localeCompare(b.student.name, "ko")
  );
  const rankByStudentId = {};
  const groups = groupByRank(sorted);
  groups.forEach((g) => g.rows.forEach((r) => (rankByStudentId[r.student.id] = g.rank)));
  return { sorted, groups, rankByStudentId };
}

function pointsFor(settings, event, result) {
  if (settings && settings.mode === "perEvent") {
    const found = (settings.events || []).find((e) => e.name === event);
    const cfg = found || DEFAULT_POINTS;
    return cfg[result] ?? 0;
  }
  const cfg = (settings && settings.pointsConfig) || DEFAULT_POINTS;
  return cfg[result] ?? 0;
}

// 참가자 한 명의 실제 득점. result가 "custom"이면 그 경기·그 학생에 직접 입력한 점수를,
// 그 외에는 승/무/패/부정행위 기준표 값을 그대로 씁니다.
function pointsForParticipant(settings, event, participant) {
  if (participant.result === "custom") return Number(participant.customPoints) || 0;
  return pointsFor(settings, event, participant.result);
}

function buildEventsFromData(data) {
  const byName = {};
  const order = [];
  function upsert(name, points) {
    const key = String(name || "").trim();
    if (!key) return;
    if (!byName[key]) {
      order.push(key);
      byName[key] = { id: uid("evt"), name: key, ...DEFAULT_POINTS };
    }
    if (points) byName[key] = { ...byName[key], ...points };
  }
  if (Array.isArray(data && data.events)) {
    data.events.forEach((e) => upsert(e.name, { win: e.win, draw: e.draw, loss: e.loss, foul: e.foul }));
  } else if (data && data.eventPointsConfig) {
    Object.entries(data.eventPointsConfig).forEach(([name, pts]) => upsert(name, pts));
  }
  (data && data.matches ? data.matches : []).forEach((m) => upsert(m.event));
  return order.map((name) => byName[name]);
}

// 학생 이름은 이 기기에만 저장되고 Firestore에는 올라가지 않습니다.
// 서버에서 막 받아온 학생에게 이 기기가 아직 이름표를 안 붙여줬다면,
// 학년-반-번호로 대신 표시합니다.
function displayName(s) {
  if (!s) return "";
  if (s.name && s.name.trim()) return s.name;
  return `${s.grade}-${s.classNum}-${s.number} (이름 미등록)`;
}

function stripNames(students) {
  return students.map(({ name, ...rest }) => rest);
}

function formatDateKorean(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
}

// 화면 폭이 md(768px) 이상인지 — SVG 크기처럼 클래스로 못 바꾸는 값을 모바일/데스크톱에 맞출 때 씁니다.
function useIsDesktop() {
  const query = "(min-width: 768px)";
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia && window.matchMedia(query).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setIsDesktop(mq.matches);
    onChange();
    mq.addEventListener ? mq.addEventListener("change", onChange) : mq.addListener(onChange);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", onChange) : mq.removeListener(onChange));
  }, []);
  return isDesktop;
}

function MedalIcon({ tier, size = 28, ribbon = false }) {
  const colors = {
    1: { ring: "#C9A227", fill: "#F3DA8E", glow: "#F3DA8E" },
    2: { ring: "#8E97A2", fill: "#DCE1E6", glow: "#C4CCD4" },
    3: { ring: "#8A5A2E", fill: "#D6A46E", glow: "#C08A54" },
  };
  const c = colors[tier] || colors[3];
  const h = ribbon ? Math.round(size * 1.5) : size;
  return (
    <svg width={size} height={h} viewBox={ribbon ? "0 0 40 60" : "0 0 40 40"} style={{ flexShrink: 0, overflow: "visible" }}>
      {ribbon && (
        <>
          <polygon points="14,18 6,55 20,44" fill="#0B1B33" />
          <polygon points="26,18 34,55 20,44" fill="#8C2138" />
        </>
      )}
      {tier === 1 && (
        <circle cx="20" cy="20" r="18.5" fill="none" stroke={c.glow} strokeWidth="1" opacity="0.5">
          <animate attributeName="r" values="17;20;17" dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.55;0.1;0.55" dur="2.4s" repeatCount="indefinite" />
        </circle>
      )}
      <circle cx="20" cy="20" r="17" fill={c.fill} stroke={c.ring} strokeWidth="2.5" />
      <circle cx="20" cy="20" r="10.5" fill="none" stroke={c.ring} strokeWidth="1.2" opacity="0.6" />
      <text x="20" y="25" textAnchor="middle" fontSize="14" fontWeight="700" fill={c.ring} fontFamily="JetBrains Mono, monospace">
        {tier}
      </text>
    </svg>
  );
}

function TrophyEmblem({ size = 56 }) {
  const gid = "trophyGrad";
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id={gid} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#F3DA8E" />
          <stop offset="55%" stopColor="#C9A227" />
          <stop offset="100%" stopColor="#8A6A14" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="31" fill="none" stroke="#C9A227" strokeWidth="1" opacity="0.35" />
      <path
        d="M22 12h20v10c0 6-4.5 10.5-10 10.5S22 28 22 22V12z"
        fill={`url(#${gid})`}
        stroke="#8A6A14"
        strokeWidth="1"
      />
      <path d="M22 15h-6c0 7 3 11 7.5 12.3" fill="none" stroke="#C9A227" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M42 15h6c0 7-3 11-7.5 12.3" fill="none" stroke="#C9A227" strokeWidth="2.6" strokeLinecap="round" />
      <rect x="29" y="32" width="6" height="8" fill={`url(#${gid})`} />
      <path d="M20 48c0-4.5 5.4-7 12-7s12 2.5 12 7v2H20v-2z" fill={`url(#${gid})`} stroke="#8A6A14" strokeWidth="1" />
      <rect x="26" y="40" width="12" height="4" rx="1" fill="#8A6A14" />
      <path d="M32 16l1.7 3.6 3.9.4-2.9 2.7.8 3.9-3.5-2-3.5 2 .8-3.9-2.9-2.7 3.9-.4z" fill="#FBF3D8" opacity="0.9" />
    </svg>
  );
}

function FilterChips({ label, value, onChange, options, disabled }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium" style={{ color: "var(--ink-2)", opacity: disabled ? 0.4 : 1 }}>
        {label}
      </span>
      <div className="flex gap-1.5 flex-wrap">
        {options.map((opt) => (
          <button
            key={opt.id}
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.id)}
            className="text-xs px-2.5 py-1 rounded-full font-medium"
            style={{
              backgroundColor: value === opt.id ? "var(--ink)" : "var(--surface-2)",
              color: value === opt.id ? "var(--bg)" : "var(--ink-2)",
              opacity: disabled ? 0.4 : 1,
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function InlineCalendar({ value, onChange }) {
  const today = new Date();
  const initial = value ? new Date(value + "T00:00:00") : today;
  const [viewYear, setViewYear] = useState(initial.getFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getMonth());

  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function toISO(y, m, d) {
    return `${y}-${pad(m + 1)}-${pad(d)}`;
  }

  const firstDay = new Date(viewYear, viewMonth, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function prevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else setViewMonth((m) => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else setViewMonth((m) => m + 1);
  }

  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <div className="rounded-md p-3" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={prevMonth} className="p-1 rounded-md hover:opacity-70" style={{ color: "var(--ink-2)" }}>
          <ChevronLeft size={16} />
        </button>
        <span className="lb-mono text-sm font-medium" style={{ color: "var(--ink)" }}>
          {viewYear}년 {viewMonth + 1}월
        </span>
        <button type="button" onClick={nextMonth} className="p-1 rounded-md hover:opacity-70" style={{ color: "var(--ink-2)" }}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs mb-1" style={{ color: "var(--ink-2)" }}>
        {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <span key={i} />;
          const iso = toISO(viewYear, viewMonth, d);
          const isSelected = iso === value;
          const isToday = iso === todayISO;
          return (
            <button
              type="button"
              key={i}
              onClick={() => onChange(iso)}
              className="lb-mono text-sm rounded-md py-1.5"
              style={{
                backgroundColor: isSelected ? "var(--ink)" : "transparent",
                color: isSelected ? "var(--bg)" : "var(--ink)",
                border: isToday && !isSelected ? "1px solid var(--accent)" : "1px solid transparent",
                fontWeight: isSelected ? 600 : 400,
              }}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConfirmModal({ title, message, confirmLabel = "확인", danger, onConfirm, onCancel }) {
  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(11,27,51,0.45)", zIndex: 50 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-lg p-5"
        style={{ maxWidth: 380, backgroundColor: "var(--surface)", border: "1px solid var(--line)" }}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-2 font-medium" style={{ color: "var(--ink)" }}>
            <AlertTriangle size={17} style={{ color: "var(--danger)" }} />
            {title}
          </h3>
          <button onClick={onCancel} className="p-1 rounded-md hover:opacity-70">
            <X size={16} style={{ color: "var(--ink-2)" }} />
          </button>
        </div>
        <p className="text-sm mb-5" style={{ color: "var(--ink)" }}>
          {message}
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-md text-sm font-medium"
            style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            className="px-3.5 py-1.5 rounded-md text-sm font-medium"
            style={{ backgroundColor: danger ? "var(--danger)" : "var(--ink)", color: danger ? "white" : "var(--bg)" }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoModal({ title, icon: Icon, onClose, children }) {
  return (
    <div
      onClick={onClose}
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(11,27,51,0.55)", zIndex: 60 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-2xl overflow-hidden flex flex-col"
        style={{ maxWidth: 620, maxHeight: "85vh", backgroundColor: "var(--surface)" }}
      >
        <div
          className="flex items-center justify-between px-5 md:px-6 py-4 flex-shrink-0"
          style={{ background: "var(--bg)", borderBottom: "3px solid transparent", borderImage: "linear-gradient(100deg, #FF9570, #E48AC4, #9E86FF) 1" }}
        >
          <h2 className="lb-title text-xl flex items-center gap-2" style={{ color: "var(--ink)" }}>
            {Icon && <Icon size={20} style={{ color: "var(--accent)" }} />}
            {title}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "rgba(255,255,255,0.12)" }}>
            <X size={16} color="white" />
          </button>
        </div>
        <div className="px-5 md:px-6 py-5 overflow-y-auto" style={{ flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 pt-4">
      <div
        className="text-sm px-3.5 py-2 rounded-md font-medium"
        style={{
          backgroundColor: toast.type === "warn" ? "#F2D4DC" : "var(--surface-2)",
          color: toast.type === "warn" ? "var(--danger)" : "var(--ink)",
        }}
      >
        {toast.msg}
      </div>
    </div>
  );
}

function Dashboard({ workspaceCode, onLeaveWorkspace, role, myName, deviceId, onRefreshRole }) {
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState("여기에 각종 체육행사명을 입력하세요.");
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [students, setStudents] = useState([]);
  const [matches, setMatches] = useState([]);
  const [pointsConfig, setPointsConfig] = useState(DEFAULT_POINTS);
  const [pointsMode, setPointsMode] = useState("global");
  const [events, setEvents] = useState([]);
  const [tab, setTab] = useState("leaderboard");
  const [saveState, setSaveState] = useState("idle");
  const [confirmModal, setConfirmModal] = useState(null);
  const [showFeatureGuide, setShowFeatureGuide] = useState(false);
  const [toast, setToast] = useState(null);
  const [projectorLocked, setProjectorLocked] = useState(false);
  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const skipFirstSave = useRef(true);
  const isDesktop = useIsDesktop();

  function enterProjectorMode() {
    setProjectorLocked(true);
  }
  function openUnlockModal() {
    setUnlockPassword("");
    setUnlockError("");
    setShowUnlockModal(true);
  }
  async function attemptUnlock() {
    if (!unlockPassword.trim()) return;
    setUnlockBusy(true);
    setUnlockError("");
    try {
      const cfg = await readWorkspaceConfig(workspaceCode);
      if (cfg && cfg.founderPassword && cfg.founderPassword === unlockPassword.trim()) {
        setProjectorLocked(false);
        setShowUnlockModal(false);
        setUnlockPassword("");
      } else {
        setUnlockError("개설자 비밀번호가 올바르지 않습니다.");
      }
    } catch (e) {
      setUnlockError("확인 중 오류가 발생했습니다. 다시 시도해주세요.");
    } finally {
      setUnlockBusy(false);
    }
  }

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
  }
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function openConfirm(cfg) {
    setConfirmModal(cfg);
  }
  function closeConfirm() {
    setConfirmModal(null);
  }

  function applyLoadedData(data) {
    if (!data) return;
    if (data.title) setTitle(data.title);
    if (Array.isArray(data.students)) {
      // 서버(Firestore)에는 이름이 없습니다. 이 데이터에 이름이 들어있다면
      // JSON 백업을 불러온 경우이므로, 그 이름을 이 기기의 이름표에 반영합니다.
      const incoming = {};
      data.students.forEach((s) => {
        if (s.name && s.name.trim()) incoming[s.id] = s.name.trim();
      });
      const nameMap = Object.keys(incoming).length > 0 ? mergeNameMap(workspaceCode, incoming) : getNameMap(workspaceCode);
      setStudents(
        data.students.map((s, i) => ({
          grade: 1,
          classNum: 1,
          number: i + 1,
          gender: "M",
          ...s,
          name: nameMap[s.id] || "",
        }))
      );
    } else {
      setStudents([]);
    }
    setMatches(Array.isArray(data.matches) ? data.matches : []);
    setPointsConfig(data.pointsConfig ? { ...DEFAULT_POINTS, ...data.pointsConfig } : DEFAULT_POINTS);
    setPointsMode(data.pointsMode || "global");
    setEvents(buildEventsFromData(data));
  }

  // students를 바꿀 때마다, 이름이 있는 항목은 이 기기의 이름표(로컬)에도 함께 저장합니다.
  function setStudentsAndSyncNames(next) {
    setStudents((prev) => {
      const resolved = typeof next === "function" ? next(prev) : next;
      const patch = {};
      resolved.forEach((s) => {
        if (s.name && s.name.trim()) patch[s.id] = s.name.trim();
      });
      if (Object.keys(patch).length > 0) mergeNameMap(workspaceCode, patch);
      return resolved;
    });
  }

  // 실시간 구독: 다른 기기/구성원이 저장하면 이 화면에도 곧바로 반영됩니다.
  useEffect(() => {
    skipFirstSave.current = true;
    setLoaded(false);
    const unsubscribe = watchWorkspaceData(workspaceCode, (data) => {
      applyLoadedData(data);
      setLoaded(true);
    });
    return () => unsubscribe();
  }, [workspaceCode]);

  useEffect(() => {
    if (!loaded) return;
    if (skipFirstSave.current) {
      skipFirstSave.current = false;
      return;
    }
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        await writeWorkspaceData(workspaceCode, {
          title,
          students: stripNames(students),
          matches,
          pointsConfig,
          pointsMode,
          events,
          updatedAt: Date.now(),
        });
        setSaveState("saved");
      } catch (e) {
        setSaveState("error");
      }
    }, 400);
    return () => clearTimeout(t);
  }, [title, students, matches, pointsConfig, pointsMode, events, loaded, workspaceCode]);

  async function refreshFromServer() {
    // 데이터는 실시간으로 반영되므로, 이 버튼은 접근 권한(승인 여부) 상태만 다시 확인합니다.
    showToast("접근 권한을 확인하는 중...", "ok");
    if (onRefreshRole) await onRefreshRole();
    showToast("최신 상태를 확인했습니다.", "ok");
  }

  // 승인 대기 중이거나 조회/수정 권한자인 경우, 개설자가 승인·거절·권한취소를 하면
  // 실시간으로 반영되도록 설정을 구독합니다.
  useEffect(() => {
    if (role === "founder" || !onRefreshRole) return;
    const unsubscribe = watchWorkspaceConfig(workspaceCode, () => {
      onRefreshRole();
    });
    return () => unsubscribe();
  }, [role, workspaceCode, onRefreshRole]);

  // 되돌리기용: 이 기기 이름표에서 특정 학생 id의 이름을 지웁니다.
  function forgetLocalNames(ids) {
    const map = getNameMap(workspaceCode);
    let changed = false;
    ids.forEach((id) => {
      if (id in map) {
        delete map[id];
        changed = true;
      }
    });
    if (changed) setNameMap(workspaceCode, map);
  }

  function refreshNamesFromLocalMap() {
    const map = getNameMap(workspaceCode);
    setStudents((prev) => prev.map((s) => ({ ...s, name: map[s.id] || s.name || "" })));
  }

  async function closeoutWorkspace() {
    try {
      await deleteWorkspaceData(workspaceCode);
    } catch (e) {
      // already empty — nothing to delete
    }
    try {
      await deleteWorkspaceConfig(workspaceCode);
    } catch (e) {
      // already empty — nothing to delete
    }
    try {
      removeLocal(LAST_CODE_KEY);
    } catch (e) {
      // ignore
    }
    removeNameMap(workspaceCode);
    onLeaveWorkspace();
  }

  const pointsSettings = { mode: pointsMode, pointsConfig, events };
  const { sorted, groups, rankByStudentId } = computeStandings(students, matches, pointsSettings);
  const readOnly = role === "viewer" || role === "pending";
  const canManageAccess = role === "founder";
  const podiumGroups = groups.slice(0, 3);
  const podiumOrder = [];
  if (podiumGroups[1]) podiumOrder.push({ ...podiumGroups[1], slot: "left" });
  if (podiumGroups[0]) podiumOrder.push({ ...podiumGroups[0], slot: "center" });
  if (podiumGroups[2]) podiumOrder.push({ ...podiumGroups[2], slot: "right" });

  function removeStudentFromMatches(id) {
    setMatches((prev) => prev.map((m) => ({ ...m, participants: m.participants.filter((p) => p.studentId !== id) })));
  }

  function addMatch(match) {
    setMatches((prev) => [...prev, { id: uid("match"), ...match }]);
  }

  function updateMatch(id, patch) {
    setMatches((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }

  function removeMatch(id) {
    openConfirm({
      title: "경기 기록 삭제",
      message: "이 경기 기록을 삭제할까요? 되돌릴 수 없습니다.",
      confirmLabel: "삭제",
      danger: true,
      onConfirm: () => {
        setMatches((prev) => prev.filter((m) => m.id !== id));
        closeConfirm();
      },
    });
  }

  const stageStyle = {
    "--bg": "#0A0B0D",
    "--surface": "#121418",
    "--surface-2": "#1A1D22",
    "--ink": "#F4F5F7",
    "--ink-2": "#A3A8B1",
    "--muted": "#6B717B",
    "--line": "#22252B",
    "--line-2": "#30343C",
    "--grad": "linear-gradient(100deg, #FF9570 0%, #E48AC4 50%, #9E86FF 100%)",
    "--accent": "#FF9570",
    "--accent-2": "#9E86FF",
    "--good": "#3DD68C",
    "--warn": "#FFD23F",
    "--danger": "#D92D4A",
    "--gold-500": "#C9A227",
    "--gold-300": "#E4C765",
    fontFamily: "'IBM Plex Sans KR', sans-serif",
    backgroundColor: "var(--bg)",
    minHeight: "100vh",
    color: "var(--ink)",
  };
  const stageFonts = `
        @import url('https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,700..900;1,700..900&family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap');
        .lb-title { font-family: 'Archivo', sans-serif; font-style: italic; font-weight: 900; letter-spacing: -0.03em; }
        .lb-mono { font-family: 'JetBrains Mono', monospace; }
        .lb-tab-btn { transition: color 0.15s ease, border-color 0.15s ease; }
        select, textarea, input:not([type=checkbox]):not([type=file]) { font-family: 'IBM Plex Sans KR', sans-serif; background-color: var(--surface-2); color: var(--ink); border-color: var(--line); }
        .podium-pop { animation: podiumPop 0.6s cubic-bezier(0.22,1,0.36,1) both; }
        @keyframes podiumPop { from { opacity: 0; transform: translateY(18px) scale(0.94); } to { opacity: 1; transform: none; } }
        .platform-shine { position: relative; overflow: hidden; }
        .platform-shine::after { content: ''; position: absolute; top: 0; bottom: 0; width: 35%; left: -50%; background: linear-gradient(120deg, transparent, rgba(255,255,255,0.55), transparent); animation: shineSweep 3.2s ease-in-out infinite; }
        @keyframes shineSweep { 0% { left: -50%; } 55% { left: 120%; } 100% { left: 120%; } }
        .twinkle { animation: twinkle 2.6s ease-in-out infinite; }
        @keyframes twinkle { 0%, 100% { opacity: 0.15; transform: scale(0.8); } 50% { opacity: 0.95; transform: scale(1.2); } }
        .ray-spin { animation: raySpin 60s linear infinite; }
        @keyframes raySpin { from { transform: translate(-50%, -50%) rotate(0deg); } to { transform: translate(-50%, -50%) rotate(360deg); } }
        .live-pulse { display: inline-block; animation: livePulse 1.7s ease-in-out infinite; }
        @keyframes livePulse { 0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(225,75,90,0.55); } 50% { opacity: 0.55; box-shadow: 0 0 0 7px rgba(225,75,90,0); } }
        .crown-glow { filter: drop-shadow(0 0 16px rgba(243,218,142,0.8)); }
        .medal-ring { position: absolute; inset: -16px; border-radius: 9999px; border: 2px solid rgba(243,218,142,0.5); animation: ringPulse 2.4s ease-in-out infinite; }
        @keyframes ringPulse { 0%, 100% { transform: scale(1); opacity: 0.65; } 50% { transform: scale(1.14); opacity: 0.1; } }
        .score-glow-1 { text-shadow: 0 0 26px rgba(243,218,142,0.85); }
        .score-glow-2, .score-glow-3 { text-shadow: 0 0 12px rgba(243,218,142,0.35); }
        .scoreboard-scan { background-image: repeating-linear-gradient(180deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 3px); }
        @media (prefers-reduced-motion: reduce) {
          .ray-spin, .live-pulse, .medal-ring, .twinkle, .platform-shine::after { animation: none !important; }
        }
  `;

  if (projectorLocked) {
    return (
      <div style={stageStyle} className="w-full">
        <style>{stageFonts}</style>
        <header
          className="relative overflow-hidden px-4 pt-6 pb-5 md:px-6 md:pt-11 md:pb-9"
          style={{
            background: "linear-gradient(135deg, #050B18, #14294D 60%, #0B1B33)",
            borderBottom: "1px solid rgba(228,199,101,0.25)",
          }}
        >
          <div className="scoreboard-scan pointer-events-none absolute inset-0" />
          <div className="relative max-w-5xl mx-auto flex items-center justify-center gap-2 mb-3 md:mb-4">
            <span className="live-pulse" style={{ width: 9, height: 9, borderRadius: "50%", backgroundColor: "#E14B5A" }} />
            <span className="lb-mono text-xs" style={{ color: "var(--accent-2)", letterSpacing: "0.35em" }}>
              LIVE SCOREBOARD
            </span>
          </div>
          <div className="relative max-w-5xl mx-auto flex items-center justify-center gap-3 md:gap-5">
            <div className="crown-glow flex-shrink-0">
              <TrophyEmblem size={isDesktop ? 72 : 48} />
            </div>
            <h1
              className="lb-title text-center min-w-0"
              style={{ color: "var(--ink)", fontSize: "clamp(1.4rem, 4vw, 3rem)", lineHeight: 1.15, textShadow: "0 0 30px rgba(228,199,101,0.35)" }}
            >
              {title}
            </h1>
          </div>
        </header>
        <main>
          <ProjectorLeaderboard sorted={sorted} groups={groups} podiumOrder={podiumOrder} students={students} />
        </main>
        <button
          onClick={openUnlockModal}
          className="fixed bottom-4 right-4 flex items-center gap-1.5 text-xs px-3 py-2 rounded-full font-medium shadow"
          style={{ backgroundColor: "rgba(18,20,24,0.85)", color: "var(--accent)", border: "1px solid rgba(255,149,112,0.4)" }}
        >
          <Lock size={13} /> 고정 해제
        </button>
        {showUnlockModal && (
          <div className="fixed inset-0 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(11,27,51,0.6)", zIndex: 60 }}>
            <div className="w-full max-w-sm rounded-2xl p-6" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--line)" }}>
              <div className="flex items-center gap-2 mb-1">
                <Lock size={18} style={{ color: "var(--ink)" }} />
                <h3 className="lb-title text-lg" style={{ color: "var(--ink)" }}>
                  빔프로젝터 고정 모드 해제
                </h3>
              </div>
              <p className="text-xs mb-4" style={{ color: "var(--ink-2)" }}>
                개설자 전용 비밀번호를 입력하면 고정 모드가 해제되고 원래 화면으로 돌아갑니다.
              </p>
              <input
                type="password"
                autoFocus
                value={unlockPassword}
                onChange={(e) => {
                  setUnlockPassword(e.target.value);
                  setUnlockError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") attemptUnlock();
                }}
                placeholder="개설자 비밀번호"
                className="w-full text-sm px-3 py-2.5 rounded-lg border outline-none mb-2"
                style={{ borderColor: unlockError ? "var(--danger)" : "var(--line)" }}
              />
              {unlockError && (
                <p className="text-xs mb-2" style={{ color: "var(--danger)" }}>
                  {unlockError}
                </p>
              )}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setShowUnlockModal(false)}
                  className="flex-1 text-sm py-2.5 rounded-lg font-medium"
                  style={{ backgroundColor: "var(--surface-2)", color: "var(--ink)" }}
                >
                  취소
                </button>
                <button
                  onClick={attemptUnlock}
                  disabled={!unlockPassword.trim() || unlockBusy}
                  className="flex-1 text-sm py-2.5 rounded-lg font-medium"
                  style={{ backgroundColor: "var(--ink)", color: "var(--bg)", opacity: unlockPassword.trim() && !unlockBusy ? 1 : 0.5 }}
                >
                  {unlockBusy ? "확인 중..." : "해제하기"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={stageStyle} className="w-full">
      <style>{stageFonts}</style>

      <header
        className="px-4 pt-4 pb-3 md:px-6 md:pt-8 md:pb-7"
        style={{ background: "var(--bg)", borderBottom: "3px solid transparent", borderImage: "linear-gradient(100deg, #FF9570, #E48AC4, #9E86FF) 1" }}
      >
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-2 mb-3 md:mb-1">
          <span
            className="lb-mono text-xs px-2.5 py-1 rounded-full flex items-center gap-1.5 min-w-0"
            style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--accent)" }}
          >
            <KeyRound size={12} className="flex-shrink-0" />
            <span className="truncate">{workspaceCode}</span>
          </span>
          <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
            <button
              onClick={enterProjectorMode}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap"
              style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "var(--ink)", border: "1px solid rgba(255,255,255,0.22)" }}
            >
              <Projector size={13} /> 빔프로젝터 고정
            </button>
            <button
              onClick={() => setShowFeatureGuide(true)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium whitespace-nowrap"
              style={{ backgroundColor: "rgba(255,149,112,0.16)", color: "var(--accent)", border: "1px solid rgba(255,149,112,0.4)" }}
            >
              <HelpCircle size={13} /> 기능 설명
            </button>
          </div>
        </div>
        <div className="max-w-4xl mx-auto flex items-start md:items-center gap-3 md:gap-4">
          <TrophyEmblem size={isDesktop ? 56 : 44} />
          <div className="flex-1 min-w-0">
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      setTitle(draftTitle.trim() || title);
                      setEditingTitle(false);
                    }
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                  className="lb-title text-xl md:text-3xl bg-transparent border-b-2 outline-none w-full min-w-0"
                  style={{ color: "var(--ink)", borderColor: "var(--accent)" }}
                />
                <button
                  onClick={() => {
                    setTitle(draftTitle.trim() || title);
                    setEditingTitle(false);
                  }}
                  className="p-1.5 rounded-full"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  <Check size={16} color="#0B1B33" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setDraftTitle(title);
                  setEditingTitle(true);
                }}
                className="flex items-center gap-2 group text-left max-w-full"
              >
                <h1 className="lb-title text-xl md:text-3xl leading-tight" style={{ color: "var(--ink)" }}>
                  {title}
                </h1>
                <Pencil size={15} style={{ color: "var(--accent)" }} className="opacity-60 group-hover:opacity-100 flex-shrink-0" />
              </button>
            )}
            <p className="text-xs md:text-sm mt-1.5 max-w-lg" style={{ color: "var(--accent-2)", lineHeight: 1.6 }}>
              개인전과 팀전 점수를 모바일로 빠르게 기록하고, 전광판처럼 큰 화면에 띄워 실시간 순위를 보여주는 프로그램입니다.
            </p>
          </div>
        </div>

        <nav className="max-w-4xl mx-auto grid grid-cols-4 md:flex md:gap-6 mt-4 md:mt-6 border-b" style={{ borderColor: "rgba(255,255,255,0.12)" }}>
          {[
            { id: "leaderboard", label: "리더보드", icon: Trophy },
            { id: "roster", label: "명단 관리", icon: Users },
            { id: "matches", label: "경기 기록", icon: CalendarDays },
            { id: "settings", label: "설정", icon: Settings },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="lb-tab-btn flex flex-col md:flex-row items-center justify-center gap-1 md:gap-2 pb-2.5 md:pb-3 text-xs md:text-sm font-medium whitespace-nowrap"
              style={{
                color: tab === id ? "var(--ink)" : "var(--ink-2)",
                borderBottom: "2px solid transparent", borderImage: tab === id ? "linear-gradient(100deg, #FF9570, #E48AC4, #9E86FF) 1" : "none",
              }}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
      </header>

      <Toast toast={toast} />

      <main className="max-w-4xl mx-auto px-4 md:px-6 py-5 md:py-8">
        {role !== "founder" && (
          <div
            className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-md mb-4"
            style={{ backgroundColor: "var(--surface-2)", color: "var(--ink)" }}
          >
            <KeyRound size={13} />
            {myName}님 · {ROLE_LABEL[role]}로 접속 중
            {role === "pending" && " (수정 권한 승인 대기 중이에요. 승인 전까지는 조회만 가능합니다.)"}
          </div>
        )}
        {tab === "leaderboard" && <LeaderboardTab sorted={sorted} groups={groups} podiumOrder={podiumOrder} students={students} />}
        {tab === "roster" && (
          <RosterManager
            students={students}
            setStudents={setStudentsAndSyncNames}
            showToast={showToast}
            openConfirm={openConfirm}
            closeConfirm={closeConfirm}
            removeStudentFromMatches={removeStudentFromMatches}
            forgetLocalNames={forgetLocalNames}
            readOnly={readOnly}
          />
        )}
        {tab === "matches" && (
          <MatchesTab
            students={students}
            matches={matches}
            addMatch={addMatch}
            updateMatch={updateMatch}
            removeMatch={removeMatch}
            pointsConfig={pointsConfig}
            setPointsConfig={setPointsConfig}
            pointsMode={pointsMode}
            setPointsMode={setPointsMode}
            events={events}
            setEvents={setEvents}
            readOnly={readOnly}
          />
        )}
        {tab === "settings" && (
          <SettingsTab
            workspaceCode={workspaceCode}
            onLeaveWorkspace={onLeaveWorkspace}
            onRefresh={refreshFromServer}
            onCloseout={closeoutWorkspace}
            showToast={showToast}
            openConfirm={openConfirm}
            closeConfirm={closeConfirm}
            students={students}
            matches={matches}
            data={{ title, students, matches, pointsConfig, pointsMode, events }}
            applyLoadedData={applyLoadedData}
            role={role}
            myName={myName}
            deviceId={deviceId}
            canManageAccess={canManageAccess}
            refreshNamesFromLocalMap={refreshNamesFromLocalMap}
          />
        )}
      </main>

      <footer className="max-w-4xl mx-auto px-4 md:px-6 pb-8 flex items-center justify-between text-xs" style={{ color: "var(--ink-2)" }}>
        <span>
          {saveState === "saving" && "저장 중..."}
          {saveState === "saved" && "자동 저장됨"}
          {saveState === "error" && "저장 실패 — 이 기기에서 다시 시도해 주세요"}
        </span>
        <button
          onClick={() =>
            openConfirm({
              title: "전체 초기화",
              message: "명단과 모든 경기 기록을 초기화할까요? 되돌릴 수 없습니다.",
              confirmLabel: "초기화",
              danger: true,
              onConfirm: () => {
                setStudents([]);
                setMatches([]);
                removeNameMap(workspaceCode);
                closeConfirm();
              },
            })
          }
          className="underline"
          style={{ color: "var(--ink-2)" }}
        >
          전체 초기화
        </button>
      </footer>

      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          danger={confirmModal.danger}
          onConfirm={confirmModal.onConfirm}
          onCancel={closeConfirm}
        />
      )}

      {showFeatureGuide && (
        <InfoModal title="기능 설명" icon={HelpCircle} onClose={() => setShowFeatureGuide(false)}>
          <div className="flex flex-col gap-5">
            {[
              {
                icon: Trophy,
                title: "리더보드",
                points: [
                  "학생별 누적 승점을 자동으로 계산해 순위대로 보여줘요. 동점자는 공동 순위로 처리돼요.",
                  "상위 3명은 시상대로, 이름 옆 점들은 경기별 결과(승/무/패/부정행위)를 색으로 나타내요.",
                  "이 탭만 화면에 띄우면 그대로 빔프로젝터·전광판으로 쓸 수 있어요.",
                ],
              },
              {
                icon: Users,
                title: "명단 관리",
                points: [
                  "학년·반·번호·이름·성별로 학생을 등록해요. 엑셀 파일을 끌어다 놓으면 한 번에 여러 명을 올릴 수 있어요.",
                  "체크박스로 여러 명을 선택해 한꺼번에 삭제하거나 성별을 바꿀 수 있어요.",
                  "엑셀을 다시 올려도 같은 학년·반·번호의 학생은 중복으로 늘어나지 않고, 기존 학생의 이름·성별만 갱신돼요(경기 기록은 그대로 유지). 단, 직접 한 명씩 추가할 때 이미 있는 번호면 추가되지 않아요.",
                  "방금 엑셀로 올린 명단은 '되돌리기'로 취소할 수 있어요(신규 추가는 삭제, 갱신은 이전 값으로 복구).",
                  "학생 이름은 이 기기(브라우저)에만 저장되고 서버에는 올라가지 않아요. 다른 기기에서는 이름 칸이 비어 보일 수 있는데, 그 자리를 클릭해 이름을 입력하면 그 기기에도 저장돼요.",
                ],
              },
              {
                icon: CalendarDays,
                title: "경기 기록",
                points: [
                  "날짜는 달력에서 바로 고르고, 종목을 정한 뒤 참가한 학생을 체크해요.",
                  "'승점 기준 설정'에서 승/무/패/부정행위 점수를 직접 정할 수 있고, '종목별 기준'으로 바꾸면 종목마다 다른 점수도 줄 수 있어요(예: 축구는 승리 3점, 배드민턴은 2점). 종목별 기준은 표에서 종목을 직접 추가·삭제해요.",
                  "참가자별 결과 선택에는 '직접 입력'도 있어서, 정해진 승/무/패 점수 대신 그 학생·그 경기에만 적용할 점수를 바로 입력할 수 있어요.",
                  "'전체 승 / 전체 무 / 전체 패 / 전체 부정행위' 버튼으로, 지금 화면에 보이는(필터된) 학생 전체를 한 번에 체크하고 같은 결과로 일괄 지정할 수 있어요. '전체 해제'로 체크를 한 번에 풀 수도 있어요.",
                  "일부 학생만 골라 같은 결과를 주고 싶다면, 원하는 학생만 체크(전체선택·부분체크·해제 자유롭게 조합)한 뒤 '체크된 학생에게 결과 일괄 적용'에서 결과를 골라 적용하세요. 한 명씩 드롭다운을 열지 않아도 됩니다.",
                  "등록한 경기는 목록의 연필 아이콘으로 언제든 내용을 고쳐 다시 저장하거나, 휴지통 아이콘으로 삭제할 수 있어요.",
                ],
              },
              {
                icon: Settings,
                title: "설정",
                points: [
                  "코드를 복사하거나 다른 코드로 전환할 수 있고, 개설자는 조회·개설자 비밀번호를 여기서 바꿀 수 있어요.",
                  "개설자는 '구성원 및 접근 권한 관리'에서 동료 선생님의 수정 권한 신청을 승인·거절하거나 권한을 취소할 수 있어요.",
                  "'데이터 관리'에서 엑셀로 현재 기록을 내려받을 수 있고(누구나 가능), 개설자는 JSON 백업·복원도 할 수 있어요.",
                  "'학생 이름표'에서 이 기기에 저장된 이름을 파일로 내보내 다른 기기로 옮기거나, 다른 기기가 내보낸 이름표 파일을 가져와 이 기기에 반영할 수 있어요.",
                  "시즌이 끝나면 개설자가 '마감'으로 이 코드의 모든 데이터를 정리하고 첫 화면으로 돌아갈 수 있어요(백업 필수).",
                ],
              },
              {
                icon: Projector,
                title: "빔프로젝터 고정",
                points: [
                  "화면 위쪽 '빔프로젝터 고정' 버튼을 누르면 월드컵·올림픽 전광판 같은 화려한 연출(금빛 조명, 반짝이는 배경, 빛나는 시상대)로 리더보드가 크게 펼쳐져요. 발표·시상식처럼 빔프로젝터나 전광판으로 띄워두기 좋아요.",
                  "고정 모드에서는 탭 이동이나 편집 버튼이 모두 사라져서, 학생들이 화면 근처에 있어도 실수로 다른 화면을 누르거나 내용을 바꿀 걱정이 없어요.",
                  "오른쪽 아래 '고정 해제' 버튼을 누르고 개설자 전용 비밀번호를 입력해야만 원래 화면으로 돌아갈 수 있어요.",
                ],
              },
            ].map((section) => (
              <div key={section.title}>
                <h3 className="lb-title text-base mb-2 flex items-center gap-1.5" style={{ color: "var(--ink)" }}>
                  <section.icon size={16} style={{ color: "var(--accent)" }} /> {section.title}
                </h3>
                <ul className="flex flex-col gap-1.5">
                  {section.points.map((p, i) => (
                    <li key={i} className="text-sm flex gap-2" style={{ color: "var(--ink)" }}>
                      <span style={{ color: "var(--accent)" }}>·</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="pt-3 text-xs" style={{ borderTop: "1px solid var(--line)", color: "var(--ink-2)" }}>
              여러 기기에서 동시에 열어두면, 다른 사람이 저장한 내용이 자동으로 화면에 반영돼요. 접근 권한이 바뀌면(승인·취소) 그것도 실시간으로 반영됩니다. (단, 학생 이름은 서버로 동기화되지 않아 기기마다 따로 등록해야 해요.)
            </div>
          </div>
        </InfoModal>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="flex flex-col items-center text-center py-16 px-4">
      <div className="p-3 rounded-full mb-4" style={{ backgroundColor: "var(--surface-2)" }}>
        <Icon size={26} style={{ color: "var(--accent)" }} />
      </div>
      <h3 className="lb-title text-lg mb-1" style={{ color: "var(--ink)" }}>
        {title}
      </h3>
      <p className="text-sm" style={{ color: "var(--ink-2)" }}>
        {body}
      </p>
    </div>
  );
}

function LeaderboardTab({ sorted, groups, podiumOrder, students }) {
  const isDesktop = useIsDesktop();
  if (students.length === 0) {
    return <EmptyState icon={Users} title="명단부터 등록해 주세요" body="리더보드는 등록된 학생과 경기 기록을 바탕으로 계산됩니다." />;
  }
  if (sorted.every((r) => r.played === 0)) {
    return (
      <EmptyState icon={CalendarDays} title="아직 등록된 경기 결과가 없어요" body="경기 기록 탭에서 첫 경기를 등록하면 순위가 나타납니다." />
    );
  }

  const heights = { center: "h-32 md:h-48", left: "h-20 md:h-32", right: "h-16 md:h-28" };
  const stars = [
    { x: "8%", y: "20%", size: 4, delay: "0s" },
    { x: "18%", y: "58%", size: 3, delay: "0.6s" },
    { x: "88%", y: "18%", size: 3, delay: "1.1s" },
    { x: "80%", y: "62%", size: 4, delay: "0.3s" },
    { x: "50%", y: "10%", size: 3, delay: "1.5s" },
    { x: "30%", y: "80%", size: 3, delay: "0.9s" },
    { x: "70%", y: "85%", size: 3, delay: "1.8s" },
  ];

  return (
    <div>
      <div
        className="relative overflow-hidden rounded-2xl mb-6 md:mb-10 px-3 md:px-4 pt-7 md:pt-10 pb-0"
        style={{ background: "linear-gradient(160deg, var(--surface), var(--bg) 70%)" }}
      >
        <svg
          viewBox="0 0 200 200"
          className="absolute pointer-events-none"
          style={{ top: "18%", left: "50%", width: 460, height: 460, transform: "translate(-50%,-50%)" }}
        >
          {Array.from({ length: 16 }).map((_, i) => (
            <rect key={i} x="98.5" y="0" width="3" height="100" fill="#E4C765" opacity="0.1" transform={`rotate(${i * 22.5} 100 100)`} />
          ))}
        </svg>
        {stars.map((s, i) => (
          <span
            key={i}
            className="twinkle"
            style={{
              position: "absolute",
              left: s.x,
              top: s.y,
              width: s.size,
              height: s.size,
              borderRadius: "50%",
              backgroundColor: "#F3DA8E",
              animationDelay: s.delay,
            }}
          />
        ))}

        <div className="relative flex items-end justify-center gap-2 md:gap-6">
          {podiumOrder.map((g, idx) => (
            <div
              key={g.slot}
              className="podium-pop flex flex-col items-center min-w-0"
              style={{ flex: "1 1 0", maxWidth: 140, animationDelay: `${idx * 0.12}s` }}
            >
              {g.rank === 1 && (
                <Crown size={isDesktop ? 26 : 22} style={{ color: "var(--gold-300)", marginBottom: -4 }} fill="var(--gold-300)" />
              )}
              <MedalIcon tier={g.rank} size={g.rank === 1 ? (isDesktop ? 50 : 40) : isDesktop ? 40 : 32} ribbon />
              <div className="mt-2 md:mt-3 text-center px-1 w-full">
                {g.rows.map((r) => (
                  <div
                    key={r.student.id}
                    className={g.rank === 1 ? "font-semibold text-sm md:text-base leading-snug truncate" : "font-medium text-xs md:text-sm leading-snug truncate"}
                    style={{ color: "var(--ink)" }}
                  >
                    {displayName(r.student)}
                  </div>
                ))}
              </div>
              <div
                className={`lb-mono font-bold mt-1 ${g.rank === 1 ? "text-xl md:text-2xl" : "text-base md:text-lg"}`}
                style={{
                  color: "var(--gold-300)",
                  textShadow: g.rank === 1 ? "0 0 18px rgba(228,199,101,0.7)" : "none",
                }}
              >
                {g.total}
                <span className="text-xs font-normal" style={{ color: "rgba(251,248,240,0.65)" }}>
                  점
                </span>
              </div>
              <div
                className={`${heights[g.slot]} platform-shine w-full mt-2 md:mt-3 rounded-t-lg flex items-start justify-center pt-2`}
                style={{
                  background:
                    g.rank === 1
                      ? "linear-gradient(180deg, var(--gold-300), var(--gold-500) 60%, #8A6A14)"
                      : g.rank === 2
                      ? "linear-gradient(180deg, #E7EBEE, #A9B1BC 60%, #6E7680)"
                      : "linear-gradient(180deg, #D9AE81, #A2662F 60%, #6B4118)",
                  boxShadow: g.rank === 1 ? "0 8px 24px rgba(201,162,39,0.45)" : "0 6px 16px rgba(11,27,51,0.25)",
                }}
              >
                <span className="lb-mono text-white font-bold opacity-95" style={{ fontSize: g.rank === 1 ? (isDesktop ? 28 : 22) : isDesktop ? 22 : 18 }}>
                  {g.rank}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--line)" }}>
        <div
          className="rank-grid grid text-xs font-medium px-3 md:px-4 py-2"
          style={{ backgroundColor: "var(--surface-2)", color: "var(--ink-2)" }}
        >
          <span>순위</span>
          <span>이름</span>
          <span className="text-right">경기수</span>
          <span className="text-right">승점</span>
        </div>
        {groups.flatMap((g) =>
          g.rows.map((row) => {
            const accent = g.rank === 1 ? "var(--gold-500)" : g.rank === 2 ? "#9AA5B1" : g.rank === 3 ? "#A2662F" : "transparent";
            return (
              <div
                key={row.student.id}
                className="rank-grid grid items-center px-3 md:px-4 py-2.5 text-sm"
                style={{
                  borderTop: "1px solid var(--line)",
                  borderLeft: `3px solid ${accent}`,
                  backgroundColor: g.rank <= 3 ? "var(--bg)" : "transparent",
                }}
              >
                <span className="flex items-center">
                  {g.rank <= 3 ? (
                    <MedalIcon tier={g.rank} size={22} />
                  ) : (
                    <span className="lb-mono text-sm" style={{ color: "var(--ink-2)" }}>
                      {g.rank}
                    </span>
                  )}
                </span>
                <span className="flex flex-col min-w-0">
                  <span className="font-medium truncate">{displayName(row.student)}</span>
                  <span className="text-xs" style={{ color: "var(--ink-2)" }}>
                    {row.student.grade}학년 {row.student.classNum}반 {row.student.number}번
                  </span>
                  {row.history.length > 0 && (
                    <span className="flex flex-wrap gap-1 mt-1">
                      {row.history.map((h, i) => (
                        <span
                          key={i}
                          title={`${h.date} ${h.event} · ${RESULT_LABELS_WITH_CUSTOM[h.result]}`}
                          style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: RESULT_DOT_COLOR[h.result] }}
                        />
                      ))}
                    </span>
                  )}
                </span>
                <span className="text-right text-xs md:text-sm" style={{ color: "var(--ink-2)" }}>
                  {row.played}경기
                </span>
                <span className="lb-mono text-right font-semibold" style={{ color: "var(--ink)" }}>
                  {row.total}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ProjectorLeaderboard({ sorted, groups, podiumOrder, students }) {
  const isDesktop = useIsDesktop();
  if (students.length === 0) {
    return <EmptyState icon={Users} title="명단부터 등록해 주세요" body="리더보드는 등록된 학생과 경기 기록을 바탕으로 계산됩니다." />;
  }
  if (sorted.every((r) => r.played === 0)) {
    return <EmptyState icon={CalendarDays} title="아직 등록된 경기 결과가 없어요" body="경기 기록 탭에서 첫 경기를 등록하면 순위가 나타납니다." />;
  }

  const heights = { center: "h-36 md:h-72", left: "h-24 md:h-52", right: "h-20 md:h-44" };
  const rays = Array.from({ length: 24 });
  const sparks = [
    { x: "6%", y: "15%", size: 3, delay: "0s" },
    { x: "92%", y: "22%", size: 4, delay: "0.4s" },
    { x: "14%", y: "70%", size: 3, delay: "1.1s" },
    { x: "85%", y: "68%", size: 3, delay: "0.8s" },
    { x: "50%", y: "8%", size: 4, delay: "1.6s" },
    { x: "30%", y: "88%", size: 3, delay: "0.3s" },
    { x: "70%", y: "90%", size: 3, delay: "2.1s" },
    { x: "40%", y: "35%", size: 2, delay: "1.4s" },
    { x: "60%", y: "40%", size: 2, delay: "0.6s" },
  ];

  return (
    <div className="relative overflow-hidden" style={{ background: "radial-gradient(ellipse at 50% -10%, #1B3562 0%, #0B1B33 45%, #050B18 100%)", minHeight: "60vh" }}>
      <div className="scoreboard-scan pointer-events-none absolute inset-0" />
      <svg
        viewBox="0 0 200 200"
        className="ray-spin pointer-events-none absolute"
        style={{ top: "8%", left: "50%", width: 900, height: 900, transform: "translate(-50%,-50%)", opacity: 0.12 }}
      >
        {rays.map((_, i) => (
          <rect key={i} x="99" y="0" width="2" height="100" fill="#F3DA8E" transform={`rotate(${i * (360 / rays.length)} 100 100)`} />
        ))}
      </svg>
      {sparks.map((s, i) => (
        <span
          key={i}
          className="twinkle pointer-events-none absolute"
          style={{ left: s.x, top: s.y, width: s.size, height: s.size, borderRadius: "50%", backgroundColor: "#F3DA8E", animationDelay: s.delay }}
        />
      ))}

      <div className="relative max-w-6xl mx-auto px-3 pt-8 pb-20 md:px-6 md:pt-12 md:pb-16">
        <div className="relative flex items-end justify-center gap-2 md:gap-14 mb-8 md:mb-16">
          {podiumOrder.map((g, idx) => (
            <div
              key={g.slot}
              className="podium-pop flex flex-col items-center min-w-0"
              style={{ flex: g.slot === "center" ? "1.2 1 0" : "1 1 0", maxWidth: g.slot === "center" ? 220 : 170, animationDelay: `${idx * 0.15}s` }}
            >
              {g.rank === 1 && (
                <div className="crown-glow mb-1">
                  <Crown size={isDesktop ? 40 : 26} style={{ color: "#F3DA8E" }} fill="#F3DA8E" />
                </div>
              )}
              <div className="relative">
                {g.rank === 1 && <div className="medal-ring" />}
                <MedalIcon tier={g.rank} size={g.rank === 1 ? (isDesktop ? 84 : 50) : isDesktop ? 60 : 38} ribbon />
              </div>
              <div className="mt-3 md:mt-4 text-center px-1 w-full">
                {g.rows.map((r) => (
                  <div
                    key={r.student.id}
                    className={g.rank === 1 ? "font-bold leading-snug truncate" : "font-semibold leading-snug truncate"}
                    style={{ color: "var(--ink)", fontSize: g.rank === 1 ? (isDesktop ? 26 : 17) : isDesktop ? 19 : 14 }}
                  >
                    {displayName(r.student)}
                  </div>
                ))}
              </div>
              <div
                className={`lb-mono font-bold mt-2 score-glow-${g.rank}`}
                style={{ color: "#F3DA8E", fontSize: g.rank === 1 ? (isDesktop ? 44 : 30) : isDesktop ? 30 : 22 }}
              >
                {g.total}
                <span style={{ fontSize: g.rank === 1 ? (isDesktop ? 16 : 13) : 12, fontWeight: 500, color: "rgba(251,248,240,0.6)" }}> 점</span>
              </div>
              <div
                className={`${heights[g.slot]} platform-shine w-full mt-3 md:mt-4 rounded-t-xl flex items-start justify-center pt-2 md:pt-4 relative`}
                style={{
                  background:
                    g.rank === 1
                      ? "linear-gradient(180deg, #F3DA8E, #C9A227 55%, #7A5C10)"
                      : g.rank === 2
                      ? "linear-gradient(180deg, #EDEFF2, #AEB6C0 55%, #626A74)"
                      : "linear-gradient(180deg, #E0B487, #A2662F 55%, #5E3A16)",
                  boxShadow: g.rank === 1 ? "0 0 60px rgba(243,218,142,0.5), 0 10px 30px rgba(0,0,0,0.4)" : "0 10px 24px rgba(0,0,0,0.35)",
                }}
              >
                <span className="lb-mono text-white font-bold" style={{ fontSize: g.rank === 1 ? (isDesktop ? 46 : 30) : isDesktop ? 34 : 22, textShadow: "0 2px 6px rgba(0,0,0,0.35)" }}>
                  {g.rank}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: "1px solid rgba(228,199,101,0.25)", backgroundColor: "rgba(5,11,24,0.55)" }}
        >
          <div
            className="stage-rank-grid grid text-xs font-semibold px-3 md:px-6 py-3"
            style={{ backgroundColor: "rgba(228,199,101,0.08)", color: "#E4C765", letterSpacing: "0.08em" }}
          >
            <span>순위</span>
            <span>이름</span>
            <span className="text-right">경기수</span>
            <span className="text-right">승점</span>
          </div>
          {groups.flatMap((g) =>
            g.rows.map((row) => {
              const accent = g.rank === 1 ? "#E4C765" : g.rank === 2 ? "#AEB6C0" : g.rank === 3 ? "#C98A4B" : "transparent";
              return (
                <div
                  key={row.student.id}
                  className="stage-rank-grid grid items-center px-3 md:px-6 py-3 md:py-3.5"
                  style={{
                    borderTop: "1px solid rgba(228,199,101,0.12)",
                    borderLeft: `4px solid ${accent}`,
                    backgroundColor: g.rank <= 3 ? "rgba(228,199,101,0.06)" : "transparent",
                  }}
                >
                  <span className="flex items-center">
                    {g.rank <= 3 ? (
                      <MedalIcon tier={g.rank} size={isDesktop ? 30 : 24} />
                    ) : (
                      <span className="lb-mono font-bold" style={{ color: "rgba(251,248,240,0.55)", fontSize: isDesktop ? 20 : 16 }}>
                        {g.rank}
                      </span>
                    )}
                  </span>
                  <span className="flex flex-col min-w-0">
                    <span className="font-semibold truncate" style={{ color: "var(--ink)", fontSize: isDesktop ? 17 : 15 }}>
                      {displayName(row.student)}
                    </span>
                    <span className="text-xs mt-0.5" style={{ color: "rgba(251,248,240,0.5)" }}>
                      {row.student.grade}학년 {row.student.classNum}반 {row.student.number}번
                    </span>
                    {row.history.length > 0 && (
                      <span className="flex flex-wrap gap-1 mt-1.5">
                        {row.history.map((h, i) => (
                          <span
                            key={i}
                            title={`${h.date} ${h.event} · ${RESULT_LABELS_WITH_CUSTOM[h.result]}`}
                            style={{ width: 7, height: 7, borderRadius: "50%", backgroundColor: RESULT_DOT_COLOR[h.result] }}
                          />
                        ))}
                      </span>
                    )}
                  </span>
                  <span className="text-right lb-mono" style={{ color: "rgba(251,248,240,0.55)", fontSize: isDesktop ? 16 : 12 }}>
                    {row.played}경기
                  </span>
                  <span className="lb-mono text-right font-bold" style={{ color: "#F3DA8E", fontSize: isDesktop ? 22 : 18 }}>
                    {row.total}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function RosterManager({ students, setStudents, showToast, openConfirm, closeConfirm, removeStudentFromMatches, forgetLocalNames, readOnly }) {
  const [form, setForm] = useState({ grade: 1, classNum: 1, number: "", name: "", gender: "M" });
  const [bulkText, setBulkText] = useState("");
  const [filterGrade, setFilterGrade] = useState("ALL");
  const [filterClass, setFilterClass] = useState("ALL");
  const [dragOver, setDragOver] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [lastBulk, setLastBulk] = useState(null); // { addedIds, updated, summary }
  const fileInputRef = useRef(null);

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll(list) {
    setSelected((prev) => {
      const allSelected = list.length > 0 && list.every((s) => prev.has(s.id));
      const next = new Set(prev);
      if (allSelected) list.forEach((s) => next.delete(s.id));
      else list.forEach((s) => next.add(s.id));
      return next;
    });
  }

  function bulkSetGender(gender) {
    if (selected.size === 0) return;
    setStudents(students.map((s) => (selected.has(s.id) ? { ...s, gender } : s)));
    showToast(`${selected.size}명의 성별을 ${gender === "M" ? "남" : "여"}로 변경했습니다.`, "ok");
    setSelected(new Set());
  }

  function bulkDelete() {
    if (selected.size === 0) return;
    openConfirm({
      title: "선택한 학생 삭제",
      message: `${selected.size}명을 명단에서 삭제할까요? 경기 기록에서도 함께 제거됩니다. 되돌릴 수 없습니다.`,
      confirmLabel: "삭제",
      danger: true,
      onConfirm: () => {
        const ids = Array.from(selected);
        setStudents(students.filter((s) => !selected.has(s.id)));
        ids.forEach((id) => removeStudentFromMatches(id));
        showToast(`${ids.length}명을 삭제했습니다.`, "ok");
        setSelected(new Set());
        closeConfirm();
      },
    });
  }

  function addStudent() {
    if (!form.name || !form.number) {
      showToast("번호와 이름을 입력해 주세요.", "warn");
      return;
    }
    const candidate = { id: uid("stu"), grade: Number(form.grade), classNum: Number(form.classNum), number: Number(form.number), name: form.name.trim(), gender: form.gender };
    if (students.some((s) => studentKey(s) === studentKey(candidate))) {
      showToast(`${candidate.grade}학년 ${candidate.classNum}반 ${candidate.number}번은 이미 등록돼 있어요. 이름·성별은 오른쪽 명단에서 직접 고칠 수 있어요.`, "warn");
      return;
    }
    const next = [...students, candidate];
    setStudents(next);
    setForm((f) => ({ ...f, number: "", name: "" }));
    showToast(`${form.name} 학생을 추가했습니다.`, "ok");
  }

  function removeStudent(id) {
    setStudents(students.filter((s) => s.id !== id));
    removeStudentFromMatches(id);
  }

  function undoLastBulkAdd() {
    if (!lastBulk) return;
    const addedSet = new Set(lastBulk.addedIds);
    const prevById = new Map(lastBulk.updated.map((u) => [u.id, u]));
    setStudents(
      students
        .filter((s) => !addedSet.has(s.id))
        .map((s) => {
          const p = prevById.get(s.id);
          return p ? { ...s, name: p.name, gender: p.gender } : s;
        })
    );
    // 이 기기 이름표에서도 되돌려요 (이전에 이름이 없던 학생 + 방금 추가한 학생)
    if (forgetLocalNames) {
      forgetLocalNames([...lastBulk.addedIds, ...lastBulk.updated.filter((u) => !u.name).map((u) => u.id)]);
    }
    setLastBulk(null);
    showToast("방금 올린 명단을 되돌렸습니다.", "ok");
  }

  // 엑셀·붙여넣기 공통: 같은 학년·반·번호는 중복 추가하지 않고 기존 학생을 갱신합니다.
  function applyIncoming(parsed) {
    const result = mergeIncomingStudents(students, parsed);
    const changed = result.addedIds.length + result.updated.length;
    if (changed > 0) {
      setStudents(result.next);
      setLastBulk({ addedIds: result.addedIds, updated: result.updated, summary: summarizeMerge(result) });
    }
    return result;
  }

  function bulkAdd() {
    const lines = bulkText.split("\n").map((l) => l.trim()).filter(Boolean);
    const parsed = [];
    lines.forEach((line) => {
      const parts = line.split(/[,\t]+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 5) return;
      const [g, c, n, name, gender] = parts;
      parsed.push({ id: uid("stu"), grade: Number(g), classNum: Number(c), number: Number(n), name, gender: normalizeGender(gender) });
    });
    if (parsed.length > 0) {
      const result = applyIncoming(parsed);
      setBulkText("");
      showToast(summarizeMerge(result) || "이미 같은 명단이 등록돼 있어요.", "ok");
    } else {
      showToast("형식을 확인해 주세요. 예) 1,3,12,홍길동,남", "warn");
    }
  }

  function readFileAsStudents(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const data = new Uint8Array(evt.target.result);
          const wb = XLSX.read(data, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
          resolve({ name: file.name, added: parseRowsToStudents(rows), ok: true });
        } catch (err) {
          resolve({ name: file.name, added: [], ok: false });
        }
      };
      reader.onerror = () => resolve({ name: file.name, added: [], ok: false });
      reader.readAsArrayBuffer(file);
    });
  }

  async function processExcelFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    const results = await Promise.all(files.map(readFileAsStudents));
    const allParsed = results.flatMap((r) => r.added);
    const problemFiles = results.filter((r) => !r.ok || r.added.length === 0).map((r) => r.name);

    if (allParsed.length > 0) {
      const summary = summarizeMerge(applyIncoming(allParsed)) || "이미 같은 명단이 등록돼 있어요.";
      if (problemFiles.length === 0) {
        showToast(summary, "ok");
      } else {
        showToast(`${summary} (인식 실패: ${problemFiles.join(", ")})`, "warn");
      }
    } else {
      showToast("엑셀 내용을 인식하지 못했습니다. 학년·반·번호·이름·성별 열을 확인해 주세요.", "warn");
    }
  }

  function handleExcelFile(e) {
    processExcelFiles(e.target.files);
    e.target.value = "";
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    processExcelFiles(e.dataTransfer.files);
  }

  const filterClassOptions = useMemo(() => {
    if (filterGrade === "ALL") return [];
    const set = new Set(students.filter((s) => s.grade === Number(filterGrade)).map((s) => s.classNum));
    return Array.from(set).sort((a, b) => a - b);
  }, [students, filterGrade]);

  const filtered = useMemo(() => {
    return students
      .filter((s) => (filterGrade === "ALL" || s.grade === Number(filterGrade)) && (filterClass === "ALL" || s.classNum === Number(filterClass)))
      .sort((a, b) => a.grade - b.grade || a.classNum - b.classNum || a.number - b.number);
  }, [students, filterGrade, filterClass]);

  const inputStyle = { border: "1px solid var(--line)" };

  if (readOnly) {
    return (
      <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
        <div className="px-4 py-2 text-xs font-medium" style={{ backgroundColor: "var(--surface-2)", color: "var(--ink-2)" }}>
          조회 전용 · 학생 명단 ({students.length}명)
        </div>
        {students.length === 0 && (
          <div className="px-4 py-6 text-sm text-center" style={{ color: "var(--ink-2)" }}>
            등록된 학생이 없습니다.
          </div>
        )}
        {students
          .slice()
          .sort((a, b) => a.grade - b.grade || a.classNum - b.classNum || a.number - b.number)
          .map((s, i) => (
            <div key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm" style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}>
              <span className="lb-mono text-xs flex-shrink-0" style={{ color: "var(--ink-2)", width: 52 }}>
                {s.grade}-{s.classNum}-{s.number}
              </span>
              <span className="font-medium flex-1 min-w-0 truncate">{displayName(s)}</span>
              <span className="text-xs" style={{ color: "var(--ink-2)" }}>
                {s.gender === "M" ? "남" : "여"}
              </span>
            </div>
          ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="rounded-lg p-4" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
        <h3 className="lb-title text-lg mb-1" style={{ color: "var(--ink)" }}>
          엑셀 파일로 추가
        </h3>
        <p className="text-xs mb-3" style={{ color: "var(--ink-2)" }}>
          여러 학생을 한 번에 등록할 때(예: 새 학기 전체 명단 등록) 활용하세요.
        </p>
        <label
          htmlFor="roster-excel-file-input"
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          className="flex flex-col items-center justify-center text-center gap-1.5 rounded-md py-6 px-3 cursor-pointer"
          style={{ border: `1.5px dashed ${dragOver ? "var(--accent)" : "var(--line)"}`, backgroundColor: dragOver ? "var(--surface-2)" : "transparent" }}
        >
          <FileSpreadsheet size={24} style={{ color: "var(--accent)" }} />
          <span className="text-sm font-medium">엑셀/CSV 파일을 끌어다 놓거나 눌러서 선택하세요</span>
          <span className="text-xs" style={{ color: "var(--ink-2)" }}>
            열 순서: 학년, 반, 번호, 이름, 성별 (.xlsx, .xls, .csv · 제목 줄 자동 인식)
          </span>
          <span className="text-xs" style={{ color: "var(--ink-2)" }}>
            같은 학년·반·번호는 중복으로 만들지 않고 기존 학생의 이름·성별만 갱신해요
          </span>
        </label>
        <input
          id="roster-excel-file-input"
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,text/comma-separated-values,text/plain"
          multiple
          className="hidden"
          onChange={handleExcelFile}
        />
        {lastBulk && (
          <div className="flex items-center justify-between mt-3 text-xs" style={{ color: "var(--ink-2)" }}>
            <span>방금 올린 명단: {lastBulk.summary}</span>
            <button onClick={undoLastBulkAdd} className="flex items-center gap-1 font-medium underline">
              <RotateCcw size={12} /> 되돌리기
            </button>
          </div>
        )}

        <div className="my-4" style={{ borderTop: "1px solid var(--line)" }} />

        <h3 className="lb-title text-lg mb-1" style={{ color: "var(--ink)" }}>
          학생 추가
        </h3>
        <p className="text-xs mb-3" style={{ color: "var(--ink-2)" }}>
          전학생 등 한 명만 빠르게 추가하세요.
        </p>
        <div className="mb-3">
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
            학년
          </label>
          <div className="flex gap-1.5">
            {SCHOOL_GRADES.map((g) => (
              <button
                key={g}
                onClick={() => setForm((f) => ({ ...f, grade: g }))}
                className="text-xs px-3 py-1.5 rounded-full font-medium"
                style={{
                  backgroundColor: form.grade === g ? "var(--ink)" : "var(--surface-2)",
                  color: form.grade === g ? "var(--bg)" : "var(--ink-2)",
                }}
              >
                {g}학년
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
              반
            </label>
            <input
              type="number"
              min="1"
              value={form.classNum}
              onChange={(e) => setForm((f) => ({ ...f, classNum: e.target.value }))}
              className="w-full px-2 py-1.5 rounded-md text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
              번호
            </label>
            <input
              type="number"
              min="1"
              value={form.number}
              onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))}
              className="w-full px-2 py-1.5 rounded-md text-sm outline-none"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
              성별
            </label>
            <div className="flex gap-1">
              {GENDERS.map((g) => (
                <button
                  key={g.id}
                  onClick={() => setForm((f) => ({ ...f, gender: g.id }))}
                  className="flex-1 text-xs py-1.5 rounded-md font-medium"
                  style={{
                    backgroundColor: form.gender === g.id ? "var(--ink)" : "var(--surface-2)",
                    color: form.gender === g.id ? "var(--bg)" : "var(--ink-2)",
                  }}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mb-3">
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
            이름
          </label>
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") addStudent();
            }}
            className="w-full px-3 py-2 rounded-md text-sm outline-none"
            style={inputStyle}
          />
        </div>
        <button
          onClick={addStudent}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium"
          style={{ backgroundColor: "var(--ink)", color: "var(--bg)" }}
        >
          <Plus size={15} /> 추가
        </button>

        <div className="my-4" style={{ borderTop: "1px solid var(--line)" }} />

        <h3 className="lb-title text-lg mb-1" style={{ color: "var(--ink)" }}>
          일괄 추가
        </h3>
        <p className="text-xs mb-2" style={{ color: "var(--ink-2)" }}>
          한 줄에 한 명씩: 학년,반,번호,이름,성별 (예: 1,3,12,홍길동,남)
        </p>
        <textarea
          rows={5}
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          placeholder={"1,1,1,김민준,남\n1,1,2,이서연,여"}
          className="w-full px-3 py-2 rounded-md text-sm outline-none mb-2"
          style={inputStyle}
        />
        <button
          onClick={bulkAdd}
          className="px-4 py-2 rounded-md text-sm font-medium"
          style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
        >
          일괄 추가
        </button>
      </div>

      <div className="rounded-lg p-4" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
        <h3 className="lb-title text-lg mb-3" style={{ color: "var(--ink)" }}>
          학생 명단 ({students.length}명)
        </h3>
        <div className="flex flex-col gap-2 mb-3">
          <FilterChips
            label="학년"
            value={filterGrade}
            onChange={(v) => {
              setFilterGrade(v);
              setFilterClass("ALL");
            }}
            options={[{ id: "ALL", label: "전체" }, ...SCHOOL_GRADES.map((g) => ({ id: String(g), label: `${g}학년` }))]}
          />
          <FilterChips
            label="반"
            value={filterClass}
            onChange={setFilterClass}
            disabled={filterGrade === "ALL"}
            options={[{ id: "ALL", label: "전체" }, ...filterClassOptions.map((c) => ({ id: String(c), label: `${c}반` }))]}
          />
        </div>

        <div className="flex items-center justify-between flex-wrap gap-2 mb-2 px-1">
          <label className="flex items-center gap-1.5 text-xs font-medium">
            <input type="checkbox" checked={filtered.length > 0 && filtered.every((s) => selected.has(s.id))} onChange={() => toggleSelectAll(filtered)} />
            전체선택
          </label>
          <span className="text-xs" style={{ color: "var(--ink-2)" }}>
            {selected.size}명 선택됨
          </span>
          <div className="flex flex-wrap gap-1.5">
            <button disabled={selected.size === 0} onClick={() => bulkSetGender("M")} className="text-xs px-2 py-1 rounded-md" style={{ border: "1px solid var(--line)", opacity: selected.size === 0 ? 0.4 : 1 }}>
              남학생으로 변경
            </button>
            <button disabled={selected.size === 0} onClick={() => bulkSetGender("F")} className="text-xs px-2 py-1 rounded-md" style={{ border: "1px solid var(--line)", opacity: selected.size === 0 ? 0.4 : 1 }}>
              여학생으로 변경
            </button>
            <button
              disabled={selected.size === 0}
              onClick={bulkDelete}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded-md font-medium"
              style={{ color: "var(--danger)", border: "1px solid var(--line)", opacity: selected.size === 0 ? 0.4 : 1 }}
            >
              <Trash2 size={12} /> 선택 삭제
            </button>
          </div>
        </div>

        <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--line)" }}>
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-sm text-center" style={{ color: "var(--ink-2)" }}>
              학생이 없습니다.
            </div>
          )}
          {filtered.map((s, i) => (
            <div
              key={s.id}
              className="flex items-center gap-2 px-3 py-2 text-sm"
              style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}
            >
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} />
              <span className="lb-mono text-xs flex-shrink-0" style={{ color: "var(--ink-2)", width: 52 }}>
                {s.grade}-{s.classNum}-{s.number}
              </span>
              <input
                defaultValue={s.name}
                key={s.id + ":" + s.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v !== s.name) setStudents(students.map((st) => (st.id === s.id ? { ...st, name: v } : st)));
                }}
                placeholder="이름 (이 기기에만 저장)"
                className="font-medium flex-1 min-w-0 px-1.5 py-0.5 rounded outline-none"
                style={{ border: "1px solid transparent" }}
                onFocus={(e) => (e.target.style.border = "1px solid var(--line)")}
              />
              <div className="flex gap-1 flex-shrink-0">
                {GENDERS.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => setStudents(students.map((st) => (st.id === s.id ? { ...st, gender: g.id } : st)))}
                    className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      backgroundColor: s.gender === g.id ? "var(--ink)" : "var(--surface-2)",
                      color: s.gender === g.id ? "var(--bg)" : "var(--ink-2)",
                    }}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
              <button onClick={() => removeStudent(s.id)} className="p-1 rounded-md hover:opacity-70 flex-shrink-0">
                <Trash2 size={14} style={{ color: "var(--danger)" }} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MatchesTab({
  students,
  matches,
  addMatch,
  updateMatch,
  removeMatch,
  pointsConfig,
  setPointsConfig,
  pointsMode,
  setPointsMode,
  events,
  setEvents,
  readOnly,
}) {
  const [date, setDate] = useState("");
  const [event, setEvent] = useState("");
  const [customEvent, setCustomEvent] = useState("");
  const [checked, setChecked] = useState({});
  const [resultFor, setResultFor] = useState({});
  const [customPointsFor, setCustomPointsFor] = useState({});
  const [bulkApplyResult, setBulkApplyResult] = useState("win");
  const [bulkApplyCustomPoints, setBulkApplyCustomPoints] = useState("");
  const [editingMatchId, setEditingMatchId] = useState(null);
  const [filterGrade, setFilterGrade] = useState("ALL");
  const [filterClass, setFilterClass] = useState("ALL");
  const [error, setError] = useState("");

  const filterClassOptions = useMemo(() => {
    if (filterGrade === "ALL") return [];
    const set = new Set(students.filter((s) => s.grade === Number(filterGrade)).map((s) => s.classNum));
    return Array.from(set).sort((a, b) => a - b);
  }, [students, filterGrade]);

  const visibleStudents = useMemo(() => {
    return students
      .filter((s) => (filterGrade === "ALL" || s.grade === Number(filterGrade)) && (filterClass === "ALL" || s.classNum === Number(filterClass)))
      .sort((a, b) => a.grade - b.grade || a.classNum - b.classNum || a.number - b.number);
  }, [students, filterGrade, filterClass]);

  function toggleChecked(id) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
    setResultFor((prev) => (prev[id] ? prev : { ...prev, [id]: "win" }));
  }

  function toggleCheckAll() {
    const allChecked = visibleStudents.length > 0 && visibleStudents.every((s) => checked[s.id]);
    setChecked((prev) => {
      const next = { ...prev };
      visibleStudents.forEach((s) => {
        next[s.id] = !allChecked;
      });
      return next;
    });
    if (!allChecked) {
      setResultFor((prev) => {
        const next = { ...prev };
        visibleStudents.forEach((s) => {
          if (!next[s.id]) next[s.id] = "win";
        });
        return next;
      });
    }
  }

  // 지금 보이는(필터된) 학생 전체를 한 번에 체크하고 같은 결과로 일괄 지정해요.
  function bulkSetResult(resultKey) {
    setChecked((prev) => {
      const next = { ...prev };
      visibleStudents.forEach((s) => {
        next[s.id] = true;
      });
      return next;
    });
    setResultFor((prev) => {
      const next = { ...prev };
      visibleStudents.forEach((s) => {
        next[s.id] = resultKey;
      });
      return next;
    });
  }

  function uncheckAll() {
    setChecked((prev) => {
      const next = { ...prev };
      visibleStudents.forEach((s) => {
        next[s.id] = false;
      });
      return next;
    });
  }

  function setResult(id, value) {
    setResultFor((prev) => ({ ...prev, [id]: value }));
  }

  function setCustomPoints(id, value) {
    setCustomPointsFor((prev) => ({ ...prev, [id]: value }));
  }

  // 지금 체크된 학생들(전체 체크, 몇 명만 체크, 혹은 개별 체크 어떤 경우든)에게
  // 한 번에 같은 결과를 적용해요. 한 명씩 드롭다운을 여는 수고를 덜어줍니다.
  function applyBulkResultToChecked() {
    const ids = Object.keys(checked).filter((id) => checked[id]);
    if (ids.length === 0) return;
    setResultFor((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        next[id] = bulkApplyResult;
      });
      return next;
    });
    if (bulkApplyResult === "custom") {
      const val = Number(bulkApplyCustomPoints) || 0;
      setCustomPointsFor((prev) => {
        const next = { ...prev };
        ids.forEach((id) => {
          next[id] = val;
        });
        return next;
      });
    }
  }

  function handleSubmit() {
    const finalEvent = event === "__custom__" ? customEvent.trim() : event;
    const participants = Object.keys(checked)
      .filter((id) => checked[id])
      .map((studentId) => {
        const result = resultFor[studentId] || "win";
        if (result === "custom") {
          return { studentId, result, customPoints: Number(customPointsFor[studentId]) || 0 };
        }
        return { studentId, result };
      });

    if (!date) {
      setError("경기 날짜를 선택해 주세요.");
      return;
    }
    if (!finalEvent) {
      setError("종목을 입력해 주세요.");
      return;
    }
    if (participants.length === 0) {
      setError("참가한 학생을 한 명 이상 체크해 주세요.");
      return;
    }
    if (editingMatchId) {
      updateMatch(editingMatchId, { date, event: finalEvent, participants });
    } else {
      addMatch({ date, event: finalEvent, participants });
    }
    cancelEdit();
  }

  function startEdit(match) {
    setEditingMatchId(match.id);
    setDate(match.date);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    if (eventOptions.includes(match.event)) {
      setEvent(match.event);
      setCustomEvent("");
    } else {
      setEvent("__custom__");
      setCustomEvent(match.event);
    }
    const nextChecked = {};
    const nextResult = {};
    const nextCustomPoints = {};
    match.participants.forEach((p) => {
      nextChecked[p.studentId] = true;
      nextResult[p.studentId] = p.result;
      if (p.result === "custom") nextCustomPoints[p.studentId] = p.customPoints;
    });
    setChecked(nextChecked);
    setResultFor(nextResult);
    setCustomPointsFor(nextCustomPoints);
    setError("");
  }

  function cancelEdit() {
    setEditingMatchId(null);
    setDate("");
    setChecked({});
    setResultFor({});
    setCustomPointsFor({});
    setCustomEvent("");
    setError("");
  }

  const sortedMatches = [...matches].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const inputStyle = { border: "1px solid var(--line)" };
  const checkedCount = Object.values(checked).filter(Boolean).length;
  const settings = { mode: pointsMode, pointsConfig, events };
  const currentEventName = event === "__custom__" ? customEvent.trim() || "직접입력" : event;
  const eventOptions = pointsMode === "perEvent" ? events.map((e) => e.name).filter(Boolean) : EVENT_PRESETS;

  useEffect(() => {
    if (event === "__custom__") return;
    if (!eventOptions.includes(event)) {
      setEvent(eventOptions[0] || "__custom__");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsMode, events]);

  function addEventRow() {
    setEvents((prev) => [...prev, { id: uid("evt"), name: "", ...DEFAULT_POINTS }]);
  }
  function removeEventRow(id) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }
  function updateEventField(id, field, value) {
    setEvents((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)));
  }
  function getEventConfig(name) {
    const found = events.find((e) => e.name === name);
    return found || DEFAULT_POINTS;
  }

  if (readOnly) {
    return (
      <div>
        <h3 className="lb-title text-lg mb-3" style={{ color: "var(--ink)" }}>
          조회 전용 · 등록된 경기 ({matches.length})
        </h3>
        {sortedMatches.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            아직 등록된 경기가 없어요.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {sortedMatches.map((m) => (
              <div key={m.id} className="rounded-lg p-4" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
                <div className="flex items-center flex-wrap gap-2 mb-3">
                  <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md" style={{ backgroundColor: "var(--surface-2)", color: "var(--ink)" }}>
                    <CalendarDays size={12} />
                    {formatDateKorean(m.date)}
                  </span>
                  <span className="text-sm font-medium">{m.event}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {m.participants.map((p) => {
                    const s = students.find((st) => st.id === p.studentId);
                    const c = RESULT_COLORS[p.result] || RESULT_COLORS.custom;
                    const pts = pointsForParticipant(settings, m.event, p);
                    return (
                      <span key={p.studentId} className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ backgroundColor: c.bg, color: c.text }}>
                        {s ? displayName(s) : "삭제된 학생"} · {RESULT_LABELS_WITH_CUSTOM[p.result]} {pts > 0 ? "+" : ""}
                        {pts}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="rounded-lg p-4 mb-6" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
          <h3 className="lb-title text-lg" style={{ color: "var(--ink)" }}>
            승점 기준 설정
          </h3>
          <div className="flex gap-1.5">
            <button
              onClick={() => setPointsMode("global")}
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{
                backgroundColor: pointsMode === "global" ? "var(--ink)" : "var(--surface-2)",
                color: pointsMode === "global" ? "var(--bg)" : "var(--ink-2)",
              }}
            >
              전체 공통 기준
            </button>
            <button
              onClick={() => setPointsMode("perEvent")}
              className="text-xs px-3 py-1.5 rounded-full font-medium"
              style={{
                backgroundColor: pointsMode === "perEvent" ? "var(--ink)" : "var(--surface-2)",
                color: pointsMode === "perEvent" ? "var(--bg)" : "var(--ink-2)",
              }}
            >
              종목별 기준
            </button>
          </div>
        </div>
        <p className="text-xs mb-3" style={{ color: "var(--ink-2)" }}>
          {pointsMode === "global"
            ? "모든 종목에 같은 점수 기준을 적용해요. 값을 바꾸면 전체 순위에 바로 반영됩니다."
            : "종목마다 다른 점수 기준을 정할 수 있어요. 예: 축구는 승 3점, 배드민턴은 승 2점처럼 다르게 설정 가능합니다."}
        </p>

        {pointsMode === "global" ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.keys(RESULT_LABELS).map((key) => (
              <div key={key}>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
                  {RESULT_LABELS[key]}
                </label>
                <input
                  type="number"
                  value={pointsConfig[key]}
                  onChange={(e) => setPointsConfig((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                  className="w-full px-2 py-1.5 rounded-md text-sm outline-none lb-mono"
                  style={inputStyle}
                />
              </div>
            ))}
          </div>
        ) : (
          <div>
            <div className="rounded-md overflow-hidden mb-2" style={{ border: "1px solid var(--line)" }}>
              <div
                className="event-points-grid grid text-xs font-medium px-2 md:px-3 py-2"
                style={{ backgroundColor: "var(--surface-2)", color: "var(--ink-2)" }}
              >
                <span>종목</span>
                {Object.keys(RESULT_LABELS).map((key) => (
                  <span key={key} className="text-center whitespace-nowrap">
                    {key === "foul" ? (
                      <>
                        <span className="md:hidden">부정</span>
                        <span className="hidden md:inline">{RESULT_LABELS[key]}</span>
                      </>
                    ) : (
                      RESULT_LABELS[key]
                    )}
                  </span>
                ))}
                <span />
              </div>
              {events.length === 0 && (
                <div className="px-3 py-4 text-sm text-center" style={{ color: "var(--ink-2)" }}>
                  아직 추가된 종목이 없어요. 아래 버튼으로 종목을 추가해 주세요.
                </div>
              )}
              {events.map((ev, i) => (
                <div
                  key={ev.id}
                  className="event-points-grid grid items-center px-2 md:px-3 py-1.5 text-sm"
                  style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}
                >
                  <input
                    value={ev.name}
                    onChange={(e) => updateEventField(ev.id, "name", e.target.value)}
                    placeholder="종목명 (예: 축구)"
                    className="text-sm rounded-md outline-none px-1.5 py-1 mr-1 min-w-0"
                    style={inputStyle}
                  />
                  {Object.keys(RESULT_LABELS).map((key) => (
                    <input
                      key={key}
                      type="number"
                      value={ev[key]}
                      onChange={(e) => updateEventField(ev.id, key, Number(e.target.value))}
                      className="lb-mono text-sm text-center rounded-md outline-none mx-0.5 md:mx-1 min-w-0"
                      style={{ ...inputStyle, padding: "4px 2px" }}
                    />
                  ))}
                  <button onClick={() => removeEventRow(ev.id)} className="p-1 rounded-md hover:opacity-70 justify-self-center">
                    <Trash2 size={14} style={{ color: "var(--danger)" }} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addEventRow}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium"
              style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
            >
              <Plus size={13} /> 종목 추가
            </button>
          </div>
        )}
      </div>

      <div
        className="rounded-lg p-4 mb-8"
        style={{ border: editingMatchId ? "1px solid var(--accent)" : "1px solid var(--line)", backgroundColor: "var(--surface)" }}
      >
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <h3 className="lb-title text-lg" style={{ color: "var(--ink)" }}>
            {editingMatchId ? "경기 수정" : "새 경기 등록"}
          </h3>
          {editingMatchId && (
            <span className="text-xs px-2 py-1 rounded-full font-medium" style={{ backgroundColor: "var(--surface-2)", color: "var(--accent)" }}>
              {formatDateKorean(date)} · {currentEventName} 수정 중
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="flex items-center justify-between text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
              <span className="flex items-center gap-1.5">
                <CalendarDays size={13} /> 날짜
              </span>
              {date && (
                <span className="lb-mono" style={{ color: "var(--ink)" }}>
                  {formatDateKorean(date)}
                </span>
              )}
            </label>
            <InlineCalendar value={date} onChange={setDate} />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
              종목
            </label>
            <select value={event} onChange={(e) => setEvent(e.target.value)} className="w-full px-3 py-2 rounded-md text-sm outline-none" style={inputStyle}>
              {eventOptions.map((ev) => (
                <option key={ev} value={ev}>
                  {ev}
                </option>
              ))}
              <option value="__custom__">직접 입력</option>
            </select>
            {pointsMode === "perEvent" && eventOptions.length === 0 && (
              <p className="text-xs mt-2" style={{ color: "var(--ink-2)" }}>
                위 "종목별 기준"에서 종목을 먼저 추가하면 여기서 바로 고를 수 있어요. 지금은 직접 입력한 종목명으로 등록되고, 기본 점수 기준이 적용됩니다.
              </p>
            )}
            {event === "__custom__" && (
              <input
                value={customEvent}
                onChange={(e) => setCustomEvent(e.target.value)}
                placeholder="종목명 입력"
                className="w-full mt-2 px-3 py-2 rounded-md text-sm outline-none"
                style={inputStyle}
              />
            )}
            {pointsMode === "perEvent" && (
              <p className="text-xs mt-2" style={{ color: "var(--ink-2)" }}>
                이 종목의 승점 기준: 승 {getEventConfig(currentEventName).win}점 · 무 {getEventConfig(currentEventName).draw}점 · 패{" "}
                {getEventConfig(currentEventName).loss}점 · 부정행위 {getEventConfig(currentEventName).foul}점
              </p>
            )}
          </div>
        </div>

        {students.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--ink-2)" }}>
            명단 관리 탭에서 학생을 먼저 등록해 주세요.
          </p>
        ) : (
          <div>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
              <label className="block text-xs font-medium" style={{ color: "var(--ink-2)" }}>
                참가자 체크 후 결과 선택
              </label>
              <div className="flex flex-wrap gap-x-3 gap-y-2">
                <FilterChips
                  label="학년"
                  value={filterGrade}
                  onChange={(v) => {
                    setFilterGrade(v);
                    setFilterClass("ALL");
                  }}
                  options={[{ id: "ALL", label: "전체" }, ...SCHOOL_GRADES.map((g) => ({ id: String(g), label: `${g}학년` }))]}
                />
                <FilterChips
                  label="반"
                  value={filterClass}
                  onChange={setFilterClass}
                  disabled={filterGrade === "ALL"}
                  options={[{ id: "ALL", label: "전체" }, ...filterClassOptions.map((c) => ({ id: String(c), label: `${c}반` }))]}
                />
              </div>
            </div>

            <div className="flex items-center justify-between px-1 mb-2">
              <label className="flex items-center gap-1.5 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={visibleStudents.length > 0 && visibleStudents.every((s) => checked[s.id])}
                  onChange={toggleCheckAll}
                />
                전체선택
              </label>
              <span className="text-xs" style={{ color: "var(--ink-2)" }}>
                {checkedCount}명 참가 체크됨
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className="text-xs" style={{ color: "var(--ink-2)" }}>
                일괄 처리:
              </span>
              {Object.keys(RESULT_LABELS).map((key) => (
                <button
                  key={key}
                  onClick={() => bulkSetResult(key)}
                  className="text-xs px-2.5 py-1 rounded-full font-medium"
                  style={{ backgroundColor: "var(--surface-2)", color: "var(--ink)" }}
                >
                  전체 {RESULT_LABELS[key]}
                </button>
              ))}
              <button onClick={uncheckAll} className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ color: "var(--ink-2)", border: "1px solid var(--line)" }}>
                전체 해제
              </button>
            </div>

            <div
              className="flex flex-wrap items-center gap-2 mb-2 px-2 py-2 rounded-md"
              style={{ backgroundColor: "var(--surface-2)" }}
            >
              <span className="text-xs font-medium w-full md:w-auto" style={{ color: "var(--ink)" }}>
                체크된 학생에게 결과 일괄 적용:
              </span>
              <select
                value={bulkApplyResult}
                onChange={(e) => setBulkApplyResult(e.target.value)}
                className="px-2 py-1 rounded-md text-sm outline-none font-medium"
                style={{ ...inputStyle, backgroundColor: RESULT_COLORS[bulkApplyResult].bg, color: RESULT_COLORS[bulkApplyResult].text }}
              >
                {Object.keys(RESULT_LABELS).map((key) => (
                  <option key={key} value={key} style={{ backgroundColor: RESULT_COLORS[key].bg, color: RESULT_COLORS[key].text }}>
                    {RESULT_LABELS[key]}
                  </option>
                ))}
                <option value="custom" style={{ backgroundColor: RESULT_COLORS.custom.bg, color: RESULT_COLORS.custom.text }}>
                  직접 입력
                </option>
              </select>
              {bulkApplyResult === "custom" && (
                <input
                  type="number"
                  value={bulkApplyCustomPoints}
                  onChange={(e) => setBulkApplyCustomPoints(e.target.value)}
                  placeholder="점수"
                  className="lb-mono text-sm text-center rounded-md outline-none"
                  style={{ ...inputStyle, width: 64 }}
                />
              )}
              <button
                onClick={applyBulkResultToChecked}
                disabled={checkedCount === 0}
                className="text-xs px-3 py-1.5 rounded-full font-medium"
                style={{ backgroundColor: "var(--ink)", color: "var(--bg)", opacity: checkedCount === 0 ? 0.4 : 1 }}
              >
                체크된 {checkedCount}명에게 적용
              </button>
              <span className="text-xs w-full" style={{ color: "var(--ink-2)" }}>
                전체선택·부분체크(개별로 몇 명만)·전체 해제로 원하는 학생만 체크한 뒤, 위에서 결과를 골라 한 번에 적용하세요.
              </span>
            </div>

            <div className="rounded-md overflow-hidden" style={{ border: "1px solid var(--line)" }}>
              {visibleStudents.map((s, i) => (
                <div
                  key={s.id}
                  className="flex items-center gap-2 px-3 py-2 text-sm"
                  style={{ borderTop: i === 0 ? "none" : "1px solid var(--line)" }}
                >
                  <input type="checkbox" checked={!!checked[s.id]} onChange={() => toggleChecked(s.id)} />
                  <span className="lb-mono text-xs flex-shrink-0" style={{ color: "var(--ink-2)", width: 52 }}>
                    {s.grade}-{s.classNum}-{s.number}
                  </span>
                  <span className="flex-1 min-w-0 truncate">{displayName(s)}</span>
                  <select
                    value={resultFor[s.id] || "win"}
                    onChange={(e) => setResult(s.id, e.target.value)}
                    disabled={!checked[s.id]}
                    className="px-2 py-1 rounded-md text-sm outline-none font-medium flex-shrink-0"
                    style={{
                      ...inputStyle,
                      backgroundColor: RESULT_COLORS[resultFor[s.id] || "win"].bg,
                      color: RESULT_COLORS[resultFor[s.id] || "win"].text,
                      opacity: checked[s.id] ? 1 : 0.4,
                    }}
                  >
                    {Object.keys(RESULT_LABELS).map((key) => {
                      const pts = pointsFor(settings, currentEventName, key);
                      return (
                        <option key={key} value={key} style={{ backgroundColor: RESULT_COLORS[key].bg, color: RESULT_COLORS[key].text }}>
                          {RESULT_LABELS[key]} ({pts > 0 ? "+" : ""}
                          {pts}점)
                        </option>
                      );
                    })}
                    <option value="custom" style={{ backgroundColor: RESULT_COLORS.custom.bg, color: RESULT_COLORS.custom.text }}>
                      직접 입력
                    </option>
                  </select>
                  {resultFor[s.id] === "custom" && (
                    <input
                      type="number"
                      value={customPointsFor[s.id] ?? ""}
                      onChange={(e) => setCustomPoints(s.id, e.target.value)}
                      disabled={!checked[s.id]}
                      placeholder="점수"
                      className="lb-mono text-sm text-center rounded-md outline-none flex-shrink-0"
                      style={{ ...inputStyle, width: 56, opacity: checked[s.id] ? 1 : 0.4 }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="text-sm mt-3" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={handleSubmit} className="flex-1 md:flex-none px-4 py-2.5 md:py-2 rounded-md text-sm font-medium" style={{ backgroundColor: "var(--ink)", color: "var(--bg)" }}>
            {editingMatchId ? "수정 저장" : "경기 등록"}
          </button>
          {editingMatchId && (
            <button onClick={cancelEdit} className="flex-1 md:flex-none px-4 py-2.5 md:py-2 rounded-md text-sm font-medium" style={{ border: "1px solid var(--line)", color: "var(--ink)" }}>
              취소
            </button>
          )}
        </div>
      </div>

      <h3 className="lb-title text-lg mb-3" style={{ color: "var(--ink)" }}>
        등록된 경기 ({matches.length})
      </h3>
      {sortedMatches.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--ink-2)" }}>
          아직 등록된 경기가 없어요.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {sortedMatches.map((m) => (
            <div key={m.id} className="rounded-lg p-4" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className="flex items-center flex-wrap gap-2 min-w-0">
                  <span className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md" style={{ backgroundColor: "var(--surface-2)", color: "var(--ink)" }}>
                    <CalendarDays size={12} />
                    {formatDateKorean(m.date)}
                  </span>
                  <span className="text-sm font-medium">{m.event}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(m)} className="p-1.5 rounded-md hover:opacity-70">
                    <Pencil size={15} style={{ color: "var(--ink)" }} />
                  </button>
                  <button onClick={() => removeMatch(m.id)} className="p-1.5 rounded-md hover:opacity-70">
                    <Trash2 size={15} style={{ color: "var(--danger)" }} />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {m.participants.map((p) => {
                  const s = students.find((st) => st.id === p.studentId);
                  const c = RESULT_COLORS[p.result] || RESULT_COLORS.custom;
                  const pts = pointsForParticipant(settings, m.event, p);
                  return (
                    <span key={p.studentId} className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ backgroundColor: c.bg, color: c.text }}>
                      {s ? displayName(s) : "삭제된 학생"} · {RESULT_LABELS_WITH_CUSTOM[p.result]} {pts > 0 ? "+" : ""}
                      {pts}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsTab({
  workspaceCode,
  onLeaveWorkspace,
  onRefresh,
  onCloseout,
  showToast,
  openConfirm,
  closeConfirm,
  students,
  matches,
  data,
  applyLoadedData,
  role,
  myName,
  deviceId,
  canManageAccess,
  refreshNamesFromLocalMap,
}) {
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [backedUp, setBackedUp] = useState(false);
  const [leaveModalOpen, setLeaveModalOpen] = useState(false);
  const importInputRef = useRef(null);

  const studentCount = students.length;
  const matchCount = matches.length;
  const isEmpty = studentCount === 0 && matchCount === 0;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(workspaceCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      showToast("복사에 실패했어요. 코드를 직접 선택해 복사해 주세요.", "warn");
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  function downloadBackup(suffix) {
    const payload = { exportedAt: Date.now(), workspaceCode, ...data };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `league-backup-${workspaceCode}${suffix || ""}-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadExcel(suffix) {
    const settings = { mode: data.pointsMode, pointsConfig: data.pointsConfig, events: data.events };
    const { groups } = computeStandings(data.students, data.matches, settings);

    const leaderboardRows = [];
    groups.forEach((g) => {
      g.rows.forEach((row) => {
        leaderboardRows.push({
          순위: g.rank,
          이름: displayName(row.student),
          학년: row.student.grade,
          반: row.student.classNum,
          번호: row.student.number,
          경기수: row.played,
          승점: row.total,
        });
      });
    });

    const rosterRows = data.students.map((s) => ({
      학년: s.grade,
      반: s.classNum,
      번호: s.number,
      이름: s.name,
      성별: s.gender === "M" ? "남" : "여",
    }));

    const matchRows = [];
    data.matches.forEach((m) => {
      m.participants.forEach((p) => {
        const s = data.students.find((st) => st.id === p.studentId);
        matchRows.push({
          날짜: m.date,
          종목: m.event,
          이름: s ? displayName(s) : "삭제된 학생",
          학년: s ? s.grade : "",
          반: s ? s.classNum : "",
          번호: s ? s.number : "",
          결과: RESULT_LABELS_WITH_CUSTOM[p.result],
          점수: pointsForParticipant(settings, m.event, p),
        });
      });
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(leaderboardRows), "리더보드");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rosterRows), "명단");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matchRows), "경기기록");

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `league-backup-${workspaceCode}${suffix || ""}-${dateStr}.xlsx`);
  }

  function exportExcelNow() {
    downloadExcel("");
    showToast("엑셀 파일을 다운로드했습니다.", "ok");
  }

  function exportBackup() {
    downloadBackup("");
    showToast("복원용 JSON 파일을 다운로드했습니다.", "ok");
  }

  function downloadBackupBeforeCloseout() {
    downloadExcel("-마감전");
    setBackedUp(true);
    showToast("엑셀 파일을 다운로드했습니다.", "ok");
  }

  function handleLeaveConfirm(withExcel) {
    if (withExcel) downloadExcel("-나가기전");
    setLeaveModalOpen(false);
    onLeaveWorkspace();
  }

  function handleImportFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const payload = JSON.parse(evt.target.result);
        if (!payload || !Array.isArray(payload.students)) {
          showToast("올바른 백업 파일이 아닙니다.", "warn");
          return;
        }
        setPendingImport(payload);
      } catch (err) {
        showToast("파일을 읽는 중 오류가 발생했습니다.", "warn");
      }
    };
    reader.readAsText(file);
  }

  function confirmImport() {
    applyLoadedData(pendingImport);
    setPendingImport(null);
    showToast("백업 파일을 불러왔습니다.", "ok");
  }

  function exportNameMap() {
    const map = getNameMap(workspaceCode);
    const count = Object.keys(map).length;
    if (count === 0) {
      showToast("이 기기에 저장된 이름표가 없습니다.", "warn");
      return;
    }
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `namemap-${workspaceCode}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`이름표 ${count}건을 내보냈습니다.`, "ok");
  }

  function handleImportNameMapFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          showToast("올바른 이름표 파일이 아닙니다.", "warn");
          return;
        }
        mergeNameMap(workspaceCode, parsed);
        refreshNamesFromLocalMap();
        showToast(`이름표 ${Object.keys(parsed).length}건을 이 기기에 반영했습니다.`, "ok");
      } catch (err) {
        showToast("파일을 읽는 중 오류가 발생했습니다.", "warn");
      }
    };
    reader.readAsText(file);
  }

  function handleCloseoutClick() {
    openConfirm({
      title: "정말 마감하시겠습니까?",
      message: `기록 ${matchCount}건과 학생 명단 ${studentCount}명이 영구히 삭제되고, 이 코드 자체도 사라져 첫 화면으로 돌아갑니다. 이 작업은 되돌릴 수 없습니다.`,
      confirmLabel: "네, 마감합니다",
      danger: true,
      onConfirm: async () => {
        closeConfirm();
        await onCloseout();
      },
    });
  }

  const inputStyle = { border: "1px solid var(--line)" };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg p-4" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
        <h3 className="lb-title text-lg mb-1 flex items-center gap-2" style={{ color: "var(--ink)" }}>
          <KeyRound size={17} style={{ color: "var(--accent)" }} /> 코드값 설정 및 관리
        </h3>
        <p className="text-xs mb-3" style={{ color: "var(--ink-2)" }}>
          이 코드를 입력하면 데스크톱이든 모바일이든 어떤 기기에서도 같은 데이터를 이어서 관리할 수 있어요. 동료 선생님과 코드를 공유하면 함께 관리할 수도 있습니다.
        </p>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ backgroundColor: "var(--surface-2)", color: "var(--ink)" }}>
            {myName} · {ROLE_LABEL[role]}
          </span>
        </div>
        <div className="flex items-center gap-2 mb-3">
          <span className="lb-mono text-base md:text-lg font-semibold px-3 py-2 rounded-md flex-1 min-w-0 truncate" style={{ backgroundColor: "var(--surface-2)", color: "var(--ink)" }}>
            {workspaceCode}
          </span>
          <button
            onClick={copyCode}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap flex-shrink-0"
            style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
          >
            <Copy size={14} /> {copied ? "복사됨" : "복사"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium"
            style={{ border: "1px solid var(--line)", color: "var(--ink)", opacity: refreshing ? 0.5 : 1 }}
          >
            <RefreshCw size={14} /> {refreshing ? "불러오는 중..." : "최신 데이터 다시 불러오기"}
          </button>
          <button
            onClick={() => setLeaveModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-semibold"
            style={{ backgroundColor: "var(--ink)", color: "var(--bg)", boxShadow: "0 2px 8px rgba(11,27,51,0.25)" }}
          >
            <LogOut size={14} /> 다른 코드로 전환
          </button>
        </div>
        <p className="text-xs mt-2" style={{ color: "var(--ink-2)" }}>
          다른 기기에서 같은 코드를 입력하면 자동으로 최신 저장 내용을 불러와요. 여러 기기를 동시에 켜두고 쓰는 경우, 방금 다른 기기에서 바꾼 내용은 "최신 데이터 다시 불러오기"로 반영할 수 있습니다.
        </p>
      </div>

      {canManageAccess && <AccessManagementPanel workspaceCode={workspaceCode} showToast={showToast} deviceId={deviceId} />}

      <div className="rounded-lg p-4" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
        <h3 className="lb-title text-lg mb-1" style={{ color: "var(--ink)" }}>
          데이터 관리
        </h3>
        <p className="text-xs mb-3" style={{ color: "var(--ink-2)" }}>
          평소에는 자동으로 저장되지만, 화면을 나가거나 마감하기 전에는 언제든 엑셀 파일로 따로 저장해둘 수 있어요.
        </p>
        <div className="flex flex-wrap gap-2 mb-2">
          <button
            onClick={exportExcelNow}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium"
            style={{ backgroundColor: "var(--ink)", color: "var(--bg)" }}
          >
            <Download size={14} /> 엑셀 파일로 저장
          </button>
          {canManageAccess && (
            <>
              <button
                onClick={exportBackup}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium"
                style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
              >
                <Download size={14} /> JSON으로 내보내기 (복원용)
              </button>
              <input id="league-restore-file-input" ref={importInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleImportFile} />
              <label
                htmlFor="league-restore-file-input"
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium cursor-pointer"
                style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
              >
                <Upload size={14} /> 백업 파일 불러오기
              </label>
            </>
          )}
        </div>
        <p className="text-xs" style={{ color: "var(--ink-2)" }}>
          {canManageAccess
            ? "엑셀 파일은 리더보드·명단·경기기록이 각각의 시트로 정리되어 열람·제출·인쇄용으로 좋아요. 이 앱에 나중에 다시 불러오려면(복원) JSON 파일을 이용해 주세요. 불러오기를 하면 지금 화면의 명단·기록이 파일 내용으로 완전히 바뀝니다(되돌릴 수 없어요)."
            : "JSON 백업(내보내기·불러오기)은 개설자만 할 수 있습니다. 여러 명이 각자 따로 불러오면 서로 다른 시점의 기록이 뒤섞일 수 있어서, 혼선을 막기 위해 개설자 한 명으로 창구를 좁혀두었습니다."}
        </p>
      </div>

      <div className="rounded-lg p-4" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
        <h3 className="lb-title text-lg mb-1" style={{ color: "var(--ink)" }}>
          학생 이름표 (이 기기 전용)
        </h3>
        <p className="text-xs mb-3" style={{ color: "var(--ink-2)" }}>
          학생 이름은 서버(Firebase)에는 저장되지 않고, 이 기기(브라우저)에만 남습니다. 다른 기기에서는 학년-반-번호만 보이니, 아래로 이름표 파일을 내보내 다른 기기에 옮겨보세요.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={exportNameMap}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium"
            style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
          >
            <Download size={14} /> 이름표 내보내기
          </button>
          <input id="league-namemap-file-input" type="file" accept=".json,application/json" className="hidden" onChange={handleImportNameMapFile} />
          <label
            htmlFor="league-namemap-file-input"
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium cursor-pointer"
            style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
          >
            <Upload size={14} /> 이름표 가져오기
          </label>
        </div>
      </div>

      {canManageAccess ? (
      <div className="rounded-lg p-4" style={{ border: "1px solid var(--danger)", backgroundColor: "var(--surface)" }}>
        <h3 className="lb-title text-lg mb-1 flex items-center gap-2" style={{ color: "var(--danger)" }}>
          <Trash2 size={17} /> 마감
        </h3>
        <p className="text-xs mb-3" style={{ color: "var(--ink-2)" }}>
          시즌이나 대회가 완전히 끝났다면, 학생 명단과 경기 기록을 계속 저장해 둘 필요가 없습니다. 마감하면 이 코드에 담긴 모든 데이터와 코드 자체가 삭제되고 첫 화면으로 돌아갑니다.
        </p>
        <div className="text-sm mb-3" style={{ color: "var(--ink)" }}>
          현재 <b>학생 {studentCount}명</b>, <b>경기 {matchCount}건</b>이 저장되어 있습니다.
        </div>

        {!isEmpty && (
          <div className="mb-3">
            <p className="text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
              ① 엑셀 파일부터 받으세요 (필수)
            </p>
            <button
              onClick={downloadBackupBeforeCloseout}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium"
              style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
            >
              <Download size={14} /> {backedUp ? "엑셀 파일 다시 받기" : "지금 엑셀 파일 받기"}
            </button>
            {backedUp && (
              <p className="text-xs mt-1.5 flex items-center gap-1" style={{ color: "var(--ink)" }}>
                <Check size={13} /> 엑셀 파일을 받았습니다. 이제 마감할 수 있습니다.
              </p>
            )}
          </div>
        )}

        <p className="text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
          {isEmpty ? "마감하기" : "② 마감하기"}
        </p>
        <button
          onClick={handleCloseoutClick}
          disabled={!isEmpty && !backedUp}
          className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium"
          style={{ backgroundColor: "var(--danger)", color: "white", opacity: !isEmpty && !backedUp ? 0.4 : 1 }}
        >
          <Trash2 size={15} /> 마감하기
        </button>
        {!isEmpty && !backedUp && (
          <p className="text-xs mt-1.5" style={{ color: "var(--ink-2)" }}>
            먼저 위에서 엑셀 파일을 받아야 눌러집니다.
          </p>
        )}
      </div>
      ) : (
      <div className="rounded-lg p-4" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
        <h3 className="lb-title text-lg mb-1 flex items-center gap-2" style={{ color: "var(--ink-2)" }}>
          <Trash2 size={17} /> 마감
        </h3>
        <p className="text-xs" style={{ color: "var(--ink-2)" }}>
          마감(전체 데이터·코드 삭제)은 개설자만 할 수 있습니다. 시즌이 끝나 정리가 필요하면 개설자 선생님께 요청해 주세요.
        </p>
      </div>
      )}

      {pendingImport && (
        <ConfirmModal
          title="백업 파일 불러오기"
          message={`이 파일로 불러오면 현재 학생 ${students.length}명의 데이터가 백업 파일 속 학생 ${pendingImport.students.length}명 데이터로 완전히 대체됩니다. 계속할까요?`}
          confirmLabel="불러오기"
          danger
          onConfirm={confirmImport}
          onCancel={() => setPendingImport(null)}
        />
      )}

      {leaveModalOpen && (
        <div
          onClick={() => setLeaveModalOpen(false)}
          className="fixed inset-0 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(11,27,51,0.45)", zIndex: 50 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-lg p-5"
            style={{ maxWidth: 380, backgroundColor: "var(--surface)", border: "1px solid var(--line)" }}
          >
            <h3 className="flex items-center gap-2 font-medium mb-3" style={{ color: "var(--ink)" }}>
              <LogOut size={17} /> 코드 나가기
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--ink)" }}>
              나가기 전에 지금까지 기록을 엑셀 파일로 저장해둘 수 있어요. 데이터 자체는 코드에 계속 남아 있으니, 나중에 같은 코드로 다시 들어오면 이어서 볼 수 있습니다.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleLeaveConfirm(true)}
                className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium"
                style={{ backgroundColor: "var(--ink)", color: "var(--bg)" }}
              >
                <Download size={14} /> 엑셀로 저장 후 나가기
              </button>
              <button
                onClick={() => handleLeaveConfirm(false)}
                className="px-4 py-2 rounded-md text-sm font-medium"
                style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
              >
                그냥 나가기
              </button>
              <button onClick={() => setLeaveModalOpen(false)} className="px-4 py-2 rounded-md text-sm font-medium" style={{ color: "var(--ink-2)" }}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AccessManagementPanel({ workspaceCode, showToast, deviceId }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewerPwDraft, setViewerPwDraft] = useState("");
  const [founderPwDraft, setFounderPwDraft] = useState("");
  const [showFounderPw, setShowFounderPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);
  const draftsInitialized = useRef(false);

  useEffect(() => {
    draftsInitialized.current = false;
    setLoading(true);
    const unsubscribe = watchWorkspaceConfig(workspaceCode, (cfg) => {
      setConfig(cfg);
      if (cfg && !draftsInitialized.current) {
        setViewerPwDraft(cfg.viewerPassword || "");
        setFounderPwDraft(cfg.founderPassword || "");
        draftsInitialized.current = true;
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [workspaceCode]);

  async function saveConfig(next) {
    await writeWorkspaceConfig(workspaceCode, next);
    setConfig(next);
  }

  async function savePasswords() {
    if (!config) return;
    setSavingPw(true);
    await saveConfig({ ...config, viewerPassword: viewerPwDraft.trim(), founderPassword: founderPwDraft.trim() });
    setSavingPw(false);
    showToast("비밀번호를 저장했습니다.", "ok");
  }

  async function decide(id, status) {
    if (!config) return;
    const list = (config.accessList || []).map((a) => (a.id === id ? { ...a, status, decidedAt: Date.now() } : a));
    await saveConfig({ ...config, accessList: list });
    showToast(status === "approved" ? "승인했습니다." : "거절했습니다.", "ok");
  }

  async function revoke(id) {
    if (!config) return;
    const list = (config.accessList || []).map((a) => (a.id === id ? { ...a, status: "denied", decidedAt: Date.now() } : a));
    await saveConfig({ ...config, accessList: list });
    showToast("접근 권한을 취소했습니다.", "ok");
  }

  if (loading || !config) {
    return (
      <div className="rounded-lg p-4" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
        <p className="text-xs" style={{ color: "var(--ink-2)" }}>
          구성원 정보를 불러오는 중...
        </p>
      </div>
    );
  }

  const accessList = config.accessList || [];
  const pending = accessList.filter((a) => a.status === "pending");
  const approved = accessList.filter((a) => a.status === "approved");
  const inputStyle = { border: "1px solid var(--line)" };

  return (
    <div className="rounded-lg p-4" style={{ border: "1px solid var(--line)", backgroundColor: "var(--surface)" }}>
      <h3 className="lb-title text-lg mb-1" style={{ color: "var(--ink)" }}>
        구성원 및 접근 권한 관리
      </h3>
      <p className="text-xs mb-3" style={{ color: "var(--ink-2)" }}>
        조회 비밀번호를 알면 누구나 열람 신청을 해서 바로 조회할 수 있어요. 명단·기록을 수정하려면 개설자인 선생님의 승인이 한 번 더 필요합니다.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
            조회 비밀번호 (동료 선생님께 안내)
          </label>
          <input
            value={viewerPwDraft}
            onChange={(e) => setViewerPwDraft(e.target.value)}
            placeholder="비워두면 접근 신청 자체가 꺼집니다"
            className="w-full px-3 py-2 rounded-md text-sm outline-none"
            style={inputStyle}
          />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
            개설자 전용 비밀번호
          </label>
          <div className="flex gap-1.5">
            <input
              type={showFounderPw ? "text" : "password"}
              value={founderPwDraft}
              onChange={(e) => setFounderPwDraft(e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 rounded-md text-sm outline-none"
              style={inputStyle}
            />
            <button
              onClick={() => setShowFounderPw((v) => !v)}
              className="px-3 py-1 rounded-md text-xs whitespace-nowrap flex-shrink-0"
              style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}
            >
              {showFounderPw ? "숨기기" : "보기"}
            </button>
          </div>
        </div>
      </div>
      <button
        onClick={savePasswords}
        disabled={savingPw}
        className="px-3 py-1.5 rounded-md text-xs font-medium mb-4"
        style={{ backgroundColor: "var(--ink)", color: "var(--bg)", opacity: savingPw ? 0.6 : 1 }}
      >
        {savingPw ? "저장 중..." : "비밀번호 저장"}
      </button>

      <div className="mb-4">
        <p className="text-xs font-medium mb-2" style={{ color: "var(--ink)" }}>
          승인 대기 ({pending.length}명)
        </p>
        {pending.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--ink-2)" }}>
            대기 중인 수정 권한 신청이 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {pending.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm" style={{ backgroundColor: "var(--surface-2)" }}>
                <span className="min-w-0">
                  {r.name} <span style={{ color: "var(--ink-2)" }}>· 수정 권한 신청</span>
                </span>
                <div className="flex gap-1.5 flex-shrink-0">
                  <button onClick={() => decide(r.id, "approved")} className="text-xs px-2.5 py-1 rounded-md font-medium" style={{ backgroundColor: "var(--ink)", color: "var(--bg)" }}>
                    승인
                  </button>
                  <button onClick={() => decide(r.id, "denied")} className="text-xs px-2.5 py-1 rounded-md font-medium" style={{ border: "1px solid var(--line)" }}>
                    거절
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-medium mb-2" style={{ color: "var(--ink)" }}>
          승인된 구성원 ({approved.length}명)
        </p>
        {approved.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--ink-2)" }}>
            아직 승인된 구성원이 없습니다.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {approved.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 px-3 py-2 rounded-md text-sm" style={{ backgroundColor: "var(--surface-2)" }}>
                <span className="min-w-0">
                  {r.name} <span style={{ color: "var(--ink-2)" }}>· {r.type === "editor" ? "수정 권한" : "조회 전용"}</span>
                </span>
                <button onClick={() => revoke(r.id)} className="text-xs px-2.5 py-1 rounded-md font-medium whitespace-nowrap flex-shrink-0" style={{ color: "var(--danger)", border: "1px solid var(--line)" }}>
                  권한 취소
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const INTRO_SESSION_KEY = "league-intro-shown";

function IntroSplash({ onDone }) {
  const [stage, setStage] = useState(0); // 0: 아이콘 등장, 1: 제목 등장, 2: 페이드아웃
  const reducedMotion = useRef(false);

  useEffect(() => {
    try {
      reducedMotion.current = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      reducedMotion.current = false;
    }
    if (reducedMotion.current) {
      onDone();
      return;
    }
    const t1 = setTimeout(() => setStage(1), 900);
    const t2 = setTimeout(() => setStage(2), 2600);
    const t3 = setTimeout(() => onDone(), 3150);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (reducedMotion.current) return null;

  const stars = [
    { x: "8%", y: "16%", size: 6, delay: "0s" },
    { x: "90%", y: "12%", size: 5, delay: "0.5s" },
    { x: "14%", y: "76%", size: 5, delay: "1s" },
    { x: "86%", y: "72%", size: 6, delay: "0.3s" },
    { x: "50%", y: "6%", size: 4, delay: "1.4s" },
    { x: "26%", y: "90%", size: 5, delay: "0.8s" },
    { x: "74%", y: "92%", size: 5, delay: "1.7s" },
    { x: "4%", y: "48%", size: 4, delay: "1.1s" },
    { x: "96%", y: "44%", size: 4, delay: "0.65s" },
  ];

  return (
    <div
      onClick={onDone}
      className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden cursor-pointer"
      style={{
        zIndex: 100,
        background: "linear-gradient(160deg, #121418, #0A0B0D 65%, #0A0B0D)",
        opacity: stage === 2 ? 0 : 1,
        transition: "opacity 0.55s ease",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,700..900;1,700..900&family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap');
        @keyframes introBurstSpin { from { transform: translate(-50%,-50%) rotate(0deg); } to { transform: translate(-50%,-50%) rotate(360deg); } }
        @keyframes introTwinkle { 0%, 100% { opacity: 0.15; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.3); } }
        @keyframes introPop { 0% { opacity: 0; transform: scale(0.35) translateY(24px); } 60% { opacity: 1; transform: scale(1.14) translateY(0); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes introMedalDrop { 0% { opacity: 0; transform: translateY(-50px) scale(0.55); } 60% { opacity: 1; } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes introTitleIn { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes introShock { 0% { opacity: 0.55; transform: translate(-50%,-50%) scale(0.2); } 100% { opacity: 0; transform: translate(-50%,-50%) scale(2.4); } }
        @keyframes introGlowPulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 0.85; } }
        .intro-trophy { animation: introPop 0.75s cubic-bezier(0.22,1,0.36,1) both; }
        .intro-medal { animation: introMedalDrop 0.65s cubic-bezier(0.22,1,0.36,1) both; }
        .intro-title { animation: introTitleIn 0.65s ease both; }
        .intro-shock { animation: introShock 1.1s cubic-bezier(0.16,1,0.3,1) both; animation-delay: 0.15s; }
        .intro-glow { animation: introGlowPulse 2.6s ease-in-out infinite; }
        .intro-trophy svg, .intro-medal svg { width: 100%; height: auto; display: block; }
      `}</style>

      <div
        className="intro-glow absolute pointer-events-none"
        style={{
          top: "40%",
          left: "50%",
          width: "min(120vw, 1400px)",
          height: "min(120vw, 1400px)",
          transform: "translate(-50%,-50%)",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(228,199,101,0.22) 0%, rgba(228,199,101,0.06) 40%, transparent 70%)",
        }}
      />
      <svg
        viewBox="0 0 200 200"
        className="absolute pointer-events-none"
        style={{
          top: "40%",
          left: "50%",
          width: "min(150vw, 1600px)",
          height: "min(150vw, 1600px)",
          transform: "translate(-50%,-50%)",
          animation: "introBurstSpin 30s linear infinite",
        }}
      >
        {Array.from({ length: 24 }).map((_, i) => (
          <rect key={i} x="98.8" y="0" width="2.2" height="100" fill="#E4C765" opacity="0.1" transform={`rotate(${i * 15} 100 100)`} />
        ))}
      </svg>
      <span
        className="intro-shock absolute pointer-events-none"
        style={{
          top: "40%",
          left: "50%",
          width: "min(60vw, 520px)",
          height: "min(60vw, 520px)",
          borderRadius: "50%",
          border: "2px solid rgba(228,199,101,0.55)",
        }}
      />
      {stars.map((s, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: s.x,
            top: s.y,
            width: s.size,
            height: s.size,
            borderRadius: "50%",
            backgroundColor: "#F3DA8E",
            animation: `introTwinkle 2.4s ease-in-out infinite`,
            animationDelay: s.delay,
          }}
        />
      ))}

      <div className="intro-trophy relative" style={{ width: "clamp(150px, 24vw, 300px)" }}>
        <TrophyEmblem size={300} />
      </div>
      <div className="flex items-end gap-5 mt-3">
        <div className="intro-medal" style={{ animationDelay: "0.15s", width: "clamp(64px, 11vw, 120px)" }}>
          <MedalIcon tier={2} size={120} ribbon />
        </div>
        <div className="intro-medal" style={{ animationDelay: "0s", width: "clamp(84px, 14.5vw, 160px)" }}>
          <MedalIcon tier={1} size={160} ribbon />
        </div>
        <div className="intro-medal" style={{ animationDelay: "0.3s", width: "clamp(64px, 11vw, 120px)" }}>
          <MedalIcon tier={3} size={120} ribbon />
        </div>
      </div>

      {stage >= 1 && (
        <div className="intro-title text-center mt-8 px-6" style={{ maxWidth: "92vw" }}>
          <h1
            className="tracking-wide font-semibold"
            style={{
              fontFamily: "'Archivo', sans-serif",
              fontStyle: "italic",
              fontWeight: 900,
              letterSpacing: "-0.03em",
              color: "#F4F5F7",
              background: "linear-gradient(100deg, #FF9570 0%, #E48AC4 50%, #9E86FF 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              WebkitTextFillColor: "transparent",
              fontSize: "clamp(2.1rem, 7vw, 4.5rem)",
              lineHeight: 1.1,
            }}
          >
            P.E SCORE LEADERBOARD
          </h1>
          <p
            className="mt-4"
            style={{ fontFamily: "'IBM Plex Sans KR', sans-serif", color: "#E4C765", fontSize: "clamp(1rem, 2.4vw, 1.4rem)" }}
          >
            매 순간의 승점이 모여, 오늘의 챔피언을 만듭니다
          </p>
        </div>
      )}
    </div>
  );
}

function WorkspaceGate({ lastCode, onFounderLogin, onCreateCode, onRequestAccess }) {
  const [mode, setMode] = useState("code");
  const [value, setValue] = useState(lastCode || "");
  const [founderPassword, setFounderPassword] = useState("");
  const [showFounderPassword, setShowFounderPassword] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [viewerPasswordNew, setViewerPasswordNew] = useState("");
  const [founderPasswordNew, setFounderPasswordNew] = useState("");
  const [showFounderPasswordNew, setShowFounderPasswordNew] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const [agree, setAgree] = useState(false);
  const [name, setName] = useState("");
  const [reqCode, setReqCode] = useState(lastCode || "");
  const [reqPassword, setReqPassword] = useState("");
  const [wantsEdit, setWantsEdit] = useState(false);
  const [formError, setFormError] = useState("");

  async function handleLogin() {
    const clean = sanitizeCode(value);
    if (!clean || !founderPassword.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await onFounderLogin(clean, founderPassword);
      if (!result.ok) {
        if (result.reason === "bad-code") setError("존재하지 않는 코드입니다. 아래 '새 코드 만들기'로 새로 만들 수 있어요.");
        else setError("개설자 전용 비밀번호가 올바르지 않습니다.");
      }
    } catch (e) {
      console.error("founder login failed:", e);
      setError("연결에 실패했습니다 (" + (e && e.code ? e.code : "알 수 없는 오류") + "). Firebase 설정을 확인하고 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCreate() {
    const clean = sanitizeCode(value);
    if (!clean || !founderPasswordNew.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await onCreateCode(clean, viewerPasswordNew, founderPasswordNew);
      if (!result.ok) {
        if (result.reason === "code-taken") setError("이미 사용 중인 코드예요. 개설자 전용 비밀번호가 다릅니다.");
        else setError("코드를 만들지 못했습니다. 다시 시도해 주세요.");
      }
    } catch (e) {
      console.error("create code failed:", e);
      setError("연결에 실패했습니다 (" + (e && e.code ? e.code : "알 수 없는 오류") + "). Firebase 설정을 확인하고 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRequestSubmit() {
    if (!name.trim() || !reqCode.trim() || !reqPassword.trim()) return;
    setBusy(true);
    setFormError("");
    try {
      const result = await onRequestAccess({ name, code: reqCode, password: reqPassword, wantsEdit });
      if (!result.ok) {
        if (result.reason === "bad-code") setFormError("존재하지 않는 코드입니다.");
        else if (result.reason === "no-password-set") setFormError("이 코드는 아직 조회 비밀번호가 설정되어 있지 않습니다. 개설자에게 문의해 주세요.");
        else if (result.reason === "bad-password") setFormError("조회 비밀번호가 올바르지 않습니다.");
        else setFormError("신청을 처리하지 못했습니다. 다시 시도해 주세요.");
      }
    } catch (e) {
      console.error("access request failed:", e);
      setFormError("연결에 실패했습니다 (" + (e && e.code ? e.code : "알 수 없는 오류") + "). Firebase 설정을 확인하고 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const shellStyle = {
    "--bg": "#0A0B0D",
    "--surface": "#121418",
    "--surface-2": "#1A1D22",
    "--ink": "#F4F5F7",
    "--ink-2": "#A3A8B1",
    "--muted": "#6B717B",
    "--line": "#22252B",
    "--line-2": "#30343C",
    "--grad": "linear-gradient(100deg, #FF9570 0%, #E48AC4 50%, #9E86FF 100%)",
    "--accent": "#FF9570",
    "--accent-2": "#9E86FF",
    "--good": "#3DD68C",
    "--warn": "#FFD23F",
    "--danger": "#D92D4A",
    "--gold-500": "#C9A227",
    "--gold-300": "#E4C765",
    fontFamily: "'IBM Plex Sans KR', sans-serif",
    background: "linear-gradient(160deg, var(--surface), var(--bg) 70%)",
    minHeight: "100vh",
  };
  const inputStyle = { border: "1px solid var(--line)" };

  if (mode === "notice") {
    return (
      <div style={shellStyle} className="w-full flex items-center justify-center px-4 py-8 md:py-16">
        <style>{`.lb-title { font-family: 'Archivo', sans-serif; font-style: italic; font-weight: 900; letter-spacing: -0.03em; } input:not([type=checkbox]):not([type=file]), select, textarea { background-color: var(--surface-2); color: var(--ink); border-color: var(--line); font-family: 'IBM Plex Sans KR', sans-serif; }`}</style>
        <div className="w-full rounded-2xl p-6 md:p-8" style={{ maxWidth: 440, backgroundColor: "var(--surface)" }}>
          <h2 className="lb-title text-xl mb-3" style={{ color: "var(--ink)" }}>
            접근 신청 안내
          </h2>
          <ul className="text-sm mb-4 flex flex-col gap-2" style={{ color: "var(--ink)" }}>
            <li>개설자에게 안내받은 <b>코드</b>와 <b>조회 비밀번호</b>를 정확히 입력해야 합니다.</li>
            <li>기본으로 부여되는 권한은 <b>조회 전용</b>입니다. 명단·기록을 입력·수정하려면 아래에서 <b>수정 권한도 함께 신청</b>할 수 있고, 이 경우 개설자의 승인이 필요합니다.</li>
            <li>신청 시 입력한 이름은 개설자가 구성원을 파악하는 용도로 쓰이며, 개설자는 언제든 접근을 취소할 수 있습니다.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm mb-4" style={{ color: "var(--ink)" }}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" />
            위 내용을 확인했습니다.
          </label>
          <div className="flex justify-between">
            <button onClick={() => setMode("code")} className="px-4 py-2 rounded-md text-sm font-medium" style={{ color: "var(--ink-2)" }}>
              돌아가기
            </button>
            <button
              onClick={() => setMode("form")}
              disabled={!agree}
              className="px-4 py-2 rounded-md text-sm font-medium"
              style={{ backgroundColor: "var(--ink)", color: "var(--bg)", opacity: agree ? 1 : 0.5 }}
            >
              다음
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "form") {
    return (
      <div style={shellStyle} className="w-full flex items-center justify-center px-4 py-8 md:py-16">
        <style>{`.lb-title { font-family: 'Archivo', sans-serif; font-style: italic; font-weight: 900; letter-spacing: -0.03em; } .lb-mono { font-family: 'JetBrains Mono', monospace; } input:not([type=checkbox]):not([type=file]), select, textarea { background-color: var(--surface-2); color: var(--ink); border-color: var(--line); font-family: 'IBM Plex Sans KR', sans-serif; }`}</style>
        <div className="w-full rounded-2xl p-6 md:p-8" style={{ maxWidth: 420, backgroundColor: "var(--surface)" }}>
          <h2 className="lb-title text-xl mb-1" style={{ color: "var(--ink)" }}>
            접근 신청
          </h2>
          <p className="text-sm mb-4" style={{ color: "var(--ink-2)" }}>
            개설자에게 안내받은 코드와 조회 비밀번호를 입력해 주세요.
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="이름 (예: 2학년 3반 김민준)"
            className="w-full px-3 py-2.5 rounded-md text-sm outline-none mb-2"
            style={inputStyle}
          />
          <input
            value={reqCode}
            onChange={(e) => setReqCode(e.target.value)}
            placeholder="코드"
            className="w-full px-3 py-2.5 rounded-md text-sm outline-none mb-2 lb-mono"
            style={inputStyle}
          />
          <input
            type="password"
            value={reqPassword}
            onChange={(e) => setReqPassword(e.target.value)}
            placeholder="조회 비밀번호"
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim() && reqCode.trim() && reqPassword.trim()) handleRequestSubmit();
            }}
            className="w-full px-3 py-2.5 rounded-md text-sm outline-none mb-2"
            style={inputStyle}
          />
          <label className="flex items-start gap-2 text-sm mb-3" style={{ color: "var(--ink)" }}>
            <input type="checkbox" checked={wantsEdit} onChange={(e) => setWantsEdit(e.target.checked)} className="mt-0.5" />
            명단·기록을 입력·수정할 권한도 필요합니다 (개설자 승인 필요)
          </label>
          {formError && (
            <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>
              {formError}
            </p>
          )}
          <div className="flex justify-between">
            <button onClick={() => setMode("notice")} className="px-4 py-2 rounded-md text-sm font-medium" style={{ color: "var(--ink-2)" }}>
              이전
            </button>
            <button
              onClick={handleRequestSubmit}
              disabled={!name.trim() || !reqCode.trim() || !reqPassword.trim() || busy}
              className="px-4 py-2 rounded-md text-sm font-medium"
              style={{ backgroundColor: "var(--ink)", color: "var(--bg)", opacity: busy ? 0.6 : 1 }}
            >
              {busy ? "확인 중..." : wantsEdit ? "신청하기" : "확인하기"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={shellStyle} className="w-full flex items-center justify-center px-4 py-8 md:py-16">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:ital,wght@0,700..900;1,700..900&family=IBM+Plex+Sans+KR:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600;700&display=swap');
        .lb-title { font-family: 'Archivo', sans-serif; font-style: italic; font-weight: 900; letter-spacing: -0.03em; }
        .lb-mono { font-family: 'JetBrains Mono', monospace; }
        input:not([type=checkbox]):not([type=file]), select, textarea { background-color: var(--surface-2); color: var(--ink); border-color: var(--line); font-family: 'IBM Plex Sans KR', sans-serif; }
      `}</style>
      <div className="w-full rounded-2xl p-6 md:p-8" style={{ maxWidth: 420, backgroundColor: "var(--surface)" }}>
        <div className="flex justify-center mb-3">
          <TrophyEmblem size={64} />
        </div>
        <h1
          className="lb-title text-2xl text-center mb-1 tracking-wide"
          style={{
            color: "#F4F5F7",
            background: "linear-gradient(100deg, #FF9570 0%, #E48AC4 50%, #9E86FF 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          P.E SCORE LEADERBOARD
        </h1>
        <p className="text-sm text-center mb-5" style={{ color: "var(--ink-2)" }}>
          수업, 행사에서 개인, 팀, 반의 성적을 빔프로젝터, 화면, 모바일로 공유할 수 있어요.
        </p>

        <button
          onClick={() => setShowGuide(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold mb-6 whitespace-nowrap"
          style={{
            background: "var(--grad)",
            color: "var(--ink)",
            boxShadow: "0 4px 14px rgba(201,162,39,0.35)",
          }}
        >
          <BookOpen size={16} />
          사용설명서 — 이렇게 활용해보세요
          <Sparkles size={14} />
        </button>

        <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
          코드
        </label>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim() && !createOpen) handleLogin();
          }}
          placeholder="예: 3반체육왕2026"
          className="w-full px-3 py-2.5 rounded-md text-sm outline-none mb-3 lb-mono"
          style={inputStyle}
        />

        {!createOpen && (
          <>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
              개설자 전용 비밀번호
            </label>
            <div className="flex gap-1.5 mb-3">
              <input
                type={showFounderPassword ? "text" : "password"}
                value={founderPassword}
                onChange={(e) => setFounderPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && value.trim()) handleLogin();
                }}
                className="flex-1 min-w-0 px-3 py-2.5 rounded-md text-sm outline-none"
                style={inputStyle}
              />
              <button onClick={() => setShowFounderPassword((v) => !v)} className="px-3 rounded-md text-xs whitespace-nowrap flex-shrink-0" style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}>
                {showFounderPassword ? "숨기기" : "보기"}
              </button>
            </div>
            {error && (
              <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}
            <button
              onClick={handleLogin}
              disabled={!value.trim() || !founderPassword.trim() || busy}
              className="w-full px-4 py-2.5 rounded-md text-sm font-medium mb-3"
              style={{ backgroundColor: "var(--ink)", color: "var(--bg)", opacity: value.trim() && founderPassword.trim() ? 1 : 0.5 }}
            >
              {busy ? "확인 중..." : "개설자로 로그인"}
            </button>

            <button onClick={() => setMode("notice")} className="w-full text-sm mb-3" style={{ color: "var(--accent)" }}>
              동료 선생님이신가요? 접근 신청 →
            </button>

            <div className="my-3" style={{ borderTop: "1px solid var(--line)" }} />

            <button
              onClick={() => {
                setCreateOpen(true);
                setError("");
              }}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-md text-sm font-medium"
              style={{ border: "1px solid var(--line)", color: "var(--ink)" }}
            >
              <Plus size={15} /> 처음이신가요? 새 코드 만들기
            </button>
          </>
        )}

        {createOpen && (
          <>
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
              조회 비밀번호 (동료 선생님께 안내할 비밀번호, 선택)
            </label>
            <input
              value={viewerPasswordNew}
              onChange={(e) => setViewerPasswordNew(e.target.value)}
              placeholder="비워두면 동료의 접근 신청 자체가 꺼집니다"
              className="w-full px-3 py-2.5 rounded-md text-sm outline-none mb-3"
              style={inputStyle}
            />
            <label className="block text-xs font-medium mb-1" style={{ color: "var(--ink-2)" }}>
              개설자 전용 비밀번호 (본인만 알아야 해요)
            </label>
            <div className="flex gap-1.5 mb-1">
              <input
                type={showFounderPasswordNew ? "text" : "password"}
                value={founderPasswordNew}
                onChange={(e) => setFounderPasswordNew(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && value.trim()) handleCreate();
                }}
                className="flex-1 min-w-0 px-3 py-2.5 rounded-md text-sm outline-none"
                style={inputStyle}
              />
              <button onClick={() => setShowFounderPasswordNew((v) => !v)} className="px-3 rounded-md text-xs whitespace-nowrap flex-shrink-0" style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}>
                {showFounderPasswordNew ? "숨기기" : "보기"}
              </button>
            </div>
            <p className="text-xs mb-3" style={{ color: "var(--ink-2)" }}>
              다른 기기에서 이 코드와 이 비밀번호를 입력하면 승인 절차 없이 바로 개설자로 들어올 수 있어요. 동료 교사에게는 알려주지 마세요.
            </p>
            {error && (
              <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>
                {error}
              </p>
            )}
            <button
              onClick={handleCreate}
              disabled={!value.trim() || !founderPasswordNew.trim() || busy}
              className="w-full px-4 py-2.5 rounded-md text-sm font-medium mb-3"
              style={{ backgroundColor: "var(--ink)", color: "var(--bg)", opacity: value.trim() && founderPasswordNew.trim() ? 1 : 0.5 }}
            >
              {busy ? "만드는 중..." : "코드 만들기"}
            </button>
            <button onClick={() => setCreateOpen(false)} className="w-full text-sm" style={{ color: "var(--ink-2)" }}>
              ← 코드로 로그인 화면으로 돌아가기
            </button>
          </>
        )}
      </div>

      {showGuide && (
        <InfoModal title="사용설명서" icon={BookOpen} onClose={() => setShowGuide(false)}>
          <div className="mb-6">
            <h3 className="lb-title text-base mb-3 flex items-center gap-1.5" style={{ color: "var(--ink)" }}>
              <Sparkles size={16} style={{ color: "var(--accent)" }} /> 이런 곳에 활용해보세요
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {[
                { title: "학교스포츠클럽 리그전", desc: "종목별 승점을 누적해 시즌 최다 승점자를 가려요." },
                { title: "체육대회 종합 순위", desc: "개인전·단체전 점수를 한 화면에서 실시간 집계해요." },
                { title: "체육수업 미니 게임", desc: "한 차시 안에서 팀별 승점을 즉석으로 매기고 보여줘요." },
                { title: "학급 대항전", desc: "반별 대표가 각자 태블릿으로 입력하고 함께 관리해요." },
                { title: "방과후 스포츠클럽", desc: "시즌 내내 누적 기록을 쌓아 학기말 시상까지 이어가요." },
                { title: "빔프로젝터 전광판", desc: "리더보드 탭만 띄워 강당·운동장 대형 화면으로 공유해요." },
              ].map((item) => (
                <div key={item.title} className="rounded-lg p-3" style={{ backgroundColor: "var(--surface-2)" }}>
                  <div className="text-sm font-semibold mb-0.5" style={{ color: "var(--ink)" }}>
                    {item.title}
                  </div>
                  <div className="text-xs" style={{ color: "var(--ink-2)" }}>
                    {item.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="lb-title text-base mb-3 flex items-center gap-1.5" style={{ color: "var(--ink)" }}>
              <ListChecks size={16} style={{ color: "var(--accent)" }} /> 4단계로 시작하기
            </h3>
            <div className="flex flex-col gap-3">
              {[
                { n: 1, title: "코드 만들기", desc: "원하는 코드(예: 3반체육왕2026)와 비밀번호 두 개(개설자 전용 / 조회용)를 정해 새 코드를 만들어요. 이 코드로 어떤 기기에서든 같은 데이터를 이어서 관리해요." },
                { n: 2, title: "명단 등록", desc: "'명단 관리' 탭에서 학생을 엑셀로 한 번에 올리거나 직접 추가해요(엑셀을 다시 올려도 같은 학년·반·번호는 중복되지 않아요). 이름은 이 기기에만 저장되니, 다른 기기에서 열 땐 그 기기에서 한 번 더 등록하거나 '이름표 가져오기'로 옮겨오세요." },
                { n: 3, title: "경기 기록", desc: "'경기 기록' 탭에서 날짜·종목을 고르고 참가자를 체크해 결과를 입력해요. '전체 승/무/패' 버튼으로 한 팀 전체를 한 번에 처리하거나, '직접 입력'으로 특정 학생에게만 점수를 따로 줄 수도 있어요." },
                { n: 4, title: "리더보드 공유", desc: "'리더보드' 탭이 자동으로 순위를 계산해요. 화면 위 '빔프로젝터 고정' 버튼을 누르면 리더보드만 크게 보이고 다른 조작이 잠기는 화면으로 바뀌어, 빔프로젝터나 모바일로 안전하게 띄워 보여줄 수 있어요. 되돌아오려면 개설자 비밀번호가 필요해요." },
              ].map((s) => (
                <div key={s.n} className="flex gap-3">
                  <div
                    className="lb-mono flex items-center justify-center rounded-full flex-shrink-0 font-semibold"
                    style={{ width: 26, height: 26, backgroundColor: "var(--ink)", color: "var(--bg)", fontSize: 13 }}
                  >
                    {s.n}
                  </div>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
                      {s.title}
                    </div>
                    <div className="text-xs mt-0.5" style={{ color: "var(--ink-2)" }}>
                      {s.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-4 text-xs flex flex-col gap-1.5" style={{ borderTop: "1px solid var(--line)", color: "var(--ink-2)" }}>
            <p>동료 선생님과 함께 관리하려면, 코드와 조회 비밀번호를 안내해 "접근 신청"으로 들어오게 하세요. 명단·기록 수정까지 맡기려면 신청 시 "수정 권한도 필요합니다"에 체크하도록 안내하면, 개설자가 승인한 뒤 함께 입력할 수 있어요.</p>
            <p>학생 이름은 서버가 아닌 각 기기에만 저장돼요. 여러 기기를 쓴다면 설정 탭의 "이름표 내보내기/가져오기"로 이름을 옮길 수 있습니다.</p>
          </div>
        </InfoModal>
      )}
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null); // { workspaceCode, role, myName }
  const [lastCode, setLastCode] = useState(null);
  const [deviceId, setDeviceId] = useState(null);
  const [gateLoading, setGateLoading] = useState(true);
  const [showIntro, setShowIntro] = useState(() => {
    try {
      return !sessionStorage.getItem(INTRO_SESSION_KEY);
    } catch (e) {
      return true;
    }
  });

  function dismissIntro() {
    setShowIntro(false);
    try {
      sessionStorage.setItem(INTRO_SESSION_KEY, "1");
    } catch (e) {
      // ignore
    }
  }

  useEffect(() => {
    const code = getLocal(LAST_CODE_KEY);
    if (code) setLastCode(code);

    let id = getLocal(DEVICE_ID_KEY);
    if (!id) {
      id = uid("device");
      setLocal(DEVICE_ID_KEY, id);
    }
    setDeviceId(id);
    setGateLoading(false);
  }, []);

  function enterAs(code, role, myName) {
    setSession({ workspaceCode: code, role, myName });
    setLocal(LAST_CODE_KEY, code);
    setLocal(LAST_NAME_KEY, myName);
  }

  async function handleFounderLogin(code, founderPassword) {
    const cfg = await readWorkspaceConfig(code);
    if (!cfg) return { ok: false, reason: "bad-code" };
    if (!cfg.founderPassword || cfg.founderPassword !== founderPassword.trim()) return { ok: false, reason: "bad-password" };
    enterAs(code, "founder", "개설자");
    return { ok: true };
  }

  async function handleCreateCode(code, viewerPassword, founderPassword) {
    const existing = await readWorkspaceConfig(code);
    if (existing) {
      if (existing.founderPassword === founderPassword.trim()) {
        enterAs(code, "founder", "개설자");
        return { ok: true };
      }
      return { ok: false, reason: "code-taken" };
    }
    const cfg = { viewerPassword: viewerPassword.trim(), founderPassword: founderPassword.trim(), createdAt: Date.now(), accessList: [] };
    await writeWorkspaceConfig(code, cfg);
    enterAs(code, "founder", "개설자");
    return { ok: true };
  }

  async function handleRequestAccess({ name, code, password, wantsEdit }) {
    const clean = sanitizeCode(code);
    const cfg = await readWorkspaceConfig(clean);
    if (!cfg) return { ok: false, reason: "bad-code" };
    if (!cfg.viewerPassword) return { ok: false, reason: "no-password-set" };
    if (cfg.viewerPassword !== password.trim()) return { ok: false, reason: "bad-password" };

    const list = (cfg.accessList || []).filter((a) => a.id !== deviceId);
    const existing = (cfg.accessList || []).find((a) => a.id === deviceId);
    let entry;
    if (existing && existing.status !== "denied") {
      entry = existing;
      list.push(entry);
    } else {
      entry = {
        id: deviceId,
        name: name.trim(),
        type: wantsEdit ? "editor" : "viewer",
        status: wantsEdit ? "pending" : "approved",
        submittedAt: Date.now(),
      };
      list.push(entry);
      await writeWorkspaceConfig(clean, { ...cfg, accessList: list });
    }
    const role = entry.status === "approved" ? entry.type : "pending";
    enterAs(clean, role, entry.name);
    return { ok: true };
  }

  async function refreshRole() {
    if (!session || session.role === "founder") return;
    const cfg = await readWorkspaceConfig(session.workspaceCode);
    if (!cfg) {
      setSession(null);
      return;
    }
    const entry = (cfg.accessList || []).find((a) => a.id === deviceId);
    if (!entry || entry.status === "denied") {
      setSession(null);
      return;
    }
    const role = entry.status === "approved" ? entry.type : "pending";
    setSession((prev) => (prev && prev.role !== role ? { ...prev, role } : prev));
  }

  function leaveWorkspace() {
    setSession(null);
  }

  if (gateLoading) {
    return <div style={{ minHeight: "100vh", backgroundColor: "#0B1B33" }} />;
  }
  return (
    <>
      {!session ? (
        <WorkspaceGate
          lastCode={lastCode}
          onFounderLogin={handleFounderLogin}
          onCreateCode={handleCreateCode}
          onRequestAccess={handleRequestAccess}
        />
      ) : (
        <Dashboard
          workspaceCode={session.workspaceCode}
          onLeaveWorkspace={leaveWorkspace}
          role={session.role}
          myName={session.myName}
          deviceId={deviceId}
          onRefreshRole={refreshRole}
        />
      )}
      {showIntro && <IntroSplash onDone={dismissIntro} />}
    </>
  );
}
