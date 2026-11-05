# GeoScape · 지오스케이프

> **시간을 움직이면, 공간이 보인다.**

GeoScape는 고등학생이 한 지역의 과거·현재(·미래)를 시간축을 따라 탐험하며 **공간 변화의 모습, 원인, 인간과 환경의 상호작용**을 탐구하는 지리 학습 웹 프로그램입니다. 현재 버전은 **Phase 1 MVP + 역사 사진 연동**이며, 서울(1960–2025)을 첫 탐구 지역으로 제공합니다.

> 📷 **실제 역사 사진 55건**(1960~1980년대, Wikimedia Commons · 공공누리 제1유형/CC BY/PD)이 연동되어 있습니다. 수집·검증 과정과 추가 확보가 필요한 사진은 [docs/photo-collection-report.md](docs/photo-collection-report.md)를 보세요.

---

## 실행 방법

| 방법 | 지도 표시 속도* | 설명 |
|---|---|---|
| **`start-server.bat` 더블클릭 (권장)** | 약 0.7~1.2초 | Windows 기본 PowerShell로 로컬 서버를 켜고 브라우저를 엽니다. **Python 설치 불필요.** 창을 닫으면 종료됩니다. |
| **GitHub Pages** | 빠름 | 저장소 Settings → Pages → `main` 브랜치 루트 배포. 학생들에게 주소만 공유하면 됩니다. |
| `index.html` 더블클릭 | 약 2.4~2.6초 | 설치 없이 바로 실행되지만, OSM 공식 지도 서버가 파일 직접 열기를 차단해 해외(독일) 대체 서버를 쓰므로 느립니다. |
| `python -m http.server 8000` | 빠름 | Python이 있는 경우 |

\* 서울 첫 화면(타일 16장) 기준, 이 PC에서 실제 시간으로 측정한 값입니다. 네트워크 환경에 따라 다릅니다.

- Leaflet·Chart.js·Lucide는 `vendor/`에 포함되어 있어 CDN이 막힌 학교망에서도 동작합니다. 배경 지도 타일(OpenStreetMap)과 글꼴(Pretendard)은 인터넷 연결이 필요합니다(글꼴은 없으면 기본 글꼴로 표시).
- zip으로 받았다면 **압축을 푼 뒤** 실행하세요.

### 배경 지도 서버
배경 지도는 API 키가 필요 없는 OpenStreetMap 계열 서버를 씁니다. 지도는 서버 점검을 기다리지 않고 바로 그리기 시작하며, 점검은 동시에 진행합니다. OSM 공식 서버는 더블클릭(`file://`) 실행처럼 Referer가 없는 요청을 차단하므로, 실행할 때 시험 타일을 먼저 요청해 보고 **OSM 공식 → OSM Deutschland → Humanitarian OSM** 순으로 쓸 수 있는 서버를 자동 선택합니다. 사용 중에 타일 오류가 이어져도 다음 서버로 바뀝니다. 모든 서버에 연결할 수 없으면 배경 지도 없이 공간 레이어와 사진으로 계속 사용할 수 있습니다.

### 시간 이동 애니메이션
- 재생하면 하단 막대가 매 프레임 연속으로 미끄러지듯 움직입니다. 지도·정보·사진은 **정수 연도가 바뀔 때만** 갱신하므로, 자료가 없는 연도 사이의 값을 만들어 내지 않습니다.
- 시대·주요 시점·이전/다음 버튼을 누르면 막대가 목표 연도까지 부드럽게 이동합니다.
- 지도: 시가지·토지 이용 면은 **중심에서 퍼지며** 물결이 번지고, 교통망은 **선이 그려지듯**, 개발 지점·사진 마커는 **떠오르며** 고리가 퍼집니다. 시간을 되돌리면 서서히 흐려지며 사라집니다.
- 운영체제의 '애니메이션 줄이기' 설정을 켜면 모든 움직임이 생략됩니다.

### 안정성 장치
- 꼭 필요한 파일(지역 설정·시대 정보)이 아니면, 파일 하나를 불러오지 못하거나 형식이 틀려도 그 자료만 빼고 계속 실행합니다. 제외된 항목은 상단 **데이터 안내**의 '자료 점검 결과'에서 확인할 수 있습니다.
- 배포 후 브라우저가 옛 CSS·JS를 섞어 쓰지 않도록 `index.html`의 CSS·JS 주소에 내용 해시 버전을 붙입니다(`check.mjs --fix`가 자동 갱신).
- 데이터 요청 15초 시간 제한, 시작 실패 시 안내 화면, 예상치 못한 오류는 화면 아래 알림으로 표시합니다.
- 사진 파일을 불러오지 못하면 깨진 아이콘 대신 안내 문구를 보여 줍니다.

