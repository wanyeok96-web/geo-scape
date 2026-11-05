"""
GeoScape 시뮬레이터 – 수도권 전철 노선망 (실제 선형 + 구간별 개통일)

자료
- 선형·역 위치·역 순서: OpenStreetMap (© OpenStreetMap contributors, ODbL) – OSM API relation/full
- 구간별 개통일: 한국어 위키백과 각 노선 문서의 '역사' 항목(2026-11 조회)을 대조해 아래 STAGES 표로 정리
  (위키데이터 역 개통일(P1619)은 '역이 처음 생긴 날'이라 노선별 개통일과 달라 사용하지 않음)

처리
- 노선별로 대표 운행 계통(OSM route relation)의 정차역 순서를 쓰고,
  두 역 사이 선형은 그 노선의 철도 way 그래프에서 최단 경로로 찾습니다.
- 구간 개통일은 STAGES의 (시작역, 끝역) 범위에 드는 역 사이 구간에 적용합니다. 보간하지 않습니다.

사용법: python scripts/build_subway.py <작업폴더> data/regions/seoul/sim/subway.json
"""
import heapq
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

UA = {'User-Agent': 'GeoScapeEdu/0.1 (educational project; https://github.com/wanyeok96-web/geo-scape)'}

# 노선: id, 이름, 공식 색, 사용할 OSM route relation (운행 계통)
LINES = [
    ('L1', '1호선', '#0052A4', {'main': 16851104, 'gyeongbu': 8692707}),
    ('L2', '2호선', '#00A84D', {'loop': 2404374, 'seongsu': 4729405, 'sinjeong': 4729407}),
    ('L3', '3호선', '#EF7C1C', {'main': 443803}),
    ('L4', '4호선', '#00A5DE', {'main': 2718884}),
    ('L5', '5호선', '#996CAC', {'main': 12497486, 'macheon': 19427674}),
    ('L6', '6호선', '#CD7C2F', {'main': 12080315}),
    ('L7', '7호선', '#747F00', {'main': 12746493}),
    ('L8', '8호선', '#E6186C', {'main': 2718901}),
    ('L9', '9호선', '#BDB092', {'main': 2718888}),
    ('SB', '신분당선', '#D4003B', {'main': 'wikidata:Q20388'}),
    ('GA', 'GTX-A', '#9A6292', {'north': 18828088, 'south': 17413294}),
]

# 위키백과 표기 → 현재 OSM 역명
ALIAS = {'성북': '광운대', '서울역앞': '서울역', '한성대입구(삼선교)': '한성대입구', '서울운동장': '동대문역사문화공원',
         '당고개': '불암산', '운정': '운정중앙', '의정부북부': '가능', '주내': '양주', '율전': '성균관대', '지제': '평택지제'}

