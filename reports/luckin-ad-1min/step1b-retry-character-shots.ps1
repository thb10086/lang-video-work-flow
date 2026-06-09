# Step 1b — Retry shots 3-7 with single-reference (character only)
#
# 根因：toapis + gpt-image-2 在 reference_images 数量 ≥ 2 时返回 500。
# 修复：对 shots 3-7 (with_character) 改用 character_url 单图 ref。
# 产品一致性通过 prompt 中的产品锚词 + 后期视觉验证保证。

$ErrorActionPreference = 'Stop'
$reportDir = $PSScriptRoot
$promptsFile = Join-Path $reportDir 'prompts.json'
$priorResults = Join-Path $reportDir 'step1-keyframes-results.json'
$keyframesDir = Join-Path $reportDir 'keyframes'
$resultsFile = Join-Path $reportDir 'step1b-retry-results.json'

$prompts = Get-Content $promptsFile -Raw -Encoding utf8 | ConvertFrom-Json
$prior = Get-Content $priorResults -Raw -Encoding utf8 | ConvertFrom-Json
$characterUrl = $prior.character_url

# Filter the failed character shots (3, 4, 5, 6, 7)
$failedShots = $prior.results | Where-Object { -not $_.ok }
Write-Host "Retrying $($failedShots.Count) failed character shots with single ref (character only)" -ForegroundColor Cyan
Write-Host "  character_url = $characterUrl" -ForegroundColor Gray

$shotById = @{}
foreach ($s in $prompts.shots) { $shotById[$s.id] = $s }

$startAll = Get-Date
$jobs = @()
foreach ($r in $failedShots) {
    $shot = $shotById[[int]$r.shot_id]
    $job = Start-Job -Name "luckin-retry-shot$($shot.id)" -ScriptBlock {
        param($prompt, $shotId, $shotLabel, $aspectRatio, $charUrl)
        $body = @{
            model_id         = 'gpt-image-2'
            prompt           = $prompt
            reference_images = @($charUrl)
            params           = @{ size = '1024x1024'; resolution = '2048' }
        } | ConvertTo-Json -Depth 5
        $start = Get-Date
        try {
            $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/generate/image' `
                -Method POST -Body $body -ContentType 'application/json' `
                -UseBasicParsing -TimeoutSec 300
            $elapsed = [int]((Get-Date) - $start).TotalSeconds
            $j = $r.Content | ConvertFrom-Json
            return @{
                ok           = ($j.code -eq 0)
                shot_id      = $shotId
                shot_label   = $shotLabel
                aspect_ratio = $aspectRatio
                ref_strategy = 'character-only'
                elapsed_s    = $elapsed
                url          = $j.data.images[0].url
                code         = $j.code
                message      = $j.message
            }
        } catch {
            return @{
                ok         = $false
                shot_id    = $shotId
                shot_label = $shotLabel
                elapsed_s  = [int]((Get-Date) - $start).TotalSeconds
                error      = $_.Exception.Message
            }
        }
    } -ArgumentList $shot.image_prompt, $shot.id, $shot.label, $shot.aspect_ratio, $characterUrl
    $jobs += $job
    Write-Host "  Retry Shot $($shot.id) [$($shot.label)] launched -> job $($job.Id)" -ForegroundColor Gray
}

Write-Host "`nWaiting (up to 8 min) ..." -ForegroundColor Cyan
$jobs | Wait-Job -Timeout 480 | Out-Null

$results = @()
foreach ($j in $jobs) {
    $r = Receive-Job -Job $j
    Remove-Job -Job $j
    if ($r.ok) {
        Write-Host ("  Shot {0} {1,-18} {2,3}s OK  URL: {3}" -f $r.shot_id, $r.shot_label, $r.elapsed_s, $r.url.Substring(0, [Math]::Min(70, $r.url.Length))) -ForegroundColor Green
    } else {
        Write-Host ("  Shot {0} {1,-18} {2,3}s FAIL: {3}" -f $r.shot_id, $r.shot_label, $r.elapsed_s, $r.error) -ForegroundColor Red
    }
    $results += $r
}

$totalElapsed = [int]((Get-Date) - $startAll).TotalSeconds
Write-Host "`nDownloading images ..." -ForegroundColor Cyan

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

$summary = @{
    step              = 'step1b-retry-character-shots'
    ref_strategy      = 'character-only (no product ref to avoid toapis multi-ref 500)'
    character_url     = $characterUrl
    total_elapsed_s   = $totalElapsed
    successful        = ($results | Where-Object { $_.ok }).Count
    failed            = ($results | Where-Object { -not $_.ok }).Count
    results           = $results
}
$summary | ConvertTo-Json -Depth 5 | Out-File -FilePath $resultsFile -Encoding utf8

Write-Host "`n══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "Step 1b done. ${totalElapsed}s total." -ForegroundColor Cyan
Write-Host "  Success: $(($results | Where-Object { $_.ok }).Count) / $($results.Count)" -ForegroundColor Cyan
Write-Host "  Results: $resultsFile" -ForegroundColor Cyan