### 자료를 수정한 뒤 점검하기
```bash
node scripts/check.mjs --fix
```
JSON 형식, 연도 범위, 피처·출처 연결, 사진 파일·라이선스, JS 문법을 검사하고, 더블클릭용 번들(`dist/`)이 오래됐으면 다시 만듭니다. 커밋 전에 실행하세요.

### 더블클릭용 번들 다시 만들기
`js/` 또는 `data/`를 수정했다면 아래 명령으로 `dist/`를 다시 만들어야 더블클릭 실행에 반영됩니다. (웹 서버·GitHub Pages 실행에는 영향 없음)

```bash
node scripts/build-standalone.mjs
```

---

## Phase 1 구현 기능

| 영역 | 기능 |
|---|---|
| 헤더 | 브랜드·슬로건, 탐구 지역 선택(서울 / 두바이·싱가포르·상하이 준비 중), 탐구 모드(시간 탐색·과거·현재 비교·미래 시나리오 *준비 중*), 도움말 |
| 사이드바 | 지역 정보, 탐구 주제 4개(선택 시 관련 레이어 자동 구성 + 탐구 질문), 주요 시점 12개(클릭 시 연도 이동 + 지도 이동), 배경 지도 전환(밝은 지도·일반 지도·현재 위성), 레이어 on/off와 자료 상태 배지, 사진 갤러리 |
| 지도 | Leaflet 기반. 시가지 확장 단계, 교통망(개통 연도별), 토지 이용 변화, 주요 개발 지점, 사진 촬영 지점. 연도에 따라 피처가 나타나고 사라지며(페이드 전환), 시점별 범례가 갱신됨 |
| 정보 패널 | 시대 요약, 지리적 특징, 공간 변화의 배경, 주요 사례(클릭 → 지도 위치), 시기별 사진, 인구 그래프(현재 연도 표시), 탐구 질문, 자료 출처. 접기/펼치기 가능 |
| 타임라인 | 연도 슬라이더, 시대 구간 표시, 주요 연도 마커(툴팁), 재생/일시정지, 속도(0.5×–4×), 이전·다음 주요 시점 |
| 사진 | 실제 역사 사진 55건. 연도를 고르면 그 시대 사진이 선택 연도와 가까운 순으로 표시. 갤러리(시대별 필터) – 지도 연결 / 위치 미확인 / 이용 조건 미확인 / 추가 확보 필요 구분. 확대 보기에서 촬영 시기·장소·지리적 변화 해설·출처·라이선스 표시 |
| 비교 모드 | 좌우 두 지도의 범위·확대 수준 동기화, 연도 선택, 시대 특징 비교와 변화 해설(인구 변화, 새 개발 사례) |
| 기타 | 데이터 안내 창(자료 상태·출처), 첫 방문 도움말, 키보드 조작, 반응형(태블릿·모바일에서 서랍형 패널) |

### 키보드 조작
- `←` `→` : 1년 이동
- `Shift` + `←` `→` : 이전·다음 주요 시점
- `Space` : 재생 / 일시정지
- `Esc` : 창 닫기 (사진 확대 보기에서는 `←` `→`로 사진 이동)

---

## 공간 구조 시뮬레이터 (MapLibre GL)

헤더의 **시뮬레이터** 버튼으로 기존 탐구 화면과 시뮬레이터를 오갈 수 있습니다. 하단 타임라인(연도·재생)은 두 화면이 함께 씁니다. 시뮬레이터는 처음 열 때만 불러오므로 탐구 화면은 느려지지 않습니다.

