# Step 1 — 真实生 8 张关键帧 (Luckin × Erke 1-min ad)
#
# 流程：
#   1. 把 image/1778657723_f411dd72.png 上传到 COS, 拿 product_url
#   2. 用角色描述生 林溪角色九宫图, 拿 character_url
#   3. 并行调 /api/generate/image × 8:
#        - shots 1, 2 (productOnly): reference_images = [product_url]
#        - shots 3-8 (withCharacter): reference_images = [product_url, character_url]
#   4. 下载所有图到 keyframes/, 输出 results JSON
#
# 验证 Agent 工具栈端到端：
#   shotPrompts / productImage / productOnlyShots 已通过 vitest 8/8 验证
#   本脚本完成"Agent 决策 → 真实素材"的兑现, 是 generate_workflow 工具
#   调用的真实执行环节。

$ErrorActionPreference = 'Stop'
$reportDir = $PSScriptRoot
$promptsFile = Join-Path $reportDir 'prompts.json'
$keyframesDir = Join-Path $reportDir 'keyframes'
$resultsFile = Join-Path $reportDir 'step1-keyframes-results.json'
$productImageLocal = Join-Path $reportDir '..\..\image\1778657723_f411dd72.png'

if (-not (Test-Path $keyframesDir)) { New-Item -ItemType Directory -Path $keyframesDir | Out-Null }
if (-not (Test-Path $productImageLocal)) { throw "Product image not found: $productImageLocal" }

$prompts = Get-Content $promptsFile -Raw -Encoding utf8 | ConvertFrom-Json

# ── 1. Upload product image to COS ─────────────────────────────────────
Write-Host "[1/3] Uploading product image to COS ..." -ForegroundColor Cyan
$bytes = [System.IO.File]::ReadAllBytes($productImageLocal)
$dataUrl = 'data:image/png;base64,' + [Convert]::ToBase64String($bytes)
$uploadBody = @{ data = $dataUrl; filename = 'luckin-erke-product.png' } | ConvertTo-Json -Depth 5
$uploadResp = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/upload/image' `
    -Method POST -Body $uploadBody -ContentType 'application/json' -TimeoutSec 120
$productUrl = $uploadResp.data.url
if (-not $productUrl) { throw "Upload failed: $($uploadResp | ConvertTo-Json -Depth 3)" }
Write-Host "  product_url = $productUrl" -ForegroundColor Green

# ── 2. Generate character reference sheet for 林溪 ──────────────────────
Write-Host "`n[2/3] Generating character reference image for 林溪 ..." -ForegroundColor Cyan
$characterPrompt = "Character reference sheet for Lin Xi: $($prompts.character.appearance) Full body front view standing in a neutral studio setting, soft three-point lighting, calm warm smile, photo-real, ultra-detailed, sharp focus, 8K commercial portrait photography. Single shot, single pose, no grid, no collage."
$charBody = @{
    model_id = 'gpt-image-2'
    prompt   = $characterPrompt
    params   = @{ size = '1024x1024'; resolution = '2048' }
} | ConvertTo-Json -Depth 5
$charResp = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/api/generate/image' `
    -Method POST -Body $charBody -ContentType 'application/json' -TimeoutSec 300
if ($charResp.code -ne 0) { throw "Character gen failed: $($charResp.message)" }
$characterUrl = $charResp.data.images[0].url
if (-not $characterUrl) { throw "No URL returned for character: $($charResp | ConvertTo-Json -Depth 3)" }
Write-Host "  character_url = $characterUrl" -ForegroundColor Green

# Save character locally too
$charLocal = Join-Path $keyframesDir 'character-林溪.png'
try {
    Invoke-WebRequest -Uri $characterUrl -OutFile $charLocal -UseBasicParsing -TimeoutSec 60
    Write-Host "  saved -> $charLocal" -ForegroundColor Gray
} catch {
    Write-Host "  download warning: $_" -ForegroundColor Yellow
}

