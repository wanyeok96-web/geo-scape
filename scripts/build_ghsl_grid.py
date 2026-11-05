"""
GeoScape 시뮬레이터 – 실측 도시화 격자 생성 (GHSL GHS-BUILT-S R2023A)

자료: European Commission, Joint Research Centre (JRC)
      GHS-BUILT-S R2023A – 건물 피복 면적, 1975~2020년 5년 간격, 3 arcsec(약 100 m) 격자
      https://ghsl.jrc.ec.europa.eu/  ·  라이선스 CC BY 4.0
      Pesaresi M., Politis P. (2023) GHS-BUILT-S R2023A. European Commission, JRC. doi:10.2905/9F06F36F-4B11-47EC-ABB0-4F8B7B1D72EA

처리: 수도권(위도 37.15~37.85, 경도 126.55~127.35)을 잘라 9×7 화소(약 660 m × 650 m) 칸으로 묶고,
      칸마다 '건물이 덮은 면적 비율(%)'을 연도별로 계산합니다. 값은 관측 연도(5년 간격)만 저장하며 보간하지 않습니다.

사용법 (프로젝트 루트):
  python scripts/build_ghsl_grid.py <작업폴더> data/regions/seoul/sim/urban-grid.json
  ※ 타일(약 30 MB × 10개)을 작업폴더에 내려받고, 잘라낸 뒤 원본 zip은 지웁니다.
"""
import io
import json
import math
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import tifffile

EPOCHS = [1975, 1980, 1985, 1990, 1995, 2000, 2005, 2010, 2015, 2020]
TILE = 'R6_C31'
URL = ('https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_BUILT_S_GLOBE_R2023A/'
       'GHS_BUILT_S_E{y}_GLOBE_R2023A_4326_3ss/V1-0/tiles/GHS_BUILT_S_E{y}_GLOBE_R2023A_4326_3ss_V1_0_{t}.zip')
BBOX = dict(lat_min=37.15, lat_max=37.85, lon_min=126.55, lon_max=127.35)
BX, BY = 9, 7          # 묶을 화소 수 (경도, 위도 방향)
MIN_PCT_2020 = 3       # 2020년 건물 피복률이 이 값(%) 미만인 칸은 제외 (산지·하천·농지)


def crop_epoch(workdir: Path, year: int):
    cache = workdir / f'crop_{year}.npz'
    if cache.exists():
        z = np.load(cache)
        return z['a'], tuple(z['geo'])
    zpath = workdir / f'{year}_{TILE}.zip'
    if not zpath.exists():
        print('download', year, flush=True)
        req = urllib.request.Request(URL.format(y=year, t=TILE), headers={'User-Agent': 'GeoScapeEdu/0.1'})
        with urllib.request.urlopen(req, timeout=600) as r:
            zpath.write_bytes(r.read())
    with zipfile.ZipFile(zpath) as z:
        name = next(n for n in z.namelist() if n.endswith('.tif'))
        with tifffile.TiffFile(io.BytesIO(z.read(name))) as t:
            page = t.pages[0]
            sx, sy, _ = page.tags['ModelPixelScaleTag'].value
            _, _, _, x0, y0, _ = page.tags['ModelTiepointTag'].value
            c0 = int(math.floor((BBOX['lon_min'] - x0) / sx)); c1 = int(math.ceil((BBOX['lon_max'] - x0) / sx))
            r0 = int(math.floor((y0 - BBOX['lat_max']) / sy)); r1 = int(math.ceil((y0 - BBOX['lat_min']) / sy))
        # 화소 해독은 Pillow 사용 (LZW 압축 지원, 추가 패키지 불필요). 좌표 정보만 tifffile로 읽음
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = None
        with Image.open(io.BytesIO(z.read(name))) as im:
            arr = np.array(im.crop((c0, r0, c1, r1)), dtype=np.float32)
    geo = (x0 + c0 * sx, y0 - r0 * sy, sx, sy)  # 왼쪽 위 경도, 위도, 화소 크기
    np.savez_compressed(cache, a=arr, geo=np.array(geo))
    zpath.unlink()  # 원본 zip 삭제 (용량 절약)
    return arr, geo


def main(workdir, out):
    workdir = Path(workdir); workdir.mkdir(parents=True, exist_ok=True)
    layers, geo = [], None
    for y in EPOCHS:
        a, geo = crop_epoch(workdir, y)
        layers.append(a)
    lon0, lat0, sx, sy = geo
    h, w = layers[0].shape
    rows, cols = h // BY, w // BX
    lat_c = lat0 - (rows * BY * sy) / 2
    px_area = (sy * 111_320) * (sx * 111_320 * math.cos(math.radians(lat_c)))  # 화소 면적(m²)
    cells = []
    for r in range(rows):
        for c in range(cols):
            vals = []
            for a in layers:
                block = a[r * BY:(r + 1) * BY, c * BX:(c + 1) * BX]
                vals.append(int(round(min(100, block.sum() / (block.size * px_area) * 100))))
            if vals[-1] >= MIN_PCT_2020:
                cells.append([c, r] + vals)
    data = {
        'description': '수도권 건물 피복률(%) 격자 – 관측 연도(5년 간격) 값만 수록, 보간 없음',
        'source': 'European Commission, JRC – GHS-BUILT-S R2023A (Pesaresi & Politis 2023), doi:10.2905/9F06F36F-4B11-47EC-ABB0-4F8B7B1D72EA',
        'license': 'CC BY 4.0',
        'sourceUrl': 'https://ghsl.jrc.ec.europa.eu/ghs_buS2023.php',
        'processing': f'3 arcsec 격자를 {BX}×{BY} 화소(약 {round(BX*sx*111320*math.cos(math.radians(lat_c)))} m × {round(BY*sy*111320)} m)로 묶어 피복률 계산, 2020년 {MIN_PCT_2020}% 미만 칸 제외',
        'epochs': EPOCHS,
        'grid': {'lon0': round(lon0, 6), 'lat0': round(lat0, 6), 'dlon': round(BX * sx, 8), 'dlat': round(BY * sy, 8), 'cols': cols, 'rows': rows},
        'fields': ['col', 'row'] + [f'p{y}' for y in EPOCHS],
        'cells': cells,
    }
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    tot = [sum(cell[2 + i] for cell in cells) for i in range(len(EPOCHS))]
    print('cells', len(cells), 'grid', cols, 'x', rows, 'size KB', round(Path(out).stat().st_size / 1024))
    print('built-up index by epoch:', dict(zip(EPOCHS, tot)))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
