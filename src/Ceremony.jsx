// 리더보드 시상식 장면: 실내 경기장 천장 봉에 1·2·3위 태극기가 내려와 걸려요(세계선수권 시상식 느낌).
// 배경 사진: Adam Bouse, Unsplash(무료, Unsplash License) — https://unsplash.com/photos/m5nbZDHr8jM
//   경기장 로고가 안 보이게 가운데 전광판을 지우고 크게 흐린 뒤 푸른 톤으로 보정했어요.
// 태극기: 국기 규격 도안(공공 영역)에 천 주름·접힌 자국·천 결을 입혀 만든 이미지예요(public/ceremony/flag-*.webp).
// 모든 이미지는 사이트 안에 있어 외부 요청이 없어요.
import { useEffect, useRef } from "react";

const TIER = {
  1: { color: "#D4AF37", soft: "#F3DA8E" },
  2: { color: "#C3CBD4", soft: "#E4E9EE" },
  3: { color: "#C0823F", soft: "#E8BE8F" },
};

// 화면을 내리면 배경이 글보다 천천히 움직여 카메라가 따라오는 느낌을 줘요(움직임 줄이기 설정이면 꺼요).
function useParallax(ref, speed) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.parentElement.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return;
      el.style.transform = `translate3d(0, ${Math.round(-rect.top * speed)}px, 0)`;
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [ref, speed]);
}

function names(g, max) {
  const list = g.rows.map((r) => r.label);
  if (list.length <= max) return { shown: list, more: 0 };
  return { shown: list.slice(0, max), more: list.length - max };
}

/**
 * podium: [{ rank, total, rows: [{ id, label }], place: 1|2|3 }] — place는 시상 자리(1=가운데)
 * variant: "stage"(리더보드 탭) | "projector"(빔프로젝터 고정 화면, 더 크게)
 */
export default function CeremonyHero(props) {
  // 1·2·3위가 바뀌면 장면을 처음부터 다시 보여 줘요.
  const replayKey = props.podium.map((g) => g.rank + ":" + g.rows.map((r) => r.id).join(",")).join("|");
  return <CeremonyScene key={replayKey} {...props} />;
}

