import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  collection,
  writeBatch,
  serverTimestamp,
} from "firebase/firestore";
import { db, ensureSignedIn } from "./firebase";

// ───────────────────────────────────────────────────────────────
// 보안 구조(firestore.rules와 짝)
//  - 비밀번호는 원문을 저장하지 않고 SHA-256 해시만 meta/secret에 둬요(아무도 읽을 수 없음).
//  - 입장할 때 claims/{uid}에 "내가 계산한 해시"를 쓰고, 같은 묶음으로 members/{uid}를 만들어요.
//    보안 규칙이 해시가 맞는지 비교해서 맞을 때만 구성원 문서를 만들어 줘요.
//  - 예전 방식(비밀번호 원문이 config에 있던 코드)은 개설자가 로그인할 때 새 방식으로 옮겨요.
// ───────────────────────────────────────────────────────────────

function configRef(code) {
  return doc(db, "workspaces", code, "meta", "config");
}
function dataRef(code) {
  return doc(db, "workspaces", code, "meta", "data");
}
function secretRef(code) {
  return doc(db, "workspaces", code, "meta", "secret");
}
function claimRef(code, uid) {
  return doc(db, "workspaces", code, "claims", uid);
}
function memberRef(code, uid) {
  return doc(db, "workspaces", code, "members", uid);
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
// 같은 비밀번호라도 코드·종류가 다르면 전혀 다른 해시가 나오도록 함께 섞어요.
export function hashPassword(code, kind, pw) {
  return sha256Hex(`score-dashboard-v1|${code}|${kind}|${String(pw || "").trim()}`);
}

export async function currentUid() {
  const user = await ensureSignedIn();
  return user.uid;
}

function isDenied(e) {
  return e && (e.code === "permission-denied" || e.code === "firestore/permission-denied");
}

// "none"(없는 코드) | "ready"(새 방식) | "legacy"(예전 방식, 비밀번호 원문이 아직 config에 있음)
export async function probeWorkspace(code) {
  await ensureSignedIn();
  try {
    const snap = await getDoc(configRef(code));
    return snap.exists() ? "ready" : "none";
  } catch (e) {
    if (isDenied(e)) return "legacy";
    throw e;
  }
}

export async function readMyMember(code) {
  const uid = await currentUid();
  try {
    const snap = await getDoc(memberRef(code, uid));
    return snap.exists() ? { id: uid, ...snap.data() } : null;
  } catch (e) {
    if (isDenied(e)) return null;
    throw e;
  }
}

// 해시(또는 예전 비밀번호)를 먼저 제출하고, 그다음 내 구성원 문서를 써요. 비밀번호가 틀리면 규칙이 거절해요.
// 제출 기록은 따로 먼저 저장돼서, 틀린 시도도 "5초에 한 번" 제한에 걸려요(한 묶음으로 쓰면 실패할 때 기록이 남지 않아 제한이 안 걸려요).
async function submitClaimWithMember(code, claim, memberData, merge) {
  const uid = await currentUid();
  try {
    await setDoc(claimRef(code, uid), { ...claim, at: serverTimestamp() });
    await setDoc(memberRef(code, uid), memberData, merge ? { merge: true } : undefined);
    return true;
  } catch (e) {
    if (isDenied(e)) return false;
    throw e;
  }
}

export async function createWorkspace(code, viewerPassword, founderPassword) {
  const uid = await currentUid();
  const founderHash = await hashPassword(code, "founder", founderPassword);
  const viewerHash = String(viewerPassword || "").trim() ? await hashPassword(code, "viewer", viewerPassword) : "";
  const batch = writeBatch(db);
  batch.set(secretRef(code), { founder: founderHash, viewer: viewerHash });
  batch.set(configRef(code), { createdAt: Date.now(), v: 2 });
  batch.set(claimRef(code, uid), { h: founderHash, at: serverTimestamp() });
  batch.set(memberRef(code, uid), { type: "founder", status: "approved", name: "개설자", submittedAt: Date.now() });
  try {
    await batch.commit();
    return true;
  } catch (e) {
    if (isDenied(e)) return false;
    throw e;
  }
}

// 예전 방식 코드를 개설자가 처음 로그인할 때 새 방식으로 옮겨요.
async function migrateLegacy(code, founderPassword) {
  const uid = await currentUid();
  const snap = await getDoc(configRef(code)); // 개설자가 된 뒤에는 읽을 수 있어요
  const legacy = snap.exists() ? snap.data() : {};
  const founderHash = await hashPassword(code, "founder", founderPassword);
  const viewerPw = String(legacy.viewerPassword || "").trim();
  const viewerHash = viewerPw ? await hashPassword(code, "viewer", viewerPw) : "";
  const batch = writeBatch(db);
  batch.set(secretRef(code), { founder: founderHash, viewer: viewerHash });
  batch.set(configRef(code), { createdAt: legacy.createdAt || Date.now(), v: 2 }); // 비밀번호 원문·예전 접근 목록 삭제
  batch.delete(claimRef(code, uid)); // 예전 비밀번호를 담았던 제출 기록도 지워요
  await batch.commit();
}

// 결과: { ok: true } | { ok: false, reason: "bad-code" | "bad-password" }
export async function founderLogin(code, founderPassword) {
  const state = await probeWorkspace(code);
  if (state === "none") return { ok: false, reason: "bad-code" };
  const entry = { type: "founder", status: "approved", name: "개설자", submittedAt: Date.now() };
  if (state === "legacy") {
    const ok = await submitClaimWithMember(code, { h: "", legacy: String(founderPassword || "").trim() }, entry);
    if (!ok) return { ok: false, reason: "bad-password" };
    await migrateLegacy(code, founderPassword);
    return { ok: true };
  }
  const h = await hashPassword(code, "founder", founderPassword);
  const ok = await submitClaimWithMember(code, { h }, entry);
  return ok ? { ok: true } : { ok: false, reason: "bad-password" };
}

// 결과: { ok: true, entry } | { ok: false, reason: "bad-code" | "bad-password" }
export async function requestAccess(code, viewerPassword, name, wantsEdit) {
  const state = await probeWorkspace(code);
  if (state === "none") return { ok: false, reason: "bad-code" };
  const existing = await readMyMember(code);
  if (existing && existing.status !== "denied") return { ok: true, entry: existing };
  const entry = {
    type: wantsEdit ? "editor" : "viewer",
    status: wantsEdit ? "pending" : "approved",
    name: String(name || "").trim().slice(0, 60),
    submittedAt: Date.now(),
  };
  const claim =
    state === "legacy"
      ? { h: "", legacy: String(viewerPassword || "").trim() }
      : { h: await hashPassword(code, "viewer", viewerPassword) };
  const ok = await submitClaimWithMember(code, claim, entry);
  return ok ? { ok: true, entry: { id: await currentUid(), ...entry } } : { ok: false, reason: "bad-password" };
}

// 빔프로젝터 잠금 풀기 등: 개설자 비밀번호를 서버 규칙으로 다시 확인해요.
export async function verifyFounder(code, founderPassword) {
  const h = await hashPassword(code, "founder", founderPassword);
  return submitClaimWithMember(code, { h }, { type: "founder", status: "approved", verifiedAt: Date.now() }, true);
}

// 개설자: 비밀번호 바꾸기. 빈 칸은 그대로 두고, viewerOff가 true면 접근 신청을 꺼요.
export async function changePasswords(code, { viewerPassword, founderPassword, viewerOff }) {
  const patch = {};
  if (String(founderPassword || "").trim()) patch.founder = await hashPassword(code, "founder", founderPassword);
  if (viewerOff) patch.viewer = "";
  else if (String(viewerPassword || "").trim()) patch.viewer = await hashPassword(code, "viewer", viewerPassword);
  if (Object.keys(patch).length === 0) return false;
  await updateDoc(secretRef(code), patch);
  return true;
}

// callback(entry | null): 내 구성원 문서(권한 승인·취소가 실시간으로 반영돼요)
export function watchMyMember(code, uid, callback) {
  return onSnapshot(
    memberRef(code, uid),
    (snap) => callback(snap.exists() ? { id: uid, ...snap.data() } : null),
    () => callback(null)
  );
}
// 개설자 전용: 구성원 목록
export function watchMembers(code, callback) {
  return onSnapshot(
    collection(db, "workspaces", code, "members"),
    (q) => callback(q.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => callback([])
  );
}
export async function updateMember(code, uid, patch) {
  await updateDoc(memberRef(code, uid), patch);
}

// 코드 마감: 데이터·설정·비밀번호·구성원을 모두 지워요(개설자 전용).
export async function deleteWorkspaceAll(code) {
  const uid = await currentUid();
  const members = await getDocs(collection(db, "workspaces", code, "members"));
  for (const d of members.docs) {
    if (d.id !== uid) await deleteDoc(d.ref).catch(() => {});
  }
  await deleteDoc(dataRef(code)).catch(() => {});
  await deleteDoc(configRef(code)).catch(() => {});
  await deleteDoc(secretRef(code)).catch(() => {});
  await deleteDoc(claimRef(code, uid)).catch(() => {});
  await deleteDoc(memberRef(code, uid)).catch(() => {});
}

export async function readWorkspaceData(code) {
  const snap = await getDoc(dataRef(code));
  return snap.exists() ? snap.data() : null;
}
export async function writeWorkspaceData(code, data) {
  await setDoc(dataRef(code), data);
}
// callback(data | null). Returns an unsubscribe function.
export function watchWorkspaceData(code, callback) {
  return onSnapshot(
    dataRef(code),
    (snap) => callback(snap.exists() ? snap.data() : null),
    () => callback(null)
  );
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