| 요소 | 자료 | 표현 |
|---|---|---|
| 도시화 격자 | **GHSL GHS-BUILT-S R2023A** (EC JRC, 위성영상 기반 건물 피복 면적, 1975~2020년 5년 간격, CC BY 4.0) | 약 660 m × 650 m 칸 8,427개. 칸마다 건물이 덮은 면적 비율(%)을 색으로, 3D 보기에서는 높이로 표시 |
| 지하철 노선 | 선형·역: **OpenStreetMap** (ODbL) / 구간 개통일: **한국어 위키백과** 각 노선 「역사」 항목 대조 | 1~9호선·신분당선·GTX-A를 공식 색으로, 실제 개통일에 해당 구간이 선로를 따라 그려지며 새 역에 물결 표시 |
| 통계·알림 | 위 자료에서 계산 | 건물 피복 면적(km²), 운행 노선 수, 노선 길이(km), 역 수, 개통 소식 |

- **자료 원칙:** 도시화 격자는 관측 연도(1975, 1980, …, 2020) 값만 쓰며, 사이 연도에는 직전 관측값을 표시합니다(화면에 '○○년 위성 관측값'으로 안내). 1975년 이전은 위성 자료가 없어 지하철만 표시합니다. 관측값이 바뀔 때의 전환 효과와 구간이 그려지는 효과는 움직임일 뿐 자료가 아닙니다.
- **검증:** 만든 노선 길이를 공식 연장과 비교했습니다 (2호선 60.2 km, 3호선 57.3 km / 공식 57.4, 6호선 36.4 km, 9호선 40.6 km, 신분당선 33.2 km / 공식 33.4). 1975년 1호선 역 수 38개는 위키백과의 '1974년 38개 역 개통'과 일치합니다.
- **알려진 한계:** 1호선은 2개 운행 계통(인천~연천, 광운대~신창)만 반영해 광명·서동탄 지선은 빠져 있습니다. 4호선 진접선, 경의중앙선·공항철도·분당선·수인선 등은 아직 넣지 않았습니다.
- **배경 지도:** OpenFreeMap 벡터 지도(API 키 불필요). 연결이 안 되면 배경 없이 격자와 노선만 표시합니다.

### 시뮬레이터 자료 다시 만들기
```bash
python scripts/build_ghsl_grid.py <작업폴더> data/regions/seoul/sim/urban-grid.json
python scripts/build_subway.py <작업폴더> data/regions/seoul/sim/subway.json
node scripts/check.mjs --fix
```
`build_subway.py`의 `STAGES` 표에 노선·구간·개통일을 추가하면 새 노선을 넣을 수 있습니다. GHSL 타일은 약 30 MB × 10개를 내려받아 잘라 쓴 뒤 지웁니다.

---

## 자료 원칙과 현재 자료 상태

GeoScape는 **실제 관측 자료와 교육용 데모 자료를 구분**합니다. 화면 곳곳의 배지가 자료 상태를 알려 줍니다.

| 배지 | 의미 | 현재 해당 자료 |
|---|---|---|
| `데모` | 교육용 개략 형상. 실제 경계가 아님 | 시가지 확장 범위, 토지 이용 변화 |
| `개략` | 실제 좌표(역·지점) 기반이지만 선형·범위는 단순화 | 교통망, 주요 개발 지점, 인구 통계(원자료 대조 필요) |
| `검증` (사진) | 이용 조건을 확인한 실제 사진 | 역사 사진 55건 (지도 마커는 피사체 시설 위치, 촬영 지점 아님) |
| `검증` | 출처가 확인된 검증 자료 | (실제 자료 교체 시 사용) |

- 자료가 없는 연도에는 **값을 보간하거나 공간 분포를 만들어 내지 않습니다.** 각 피처는 `yearStart`/`yearEnd`에 따라 표시되고, 인구 그래프는 해당 연도 이전의 가장 최근 조사값만 강조합니다.
- 촬영 위치가 확인되지 않은 사진(`location.coords: null`)은 지도에 표시하지 않고 **지역 갤러리**에만 둡니다.
- 사진의 촬영 시기는 확실성(`day`·`month`·`year`)과 근거(제목·설명·Commons 촬영일)를 함께 기록합니다.
- 1990년대 이후처럼 실제 사진이 없는 시기에는 임의 이미지를 쓰지 않고 '추가 확보 필요' 목록을 보여 줍니다.
- 설명 문안은 공개 자료를 바탕으로 한 교육용 요약입니다. **수업 사용 전 연도·수치를 원자료(KOSIS 등)로 한 번 더 확인**하세요.

---

## 폴더 구조