# (노선, 계통, 시작역, 끝역, 개통일)  ※ 출처: 한국어 위키백과 각 노선 문서 '역사' 항목
STAGES = [
    ('L1', 'main', '인천', '광운대', '1974-08-15'),        # 경인선 구로~인천, 서울역~청량리, 경원선 청량리~성북 직결 개통
    ('L1', 'gyeongbu', '구로', '수원', '1974-08-15'),      # 경부선 서울역~수원
    ('L1', 'main', '광운대', '창동', '1985-04-20'),
    ('L1', 'main', '창동', '의정부', '1986-09-02'),
    ('L1', 'main', '의정부', '소요산', '2006-12-15'),
    ('L1', 'main', '소요산', '연천', '2023-12-16'),
    ('L1', 'gyeongbu', '수원', '병점', '2003-04-30'),
    ('L1', 'gyeongbu', '병점', '천안', '2005-01-20'),
    ('L1', 'gyeongbu', '천안', '신창', '2008-12-15'),
    ('L2', 'seongsu', '신설동', '성수', '1980-10-31'),
    ('L2', 'loop', '성수', '종합운동장', '1980-10-31'),
    ('L2', 'loop', '종합운동장', '교대', '1982-12-23'),
    ('L2', 'loop', '을지로입구', '성수', '1983-09-16'),
    ('L2', 'loop', '교대', '서울대입구', '1983-12-17'),
    ('L2', 'loop', '서울대입구', '시청', '1984-05-22'),
    ('L2', 'loop', '시청', '을지로입구', '1984-05-22'),
    ('L2', 'sinjeong', '신도림', '양천구청', '1992-05-22'),
    ('L2', 'sinjeong', '양천구청', '신정네거리', '1996-02-29'),
    ('L2', 'sinjeong', '신정네거리', '까치산', '1996-03-20'),
    ('L3', 'main', '구파발', '독립문', '1985-07-12'),
    ('L3', 'main', '독립문', '양재', '1985-10-18'),
    ('L3', 'main', '지축', '구파발', '1990-07-13'),
    ('L3', 'main', '양재', '수서', '1993-10-30'),
    ('L3', 'main', '대화', '지축', '1996-01-30'),         # 일산선 직결
    ('L3', 'main', '수서', '오금', '2010-02-18'),
    ('L4', 'main', '상계', '한성대입구', '1985-04-20'),
    ('L4', 'main', '한성대입구', '사당', '1985-10-18'),
    ('L4', 'main', '금정', '안산', '1988-10-25'),         # 안산선
    ('L4', 'main', '금정', '인덕원', '1993-01-15'),       # 과천선
    ('L4', 'main', '불암산', '상계', '1993-04-21'),       # 당고개(현 불암산)
    ('L4', 'main', '인덕원', '사당', '1994-04-01'),
    ('L4', 'main', '안산', '오이도', '2000-07-28'),
    ('L5', 'main', '왕십리', '상일동', '1995-11-15'),
    ('L5', 'main', '방화', '까치산', '1996-03-20'),
    ('L5', 'macheon', '강동', '마천', '1996-03-30'),
    ('L5', 'main', '까치산', '여의도', '1996-08-12'),
    ('L5', 'main', '여의도', '왕십리', '1996-12-30'),
    ('L5', 'main', '상일동', '하남풍산', '2020-08-08'),
    ('L5', 'main', '하남풍산', '하남검단산', '2021-03-27'),
    ('L6', 'main', '봉화산', '상월곡', '2000-08-07'),
    ('L6', 'main', '응암', '상월곡', '2000-12-15'),
    ('L6', 'main', '응암', '역촌', '2000-12-15'),         # 응암순환 (응암→역촌→불광→독바위→연신내→구산→응암)
    ('L6', 'main', '역촌', '구산', '2000-12-15'),
    ('L6', 'main', '구산', '응암', '2000-12-15'),
    ('L6', 'main', '봉화산', '신내', '2019-12-21'),
    ('L7', 'main', '장암', '건대입구', '1996-10-11'),
    ('L7', 'main', '온수', '신풍', '2000-02-29'),
    ('L7', 'main', '신풍', '건대입구', '2000-08-01'),
    ('L7', 'main', '온수', '부평구청', '2012-10-27'),
    ('L7', 'main', '부평구청', '석남', '2021-05-22'),
    ('L8', 'main', '잠실', '모란', '1996-11-23'),
    ('L8', 'main', '잠실', '암사', '1999-07-02'),
    ('L8', 'main', '암사', '별내', '2024-08-10'),
    ('L9', 'main', '개화', '신논현', '2009-07-24'),
    ('L9', 'main', '신논현', '종합운동장', '2015-03-28'),
    ('L9', 'main', '종합운동장', '중앙보훈병원', '2018-12-01'),
    ('SB', 'main', '강남', '정자', '2011-10-28'),
    ('SB', 'main', '정자', '광교', '2016-01-30'),
    ('SB', 'main', '신사', '강남', '2022-05-28'),
    ('GA', 'south', '수서', '동탄', '2024-03-30'),
    ('GA', 'north', '운정중앙', '서울역', '2024-12-28'),
]

