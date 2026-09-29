import { doc, getDoc, setDoc, deleteDoc, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

function configRef(code) {
  return doc(db, "workspaces", code, "meta", "config");
}
function dataRef(code) {
  return doc(db, "workspaces", code, "meta", "data");
}

export async function readWorkspaceConfig(code) {
  const snap = await getDoc(configRef(code));
  return snap.exists() ? snap.data() : null;
}
export async function writeWorkspaceConfig(code, data) {
  await setDoc(configRef(code), data);
}
export async function deleteWorkspaceConfig(code) {
  await deleteDoc(configRef(code));
}
// callback(data | null). Returns an unsubscribe function.
export function watchWorkspaceConfig(code, callback) {
  return onSnapshot(configRef(code), (snap) => callback(snap.exists() ? snap.data() : null));
}

export async function readWorkspaceData(code) {
  const snap = await getDoc(dataRef(code));
  return snap.exists() ? snap.data() : null;
}
export async function writeWorkspaceData(code, data) {
  await setDoc(dataRef(code), data);
}
export async function deleteWorkspaceData(code) {
  await deleteDoc(dataRef(code));
}
// callback(data | null). Returns an unsubscribe function.
export function watchWorkspaceData(code, callback) {
  return onSnapshot(dataRef(code), (snap) => callback(snap.exists() ? snap.data() : null));
}

// 기기(브라우저) 로컬 값 — 서버에 저장되지 않는 개인 기기 전용 값.
// 아티팩트 버전의 window.storage(shared:false) 호출과 같은 역할입니다.
const LOCAL_PREFIX = "league:";

export function getLocal(key) {
  try {
    return localStorage.getItem(LOCAL_PREFIX + key);
  } catch (e) {
    return null;
  }
}
export function setLocal(key, value) {
  try {
    localStorage.setItem(LOCAL_PREFIX + key, value);
  } catch (e) {
    // 저장 실패는 무시 — 다음 방문 시 다시 물어보는 정도로 그침
  }
}
export function removeLocal(key) {
  try {
    localStorage.removeItem(LOCAL_PREFIX + key);
  } catch (e) {
    // ignore
  }
}

// 학생 이름표 — 학생 id → 실명 매핑. 절대 Firestore에 올라가지 않고,
// 이 브라우저(기기)의 localStorage에만 남습니다. 코드별로 따로 보관해요.
const NAME_MAP_PREFIX = "namemap:";

export function getNameMap(code) {
  try {
    const raw = localStorage.getItem(NAME_MAP_PREFIX + code);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}
export function setNameMap(code, map) {
  try {
    localStorage.setItem(NAME_MAP_PREFIX + code, JSON.stringify(map));
  } catch (e) {
    // ignore
  }
}
export function mergeNameMap(code, partial) {
  const next = { ...getNameMap(code), ...partial };
  setNameMap(code, next);
  return next;
}
export function removeNameMap(code) {
  try {
    localStorage.removeItem(NAME_MAP_PREFIX + code);
  } catch (e) {
    // ignore
  }
}