```
지오스케이프/
├─ index.html                 # 화면 골격 (헤더·사이드바·지도·패널·타임라인·모달)
├─ css/style.css              # 디자인 토큰, 레이아웃, 반응형
├─ js/
│  ├─ main.js                 # 진입점: 데이터 로드 → 상태 → 모듈 연결, 범례·데이터 안내
│  ├─ store.js                # 구독형 상태 저장소 (year, mode, layers, basemap, topicId …)
│  ├─ data.js                 # 지역 레지스트리·지역 데이터 로더, 시대/사진/주요 시점 헬퍼
│  ├─ map-view.js             # Leaflet 지도 + 연도별 레이어 렌더링 (메인·비교 지도 공용)
│  ├─ timeline.js             # 슬라이더, 재생, 주요 시점 이동, 키보드
│  ├─ sidebar.js              # 지역 정보, 탐구 주제, 주요 시점, 레이어 UI
│  ├─ info-panel.js           # 시대별 정보 패널
│  ├─ stats-chart.js          # Chart.js 통계 그래프
│  ├─ gallery.js              # 사진 갤러리 + 확대 보기
│  ├─ compare.js              # 과거·현재 비교 모드
│  ├─ modal.js                # 모달 공통 동작
│  └─ utils.js                # 공통 유틸, 자료 상태 배지
├─ data/
│  ├─ regions.json            # 지역 목록 (활성/준비 중)
│  ├─ photos.json             # 정식 등록 사진(전 지역 공용, region 필드로 구분) + 미확인·추가 확보 목록
│  ├─ photo-sources/          # Commons 검증 보고서, 정정된 후보 목록, 추가 확보 필요 목록
│  └─ regions/seoul/
│     ├─ region.json          # 지도 설정, 시간 범위, 지역 정보, 탐구 주제, 주요 시점, 레이어 정의
│     ├─ eras.json            # 시대별 설명·사례·탐구 질문·출처 ID
│     ├─ sim/                 # 시뮬레이터 자료 (urban-grid.json, subway.json)
│     ├─ stats.json           # 통계 시계열
│     ├─ sources.json         # 출처·라이선스
│     └─ layers/*.geojson     # 공간 레이어
├─ assets/
│  ├─ logo.svg
│  └─ photos/1960s|1970s|1980s/  # 역사 사진 (1280px) + thumbs/ (420px)
├─ docs/photo-collection-report.md  # 사진 수집·검증·연동 보고서
├─ geoscape_seoul_photo_sources_safe/  # 제공받은 사진 후보 목록 원본 (CSV/JSON)
├─ vendor/                   # Leaflet 1.9.4, MapLibre GL 4.7.1, Chart.js 4.4.1, Lucide 0.469.0 (로컬 사본)
├─ dist/                     # 더블클릭 실행용 번들 (자동 생성: build-standalone.mjs)
├─ scripts/
│  ├─ check.mjs               # 자료·코드·번들 점검 (커밋 전 실행)
│  ├─ build_ghsl_grid.py      # 시뮬레이터 도시화 격자 (GHSL)
│  ├─ build_subway.py         # 시뮬레이터 지하철 노선망 (OSM + 개통일 표)
│  ├─ serve.ps1               # PowerShell 로컬 웹 서버 (start-server.bat에서 실행)
│  ├─ build-standalone.mjs    # file:// 실행용 번들 생성
│  ├─ gen-layers.mjs          # 데모 시가지·토지이용 형상 생성 (Node.js)
│  ├─ commons_photos.py       # Commons 사진 검증·다운로드 (Python + Pillow)
│  └─ build_photos_json.py    # data/photos.json 생성 (사진별 해설·위치 기준 포함)
└─ start-server.bat           # Windows 로컬 서버 실행
```

---

## 데이터 편집 가이드

### 1) 사진 추가하기 (`data/photos.json`)
Wikimedia Commons 사진은 스크립트로 검증·다운로드·등록합니다. 절차는 [docs/photo-collection-report.md](docs/photo-collection-report.md) 5장을 보세요.

사진 항목의 주요 필드:

| 필드 | 설명 |
|---|---|
| `date` | `label`(표시), `iso`, `certainty`(`day`/`month`/`year`), `basis`(날짜 근거) |
| `location` | `precision`(`camera` / `subject-facility` / `none`), `coords`([위도, 경도] 또는 `null`), `label`, `note` |
| `geography` | 학생용 지리적 변화 해설 |
| `source`, `license`, `attribution` | 저작자·원 출처·Commons 페이지, 라이선스 이름과 URL, 출처 표기 문구 |
| `contentType` | `historical-photo` · `contemporary-photo` · `reconstruction`(교육용 재구성, **생성형 AI 이미지는 반드시 이것으로 표시**) |
| `verification.notes` | 검증 중 발견한 불일치 등 |