# 노선 구간보다 늦게 문을 연 역 (위키백과 '역사' 항목에 명시된 것만)
LATE_STATIONS = {
    ('L1', '성균관대'): '1979-02-01', ('L1', '신이문'): '1980-01-05', ('L1', '회기'): '1980-04-01',
    ('L1', '석수'): '1982-08-02', ('L1', '신도림'): '1984-05-22', ('L1', '백운'): '1984-11-20',
    ('L1', '석계'): '1985-01-14', ('L1', '가능'): '1987-10-05', ('L1', '중동'): '1987-12-31',
    ('L1', '온수'): '1988-01-16', ('L1', '금정'): '1988-10-25', ('L1', '간석'): '1994-07-11',
    ('L1', '도원'): '1994-07-11', ('L1', '구일'): '1995-02-16', ('L1', '부개'): '1996-03-28',
    ('L1', '소사'): '1997-04-30', ('L1', '신길'): '1997-04-30', ('L1', '독산'): '1998-01-07',
    ('L1', '도화'): '2001-11-30', ('L1', '세마'): '2005-12-27', ('L1', '오산대'): '2005-12-27',
    ('L1', '진위'): '2006-06-30', ('L1', '평택지제'): '2006-06-30', ('L1', '녹양'): '2006-12-15',
    ('L1', '보산'): '2006-12-15', ('L1', '양주'): '2006-12-15', ('L1', '덕계'): '2007-12-28',
    ('L1', '당정'): '2010-01-21', ('L1', '탕정'): '2021-10-30',
    ('L2', '용두'): '2005-10-20',
    ('L6', '약수'): '2001-03-09', ('L6', '버티고개'): '2001-03-09', ('L6', '한강진'): '2001-03-09', ('L6', '이태원'): '2001-03-09',
    ('L5', '강일'): '2021-03-27',
    ('L8', '남위례'): '2021-12-18',
    ('L9', '마곡나루'): '2014-05-24',
    ('SB', '미금'): '2018-04-28',
    ('GA', '구성'): '2024-06-29',
}


def fetch(url, cache: Path):
    if cache.exists():
        return cache.read_bytes()
    for attempt in range(4):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120).read()
            cache.write_bytes(data)
            time.sleep(1)
            return data
        except Exception as e:
            print('  retry', url, e, flush=True)
            time.sleep(3 * (attempt + 1))
    raise RuntimeError('download failed: ' + url)


def resolve_relation(spec, work):
    """'wikidata:Qxx' → Wikidata P402(OSM relation) → route_master면 가장 정차역이 많은 route 선택"""
    if isinstance(spec, int):
        return spec
    qid = spec.split(':')[1]
    d = json.loads(fetch(f'https://www.wikidata.org/wiki/Special:EntityData/{qid}.json', work / f'{qid}.json'))
    rid = int(d['entities'][qid]['claims']['P402'][0]['mainsnak']['datavalue']['value'])
    root = ET.fromstring(fetch(f'https://api.openstreetmap.org/api/0.6/relation/{rid}', work / f'rel_{rid}.xml'))
    rel = root.find('relation')
    tags = {t.get('k'): t.get('v') for t in rel.findall('tag')}
    if tags.get('type') == 'route_master':
        best, best_n = None, -1
        for m in rel.findall('member'):
            sub = int(m.get('ref'))
            r2 = ET.fromstring(fetch(f'https://api.openstreetmap.org/api/0.6/relation/{sub}', work / f'rel_{sub}.xml')).find('relation')
            n = sum(1 for x in r2.findall('member') if x.get('type') == 'node' and x.get('role', '').startswith('stop'))
            if n > best_n:
                best, best_n = sub, n
        return best
    return rid


def clean(name):
    name = re.sub(r'\s*\(.*?\)', '', name or '').strip()
    return re.sub(r'역$', '', name) if len(name) > 2 and name.endswith('역') and name not in ('서울역',) else name


def load_route(rid, work):
    root = ET.fromstring(fetch(f'https://api.openstreetmap.org/api/0.6/relation/{rid}/full', work / f'full_{rid}.xml'))
    nodes = {n.get('id'): (float(n.get('lon')), float(n.get('lat')), {t.get('k'): t.get('v') for t in n.findall('tag')}) for n in root.findall('node')}
    ways = {w.get('id'): [nd.get('ref') for nd in w.findall('nd')] for w in root.findall('way')}
    rel = next(r for r in root.findall('relation') if r.get('id') == str(rid))
    stops, track = [], []
    for m in rel.findall('member'):
        role = m.get('role', '')
        if m.get('type') == 'node' and role.startswith('stop') and m.get('ref') in nodes:
            lon, lat, tg = nodes[m.get('ref')]
            stops.append((clean(tg.get('name:ko') or tg.get('name')), lon, lat))
        elif m.get('type') == 'way' and role in ('', 'forward', 'backward') and m.get('ref') in ways:
            track.append(ways[m.get('ref')])
    return stops, track, nodes


