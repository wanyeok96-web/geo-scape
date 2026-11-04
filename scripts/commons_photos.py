"""
GeoScape – Wikimedia Commons 사진 후보 검증·수집 스크립트

사용법 (프로젝트 루트에서):
  python scripts/commons_photos.py check    <targets.json> <report.json>
  python scripts/commons_photos.py download <report.json>  <assets/photos>

check    : 후보 파일마다 Commons API로 존재 여부, 원본 URL, 라이선스, 작성자,
           촬영일, 좌표, 삭제 요청 여부를 조회해 report.json으로 저장합니다.
download : report.json에서 status == "approved" 인 항목만 시대별 폴더로 내려받습니다.
           (원본 대신 폭 1280px 썸네일을 받아 용량을 줄입니다.)
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://commons.wikimedia.org/w/api.php"
UA = "GeoScapeEdu/0.1 (educational project; https://github.com/wanyeok96-web/geo-scape)"
THUMB_WIDTH = 1280

# Commons 라이선스 짧은 이름 → 정식 콘텐츠 허용 여부
FREE_LICENSE_PATTERNS = [
    r"^public domain", r"^pd", r"^cc0", r"^cc by(-sa)? ", r"^cc by(-sa)?$", r"^kogl type 1", r"공공누리 제1유형",
]


def get(params):
    url = API + "?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": "2"})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def strip_html(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", str(s) if s is not None else "")).strip()


def is_free(short_name):
    s = (short_name or "").strip().lower()
    return any(re.search(p, s) for p in FREE_LICENSE_PATTERNS)


def check(targets_path, report_path):
    targets = json.load(open(targets_path, encoding="utf-8"))
    results = []
    for i in range(0, len(targets), 20):
        chunk = targets[i:i + 20]
        titles = ["File:" + t["commons_filename"] for t in chunk]
        data = get({
            "action": "query", "titles": "|".join(titles),
            "prop": "imageinfo|coordinates|categories",
            "iiprop": "url|size|mime|extmetadata", "iiurlwidth": THUMB_WIDTH,
            "coprop": "type|name", "coprimary": "all", "cllimit": "max",
        })
        norm = {n["from"]: n["to"] for n in data["query"].get("normalized", [])}
        pages = {p["title"]: p for p in data["query"]["pages"]}
        for t, title in zip(chunk, titles):
            page = pages.get(norm.get(title, title), {})
            item = {"target": t, "title": norm.get(title, title)}
            if page.get("missing") or not page.get("imageinfo"):
                item.update(status="missing", reason="Commons에 해당 파일 없음")
                results.append(item)
                continue
            ii = page["imageinfo"][0]
            md = {k: strip_html(v.get("value")) for k, v in ii.get("extmetadata", {}).items()}
            cats = [c["title"] for c in page.get("categories", [])]
            flags = [c for c in cats if re.search(r"deletion|copyright violation|no permission|no license|no source", c, re.I)]
            coords = page.get("coordinates") or []
            cam = next((c for c in coords if c.get("type") in (None, "camera") or c.get("primary") is not None), None)
            item.update(
                pageUrl=ii.get("descriptionurl"), originalUrl=ii.get("url"), thumbUrl=ii.get("thumburl"),
                mime=ii.get("mime"), width=ii.get("width"), height=ii.get("height"),
                license=md.get("LicenseShortName"), licenseUrl=md.get("LicenseUrl"),
                usageTerms=md.get("UsageTerms"), artist=md.get("Artist"), credit=md.get("Credit"),
                dateOriginal=md.get("DateTimeOriginal") or md.get("DateTime"),
                description=md.get("ImageDescription"), attributionRequired=md.get("AttributionRequired"),
                restrictions=md.get("Restrictions"), coordinates=coords, flags=flags, categories=cats,
            )
            if flags:
                item.update(status="rejected", reason="삭제·저작권 문제 분류: " + ", ".join(flags))
            elif not is_free(item["license"]):
                item.update(status="unverified", reason=f"라이선스 확인 불가 또는 비자유 라이선스: {item['license']}")
            else:
                item.update(status="approved", reason="자유 라이선스 확인")
            results.append(item)
        time.sleep(1)
    json.dump(results, open(report_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    by = {}
    for r in results:
        by[r["status"]] = by.get(r["status"], 0) + 1
    print("checked", len(results), by)


def era_folder(year):
    return f"{(int(year) // 10) * 10}s"


MAX_SIDE = 1280    # 본 이미지 최대 변 길이
THUMB_SIDE = 420   # 갤러리 썸네일 최대 변 길이


def save_jpeg(body, dest, max_side):
    """Pillow로 열어 RGB JPEG로 재저장 (이미지가 아니면 예외 발생 → 다운로드 실패 처리)"""
    import io
    from PIL import Image
    im = Image.open(io.BytesIO(body))
    im.load()
    im = im.convert("RGB")
    im.thumbnail((max_side, max_side))
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.save(dest, "JPEG", quality=82, optimize=True, progressive=True)
    return im.size


def download(report_path, out_dir):
    report = json.load(open(report_path, encoding="utf-8"))
    out = Path(out_dir)
    for idx, r in enumerate(report, 1):
        if r["status"] != "approved":
            continue
        name = f"seoul-{idx:03d}.jpg"
        era = era_folder(r["target"]["year"])
        rel, rel_thumb = f"{era}/{name}", f"{era}/thumbs/{name}"
        dest, dest_thumb = out / rel, out / rel_thumb
        if not (dest.exists() and dest_thumb.exists()):
            req = urllib.request.Request(r["thumbUrl"], headers={"User-Agent": UA})
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    body = resp.read()
                r["savedSize"] = save_jpeg(body, dest, MAX_SIDE)
                save_jpeg(body, dest_thumb, THUMB_SIDE)
            except Exception as e:  # 네트워크 오류·이미지가 아닌 응답
                r["status"] = "download-failed"
                r["reason"] = f"이미지 다운로드 실패: {e}"
                print("FAIL", idx, e)
                continue
            time.sleep(0.5)
        r["localFile"] = rel
        r["localThumb"] = rel_thumb
        r["bytes"] = dest.stat().st_size
        print("ok", rel, r["bytes"])
    json.dump(report, open(report_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    cmd, a, b = sys.argv[1:4]
    {"check": check, "download": download}[cmd](a, b)