function CeremonyScene({ podium, variant = "stage" }) {
  const camRef = useRef(null);
  useParallax(camRef, 0.3);
  const order = [2, 1, 3].map((p) => podium.find((g) => g.place === p)).filter(Boolean);

  return (
    <section className={`cer cer-${variant}`} aria-label="1·2·3위 시상식">
      <style>{CEREMONY_CSS}</style>
      <div className="cer-cam" ref={camRef} aria-hidden="true">
        <div className="cer-cam-move">
          <picture>
            <source media="(min-width: 900px)" srcSet="/ceremony/arena-2000.webp" type="image/webp" />
            <img src="/ceremony/arena-1100.webp" alt="" className="cer-photo" decoding="async" />
          </picture>
          <span className="cer-beam cer-beam-1" />
          <span className="cer-beam cer-beam-2" />
          <span className="cer-beam cer-beam-3" />
        </div>
      </div>
      <div className="cer-shade" aria-hidden="true" />

      <div className="cer-rig" aria-hidden="true">
        <div className="cer-rail" />
        <div className="cer-flags">
          {order.map((g) => (
            <div key={g.place} className={`cer-hang cer-hang-${g.place}`}>
              <div className="cer-drop">
                <div className="cer-sway">
                  <div className="cer-wires">
                    <span className="cer-wire cer-wire-l" />
                    <span className="cer-wire cer-wire-r" />
                  </div>
                  <img src={`/ceremony/flag-${g.place}.webp`} alt="" className="cer-flag" decoding="async" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cer-plates">
        {order.map((g) => {
          const t = TIER[g.place];
          const { shown, more } = names(g, g.place === 1 ? 3 : 2);
          return (
            <div key={g.place} className={`cer-plate cer-plate-${g.place}`}>
              <span className="cer-bar" style={{ background: t.color }} />
              <div className="cer-rank" style={{ color: t.soft }}>
                <span className="cer-rank-num">{g.rank}</span>
                <span className="cer-rank-unit">위</span>
              </div>
              <div className="cer-names">
                {shown.map((n, i) => <span key={i} className="cer-name">{n}</span>)}
                {more > 0 && <span className="cer-more">외 {more}명</span>}
              </div>
              <div className="cer-score">
                <span className="lb-mono">{g.total}</span>
                <span className="cer-score-unit">점</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="cer-grain" aria-hidden="true" />
    </section>
  );
}

const GRAIN = "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")";

const CEREMONY_CSS = `
.cer { position: relative; overflow: hidden; isolation: isolate; color: #fff; background: #07102A; }
.cer-stage { height: clamp(420px, 56vh, 500px); }
.cer-projector { height: clamp(460px, 70vh, 900px); }

/* 카메라: 처음엔 가운데 깃발 쪽으로 바짝 다가가 있다가 천천히 물러나며 경기장 전체를 보여 줘요 */
.cer-cam { position: absolute; inset: -10% 0 -6% 0; will-change: transform; z-index: -2; }
.cer-cam-move { position: absolute; inset: 0; transform-origin: 50% 30%;
  animation: cerCamIn 3.2s cubic-bezier(0.2,0.65,0.2,1) both, cerCamDrift 24s ease-in-out 3.2s infinite alternate; }
.cer-photo { width: 100%; height: 100%; object-fit: cover; object-position: 50% 40%; }
@keyframes cerCamIn { from { transform: scale(1.28) translate3d(0, 4%, 0); } to { transform: scale(1.04) translate3d(0, 0, 0); } }
@keyframes cerCamDrift { from { transform: scale(1.04) translate3d(0, 0, 0); } to { transform: scale(1.09) translate3d(-1.2%, 0.6%, 0); } }
.cer-beam { position: absolute; top: -10%; width: 22%; height: 80%; pointer-events: none; mix-blend-mode: screen; filter: blur(18px);
  background: linear-gradient(180deg, rgba(190,215,255,0.16), rgba(190,215,255,0) 80%); clip-path: polygon(42% 0, 58% 0, 100% 100%, 0 100%); }
.cer-beam-1 { left: 10%; transform: rotate(14deg); }
.cer-beam-2 { left: 39%; }
.cer-beam-3 { left: 68%; transform: rotate(-14deg); }

.cer-shade { position: absolute; inset: 0; z-index: -1; pointer-events: none;
  background: linear-gradient(180deg, rgba(5,10,28,0.6) 0%, rgba(5,10,28,0.08) 26%, rgba(5,10,28,0.1) 52%, rgba(5,10,28,0.9) 100%); }
.cer-grain { position: absolute; inset: 0; pointer-events: none; opacity: 0.09; mix-blend-mode: overlay; background-image: ${GRAIN}; }

/* 천장 봉과 깃발 */
.cer-rig { position: absolute; left: 0; right: 0; top: 0; height: 66%; }
.cer-rail { position: absolute; left: -2%; right: -2%; top: 6%; height: 6px; border-radius: 3px;
  background: linear-gradient(180deg, #E9EDF2 0%, #9AA4B1 45%, #4E5866 100%); box-shadow: 0 6px 14px rgba(0,0,0,0.45);
  animation: cerFade 0.8s ease-out both; }
.cer-flags { position: absolute; left: 0; right: 0; top: calc(6% + 4px); display: grid; grid-template-columns: 1fr 1.12fr 1fr; gap: 2.5%;
  max-width: 880px; margin: 0 auto; padding: 0 3%; }
.cer-hang { position: relative; min-width: 0; }
.cer-drop { animation: cerDrop 2.1s cubic-bezier(0.25,0.8,0.25,1) both; }
.cer-hang-3 .cer-drop { animation-delay: 0.5s; }
.cer-hang-2 .cer-drop { animation-delay: 0.85s; }
.cer-hang-1 .cer-drop { animation-delay: 1.2s; }
.cer-sway { transform-origin: 50% 0; animation: cerSway 6s ease-in-out 3.4s infinite; }
.cer-hang-2 .cer-sway { animation-duration: 6.8s; animation-delay: 3.1s; }
.cer-hang-3 .cer-sway { animation-duration: 7.4s; animation-delay: 2.8s; }
/* 줄 길이로 높이를 달리해요: 1위가 가장 높고 3위가 가장 낮아요 */
.cer-wires { position: relative; padding-top: 5%; }
.cer-hang-2 .cer-wires { padding-top: 17%; }
.cer-hang-3 .cer-wires { padding-top: 25%; }
.cer-wire { position: absolute; top: 0; bottom: -2px; width: 1.5px; background: linear-gradient(180deg, rgba(230,236,244,0.9), rgba(170,180,195,0.7)); }
.cer-wire-l { left: 4%; }
.cer-wire-r { right: 4%; }
.cer-flag { display: block; width: 100%; height: auto; filter: drop-shadow(0 14px 18px rgba(0,0,0,0.45)) brightness(0.93) saturate(0.95); }
@keyframes cerDrop { from { transform: translate3d(0, -160%, 0); } 72% { transform: translate3d(0, 2.5%, 0); } to { transform: translate3d(0, 0, 0); } }
@keyframes cerSway { 0%, 100% { transform: rotate(0deg); } 30% { transform: rotate(0.5deg); } 70% { transform: rotate(-0.4deg); } }
@keyframes cerFade { from { opacity: 0; } to { opacity: 1; } }

/* 이름표 */
.cer-plates { position: absolute; left: 0; right: 0; bottom: 0; display: grid; grid-template-columns: 1fr 1.12fr 1fr; gap: 3.5%;
  max-width: 880px; margin: 0 auto; padding: 0 4% 22px; align-items: start; }
.cer-plate { position: relative; text-align: center; padding-top: 14px; min-width: 0; height: 150px; animation: cerPlate 0.6s ease-out both; }
.cer-plate-3 { animation-delay: 2.7s; }
.cer-plate-2 { animation-delay: 2.95s; }
.cer-plate-1 { animation-delay: 3.2s; }
@keyframes cerPlate { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
.cer-bar { position: absolute; top: 0; left: 50%; width: 34px; height: 3px; transform: translateX(-50%); border-radius: 2px; }
.cer-rank { display: flex; align-items: baseline; justify-content: center; gap: 2px; line-height: 1; }
.cer-rank-num { font-family: 'Archivo', 'IBM Plex Sans KR', sans-serif; font-weight: 800; font-size: clamp(26px, 7vw, 40px); letter-spacing: -0.02em; }
.cer-plate-1 .cer-rank-num { font-size: clamp(32px, 8.6vw, 52px); }
.cer-rank-unit { font-size: 13px; font-weight: 600; opacity: 0.9; }
.cer-names { display: flex; flex-direction: column; margin-top: 6px; min-width: 0; }
.cer-name { font-weight: 700; font-size: clamp(13px, 3.6vw, 17px); line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cer-plate-1 .cer-name { font-size: clamp(15px, 4.2vw, 20px); }
.cer-more { font-size: 12px; opacity: 0.75; margin-top: 1px; }
.cer-score { margin-top: 4px; font-size: clamp(15px, 4vw, 20px); font-weight: 700; color: rgba(255,255,255,0.92); }
.cer-score-unit { font-size: 12px; font-weight: 500; margin-left: 2px; opacity: 0.75; }

@media (min-width: 768px) {
  .cer-stage { height: clamp(560px, 80vh, 680px); }
  .cer-projector { height: clamp(600px, 84vh, 1000px); }
  .cer-projector .cer-flags, .cer-projector .cer-plates { max-width: 1200px; }
  .cer-projector .cer-plate { height: 210px; }
  .cer-projector .cer-rank-num { font-size: 56px; }
  .cer-projector .cer-plate-1 .cer-rank-num { font-size: 72px; }
  .cer-projector .cer-name { font-size: 22px; }
  .cer-projector .cer-plate-1 .cer-name { font-size: 28px; }
  .cer-projector .cer-score { font-size: 26px; }
  .cer-flags { padding: 0 4%; }
  .cer-rail { height: 8px; }
  .cer-plates { padding-bottom: 30px; }
  .cer-plate { height: 168px; }
}
@media (prefers-reduced-motion: reduce) {
  .cer-cam-move, .cer-rail, .cer-drop, .cer-sway, .cer-plate { animation: none !important; }
  .cer-cam-move { transform: scale(1.04); }
}
`;
