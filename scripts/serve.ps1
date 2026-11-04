# GeoScape 로컬 웹 서버 (Windows 기본 PowerShell만 사용, Python 불필요)
# start-server.bat 에서 실행됩니다. 이 창을 닫으면 서버가 종료됩니다.
#
# 왜 필요한가: index.html 을 더블클릭(file://)하면 OpenStreetMap 공식 지도 서버가 요청을 차단해
# 유럽의 대체 서버(타일당 약 1초 이상)를 쓰게 됩니다. http://localhost 로 열면 빠른 공식 서버(타일당 약 0.05초)를 씁니다.
param([int]$Port = 8000, [switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$Mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.geojson' = 'application/geo+json; charset=utf-8'
  '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.webp' = 'image/webp'
  '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8'; '.txt' = 'text/plain; charset=utf-8'
}

# 사용 가능한 포트 찾기 (8000 → 8001 → …)
$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://localhost:$p/")
    $l.Start()
    $listener = $l; $Port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host '사용 가능한 포트를 찾지 못했습니다.' -ForegroundColor Red; Read-Host '엔터를 누르면 종료'; exit 1 }

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host "  GeoScape 실행 중:  $url" -ForegroundColor Cyan
Write-Host '  이 창을 닫으면 프로그램이 종료됩니다.' -ForegroundColor Gray
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
      if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
      $full = [IO.Path]::GetFullPath((Join-Path $Root $rel))
      # 프로젝트 폴더 밖 파일 접근 차단
      if (-not $full.StartsWith($Root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $full -PathType Leaf)) {
        $res.StatusCode = 404
        $bytes = [Text.Encoding]::UTF8.GetBytes('404 Not Found')
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $ext = [IO.Path]::GetExtension($full).ToLower()
        $res.ContentType = if ($Mime.ContainsKey($ext)) { $Mime[$ext] } else { 'application/octet-stream' }
        # 데이터·코드는 항상 최신, 사진·라이브러리는 캐시
        $res.Headers['Cache-Control'] = if ($ext -in '.jpg', '.jpeg', '.png', '.webp' -or $rel.StartsWith('vendor/')) { 'max-age=86400' } else { 'no-cache' }
        $fs = [IO.File]::OpenRead($full)
        try { $res.ContentLength64 = $fs.Length; $fs.CopyTo($res.OutputStream) } finally { $fs.Dispose() }
      }
    } catch {
      # 브라우저가 요청을 중간에 취소한 경우 등은 무시하고 계속
    } finally {
      try { $res.OutputStream.Close() } catch { }
    }
  }
} finally {
  $listener.Stop()
}