def haversine(a, b):
    x = math.radians(b[0] - a[0]) * math.cos(math.radians((a[1] + b[1]) / 2))
    y = math.radians(b[1] - a[1])
    return 6371000 * math.hypot(x, y)


class Graph:
    def __init__(self):
        self.adj, self.pos = {}, {}

    def add(self, track, nodes):
        for w in track:
            for a, b in zip(w, w[1:]):
                if a not in nodes or b not in nodes:
                    continue
                pa, pb = nodes[a][:2], nodes[b][:2]
                self.pos[a], self.pos[b] = pa, pb
                d = haversine(pa, pb)
                self.adj.setdefault(a, []).append((b, d))
                self.adj.setdefault(b, []).append((a, d))

    def snap(self, tol=25):
        """서로 다른 선로 조각이 노드를 공유하지 않고 끊겨 있으면 25 m 이내 점끼리 연결"""
        cell = 0.0004
        buckets = {}
        for k, (x, y) in self.pos.items():
            buckets.setdefault((int(x / cell), int(y / cell)), []).append(k)
        added = 0
        for (bx, by), ks in buckets.items():
            near = [k2 for dx in (-1, 0, 1) for dy in (-1, 0, 1) for k2 in buckets.get((bx + dx, by + dy), [])]
            for a in ks:
                for b in near:
                    if a < b and b not in {v for v, _ in self.adj.get(a, [])}:
                        d = haversine(self.pos[a], self.pos[b])
                        if d <= tol:
                            self.adj.setdefault(a, []).append((b, d)); self.adj.setdefault(b, []).append((a, d)); added += 1
        return added

    def nearest(self, p):
        return min(self.pos, key=lambda k: haversine(self.pos[k], p))

    def path(self, p, q):
        s, t = self.nearest(p), self.nearest(q)
        dist, prev, pq = {s: 0}, {}, [(0, s)]
        while pq:
            d, u = heapq.heappop(pq)
            if u == t:
                break
            if d > dist.get(u, 1e18):
                continue
            for v, w in self.adj.get(u, []):
                nd = d + w
                if nd < dist.get(v, 1e18):
                    dist[v], prev[v] = nd, u
                    heapq.heappush(pq, (nd, v))
        if t not in dist:
            return None
        seq, u = [t], t
        while u != s:
            u = prev[u]
            seq.append(u)
        seq.reverse()
        return [self.pos[k] for k in seq]


def simplify(pts, tol=12):
    """Douglas-Peucker (m 단위 허용오차)로 좌표 수를 줄임"""
    if len(pts) < 3:
        return pts
    a, b = pts[0], pts[-1]
    def dist(p):
        if a == b:
            return haversine(p, a)
        ax, ay = 0, 0
        bx, by = haversine(a, (b[0], a[1])) * (1 if b[0] >= a[0] else -1), haversine(a, (a[0], b[1])) * (1 if b[1] >= a[1] else -1)
        px, py = haversine(a, (p[0], a[1])) * (1 if p[0] >= a[0] else -1), haversine(a, (a[0], p[1])) * (1 if p[1] >= a[1] else -1)
        return abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / math.hypot(bx - ax, by - ay)
    i, dmax = max(((i, dist(p)) for i, p in enumerate(pts[1:-1], 1)), key=lambda x: x[1])
    if dmax <= tol:
        return [a, b]
    return simplify(pts[:i + 1], tol)[:-1] + simplify(pts[i:], tol)


