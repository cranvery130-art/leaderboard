# 체육행사 승점 대시보드 (League Leaderboard)

React + Vite + Firebase(Firestore) 기반 학교스포츠클럽 리그전 승점 대시보드.

## 로컬 실행
```
npm install
cp .env.example .env
# .env에 Firebase 콘솔에서 발급받은 값 채우기
npm run dev
```

## 배포
GitHub에 push 후 Vercel에서 이 저장소를 Import하면 자동으로 빌드/배포됩니다.
Vercel 프로젝트 설정 > Environment Variables에 .env.example과 동일한 6개 값을 등록하세요.

## Firestore 구조
- `workspaces/{code}/meta/config` — 코드별 설정(비밀번호, 접근 목록)
- `workspaces/{code}/meta/data` — 코드별 실제 데이터(명단, 경기 기록, 승점 기준)
  - **학생 이름은 여기 포함되지 않습니다.** 서버에는 학년·반·번호·성별·id만 저장되고,
    실제 이름은 각 브라우저(기기)의 localStorage에만 남습니다(`namemap:{code}` 키).
    다른 기기에서 처음 열면 이름 대신 "학년-반-번호 (이름 미등록)"으로 보이며,
    설정 탭의 "학생 이름표 내보내기/가져오기"로 그 매핑을 다른 기기에 옮길 수 있습니다.
    JSON 백업 파일과 엑셀 내보내기 파일에는 이름이 포함됩니다(로컬 파일이라 무관).

## 보안 규칙
`firestore.rules` 참고. 앱이 쓰는 문서(`config`, `data`)만 허용하고 목록 조회·그 외 경로는 막으며,
저장 값의 종류·크기를 점검합니다. 다만 코드를 아는 사람은 읽고 쓸 수 있는 수준입니다(Firebase Auth 미도입 —
개설자/수정자/조회자 구분은 앱 화면에서만 적용되고 서버에서 강제되지 않습니다).

적용 방법: Firebase 콘솔 → Firestore Database → 규칙 탭에 붙여넣고 게시하기 전에,
**규칙 플레이그라운드**에서 `workspaces/테스트/meta/config`(get)와 `.../meta/data`(get) 요청이
허용되는지 확인하세요. 문제가 생기면 이전 규칙으로 되돌릴 수 있도록 기존 규칙은 복사해 두세요.

## 앱 아이콘 (크롬 바로가기)
`public/`의 `favicon.svg`, `icons/*.png`, `apple-touch-icon.png`와 `manifest.webmanifest`가 크롬
"바로가기 만들기"/앱 설치 시 쓰이는 아이콘입니다. 현재 적용된 시안은 **골드 트로피**이며,
다른 시안(시상대·메달·왕관)의 원본 SVG는 `design/icon-options/`에 있습니다.