위치를 모르면 `location.coords: null`로 두세요. 이용 조건이 확인되지 않은 후보는 `photos`가 아니라 `unverified`에 넣습니다.

### 2) 공간 레이어 교체하기 (`layers/*.geojson`)
- 좌표계는 WGS84(EPSG:4326), GeoJSON 좌표 순서는 `[경도, 위도]`.
- 피처 `properties`에 `id`, `name`, `yearStart`(필수), `yearEnd`(선택)를 넣으면 시간 필터가 자동 적용됩니다.
- 시가지 레이어는 `stage`(색상 단계), 교통망은 `mode`, 토지 이용은 `type`을 사용하며 스타일은 `region.json`의 `layers[]`에서 정의합니다.
- 검증된 자료로 교체했다면 `region.json`의 해당 레이어 `dataStatus`를 `"verified"`로 바꾸고 `metadata.notice`를 수정하세요.
- 옛 항공사진·지형도로 시가지 경계를 디지타이징하려면 국토정보플랫폼(국토지리정보원)의 연도별 항공사진을 참고할 수 있습니다.

### 3) 시대 설명 수정하기 (`eras.json`)
`start`/`end` 범위, `summary`, `features`, `background`, `cases[]`(`featureId`로 지도 피처와 연결), `questions`, `sourceIds`를 수정합니다.

### 4) 새 지역 추가하기 (예: 싱가포르)
1. `data/regions/singapore/`에 서울과 같은 구조의 파일을 만듭니다.
2. `data/regions.json`에서 해당 지역의 `"enabled": true`로 바꿉니다.
3. UI 코드는 수정할 필요가 없습니다. 지도 중심·시간 범위·레이어·주요 시점은 모두 `region.json`에서 읽습니다.

---

## 확장 로드맵

| 단계 | 내용 | 설계상 준비 |
|---|---|---|
| Phase 2 | 1990년대 이후·현재 사진 확보, 검증된 시가지 경계로 교체, 옛 지도/항공사진 배경 | `needed` 목록, `dataStatus`, 배경 지도 '옛 지도(예정)' 자리 |
| Phase 2 | 과거·현재 사진 비교(스와이프) | 라이트박스의 '사진 비교(예정)' 버튼, `compareGroup` |
| Phase 3 | 미래 시나리오(지속가능 도시 / 무분별한 확장 / 기후변화 적응) | 헤더 모드 버튼(비활성). 모든 미래 콘텐츠에 **'가상 시나리오'** 표시 예정, `timeRange.observedEnd` 이후 구간 |
| Phase 3 | 두바이·싱가포르·상하이 | `regions.json` 레지스트리 |
| 이후 | 학생 활동지(질문 답변 저장·내보내기), 교사용 수업 모드 | `store.js` 상태 확장 |

---

## 사용 기술과 라이선스

- [Leaflet 1.9.4](https://leafletjs.com) (BSD-2) · [MapLibre GL JS 4.7.1](https://maplibre.org) (BSD-3) · [Chart.js 4.4.1](https://www.chartjs.org) (MIT) · [Lucide Icons](https://lucide.dev) (ISC) · [Pretendard](https://github.com/orioncactus/pretendard) (OFL)
- 배경 지도: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL), 위성 영상: Esri World Imagery, 시뮬레이터 배경: [OpenFreeMap](https://openfreemap.org) · © OpenMapTiles
- 시뮬레이터 자료: GHSL GHS-BUILT-S R2023A © European Commission JRC (CC BY 4.0) · 지하철 선형 © OpenStreetMap contributors (ODbL) · 개통일 한국어 위키백과 (CC BY-SA 4.0)
- 역사 사진: 사진별 저작자·라이선스는 `data/photos.json`과 앱의 사진 확대 보기에 표시 (공공누리 제1유형, CC BY 3.0/4.0, 퍼블릭 도메인 – Wikimedia Commons 경유)
- 각 자료의 출처·이용 조건은 `data/regions/seoul/sources.json`과 앱의 **데이터 안내** 창에서 확인할 수 있습니다.
