import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Plus,
  ChevronRight,
  ChevronLeft,
  TrendingUp,
  Check,
  X,
  Dumbbell,
  Calendar as CalendarIcon,
  Settings,
  Utensils,
  Home,
  Flame,
  Pencil,
  Trash2,
  Clock,
  Square,
  Search,
} from "lucide-react";

// ── 저장소 자동 감지: Claude 아티팩트 환경이면 window.storage,
//    실제 배포 환경(GitHub Pages 등)이면 localStorage 사용 ──
const storage = {
  async get(key) {
    if (typeof window !== "undefined" && window.storage && window.storage.get) {
      return window.storage.get(key, false);
    }
    try {
      const v = window.localStorage.getItem(key);
      return v !== null ? { key, value: v } : null;
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    if (typeof window !== "undefined" && window.storage && window.storage.set) {
      return window.storage.set(key, value, false);
    }
    try {
      window.localStorage.setItem(key, value);
      return { key, value };
    } catch (e) {
      return null;
    }
  },
};

// ── 색 토큰: 산화철 파워리프팅 ─────────────────────────
const BG = "#1A1817";
const SURFACE = "#242120";
const SURFACE_ALT = "#2E2A28";
const TEXT = "#F2EDE9";
const MUTED = "#9C9490";
const ACCENT = "#C1502E"; // 러스트오렌지 - PUSH / 주요 액션
const PULL_COLOR = "#7A8C93"; // 스틸 블루그레이 - PULL
const LEGS_COLOR = "#B8860B"; // 브라스 골드 - LEGS
const CARDIO_COLOR = "#D9C9B8"; // 웜 크림 - 유산소 표시
const DANGER = "#D9534F";

const SPLIT_COLORS = { PUSH: ACCENT, PULL: PULL_COLOR, LEGS: LEGS_COLOR };
const SPLIT_LABELS = { PUSH: "PUSH", PULL: "PULL", LEGS: "LEGS+CORE" }; // 내부 키는 LEGS 유지 (기존 데이터 호환), 표시만 변경
const SPLITS = ["PUSH", "PULL", "LEGS"];
const CARDIO_TYPES = ["러닝", "사이클", "로잉", "줄넘기", "스텝퍼", "기타"];

const STORAGE_KEY = "sacobot-workout-log";
const SETTINGS_KEY = "sacobot-workout-settings";
const FOOD_LOG_KEY = "sacobot-food-log";
const FOOD_PROXY_URL = "https://saco-fit-food-proxy.rldhkd0202.workers.dev/";
const MEAL_TYPES = ["아침", "점심", "저녁", "간식"];
const TARGET_REPS_LOW = 8;
const TARGET_REPS_HIGH = 12;
const WEIGHT_STEP = 2.5;
const WEIGHT_STEP_LBS = 5;
const LBS_TO_KG = 0.453592;

function toKg(weight, unit) {
  return unit === "lbs" ? weight * LBS_TO_KG : weight;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatDuration(ms) {
  if (ms == null || ms < 0) return "0:00";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}

// 종목명으로 체중 반영 비율 기본값을 추정 (연구 기반 근사치, 사용자가 직접 조정 가능)
const BW_PERCENT_PRESETS = [
  { keywords: ["니푸시업", "무릎푸시업", "knee push"], percent: 50 },
  { keywords: ["인클라인푸시업", "incline push"], percent: 40 },
  { keywords: ["디클라인푸시업", "decline push", "발높은푸시업"], percent: 73 },
  { keywords: ["푸시업", "push up", "push-up", "pushup"], percent: 65 },
  { keywords: ["딥스", "dip"], percent: 100 },
  { keywords: ["풀업", "친업", "pull up", "pull-up", "chin up", "chinup"], percent: 100 },
  { keywords: ["인버티드", "inverted row"], percent: 72 },
];

function guessBwPercent(name) {
  const n = name.toLowerCase().replace(/\s/g, "");
  for (const preset of BW_PERCENT_PRESETS) {
    if (preset.keywords.some((k) => n.includes(k.replace(/\s/g, "")))) return preset.percent;
  }
  return 100;
}

// ── 유산소 칼로리 자동 계산 (METs 기반, ACSM 공식 근사) ────
function walkOrRunMET(speedKmh) {
  const speedMmin = speedKmh * (1000 / 60);
  if (speedKmh < 6.5) {
    // 걷기 공식
    return Math.max((0.1 * speedMmin + 3.5) / 3.5, 2);
  }
  // 달리기 공식
  return (0.2 * speedMmin + 3.5) / 3.5;
}

function cycleMET(speedKmh) {
  if (speedKmh < 16) return 4;
  if (speedKmh < 19) return 6;
  if (speedKmh < 22) return 8;
  if (speedKmh < 25) return 10;
  if (speedKmh < 30) return 12;
  return 15.8;
}

function estimateMET(type, minutes, distanceKm) {
  const speedKmh = distanceKm && distanceKm > 0 && minutes > 0 ? distanceKm / (minutes / 60) : null;
  switch (type) {
    case "러닝":
      return speedKmh ? walkOrRunMET(speedKmh) : 8; // 페이스 없으면 조깅 평균치
    case "사이클":
      return speedKmh ? cycleMET(speedKmh) : 7;
    case "로잉":
      return 7;
    case "줄넘기":
      return 11;
    case "스텝퍼":
      return 9;
    default:
      return 6;
  }
}

function estimateCalories(type, minutes, distanceKm, bodyweightKg) {
  if (!minutes || minutes <= 0 || !bodyweightKg) return null;
  const met = estimateMET(type, minutes, distanceKm);
  return Math.round(met * bodyweightKg * (minutes / 60));
}

// ── 근력운동 소모 칼로리 추정 (세트 수 기반 시간 추정 + 체중 대비 무게·반복수 기반 강도 MET) ──
const SECONDS_PER_SET = 180; // 세트당 평균 수행+휴식 시간 추정치 (3분)

function setMET(effectiveKg, reps, bodyweightKg) {
  if (!bodyweightKg) {
    // 체중 정보가 없으면 반복수만으로 대략 추정 (정확도 낮음)
    if (reps <= 5) return 6.0;
    if (reps <= 12) return 5.0;
    return 4.0;
  }
  const relLoad = effectiveKg / bodyweightKg; // 체중 대비 무게 비율
  if (relLoad < 0.15) return 3.5; // 가벼운 무게 - 반복수 상관없이 저강도 (예: 체중 70kg에 10kg×5회)
  if (relLoad >= 0.6 && reps <= 8) return 6.5; // 무겁고 저반복 - 고강도
  if (relLoad >= 0.3) return 5.0; // 중강도
  return 4.0; // 가벼운 편, 고반복 지구력성
}

function estimateStrengthCalories(setsFlat, bodyweightKg) {
  // setsFlat: [{reps, effectiveKg, durationSec}, ...] 그날 수행한 모든 세트 (종목 무관하게 펼친 배열)
  // durationSec: 실측 세트 소요시간(다음 세트까지 실제 걸린 시간). 없으면 SECONDS_PER_SET(3분)으로 대체
  if (!setsFlat || setsFlat.length === 0 || !bodyweightKg) return null;
  const total = setsFlat.reduce((sum, s) => {
    const hours = (s.durationSec != null ? s.durationSec : SECONDS_PER_SET) / 3600;
    return sum + setMET(s.effectiveKg, s.reps, bodyweightKg) * bodyweightKg * hours;
  }, 0);
  return Math.round(total);
}

function suggestNext(pastSets) {
  if (!pastSets || pastSets.length === 0) return null;
  const withKg = pastSets.map((s) => ({ ...s, kg: toKg(s.weight, s.unit || "kg") }));
  const maxKg = Math.max(...withKg.map((s) => s.kg));
  const topSets = withKg.filter((s) => Math.abs(s.kg - maxKg) < 0.001);
  const repsAtMax = Math.max(...topSets.map((s) => s.reps));
  const top = topSets[0];
  const unit = top.unit || "kg";
  const step = unit === "lbs" ? WEIGHT_STEP_LBS : WEIGHT_STEP;
  const unitLabel = unit === "lbs" ? "lbs" : "kg";

  if (repsAtMax >= TARGET_REPS_HIGH) {
    return {
      weight: top.weight + step,
      reps: TARGET_REPS_LOW,
      unit,
      reason: `지난번 ${top.weight}${unitLabel}에서 ${repsAtMax}회 성공 — 무게를 올려보세요`,
    };
  }
  if (repsAtMax >= TARGET_REPS_LOW) {
    return {
      weight: top.weight,
      reps: repsAtMax + 1,
      unit,
      reason: `지난번 ${top.weight}${unitLabel} × ${repsAtMax}회 — 반복수를 늘려보세요`,
    };
  }
  return {
    weight: top.weight,
    reps: repsAtMax,
    unit,
    reason: `지난번 ${top.weight}${unitLabel} × ${repsAtMax}회 — 같은 무게로 확실히 채워보세요`,
  };
}

export default function FitnessApp() {
  const [ready, setReady] = useState(false);
  const [entries, setEntries] = useState([]);
  const [cardio, setCardio] = useState([]);
  const [sessions, setSessions] = useState({}); // { [`${date}_${split}`]: {startedAt, endedAt} }
  const [foodLogs, setFoodLogs] = useState([]); // 식단 기록
  const [settings, setSettings] = useState({ bodyweight: null });

  // 내비게이션
  const [screen, setScreen] = useState("home"); // 'home' | 'workout' | 'nutrition'
  const [workoutView, setWorkoutView] = useState("log"); // 'log' | 'calendar' | 'detail'
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(null);
  const [logDate, setLogDate] = useState(() => todayStr()); // 'log' 화면이 기록하는 대상 날짜 (오늘 or 보강할 과거 날짜)

  // 로그 입력 상태
  const [split, setSplit] = useState("PUSH");
  const [exerciseInput, setExerciseInput] = useState("");
  const [activeExercise, setActiveExercise] = useState(null);
  const [weightInput, setWeightInput] = useState("");
  const [repsInput, setRepsInput] = useState("");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bodyweightInput, setBodyweightInput] = useState("");
  const [isBodyweight, setIsBodyweight] = useState(false);
  const [bwPercent, setBwPercent] = useState(100);
  const [unit, setUnit] = useState("kg");
  const [cardioType, setCardioType] = useState(CARDIO_TYPES[0]);
  const [cardioMinutes, setCardioMinutes] = useState("");
  const [cardioDistance, setCardioDistance] = useState("");
  const [cardioCalories, setCardioCalories] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [exerciseNameInput, setExerciseNameInput] = useState("");
  const [editingSetIndex, setEditingSetIndex] = useState(null);
  const [editWeightInput, setEditWeightInput] = useState("");
  const [editRepsInput, setEditRepsInput] = useState("");
  const [editingCardioId, setEditingCardioId] = useState(null);
  const [editCardioType, setEditCardioType] = useState(CARDIO_TYPES[0]);
  const [editCardioMinutes, setEditCardioMinutes] = useState("");
  const [editCardioDistance, setEditCardioDistance] = useState("");
  const [editCardioCalories, setEditCardioCalories] = useState("");

  // 식단 관리
  const [foodQuery, setFoodQuery] = useState("");
  const [foodResults, setFoodResults] = useState([]);
  const [foodSearching, setFoodSearching] = useState(false);
  const [foodSearchError, setFoodSearchError] = useState("");
  const [selectedFood, setSelectedFood] = useState(null); // 검색결과에서 고른 항목
  const [gramsInput, setGramsInput] = useState("100");
  const [mealType, setMealType] = useState(MEAL_TYPES[0]);

  useEffect(() => {
    (async () => {
      try {
        const res = await storage.get(STORAGE_KEY);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setEntries(parsed.entries || []);
          setCardio(parsed.cardio || []);
          setSessions(parsed.sessions || {});
        }
      } catch (e) {}
      try {
        const res2 = await storage.get(SETTINGS_KEY);
        if (res2 && res2.value) setSettings(JSON.parse(res2.value));
      } catch (e) {}
      try {
        const res3 = await storage.get(FOOD_LOG_KEY);
        if (res3 && res3.value) setFoodLogs(JSON.parse(res3.value).logs || []);
      } catch (e) {
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persistFoodLogs = useCallback(async (nextLogs) => {
    try {
      await storage.set(FOOD_LOG_KEY, JSON.stringify({ logs: nextLogs }), false);
    } catch (e) {
      setError("식단 저장에 실패했습니다.");
    }
  }, []);

  const persist = useCallback(async (nextEntries, nextCardio, nextSessions) => {
    try {
      await storage.set(
        STORAGE_KEY,
        JSON.stringify({ entries: nextEntries, cardio: nextCardio, sessions: nextSessions }),
        false
      );
    } catch (e) {
      setError("저장에 실패했습니다. 네트워크를 확인해주세요.");
    }
  }, []);

  const persistSettings = useCallback(async (next) => {
    try {
      await storage.set(SETTINGS_KEY, JSON.stringify(next), false);
    } catch (e) {
      setError("설정 저장에 실패했습니다.");
    }
  }, []);

  const saveBodyweight = async () => {
    const bw = parseFloat(bodyweightInput);
    if (!bw || bw <= 0) {
      setError("체중을 정확히 입력해주세요.");
      return;
    }
    setError("");
    const next = { ...settings, bodyweight: bw };
    setSettings(next);
    await persistSettings(next);
    setSettingsOpen(false);
  };

  const isToday = logDate === todayStr();
  const sessionKey = `${logDate}_${split}`;
  const session = sessions[sessionKey] || null;
  const sessionRunning = !!(session && session.startedAt && !session.endedAt);

  const [sectionOpenedAt, setSectionOpenedAt] = useState(null); // 현재 연 종목의 라이브 타이머 시작 시각 (비영속)
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sessionRunning && !sectionOpenedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sessionRunning, sectionOpenedAt]);

  const startSession = async () => {
    const nextSessions = { ...sessions, [sessionKey]: { startedAt: Date.now(), endedAt: null } };
    setSessions(nextSessions);
    await persist(entries, cardio, nextSessions);
  };

  const endSession = async () => {
    if (!session) return;
    const nextSessions = { ...sessions, [sessionKey]: { ...session, endedAt: Date.now() } };
    setSessions(nextSessions);
    setSectionOpenedAt(null);
    setActiveExercise(null);
    await persist(entries, cardio, nextSessions);
  };

  const todaysEntries = useMemo(
    () => entries.filter((e) => e.date === logDate && e.split === split),
    [entries, split, logDate]
  );

  const recentNamesForSplit = useMemo(() => {
    const names = [];
    for (const e of entries) {
      if (e.split === split && !names.includes(e.exercise)) names.push(e.exercise);
      if (names.length >= 8) break;
    }
    return names;
  }, [entries, split]);

  const lastSessionFor = useCallback(
    (exerciseName) => {
      const past = entries
        .filter((e) => e.exercise === exerciseName && e.date < logDate)
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      return past[0] || null;
    },
    [entries, logDate]
  );

  const openExercise = (name) => {
    if (!name.trim()) return;
    const trimmed = name.trim();
    setActiveExercise(trimmed);
    setExerciseInput("");
    setEditingSetIndex(null);
    const prevWithFlag = entries
      .filter((e) => e.exercise === trimmed && typeof e.bodyweight === "boolean")
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    if (prevWithFlag) {
      setIsBodyweight(prevWithFlag.bodyweight);
      setBwPercent(prevWithFlag.bwPercent || guessBwPercent(trimmed));
    } else {
      setIsBodyweight(false);
      setBwPercent(guessBwPercent(trimmed));
    }
    const prevEntry = entries
      .filter((e) => e.exercise === trimmed)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const lastUnit =
      prevEntry && prevEntry.sets.length > 0 ? prevEntry.sets[prevEntry.sets.length - 1].unit : null;
    setUnit(lastUnit || "kg");
    setSectionOpenedAt(sessionRunning ? Date.now() : null);
  };

  const updateSet = async () => {
    const w = parseFloat(editWeightInput);
    const r = parseInt(editRepsInput, 10);
    if (r === undefined || isNaN(r) || r <= 0) {
      setError("횟수를 정확히 입력해주세요.");
      return;
    }
    if (!currentEntry) return;
    const isBw = currentEntry.bodyweight;
    if (!isBw && (isNaN(w) || w <= 0)) {
      setError("무게를 정확히 입력해주세요.");
      return;
    }
    setError("");
    const nextEntries = entries.map((e) =>
      e.id === currentEntry.id
        ? {
            ...e,
            sets: e.sets.map((s, i) =>
              i === editingSetIndex ? { ...s, weight: isNaN(w) ? 0 : w, reps: r } : s
            ),
          }
        : e
    );
    setEntries(nextEntries);
    setEditingSetIndex(null);
    await persist(nextEntries, cardio, sessions);
  };

  const deleteSet = async (index) => {
    if (!currentEntry) return;
    const nextSets = currentEntry.sets.filter((_, i) => i !== index);
    let nextEntries;
    if (nextSets.length === 0) {
      nextEntries = entries.filter((e) => e.id !== currentEntry.id);
    } else {
      nextEntries = entries.map((e) => (e.id === currentEntry.id ? { ...e, sets: nextSets } : e));
    }
    setEntries(nextEntries);
    setEditingSetIndex(null);
    await persist(nextEntries, cardio, sessions);
  };

  const updateCardio = async () => {
    const mins = parseInt(editCardioMinutes, 10);
    if (!mins || mins <= 0) {
      setError("운동 시간(분)을 정확히 입력해주세요.");
      return;
    }
    setError("");
    const dist = parseFloat(editCardioDistance);
    const manualCal = parseInt(editCardioCalories, 10);
    const autoCal = estimateCalories(editCardioType, mins, dist > 0 ? dist : 0, settings.bodyweight);
    const finalCal = manualCal > 0 ? manualCal : autoCal;
    const nextCardio = cardio.map((c) =>
      c.id === editingCardioId
        ? {
            ...c,
            type: editCardioType,
            minutes: mins,
            distance: dist > 0 ? dist : null,
            calories: finalCal || null,
            autoCalories: !(manualCal > 0),
          }
        : c
    );
    setCardio(nextCardio);
    setEditingCardioId(null);
    await persist(entries, nextCardio, sessions);
  };

  const deleteCardio = async (id) => {
    const nextCardio = cardio.filter((c) => c.id !== id);
    setCardio(nextCardio);
    setEditingCardioId(null);
    await persist(entries, nextCardio, sessions);
  };

  const renameExercise = async () => {
    const newName = exerciseNameInput.trim();
    if (!newName || newName === activeExercise) {
      setEditingName(false);
      return;
    }
    const nextEntries = entries.map((e) =>
      e.exercise === activeExercise ? { ...e, exercise: newName } : e
    );
    setEntries(nextEntries);
    setActiveExercise(newName);
    setEditingName(false);
    await persist(nextEntries, cardio, sessions);
  };

  const effectiveWeight = useCallback(
    (set, entry) => {
      const addedKg = toKg(set.weight || 0, set.unit || "kg");
      if (entry.bodyweight) {
        const pct = (entry.bwPercent || 100) / 100;
        return (settings.bodyweight || 0) * pct + addedKg;
      }
      return addedKg;
    },
    [settings.bodyweight]
  );

  const entryVolume = useCallback(
    (entry) => entry.sets.reduce((sum, s) => sum + effectiveWeight(s, entry) * s.reps, 0),
    [effectiveWeight]
  );

  const timedSetsForEntry = useCallback(
    (entry) =>
      entry.sets.map((s, i) => {
        const next = entry.sets[i + 1];
        const durationSec = s.at && next && next.at ? (next.at - s.at) / 1000 : null;
        return { reps: s.reps, effectiveKg: effectiveWeight(s, entry), durationSec };
      }),
    [effectiveWeight]
  );

  const entryStrengthCalories = useCallback(
    (entry) => estimateStrengthCalories(timedSetsForEntry(entry), settings.bodyweight),
    [timedSetsForEntry, settings.bodyweight]
  );

  const formatSetLabel = useCallback((set, entry) => {
    const u = set.unit === "lbs" ? "lbs" : "kg";
    if (entry.bodyweight) {
      const added = set.weight || 0;
      const pct = entry.bwPercent || 100;
      const label = added > 0 ? `체중${pct}%+${added}${u}` : `체중${pct}%`;
      return `${label} × ${set.reps}회`;
    }
    return `${set.weight}${u} × ${set.reps}회`;
  }, []);

  const addSet = async () => {
    const w = parseFloat(weightInput);
    const r = parseInt(repsInput, 10);
    const effectiveW = isBodyweight ? (isNaN(w) ? 0 : w) : w;

    if (isBodyweight) {
      if (!r || r <= 0) {
        setError("횟수를 정확히 입력해주세요.");
        return;
      }
    } else if (!w || !r || w <= 0 || r <= 0) {
      setError("무게와 횟수를 정확히 입력해주세요.");
      return;
    }
    setError("");

    const date = logDate;
    const setAt = sessionRunning ? Date.now() : null;
    let nextEntries;
    const existingIdx = entries.findIndex(
      (e) => e.date === date && e.split === split && e.exercise === activeExercise
    );

    if (existingIdx >= 0) {
      nextEntries = entries.map((e, i) =>
        i === existingIdx
          ? {
              ...e,
              bodyweight: isBodyweight,
              bwPercent: isBodyweight ? bwPercent : undefined,
              sets: [...e.sets, { weight: effectiveW || 0, unit, reps: r, at: setAt }],
            }
          : e
      );
    } else {
      nextEntries = [
        ...entries,
        {
          id: `${date}-${split}-${activeExercise}-${Date.now()}`,
          date,
          split,
          exercise: activeExercise,
          bodyweight: isBodyweight,
          bwPercent: isBodyweight ? bwPercent : undefined,
          sets: [{ weight: effectiveW || 0, unit, reps: r, at: setAt }],
        },
      ];
    }
    setEntries(nextEntries);
    setWeightInput("");
    setRepsInput("");
    await persist(nextEntries, cardio, sessions);
  };

  const currentEntry = todaysEntries.find((e) => e.exercise === activeExercise);

  const repeatLastSet = async () => {
    if (!currentEntry || currentEntry.sets.length === 0) return;
    const last = currentEntry.sets[currentEntry.sets.length - 1];
    const date = logDate;
    const nextEntries = entries.map((e) =>
      e.date === date && e.split === split && e.exercise === activeExercise
        ? { ...e, sets: [...e.sets, { ...last }] }
        : e
    );
    setEntries(nextEntries);
    await persist(nextEntries, cardio, sessions);
  };

  const lastSession = activeExercise ? lastSessionFor(activeExercise) : null;
  const suggestion = lastSession ? suggestNext(lastSession.sets) : null;

  const todayAllEntries = useMemo(() => entries.filter((e) => e.date === logDate), [entries, logDate]);
  const todayVolume = useMemo(
    () => todayAllEntries.reduce((sum, e) => sum + entryVolume(e), 0),
    [todayAllEntries, entryVolume]
  );
  const todayStrengthCalories = useMemo(() => {
    const setsFlat = todayAllEntries.flatMap((e) => timedSetsForEntry(e));
    return estimateStrengthCalories(setsFlat, settings.bodyweight);
  }, [todayAllEntries, settings.bodyweight, timedSetsForEntry]);

  const todayCardio = useMemo(
    () => cardio.filter((c) => c.date === logDate && c.split === split),
    [cardio, split, logDate]
  );

  // ── 식단 관리 로직 ──────────────────────────────────
  const searchFood = async () => {
    const q = foodQuery.trim();
    if (!q) return;
    setFoodSearching(true);
    setFoodSearchError("");
    setFoodResults([]);
    setSelectedFood(null);
    try {
      const res = await fetch(`${FOOD_PROXY_URL}?food=${encodeURIComponent(q)}&limit=15`);
      const data = await res.json();
      if (data.error) {
        setFoodSearchError(data.error);
      } else {
        setFoodResults(data.results || []);
        if ((data.results || []).length === 0) setFoodSearchError("검색 결과가 없어요.");
      }
    } catch (e) {
      setFoodSearchError("검색 중 오류가 발생했어요. 네트워크를 확인해주세요.");
    } finally {
      setFoodSearching(false);
    }
  };

  const selectFood = (item) => {
    setSelectedFood(item);
    setGramsInput(String(item.realServingGrams || item.basisGrams || 100));
  };

  // 그람수 기준 스케일 = 입력한 그람 / 기준량(basisGrams, 보통 100g)
  const scaledFoodNutrientsByGrams = (item, grams) => {
    const scale = grams / item.basisGrams;
    const result = {};
    for (const [key, val] of Object.entries(item.nutrients || {})) {
      result[key] = Math.round(val * scale * 100) / 100;
    }
    return result;
  };

  const addFoodLog = async () => {
    const grams = parseFloat(gramsInput);
    if (!selectedFood || !grams || grams <= 0) {
      setFoodSearchError("섭취량(g)을 정확히 입력해주세요.");
      return;
    }
    setFoodSearchError("");
    const scaledNutrients = scaledFoodNutrientsByGrams(selectedFood, grams);
    const item = {
      id: `${todayStr()}-food-${Date.now()}`,
      date: todayStr(),
      meal: mealType,
      name: selectedFood.name,
      grams,
      nutrients: scaledNutrients,
      source: selectedFood.source,
    };
    const nextLogs = [...foodLogs, item];
    setFoodLogs(nextLogs);
    setSelectedFood(null);
    setFoodResults([]);
    setFoodQuery("");
    await persistFoodLogs(nextLogs);
  };

  const deleteFoodLog = async (id) => {
    const nextLogs = foodLogs.filter((f) => f.id !== id);
    setFoodLogs(nextLogs);
    await persistFoodLogs(nextLogs);
  };

  const todayFoodLogs = useMemo(
    () => foodLogs.filter((f) => f.date === todayStr()),
    [foodLogs]
  );

  const todayFoodTotals = useMemo(() => {
    const totals = { calorie_kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sodium_mg: 0 };
    for (const log of todayFoodLogs) {
      for (const key of Object.keys(totals)) {
        if (log.nutrients && log.nutrients[key] != null) totals[key] += log.nutrients[key];
      }
    }
    for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key] * 10) / 10;
    return totals;
  }, [todayFoodLogs]);

  const estimatedCalories = useMemo(
    () =>
      estimateCalories(
        cardioType,
        parseInt(cardioMinutes, 10) || 0,
        parseFloat(cardioDistance) || 0,
        settings.bodyweight
      ),
    [cardioType, cardioMinutes, cardioDistance, settings.bodyweight]
  );

  const addCardio = async () => {
    const mins = parseInt(cardioMinutes, 10);
    if (!mins || mins <= 0) {
      setError("운동 시간(분)을 정확히 입력해주세요.");
      return;
    }
    setError("");
    const dist = parseFloat(cardioDistance);
    const manualCal = parseInt(cardioCalories, 10);
    const autoCal = estimateCalories(cardioType, mins, dist > 0 ? dist : 0, settings.bodyweight);
    const finalCal = manualCal > 0 ? manualCal : autoCal;
    const item = {
      id: `${logDate}-${split}-cardio-${Date.now()}`,
      date: logDate,
      split,
      type: cardioType,
      minutes: mins,
      distance: dist > 0 ? dist : null,
      calories: finalCal || null,
      autoCalories: !(manualCal > 0),
    };
    const nextCardio = [...cardio, item];
    setCardio(nextCardio);
    setCardioMinutes("");
    setCardioDistance("");
    setCardioCalories("");
    await persist(entries, nextCardio, sessions);
  };

  // 날짜별 스플릿 맵 (캘린더용)
  const splitsByDate = useMemo(() => {
    const map = {};
    for (const e of entries) {
      if (!map[e.date]) map[e.date] = new Set();
      map[e.date].add(e.split);
    }
    return map;
  }, [entries]);

  const cardioByDate = useMemo(() => {
    const map = {};
    for (const c of cardio) map[c.date] = true;
    return map;
  }, [cardio]);

  const selectedDateEntries = useMemo(
    () => (selectedDate ? entries.filter((e) => e.date === selectedDate) : []),
    [entries, selectedDate]
  );

  const selectedDateCardio = useMemo(
    () => (selectedDate ? cardio.filter((c) => c.date === selectedDate) : []),
    [cardio, selectedDate]
  );

  if (!ready) {
    return (
      <div style={styles.loadingScreen}>
        <div style={styles.loadingText}>불러오는 중…</div>
      </div>
    );
  }

  // ── 홈 화면 ─────────────────────────────────────────
  if (screen === "home") {
    return (
      <div style={styles.app}>
        <div style={styles.homeHeader}>
          <div style={styles.homeTitle}>싸코 FIT</div>
          <div style={styles.homeSubtitle}>오늘도 무게를 짊어질 시간</div>
        </div>
        <div style={styles.homeBody}>
          <button
            style={styles.navCard}
            onClick={() => {
              setScreen("workout");
              setWorkoutView("log");
              setLogDate(todayStr());
              setActiveExercise(null);
            }}
          >
            <div style={{ ...styles.navCardIcon, background: "rgba(193,80,46,0.16)" }}>
              <Dumbbell size={26} color={ACCENT} />
            </div>
            <div style={styles.navCardTextWrap}>
              <div style={styles.navCardTitle}>운동 기록</div>
              <div style={styles.navCardDesc}>오늘 세트 기록 · 볼륨 · 히스토리</div>
            </div>
            <ChevronRight size={20} color={MUTED} />
          </button>

          <button style={styles.navCard} onClick={() => setScreen("nutrition")}>
            <div style={{ ...styles.navCardIcon, background: "rgba(122,140,147,0.16)" }}>
              <Utensils size={26} color={PULL_COLOR} />
            </div>
            <div style={styles.navCardTextWrap}>
              <span style={styles.navCardTitle}>식단 관리</span>
              <div style={styles.navCardDesc}>칼로리 · 단백질 · 영양성분 트래킹</div>
            </div>
            <ChevronRight size={20} color={MUTED} />
          </button>
        </div>
      </div>
    );
  }

  // ── 식단 관리 (스텁) ─────────────────────────────────
  if (screen === "nutrition") {
    return (
      <div style={styles.app}>
        <div style={styles.subHeader}>
          <button style={styles.backBtn} onClick={() => setScreen("home")}>
            <Home size={18} color={MUTED} />
          </button>
          <span style={styles.subHeaderTitle}>식단 관리</span>
        </div>

        <div style={styles.body}>
          <div style={styles.sectionLabelRow}>
            <span style={styles.sectionLabel}>오늘 섭취</span>
            <span style={styles.todayVolumeText}>
              {todayFoodTotals.calorie_kcal.toLocaleString()}kcal
            </span>
          </div>
          <div style={styles.macroSummaryRow}>
            <div style={styles.macroBox}>
              <div style={styles.macroValue}>{todayFoodTotals.protein_g}g</div>
              <div style={styles.macroLabel}>단백질</div>
            </div>
            <div style={styles.macroBox}>
              <div style={styles.macroValue}>{todayFoodTotals.carbs_g}g</div>
              <div style={styles.macroLabel}>탄수화물</div>
            </div>
            <div style={styles.macroBox}>
              <div style={styles.macroValue}>{todayFoodTotals.fat_g}g</div>
              <div style={styles.macroLabel}>지방</div>
            </div>
            <div style={styles.macroBox}>
              <div style={styles.macroValue}>{todayFoodTotals.sodium_mg}mg</div>
              <div style={styles.macroLabel}>나트륨</div>
            </div>
          </div>

          {todayFoodLogs.length > 0 && (
            <>
              {MEAL_TYPES.map((meal) => {
                const logs = todayFoodLogs.filter((f) => f.meal === meal);
                if (logs.length === 0) return null;
                return (
                  <div key={meal} style={{ marginBottom: 4 }}>
                    <div style={styles.mealLabel}>{meal}</div>
                    {logs.map((f) => (
                      <div key={f.id} style={styles.foodLogCard}>
                        <div style={{ flex: 1 }}>
                          <div style={styles.foodLogTitle}>
                            {f.name} <span style={styles.foodLogPortion}>× {f.grams}g</span>
                          </div>
                          <div style={styles.foodLogDesc}>
                            {f.nutrients.calorie_kcal ?? 0}kcal · 단백질{" "}
                            {f.nutrients.protein_g ?? 0}g · 탄수 {f.nutrients.carbs_g ?? 0}g · 지방{" "}
                            {f.nutrients.fat_g ?? 0}g
                          </div>
                        </div>
                        <button style={styles.foodDeleteBtn} onClick={() => deleteFoodLog(f.id)}>
                          <Trash2 size={14} color={DANGER} />
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </>
          )}

          <div style={styles.sectionLabel}>음식 검색</div>
          <div style={styles.addRow}>
            <input
              style={styles.input}
              placeholder="예: 김치찌개"
              value={foodQuery}
              onChange={(e) => setFoodQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchFood()}
            />
            <button style={styles.addBtn} onClick={searchFood}>
              <Search size={18} color={BG} />
            </button>
          </div>
          {foodSearching && <div style={styles.bwHint}>검색 중…</div>}
          {foodSearchError && <div style={styles.errorText}>{foodSearchError}</div>}

          {foodResults.length > 0 && !selectedFood && (
            <div style={{ marginTop: 10 }}>
              {foodResults.map((item, i) => {
                const per100 = scaledFoodNutrientsByGrams(item, item.basisGrams || 100);
                return (
                  <button key={i} style={styles.foodResultCard} onClick={() => selectFood(item)}>
                    <div style={{ flex: 1 }}>
                      <div style={styles.foodResultName}>{item.name}</div>
                      <div style={styles.foodResultDesc}>
                        {item.category} · {item.servingSize}당 {per100.calorie_kcal ?? "?"}kcal
                        {item.realServingGrams ? ` · 1인분 참고량 약 ${item.realServingGrams}g` : ""}
                      </div>
                    </div>
                    <ChevronRight size={16} color={MUTED} />
                  </button>
                );
              })}
            </div>
          )}

          {selectedFood && (
            <div style={styles.selectedFoodCard}>
              <div style={styles.selectedFoodHeader}>
                <div style={styles.foodResultName}>{selectedFood.name}</div>
                <button style={styles.backBtn} onClick={() => setSelectedFood(null)}>
                  <X size={16} color={MUTED} />
                </button>
              </div>
              <div style={styles.foodResultDesc}>
                {selectedFood.servingSize}당: {selectedFood.nutrients.calorie_kcal ?? "?"}kcal · 단백질{" "}
                {selectedFood.nutrients.protein_g ?? 0}g · 탄수 {selectedFood.nutrients.carbs_g ?? 0}g ·
                지방 {selectedFood.nutrients.fat_g ?? 0}g
              </div>
              {selectedFood.realServingGrams && (
                <div style={styles.bwHint}>
                  참고: 이 음식의 1인분 참고 중량은 약 {selectedFood.realServingGrams}g이에요. 아래
                  칸에 직접 드신 양(g)을 입력하세요.
                </div>
              )}

              <div style={styles.cardioTypeRow}>
                {MEAL_TYPES.map((m) => (
                  <button
                    key={m}
                    style={{ ...styles.cardioTypeChip, ...(mealType === m ? styles.cardioTypeChipActive : {}) }}
                    onClick={() => setMealType(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div style={styles.cardioInputRow}>
                <input
                  style={styles.numInput}
                  type="number"
                  inputMode="decimal"
                  step="10"
                  placeholder="섭취량(g)"
                  value={gramsInput}
                  onChange={(e) => setGramsInput(e.target.value)}
                />
                <span style={styles.xMark}>g</span>
                <button style={styles.setAddBtn} onClick={addFoodLog}>
                  기록
                </button>
              </div>
              {gramsInput && !isNaN(parseFloat(gramsInput)) && (
                <div style={styles.foodResultDesc}>
                  {gramsInput}g 섭취 시:{" "}
                  {scaledFoodNutrientsByGrams(selectedFood, parseFloat(gramsInput)).calorie_kcal ?? "?"}
                  kcal · 단백질{" "}
                  {scaledFoodNutrientsByGrams(selectedFood, parseFloat(gramsInput)).protein_g ?? 0}g
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 운동 기록: 캘린더 히스토리 ────────────────────────
  if (screen === "workout" && workoutView === "calendar") {
    const y = calendarMonth.getFullYear();
    const m = calendarMonth.getMonth();
    const firstDow = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDow; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);

    return (
      <div style={styles.app}>
        <div style={styles.subHeader}>
          <button style={styles.backBtn} onClick={() => setWorkoutView("log")}>
            <X size={18} color={MUTED} />
          </button>
          <span style={styles.subHeaderTitle}>히스토리</span>
        </div>

        <div style={styles.body}>
          <div style={styles.monthNavRow}>
            <button
              style={styles.monthNavBtn}
              onClick={() => setCalendarMonth(new Date(y, m - 1, 1))}
            >
              <ChevronLeft size={18} color={MUTED} />
            </button>
            <span style={styles.monthLabel}>
              {y}. {String(m + 1).padStart(2, "0")}
            </span>
            <button
              style={styles.monthNavBtn}
              onClick={() => setCalendarMonth(new Date(y, m + 1, 1))}
            >
              <ChevronRight size={18} color={MUTED} />
            </button>
          </div>

          <div style={styles.weekdayRow}>
            {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
              <div key={w} style={styles.weekdayCell}>
                {w}
              </div>
            ))}
          </div>

          <div style={styles.calendarGrid}>
            {cells.map((d, i) => {
              if (d === null) return <div key={i} style={styles.calendarCellEmpty} />;
              const key = dateKey(y, m, d);
              const splitsToday = splitsByDate[key] ? Array.from(splitsByDate[key]) : [];
              const hasCardio = !!cardioByDate[key];
              const isTodayCell = key === todayStr();
              const hasData = splitsToday.length > 0 || hasCardio;
              const isPastOrToday = key <= todayStr();
              const clickable = hasData || isPastOrToday;
              return (
                <button
                  key={i}
                  style={{
                    ...styles.calendarCell,
                    ...(isTodayCell ? styles.calendarCellToday : {}),
                    ...(hasData ? {} : isPastOrToday ? styles.calendarCellBackfillable : styles.calendarCellDisabled),
                  }}
                  onClick={() => {
                    if (!clickable) return;
                    if (hasData) {
                      setSelectedDate(key);
                      setWorkoutView("detail");
                    } else {
                      // 기록 없는 과거/오늘 날짜 → 바로 그 날짜로 기록 보강 모드 진입
                      setLogDate(key);
                      setActiveExercise(null);
                      setWorkoutView("log");
                    }
                  }}
                >
                  <span style={styles.calendarDateNum}>{d}</span>
                  <div style={styles.calendarDots}>
                    {splitsToday.map((s) => (
                      <span key={s} style={{ ...styles.calendarDot, background: SPLIT_COLORS[s] }} />
                    ))}
                    {hasCardio && <Flame size={7} color={CARDIO_COLOR} />}
                    {!hasData && isPastOrToday && <Plus size={7} color={MUTED} />}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={styles.legendRow}>
            {SPLITS.map((s) => (
              <div key={s} style={styles.legendItem}>
                <span style={{ ...styles.legendDot, background: SPLIT_COLORS[s] }} />
                <span style={styles.legendLabel}>{SPLIT_LABELS[s]}</span>
              </div>
            ))}
            <div style={styles.legendItem}>
              <Flame size={10} color={CARDIO_COLOR} />
              <span style={styles.legendLabel}>유산소</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── 운동 기록: 특정 날짜 상세 (읽기 전용) ──────────────
  if (screen === "workout" && workoutView === "detail") {
    const dayVolume = selectedDateEntries.reduce((sum, e) => sum + entryVolume(e), 0);
    const daySetsFlat = selectedDateEntries.flatMap((e) => timedSetsForEntry(e));
    const dayStrengthCalories = estimateStrengthCalories(daySetsFlat, settings.bodyweight);
    return (
      <div style={styles.app}>
        <div style={styles.subHeader}>
          <button
            style={styles.backBtn}
            onClick={() => {
              setWorkoutView("calendar");
              setSelectedDate(null);
            }}
          >
            <ChevronLeft size={18} color={MUTED} />
          </button>
          <span style={styles.subHeaderTitle}>{selectedDate}</span>
        </div>
        <div style={styles.body}>
          <div style={styles.dayDetailVolume}>
            총 볼륨 {dayVolume.toLocaleString()}kg
            {dayStrengthCalories ? ` · 약 ${dayStrengthCalories}kcal` : ""}
          </div>
          {selectedDateEntries.map((e) => (
            <div key={e.id} style={styles.historyEntryCard}>
              <div style={styles.historyEntryTop}>
                <span style={{ ...styles.splitBadge, color: SPLIT_COLORS[e.split] }}>{SPLIT_LABELS[e.split]}</span>
                <span style={styles.historyEntryTitle}>{e.exercise}</span>
              </div>
              <div style={styles.doneCardSetList}>
                {e.sets.map((s, i) => (
                  <div key={i} style={styles.doneCardSetRow}>
                    <span style={styles.doneCardSetIndex}>{i + 1} SET</span>
                    <span style={styles.doneCardSetValue}>{formatSetLabel(s, e)}</span>
                  </div>
                ))}
              </div>
              <div style={styles.historyEntryVolume}>
                볼륨 {entryVolume(e).toLocaleString()}kg
                {entryStrengthCalories(e) ? ` · 약 ${entryStrengthCalories(e)}kcal` : ""}
              </div>
            </div>
          ))}
          {selectedDateCardio.map((c) => (
            <div key={c.id} style={styles.cardioCard}>
              <Flame size={16} color={CARDIO_COLOR} />
              <div>
                <div style={styles.cardioCardTitle}>{c.type}</div>
                <div style={styles.cardioCardDesc}>
                  {c.minutes}분{c.distance ? ` · ${c.distance}km` : ""}
                  {c.calories ? ` · ${c.calories}kcal${c.autoCalories ? "(자동)" : ""}` : ""}
                </div>
              </div>
            </div>
          ))}
          <button
            style={styles.addToDateBtn}
            onClick={() => {
              setLogDate(selectedDate);
              setActiveExercise(null);
              setWorkoutView("log");
            }}
          >
            <Plus size={14} color={ACCENT} />
            이 날짜에 기록 추가
          </button>
        </div>
      </div>
    );
  }

  // ── 운동 기록: 오늘의 로그 (기본 화면) ─────────────────
  return (
    <div style={styles.app}>
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <div style={styles.headerLeft}>
            <button
              style={styles.backBtn}
              onClick={() => {
                setSectionOpenedAt(null);
                if (isToday) {
                  setScreen("home");
                } else {
                  setWorkoutView("calendar");
                }
              }}
            >
              {isToday ? <Home size={16} color={MUTED} /> : <ChevronLeft size={16} color={MUTED} />}
            </button>
            <Dumbbell size={18} color={ACCENT} />
            <span style={styles.headerTitle}>{isToday ? "오늘의 기록" : logDate}</span>
            {!isToday && <span style={styles.backfillBadge}>기록 보강</span>}
          </div>
          <div style={styles.headerRight}>
            <button style={styles.viewToggle} onClick={() => setSettingsOpen((v) => !v)}>
              <Settings size={18} color={MUTED} />
            </button>
            <button
              style={styles.viewToggle}
              onClick={() => {
                setWorkoutView("calendar");
                setActiveExercise(null);
                setSectionOpenedAt(null);
              }}
            >
              <CalendarIcon size={18} color={MUTED} />
            </button>
          </div>
        </div>
        {settingsOpen && (
          <div style={styles.settingsPanel}>
            <div style={styles.settingsLabel}>내 체중 (맨몸운동 볼륨 계산에 사용)</div>
            <div style={styles.addRow}>
              <input
                style={styles.input}
                type="number"
                inputMode="decimal"
                placeholder={settings.bodyweight ? `현재 ${settings.bodyweight}kg` : "예: 70"}
                value={bodyweightInput}
                onChange={(e) => setBodyweightInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveBodyweight()}
              />
              <button style={styles.addBtn} onClick={saveBodyweight}>
                <Check size={20} color={BG} />
              </button>
            </div>
          </div>
        )}
        <div style={styles.tabRow}>
          {SPLITS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSplit(s);
                setActiveExercise(null);
                setSectionOpenedAt(null);
              }}
              style={{
                ...styles.tab,
                ...(split === s ? { color: SPLIT_COLORS[s], borderBottom: `2px solid ${SPLIT_COLORS[s]}` } : {}),
              }}
            >
              {SPLIT_LABELS[s]}
            </button>
          ))}
        </div>

        <div style={styles.sessionBar}>
          {!session && (
            <button style={styles.sessionStartBtn} onClick={startSession}>
              <Clock size={14} color={BG} />
              타이머 시작
            </button>
          )}
          {sessionRunning && (
            <>
              <div style={styles.sessionTimeDisplay}>
                <Clock size={14} color={ACCENT} />총 운동 시간 {formatDuration(now - session.startedAt)}
              </div>
              <button style={styles.sessionEndBtn} onClick={endSession}>
                <Square size={12} color={DANGER} />
                운동 종료
              </button>
            </>
          )}
          {session && !sessionRunning && (
            <div style={styles.sessionTimeDisplay}>
              <Clock size={14} color={MUTED} />
              운동 종료됨 · 총 {formatDuration(session.endedAt - session.startedAt)}
            </div>
          )}
        </div>
      </div>

      <div style={styles.body}>
        {!activeExercise && (
          <>
            <div style={styles.sectionLabel}>종목 추가</div>
            <div style={styles.addRow}>
              <input
                style={styles.input}
                placeholder="예: 벤치프레스"
                value={exerciseInput}
                onChange={(e) => setExerciseInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && openExercise(exerciseInput)}
              />
              <button style={styles.addBtn} onClick={() => openExercise(exerciseInput)}>
                <Plus size={20} color={BG} />
              </button>
            </div>

            {recentNamesForSplit.length > 0 && (
              <>
                <div style={styles.sectionLabel}>최근 쓴 종목</div>
                <div style={styles.chipWrap}>
                  {recentNamesForSplit.map((name) => (
                    <button key={name} style={styles.chip} onClick={() => openExercise(name)}>
                      {name}
                    </button>
                  ))}
                </div>
              </>
            )}

            {todaysEntries.length > 0 && (
              <>
                <div style={styles.sectionLabelRow}>
                  <span style={styles.sectionLabel}>{isToday ? "오늘 완료" : "이 날짜 완료"}</span>
                  <span style={styles.todayVolumeText}>
                    {isToday ? "오늘" : "이 날짜"} 총 볼륨 {todayVolume.toLocaleString()}kg
                    {todayStrengthCalories ? ` · 약 ${todayStrengthCalories}kcal` : ""}
                  </span>
                </div>
                {!settings.bodyweight && (
                  <div style={styles.bwHint}>체중을 설정하면 근력운동 소모 칼로리도 같이 계산돼요</div>
                )}
                {todaysEntries.map((e) => (
                  <div key={e.id} style={styles.doneCard} onClick={() => setActiveExercise(e.exercise)}>
                    <div style={styles.doneCardHeader}>
                      <div style={styles.doneCardTitle}>{e.exercise}</div>
                      <ChevronRight size={18} color={MUTED} />
                    </div>
                    <div style={styles.doneCardSetList}>
                      {e.sets.map((s, i) => (
                        <div key={i} style={styles.doneCardSetRow}>
                          <span style={styles.doneCardSetIndex}>{i + 1} SET</span>
                          <span style={styles.doneCardSetValue}>{formatSetLabel(s, e)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}

            <div style={styles.sectionLabelRow}>
              <span style={styles.sectionLabel}>
                <Flame size={12} color={CARDIO_COLOR} style={{ marginRight: 4, verticalAlign: "-2px" }} />
                마무리 유산소
              </span>
            </div>

            {todayCardio.length > 0 &&
              todayCardio.map((c) =>
                editingCardioId === c.id ? (
                  <div key={c.id} style={styles.cardioEditCard}>
                    <div style={styles.cardioTypeRow}>
                      {CARDIO_TYPES.map((t) => (
                        <button
                          key={t}
                          style={{
                            ...styles.cardioTypeChip,
                            ...(editCardioType === t ? styles.cardioTypeChipActive : {}),
                          }}
                          onClick={() => setEditCardioType(t)}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <div style={styles.cardioInputRow}>
                      <input
                        style={styles.numInput}
                        type="number"
                        inputMode="numeric"
                        placeholder="시간(분)"
                        value={editCardioMinutes}
                        onChange={(e) => setEditCardioMinutes(e.target.value)}
                      />
                      <input
                        style={styles.numInput}
                        type="number"
                        inputMode="decimal"
                        placeholder="거리(선택,km)"
                        value={editCardioDistance}
                        onChange={(e) => setEditCardioDistance(e.target.value)}
                      />
                    </div>
                    <div style={styles.cardioInputRow}>
                      <input
                        style={styles.numInput}
                        type="number"
                        inputMode="numeric"
                        placeholder="칼로리(선택,kcal)"
                        value={editCardioCalories}
                        onChange={(e) => setEditCardioCalories(e.target.value)}
                      />
                      <button style={styles.setEditSaveBtn} onClick={updateCardio}>
                        <Check size={16} color={BG} />
                      </button>
                      <button style={styles.setEditDeleteBtn} onClick={() => deleteCardio(c.id)}>
                        <Trash2 size={16} color={DANGER} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={c.id}
                    style={styles.cardioCard}
                    onClick={() => {
                      setEditingCardioId(c.id);
                      setEditCardioType(c.type);
                      setEditCardioMinutes(String(c.minutes ?? ""));
                      setEditCardioDistance(c.distance ? String(c.distance) : "");
                      setEditCardioCalories(c.calories && !c.autoCalories ? String(c.calories) : "");
                      setError("");
                    }}
                  >
                    <Flame size={16} color={CARDIO_COLOR} />
                    <div style={{ flex: 1 }}>
                      <div style={styles.cardioCardTitle}>{c.type}</div>
                      <div style={styles.cardioCardDesc}>
                        {c.minutes}분{c.distance ? ` · ${c.distance}km` : ""}
                        {c.calories ? ` · ${c.calories}kcal${c.autoCalories ? "(자동)" : ""}` : ""}
                      </div>
                    </div>
                    <Pencil size={13} color={MUTED} />
                  </div>
                )
              )}

            <div style={styles.cardioTypeRow}>
              {CARDIO_TYPES.map((t) => (
                <button
                  key={t}
                  style={{ ...styles.cardioTypeChip, ...(cardioType === t ? styles.cardioTypeChipActive : {}) }}
                  onClick={() => setCardioType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <div style={styles.cardioInputRow}>
              <input
                style={styles.numInput}
                type="number"
                inputMode="numeric"
                placeholder="시간(분)"
                value={cardioMinutes}
                onChange={(e) => setCardioMinutes(e.target.value)}
              />
              <input
                style={styles.numInput}
                type="number"
                inputMode="decimal"
                placeholder="거리(선택,km)"
                value={cardioDistance}
                onChange={(e) => setCardioDistance(e.target.value)}
              />
            </div>
            <div style={styles.cardioInputRow}>
              <input
                style={styles.numInput}
                type="number"
                inputMode="numeric"
                placeholder={estimatedCalories ? `자동 ${estimatedCalories}kcal` : "칼로리(선택)"}
                value={cardioCalories}
                onChange={(e) => setCardioCalories(e.target.value)}
              />
              <button style={styles.cardioAddBtn} onClick={addCardio}>
                기록
              </button>
            </div>
            {!settings.bodyweight && (
              <div style={styles.bwHint}>체중을 설정하면 칼로리가 자동 계산돼요 (설정 ⚙)</div>
            )}
            {settings.bodyweight && (
              <div style={styles.cardioAutoHint}>
                직접 입력 안 하면 체중 {settings.bodyweight}kg 기준으로 자동 계산돼요
              </div>
            )}
            {error && <div style={styles.errorText}>{error}</div>}
          </>
        )}

        {activeExercise && (
          <>
            <div style={styles.exerciseHeader}>
              <button
                style={styles.backBtn}
                onClick={() => {
                  setActiveExercise(null);
                  setEditingName(false);
                  setEditingSetIndex(null);
                  setSectionOpenedAt(null);
                }}
              >
                <X size={18} color={MUTED} />
              </button>
              {editingName ? (
                <div style={styles.nameEditRow}>
                  <input
                    style={styles.nameEditInput}
                    value={exerciseNameInput}
                    onChange={(e) => setExerciseNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && renameExercise()}
                    autoFocus
                  />
                  <button style={styles.nameEditSaveBtn} onClick={renameExercise}>
                    <Check size={16} color={BG} />
                  </button>
                </div>
              ) : (
                <div style={styles.exerciseTitleRow}>
                  <div style={styles.exerciseTitle}>{activeExercise}</div>
                  <button
                    style={styles.editNameBtn}
                    onClick={() => {
                      setExerciseNameInput(activeExercise);
                      setEditingName(true);
                    }}
                  >
                    <Pencil size={13} color={MUTED} />
                  </button>
                </div>
              )}
              <button
                style={{
                  ...styles.bwToggle,
                  ...(isBodyweight ? styles.bwToggleActive : {}),
                }}
                onClick={() => setIsBodyweight((v) => !v)}
              >
                맨몸운동
              </button>
            </div>
            {sectionOpenedAt && (
              <div style={styles.sectionTimerText}>
                <Clock size={12} color={ACCENT} />이 종목 진행 시간 {formatDuration(now - sectionOpenedAt)}
              </div>
            )}
            {!sessionRunning && (
              <div style={styles.bwHint}>타이머를 시작하면 종목별·세트별 소요 시간이 측정돼요</div>
            )}
            {isBodyweight && !settings.bodyweight && (
              <div style={styles.bwHint}>체중이 설정되지 않았어요 — 설정(⚙)에서 입력하면 볼륨에 반영돼요</div>
            )}
            {isBodyweight && (
              <div style={styles.bwPercentRow}>
                <span style={styles.bwPercentLabel}>체중 반영 비율</span>
                <button style={styles.bwStepBtn} onClick={() => setBwPercent((p) => Math.max(10, p - 5))}>
                  −
                </button>
                <span style={styles.bwPercentValue}>{bwPercent}%</span>
                <button style={styles.bwStepBtn} onClick={() => setBwPercent((p) => Math.min(100, p + 5))}>
                  +
                </button>
              </div>
            )}

            {lastSession ? (
              <div style={styles.historyCard}>
                <div style={styles.historyLabel}>지난 기록 ({lastSession.date})</div>
                <div style={styles.historySets}>
                  {lastSession.sets.map((s, i) => formatSetLabel(s, lastSession)).join("   ")}
                </div>
                {suggestion && (
                  <div style={styles.suggestBox}>
                    <TrendingUp size={16} color={ACCENT} />
                    <div>
                      <div style={styles.suggestValue}>
                        {lastSession.bodyweight
                          ? formatSetLabel(
                              { weight: suggestion.weight, unit: suggestion.unit, reps: suggestion.reps },
                              lastSession
                            )
                          : `${suggestion.weight}${suggestion.unit === "lbs" ? "lbs" : "kg"} × ${suggestion.reps}회`}
                      </div>
                      <div style={styles.suggestReason}>{suggestion.reason}</div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={styles.historyCard}>
                <div style={styles.historyLabel}>이 종목 첫 기록이에요</div>
              </div>
            )}

            {currentEntry && currentEntry.sets.length > 0 && (
              <div style={styles.todaySets}>
                {currentEntry.sets.map((s, i) =>
                  editingSetIndex === i ? (
                    <div key={i} style={styles.todaySetEditRow}>
                      <span style={styles.setIndex}>{i + 1}</span>
                      {!currentEntry.bodyweight && (
                        <input
                          style={styles.setEditInput}
                          type="number"
                          inputMode="decimal"
                          value={editWeightInput}
                          onChange={(e) => setEditWeightInput(e.target.value)}
                          autoFocus
                        />
                      )}
                      {currentEntry.bodyweight && (
                        <input
                          style={styles.setEditInput}
                          type="number"
                          inputMode="decimal"
                          placeholder="추가중량"
                          value={editWeightInput}
                          onChange={(e) => setEditWeightInput(e.target.value)}
                        />
                      )}
                      <span style={styles.xMark}>×</span>
                      <input
                        style={styles.setEditInput}
                        type="number"
                        inputMode="numeric"
                        value={editRepsInput}
                        onChange={(e) => setEditRepsInput(e.target.value)}
                      />
                      <button style={styles.setEditSaveBtn} onClick={updateSet}>
                        <Check size={14} color={BG} />
                      </button>
                      <button style={styles.setEditDeleteBtn} onClick={() => deleteSet(i)}>
                        <Trash2 size={14} color={DANGER} />
                      </button>
                    </div>
                  ) : (
                    <div
                      key={i}
                      style={styles.todaySetRow}
                      onClick={() => {
                        setEditingSetIndex(i);
                        setEditWeightInput(String(s.weight ?? ""));
                        setEditRepsInput(String(s.reps ?? ""));
                        setError("");
                      }}
                    >
                      <span style={styles.setIndex}>{i + 1}</span>
                      <span style={styles.setValue}>{formatSetLabel(s, currentEntry)}</span>
                      {i > 0 && s.at && currentEntry.sets[i - 1].at && (
                        <span style={styles.setGapText}>
                          {formatDuration(s.at - currentEntry.sets[i - 1].at)}
                        </span>
                      )}
                      <Pencil size={13} color={MUTED} />
                    </div>
                  )
                )}
                {sessionRunning && currentEntry.sets[currentEntry.sets.length - 1].at && (
                  <div style={styles.setWaitingText}>
                    <Clock size={11} color={MUTED} />
                    다음 세트까지{" "}
                    {formatDuration(now - currentEntry.sets[currentEntry.sets.length - 1].at)}
                  </div>
                )}
                <div style={styles.entryVolumeText}>
                  이 종목 볼륨 {entryVolume(currentEntry).toLocaleString()}kg
                  {entryStrengthCalories(currentEntry) ? ` · 약 ${entryStrengthCalories(currentEntry)}kcal` : ""}
                </div>
                <button style={styles.repeatBtn} onClick={repeatLastSet}>
                  <Plus size={14} color={ACCENT} />
                  같은 세트 반복 (
                  {formatSetLabel(currentEntry.sets[currentEntry.sets.length - 1], currentEntry)})
                </button>
              </div>
            )}

            <div style={styles.unitToggleRow}>
              <button
                style={{ ...styles.unitBtn, ...(unit === "kg" ? styles.unitBtnActive : {}) }}
                onClick={() => setUnit("kg")}
              >
                kg
              </button>
              <button
                style={{ ...styles.unitBtn, ...(unit === "lbs" ? styles.unitBtnActive : {}) }}
                onClick={() => setUnit("lbs")}
              >
                lbs
              </button>
            </div>
            <div style={styles.setInputRow}>
              <input
                style={styles.numInput}
                type="number"
                inputMode="decimal"
                placeholder={isBodyweight ? `추가중량(선택, ${unit})` : unit}
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
              />
              <span style={styles.xMark}>×</span>
              <input
                style={styles.numInput}
                type="number"
                inputMode="numeric"
                placeholder="회"
                value={repsInput}
                onChange={(e) => setRepsInput(e.target.value)}
              />
              <button style={styles.setAddBtn} onClick={addSet}>
                기록
              </button>
            </div>
            {error && <div style={styles.errorText}>{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}

const styles = {
  loadingScreen: {
    minHeight: "100vh",
    background: BG,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: { color: MUTED, fontFamily: "system-ui, sans-serif", fontSize: 14 },
  app: {
    minHeight: "100vh",
    background: BG,
    fontFamily: "system-ui, -apple-system, sans-serif",
    color: TEXT,
    maxWidth: 480,
    margin: "0 auto",
  },

  // 홈
  homeHeader: { padding: "28px 20px 20px" },
  homeTitle: {
    fontSize: 24,
    fontWeight: 900,
    letterSpacing: "-0.02em",
    textTransform: "uppercase",
  },
  homeSubtitle: { fontSize: 13, color: MUTED, marginTop: 4 },
  homeBody: { padding: "4px 16px" },
  navCard: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 14,
    background: SURFACE,
    border: `1px solid ${SURFACE_ALT}`,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    cursor: "pointer",
    textAlign: "left",
  },
  navCardIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  navCardTextWrap: { flex: 1 },
  navCardTitleRow: { display: "flex", alignItems: "center", gap: 8 },
  navCardTitle: {
    fontSize: 16,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "-0.01em",
  },
  navCardDesc: { fontSize: 12, color: MUTED, marginTop: 4 },
  comingSoonBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: MUTED,
    background: SURFACE_ALT,
    borderRadius: 5,
    padding: "2px 6px",
  },

  // 서브 헤더 (식단/캘린더/상세 화면 공용)
  subHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: 16,
    borderBottom: `1px solid ${SURFACE_ALT}`,
    position: "sticky",
    top: 0,
    background: BG,
    zIndex: 10,
  },
  subHeaderTitle: {
    fontSize: 15,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "-0.01em",
  },

  // 식단 스텁
  stubBody: { padding: "60px 30px", textAlign: "center" },
  stubIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    background: "rgba(122,140,147,0.14)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 20px",
  },
  stubTitle: { fontSize: 17, fontWeight: 800, marginBottom: 10 },
  stubDesc: { fontSize: 13, color: MUTED, lineHeight: 1.7 },

  macroSummaryRow: { display: "flex", gap: 8, marginBottom: 18 },
  macroBox: {
    flex: 1,
    background: SURFACE,
    borderRadius: 10,
    padding: "10px 6px",
    textAlign: "center",
  },
  macroValue: { fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  macroLabel: { fontSize: 10, color: MUTED, marginTop: 2 },
  mealLabel: {
    fontSize: 11,
    color: MUTED,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    margin: "14px 0 6px",
  },
  foodLogCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: SURFACE,
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 6,
  },
  foodLogTitle: { fontSize: 14, fontWeight: 700 },
  foodLogPortion: { fontSize: 12, color: MUTED, fontWeight: 500 },
  foodLogDesc: { fontSize: 11, color: MUTED, marginTop: 3, fontVariantNumeric: "tabular-nums" },
  foodDeleteBtn: {
    width: 28,
    height: 28,
    background: SURFACE_ALT,
    border: "none",
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  foodResultCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    background: SURFACE,
    border: `1px solid ${SURFACE_ALT}`,
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 6,
    cursor: "pointer",
    textAlign: "left",
  },
  foodResultName: { fontSize: 14, fontWeight: 700 },
  foodResultDesc: { fontSize: 11, color: MUTED, marginTop: 3, fontVariantNumeric: "tabular-nums" },
  selectedFoodCard: {
    background: SURFACE,
    border: `1px solid ${PULL_COLOR}`,
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
  },
  selectedFoodHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 },

  header: {
    position: "sticky",
    top: 0,
    background: BG,
    borderBottom: `1px solid ${SURFACE_ALT}`,
    padding: "16px 16px 0 16px",
    zIndex: 10,
  },
  headerTop: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  headerLeft: { display: "flex", alignItems: "center", gap: 8 },
  headerRight: { display: "flex", alignItems: "center", gap: 8 },
  headerTitle: {
    fontSize: 15,
    fontWeight: 800,
    letterSpacing: "-0.01em",
    textTransform: "uppercase",
    fontVariantNumeric: "tabular-nums",
  },
  backfillBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: ACCENT,
    background: "rgba(193,80,46,0.16)",
    borderRadius: 5,
    padding: "2px 6px",
  },
  viewToggle: {
    width: 32,
    height: 32,
    background: SURFACE,
    border: "none",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  settingsPanel: { paddingBottom: 14 },
  settingsLabel: { fontSize: 12, color: MUTED, marginBottom: 8 },
  tabRow: { display: "flex", gap: 6 },
  tab: {
    flex: 1,
    padding: "10px 2px",
    background: "none",
    border: "none",
    color: MUTED,
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: "0.01em",
    borderBottom: "2px solid transparent",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  sessionBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "10px 0",
  },
  sessionStartBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: ACCENT,
    border: "none",
    borderRadius: 8,
    padding: "8px 14px",
    color: BG,
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  },
  sessionTimeDisplay: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: ACCENT,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  },
  sessionEndBtn: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: SURFACE,
    border: `1px solid ${DANGER}`,
    borderRadius: 8,
    padding: "7px 12px",
    color: DANGER,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  sectionTimerText: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: ACCENT,
    marginBottom: 8,
    fontVariantNumeric: "tabular-nums",
  },
  body: { padding: 16 },
  sectionLabel: {
    fontSize: 11,
    color: MUTED,
    margin: "18px 0 8px",
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  sectionLabelRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    margin: "18px 0 8px",
  },
  todayVolumeText: { fontSize: 12, color: ACCENT, fontWeight: 700, fontVariantNumeric: "tabular-nums" },
  addRow: { display: "flex", gap: 8 },
  input: {
    flex: 1,
    background: SURFACE,
    border: `1px solid ${SURFACE_ALT}`,
    borderRadius: 10,
    padding: "12px 14px",
    color: TEXT,
    fontSize: 15,
    outline: "none",
  },
  addBtn: {
    width: 44,
    height: 44,
    background: ACCENT,
    border: "none",
    borderRadius: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  chipWrap: { display: "flex", flexWrap: "wrap", gap: 8 },
  chip: {
    background: SURFACE,
    border: `1px solid ${SURFACE_ALT}`,
    borderRadius: 20,
    padding: "8px 14px",
    color: TEXT,
    fontSize: 13,
    cursor: "pointer",
  },
  doneCard: {
    background: SURFACE,
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 8,
    cursor: "pointer",
  },
  doneCardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  doneCardTitle: { fontSize: 14, fontWeight: 700 },
  doneCardSetList: { display: "flex", flexDirection: "column", gap: 4 },
  doneCardSetRow: { display: "flex", alignItems: "center", gap: 10 },
  doneCardSetIndex: { fontSize: 10, fontWeight: 700, color: MUTED, width: 40, flexShrink: 0 },
  doneCardSetValue: { fontSize: 13, color: TEXT, fontVariantNumeric: "tabular-nums" },

  exerciseHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 12, justifyContent: "space-between" },
  backBtn: {
    width: 32,
    height: 32,
    background: SURFACE,
    border: "none",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  exerciseTitle: { fontSize: 17, fontWeight: 800 },
  exerciseTitleRow: { display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 },
  editNameBtn: {
    width: 24,
    height: 24,
    background: "none",
    border: "none",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  nameEditRow: { display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 },
  nameEditInput: {
    flex: 1,
    minWidth: 0,
    background: SURFACE,
    border: `1px solid ${ACCENT}`,
    borderRadius: 8,
    padding: "6px 10px",
    color: TEXT,
    fontSize: 15,
    fontWeight: 700,
    outline: "none",
  },
  nameEditSaveBtn: {
    width: 30,
    height: 30,
    background: ACCENT,
    border: "none",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  bwToggle: {
    background: SURFACE,
    border: `1px solid ${SURFACE_ALT}`,
    borderRadius: 20,
    padding: "6px 12px",
    color: MUTED,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    flexShrink: 0,
  },
  bwToggleActive: { background: "rgba(193,80,46,0.16)", border: `1px solid ${ACCENT}`, color: ACCENT },
  bwHint: { fontSize: 11, color: MUTED, marginBottom: 12 },
  bwPercentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
    background: SURFACE,
    borderRadius: 10,
    padding: "8px 10px",
  },
  bwPercentLabel: { fontSize: 12, color: MUTED, flex: 1 },
  bwStepBtn: {
    width: 26,
    height: 26,
    background: SURFACE_ALT,
    border: "none",
    borderRadius: 6,
    color: TEXT,
    fontSize: 15,
    cursor: "pointer",
  },
  bwPercentValue: { fontSize: 14, fontWeight: 800, color: ACCENT, width: 42, textAlign: "center", fontVariantNumeric: "tabular-nums" },

  historyCard: { background: SURFACE, borderRadius: 12, padding: 16, marginBottom: 16 },
  historyLabel: { fontSize: 12, color: MUTED, marginBottom: 6 },
  historySets: { fontSize: 14, fontVariantNumeric: "tabular-nums", marginBottom: 4 },
  suggestBox: {
    display: "flex",
    gap: 10,
    alignItems: "flex-start",
    marginTop: 12,
    paddingTop: 12,
    borderTop: `1px solid ${SURFACE_ALT}`,
  },
  suggestValue: { fontSize: 18, fontWeight: 800, color: ACCENT, fontVariantNumeric: "tabular-nums" },
  suggestReason: { fontSize: 12, color: MUTED, marginTop: 2 },
  todaySets: { marginBottom: 16 },
  todaySetRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 4px",
    borderBottom: `1px solid ${SURFACE_ALT}`,
    cursor: "pointer",
  },
  setGapText: { fontSize: 11, color: MUTED, fontVariantNumeric: "tabular-nums", flexShrink: 0 },
  setWaitingText: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: MUTED,
    padding: "8px 4px",
    fontVariantNumeric: "tabular-nums",
  },
  todaySetEditRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 4px",
    borderBottom: `1px solid ${SURFACE_ALT}`,
    background: SURFACE,
    borderRadius: 8,
  },
  setEditInput: {
    width: 0,
    flex: 1,
    background: SURFACE_ALT,
    border: `1px solid ${ACCENT}`,
    borderRadius: 6,
    padding: "6px 4px",
    color: TEXT,
    fontSize: 13,
    textAlign: "center",
    outline: "none",
  },
  setEditSaveBtn: {
    width: 26,
    height: 26,
    background: ACCENT,
    border: "none",
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  setEditDeleteBtn: {
    width: 26,
    height: 26,
    background: SURFACE_ALT,
    border: "none",
    borderRadius: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    flexShrink: 0,
  },
  setIndex: {
    width: 20,
    height: 20,
    borderRadius: 5,
    background: SURFACE_ALT,
    color: MUTED,
    fontSize: 11,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  setValue: { flex: 1, fontSize: 15, fontVariantNumeric: "tabular-nums", fontWeight: 700 },
  entryVolumeText: { fontSize: 12, color: ACCENT, marginTop: 6, fontVariantNumeric: "tabular-nums" },
  repeatBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: "100%",
    marginTop: 10,
    background: SURFACE,
    border: `1px dashed ${SURFACE_ALT}`,
    borderRadius: 10,
    padding: "10px",
    color: ACCENT,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    fontVariantNumeric: "tabular-nums",
  },
  setInputRow: { display: "flex", alignItems: "center", gap: 8 },
  unitToggleRow: { display: "flex", gap: 6, marginBottom: 8 },
  cardioCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    background: SURFACE,
    borderRadius: 10,
    padding: "12px 14px",
    marginBottom: 8,
    cursor: "pointer",
  },
  cardioEditCard: {
    background: SURFACE,
    border: `1px solid ${CARDIO_COLOR}`,
    borderRadius: 10,
    padding: "10px",
    marginBottom: 8,
  },
  cardioCardTitle: { fontSize: 14, fontWeight: 700 },
  cardioCardDesc: { fontSize: 12, color: MUTED, marginTop: 2, fontVariantNumeric: "tabular-nums" },
  cardioAutoHint: { fontSize: 11, color: MUTED, marginBottom: 4 },
  cardioTypeRow: { display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  cardioTypeChip: {
    background: SURFACE,
    border: `1px solid ${SURFACE_ALT}`,
    borderRadius: 16,
    padding: "6px 12px",
    color: MUTED,
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  cardioTypeChipActive: {
    background: "rgba(217,201,184,0.14)",
    border: `1px solid ${CARDIO_COLOR}`,
    color: CARDIO_COLOR,
  },
  cardioInputRow: { display: "flex", gap: 8, marginBottom: 8 },
  cardioAddBtn: {
    background: CARDIO_COLOR,
    border: "none",
    borderRadius: 10,
    padding: "14px 18px",
    color: BG,
    fontSize: 14,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.02em",
    cursor: "pointer",
    flexShrink: 0,
  },
  unitBtn: {
    background: SURFACE,
    border: `1px solid ${SURFACE_ALT}`,
    borderRadius: 8,
    padding: "6px 14px",
    color: MUTED,
    fontSize: 12,
    fontWeight: 800,
    cursor: "pointer",
  },
  unitBtnActive: { background: "rgba(193,80,46,0.16)", border: `1px solid ${ACCENT}`, color: ACCENT },
  numInput: {
    flex: 1,
    background: SURFACE,
    border: `1px solid ${SURFACE_ALT}`,
    borderRadius: 10,
    padding: "14px",
    color: TEXT,
    fontSize: 18,
    outline: "none",
    textAlign: "center",
    fontVariantNumeric: "tabular-nums",
  },
  xMark: { color: MUTED, fontSize: 16 },
  setAddBtn: {
    background: ACCENT,
    border: "none",
    borderRadius: 10,
    padding: "14px 18px",
    color: BG,
    fontSize: 14,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.02em",
    cursor: "pointer",
    flexShrink: 0,
  },
  errorText: { color: DANGER, fontSize: 12, marginTop: 8 },

  // 캘린더
  monthNavRow: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  monthNavBtn: {
    width: 32,
    height: 32,
    background: SURFACE,
    border: "none",
    borderRadius: 8,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
  },
  monthLabel: { fontSize: 16, fontWeight: 800, fontVariantNumeric: "tabular-nums" },
  weekdayRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 6 },
  weekdayCell: { fontSize: 11, color: MUTED, textAlign: "center", fontWeight: 700 },
  calendarGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 },
  calendarCellEmpty: { aspectRatio: "1", },
  calendarCell: {
    aspectRatio: "1",
    background: SURFACE,
    border: `1px solid ${SURFACE_ALT}`,
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    cursor: "default",
    padding: 0,
  },
  calendarCellToday: { border: `1px solid ${ACCENT}` },
  calendarCellDisabled: { opacity: 0.35 },
  calendarCellBackfillable: { borderStyle: "dashed", opacity: 0.75 },
  addToDateBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    width: "100%",
    marginTop: 8,
    background: SURFACE,
    border: `1px dashed ${SURFACE_ALT}`,
    borderRadius: 10,
    padding: "12px",
    color: ACCENT,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  calendarDateNum: { fontSize: 12, color: TEXT, fontVariantNumeric: "tabular-nums", fontWeight: 600 },
  calendarDots: { display: "flex", gap: 2 },
  calendarDot: { width: 5, height: 5, borderRadius: 3 },
  legendRow: { display: "flex", gap: 16, justifyContent: "center", marginTop: 20 },
  legendItem: { display: "flex", alignItems: "center", gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, color: MUTED, fontWeight: 700 },

  // 날짜 상세
  dayDetailVolume: { fontSize: 13, color: ACCENT, fontWeight: 700, marginBottom: 16, fontVariantNumeric: "tabular-nums" },
  historyEntryCard: { background: SURFACE, borderRadius: 10, padding: "12px 14px", marginBottom: 8 },
  historyEntryTop: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 },
  splitBadge: {
    fontSize: 10,
    fontWeight: 800,
    background: "rgba(255,255,255,0.06)",
    borderRadius: 5,
    padding: "2px 6px",
    letterSpacing: "0.02em",
  },
  historyEntryTitle: { fontSize: 14, fontWeight: 700 },
  historyEntryVolume: { fontSize: 11, color: MUTED, marginTop: 6, fontVariantNumeric: "tabular-nums" },
};