# ── 3. Parallel generate 8 keyframes ────────────────────────────────────
Write-Host "`n[3/3] Launching 8 parallel keyframe jobs ..." -ForegroundColor Cyan
$startAll = Get-Date
$jobs = @()
foreach ($shot in $prompts.shots) {
    $refImages = @($productUrl)
    if ($shot.include_character) { $refImages += $characterUrl }
    
    # gpt-image-2 仅支持 1024x1024 (与 v0.2 一致)
    $size = '1024x1024'
    
    $job = Start-Job -Name "luckin-shot$($shot.id)" -ScriptBlock {
        param($prompt, $shotId, $shotLabel, $aspectRatio, $refImages, $includeChar, $size)
        $body = @{
            model_id         = 'gpt-image-2'
            prompt           = $prompt
            reference_images = $refImages
            params           = @{ size = $size; resolution = '2048' }
        } | ConvertTo-Json -Depth 5
        $start = Get-Date
        try {
            $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/generate/image' `
                -Method POST -Body $body -ContentType 'application/json' `
                -UseBasicParsing -TimeoutSec 300
            $elapsed = [int]((Get-Date) - $start).TotalSeconds
            $j = $r.Content | ConvertFrom-Json
            return @{
                ok                = ($j.code -eq 0)
                shot_id           = $shotId
                shot_label        = $shotLabel
                aspect_ratio      = $aspectRatio
                include_character = $includeChar
                ref_image_count   = $refImages.Count
                elapsed_s         = $elapsed
                url               = $j.data.images[0].url
                code              = $j.code
                message           = $j.message
                prompt_len        = $prompt.Length
            }
        } catch {
            return @{
                ok        = $false
                shot_id   = $shotId
                shot_label = $shotLabel
                elapsed_s = [int]((Get-Date) - $start).TotalSeconds
                error     = $_.Exception.Message
            }
        }
    } -ArgumentList $shot.image_prompt, $shot.id, $shot.label, $shot.aspect_ratio, $refImages, $shot.include_character, $size
    $jobs += $job
    $refDesc = if ($shot.include_character) { 'product+char' } else { 'product only' }
    Write-Host "  Shot $($shot.id) [$($shot.label)] launched ($refDesc, $size) -> job $($job.Id)" -ForegroundColor Gray
}

Write-Host "`nWaiting for all 8 jobs (up to 8 min) ..." -ForegroundColor Cyan
$jobs | Wait-Job -Timeout 480 | Out-Null

$results = @()
foreach ($j in $jobs) {
    $r = Receive-Job -Job $j
    Remove-Job -Job $j
    if ($r.ok) {
        Write-Host ("  Shot {0} {1,-18} {2,3}s OK  ref={3}  URL: {4}" -f `
            $r.shot_id, $r.shot_label, $r.elapsed_s, $r.ref_image_count, `
            $r.url.Substring(0, [Math]::Min(70, $r.url.Length))) -ForegroundColor Green
    } else {
        Write-Host ("  Shot {0} {1,-18} {2,3}s FAIL: {3}" -f `
            $r.shot_id, $r.shot_label, $r.elapsed_s, $r.error) -ForegroundColor Red
    }
    $results += $r
}

$totalElapsed = [int]((Get-Date) - $startAll).TotalSeconds
Write-Host "`nGen done in ${totalElapsed}s. Downloading images ..." -ForegroundColor Cyan

foreach ($r in $results) {
    if ($r.ok -and $r.url) {
        $filename = "shot$($r.shot_id)-$($r.shot_label -replace '[^\w\u4e00-\u9fa5]', '_').png"
        $localPath = Join-Path $keyframesDir $filename
        try {
            Invoke-WebRequest -Uri $r.url -OutFile $localPath -UseBasicParsing -TimeoutSec 60
            $sz = (Get-Item $localPath).Length
            $r['local_path'] = $localPath
            $r['file_size_bytes'] = $sz
            Write-Host "  Downloaded $filename ($([math]::Round($sz/1024,1)) KB)" -ForegroundColor Green
        } catch {
            Write-Host "  Download FAILED $filename : $_" -ForegroundColor Red
            $r['download_error'] = $_.Exception.Message
        }
    }
}

# ── Save aggregated results ────────────────────────────────────────────
$summary = @{
    step              = 'step1-keyframes'
    product_url       = $productUrl
    character_url     = $characterUrl
    character_local   = $charLocal
    total_elapsed_s   = $totalElapsed
    successful        = ($results | Where-Object { $_.ok }).Count
    failed            = ($results | Where-Object { -not $_.ok }).Count
    results           = $results
}
$summary | ConvertTo-Json -Depth 5 | Out-File -FilePath $resultsFile -Encoding utf8

Write-Host "`n══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Step 1 done. ${totalElapsed}s total." -ForegroundColor Cyan
Write-Host "  Success: $(($results | Where-Object { $_.ok }).Count) / $($results.Count)" -ForegroundColor Cyan
Write-Host "  Results saved to: $resultsFile" -ForegroundColor Cyan
Write-Host "  Keyframes dir:    $keyframesDir" -ForegroundColor Cyan