def main(work, out):
    work = Path(work); work.mkdir(parents=True, exist_ok=True)
    result = []
    for lid, lname, color, variants in LINES:
        print('==', lname, flush=True)
        graph, seqs = Graph(), {}
        for key, spec in variants.items():
            rid = resolve_relation(spec, work)
            stops, track, nodes = load_route(rid, work)
            graph.add(track, nodes)
            # 같은 역이 연속으로 나오면(플랫폼 중복) 하나로
            seq = []
            for s in stops:
                if not seq or seq[-1][0] != s[0]:
                    seq.append(s)
            seqs[key] = seq
            print(f'   {key}: relation {rid}, {len(seq)} stops, {len(track)} ways')
        print('   snapped joints:', graph.snap())
        segs, stations = {}, {}
        for (l, key, a, b, date) in STAGES:
            if l != lid:
                continue
            a, b = ALIAS.get(a, a), ALIAS.get(b, b)
            seq = seqs[key]
            names = [s[0] for s in seq]
            ia = [i for i, n in enumerate(names) if n == a]
            ib = [i for i, n in enumerate(names) if n == b]
            if not ia or not ib:
                raise SystemExit(f'역 이름을 찾지 못함: {lid} {key} {a}~{b}')
            i, j = min(((x, y) for x in ia for y in ib), key=lambda p: abs(p[0] - p[1]))
            lo, hi = min(i, j), max(i, j)
            for k in range(lo, hi):
                s1, s2 = seq[k], seq[k + 1]
                pair = tuple(sorted((s1[0], s2[0])))
                if pair in segs and segs[pair]['open'] <= date:
                    continue
                path = graph.path(s1[1:], s2[1:])
                approx = path is None
                path = path or [s1[1:], s2[1:]]
                if len(path) > 2:
                    # 최단 경로가 역 사이 직선거리의 3배를 넘으면 그래프가 끊긴 것 → 직선 대체
                    plen = sum(haversine(p, q) for p, q in zip(path, path[1:]))
                    if plen > 3 * haversine(s1[1:], s2[1:]) + 300:
                        path, approx = [s1[1:], s2[1:]], True
                coords = [s1[1:]] + simplify(path)[1:-1] + [s2[1:]]
                segs[pair] = {'from': s1[0], 'to': s2[0], 'open': date, 'coords': [[round(x, 5), round(y, 5)] for x, y in coords]}
                if approx:
                    segs[pair]['approx'] = True  # 선로 정보가 끊겨 역 사이 직선으로 표시
            for k in range(lo, hi + 1):
                n, lon, lat = seq[k]
                d = LATE_STATIONS.get((lid, n), date)
                if n not in stations or stations[n]['open'] > d:
                    stations[n] = {'name': n, 'coord': [round(lon, 5), round(lat, 5)], 'open': max(d, date) if (lid, n) in LATE_STATIONS else d}
        print(f'   segments {len(segs)}, stations {len(stations)}, first {min(s["open"] for s in segs.values())}')
        result.append({'id': lid, 'name': lname, 'color': color,
                       'segments': sorted(segs.values(), key=lambda s: s['open']),
                       'stations': sorted(stations.values(), key=lambda s: s['open'])})
    # 개통 소식 목록 (시뮬레이터 알림용): 같은 날 같은 노선 구간은 하나로
    meta = {lid: (ln, col) for lid, ln, col, _ in LINES}
    events = {}
    for (l, key, a, b, date) in STAGES:
        a, b = ALIAS.get(a, a), ALIAS.get(b, b)
        k = (l, date)
        if k in events:
            events[k]['sections'].append(f'{a}~{b}')
        else:
            events[k] = {'date': date, 'line': l, 'name': meta[l][0], 'color': meta[l][1], 'sections': [f'{a}~{b}'], 'kind': 'section'}
    for (l, st), date in LATE_STATIONS.items():
        events[(l, date, st)] = {'date': date, 'line': l, 'name': meta[l][0], 'color': meta[l][1], 'sections': [f'{st}역'], 'kind': 'station'}
    event_list = sorted(events.values(), key=lambda e: e['date'])
    data = {
        'events': event_list,
        'description': '수도권 전철 노선별 구간 개통 – 개통일에 해당 구간이 나타나며 보간하지 않음',
        'sources': [
            {'title': 'OpenStreetMap (노선 선형·역 위치·역 순서)', 'license': 'ODbL 1.0', 'url': 'https://www.openstreetmap.org/copyright'},
            {'title': '한국어 위키백과 각 노선 문서 「역사」 항목 (구간 개통일, 2026-11 조회)', 'license': 'CC BY-SA 4.0', 'url': 'https://ko.wikipedia.org/wiki/수도권_전철'},
        ],
        'notes': ['역 이름은 현재 이름으로 표시 (예: 성북→광운대, 당고개→불암산).',
                  '노선 선형은 OSM 철도 선로를 따라가며, 선로 정보가 끊긴 구간은 역 사이 직선으로 표시.',
                  '1호선 경원선·경부선·경인선 구간은 1974년 직결 운행 시작일 기준.'],
        'lines': result,
    }
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print('saved', out, round(Path(out).stat().st_size / 1024), 'KB')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
