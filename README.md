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
`firestore.rules` 참고. 코드를 아는 사람은 누구나 읽고 쓸 수 있는 수준입니다(Firebase Auth 미도입).
