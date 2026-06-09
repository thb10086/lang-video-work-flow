# P4 — 真实跑 4 张瑞幸 keyframeGrid 拼贴图（v0.2 prompt）
#
# 读 03-prompts.v2.json，用 toapis + gpt-image-2 渠道并行发起 4 个 API 调用，
# 下载图到 images-v2/，记录每张图 URL / 耗时 / 大小 / subType / prompt 长度。
#
# 与 run-real-generation.ps1 的差异：仅 PromptsFile + ImagesDir + ResultsFile
# 三个路径变量。生成参数（model_id=gpt-image-2, size=1024x1024, resolution=2048）
# 与 v0.1 完全一致，确保新旧对比仅 prompt 变量。

$ErrorActionPreference = 'Stop'
$reportDir = Join-Path $PSScriptRoot '.'
$imagesDir = Join-Path $reportDir 'images-v2'
$promptsFile = Join-Path $reportDir '03-prompts.v2.json'
$resultsFile = Join-Path $reportDir 'real-generation-results.v2.json'

if (-not (Test-Path $imagesDir)) {
    New-Item -ItemType Directory -Path $imagesDir | Out-Null
}

$data = Get-Content $promptsFile -Raw -Encoding utf8 | ConvertFrom-Json
$prompts = $data.prompts

Write-Host "Launching $($prompts.Count) parallel generation jobs (v0.2 prompt) ..." -ForegroundColor Cyan
$startAll = Get-Date

$jobs = @()
foreach ($p in $prompts) {
    # toapis + gpt-image-2 当前仅 1024x1024 工作（参数与 v0.1 一致）
    $size = '1024x1024'
    $job = Start-Job -Name "luckin-v2-$($p.subType)" -ScriptBlock {
        param($prompt, $subType, $size, $shotName, $layout)
        $body = @{
            model_id = 'gpt-image-2'
            prompt   = $prompt
            params   = @{ size = $size; resolution = '2048' }
        } | ConvertTo-Json -Depth 5
        $start = Get-Date
        try {
            $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/api/generate/image' `
                -Method POST -Body $body -ContentType 'application/json' `
                -UseBasicParsing -TimeoutSec 300
            $elapsed = [int]((Get-Date) - $start).TotalSeconds
            $j = $r.Content | ConvertFrom-Json
            return @{
                ok         = ($j.code -eq 0)
                shotName   = $shotName
                subType    = $subType
                layout     = $layout
                size       = $size
                elapsed_s  = $elapsed
                url        = $j.data.images[0].url
                mime_type  = $j.data.images[0].mime_type
                code       = $j.code
                message    = $j.message
                prompt_len = $prompt.Length
            }
        }
        catch {
            $elapsed = [int]((Get-Date) - $start).TotalSeconds
            return @{
                ok        = $false
                shotName  = $shotName
                subType   = $subType
                elapsed_s = $elapsed
                error     = $_.Exception.Message
            }
        }
    } -ArgumentList $p.prompt, $p.subType, $size, $p.shotName, $p.layout
    $jobs += $job
    Write-Host "  Launched [$($p.subType)] $($p.shotName) ($size) - job id $($job.Id)" -ForegroundColor Gray
}

Write-Host "`nWaiting for all jobs to complete (up to 5 min each) ..." -ForegroundColor Cyan
$jobs | Wait-Job -Timeout 600 | Out-Null

$results = @()
foreach ($job in $jobs) {
    $res = Receive-Job -Job $job
    Remove-Job -Job $job
    if ($res.ok) {
        Write-Host ("  [{0,-18}] {1,3}s URL: {2}" -f $res.subType, $res.elapsed_s, $res.url.Substring(0, [Math]::Min(80, $res.url.Length))) -ForegroundColor Green
    }
    else {
        Write-Host ("  [{0,-18}] {1,3}s FAILED: {2}" -f $res.subType, $res.elapsed_s, $res.error) -ForegroundColor Red
    }
    $results += $res
}

$totalElapsed = [int]((Get-Date) - $startAll).TotalSeconds
Write-Host "`nAll done in ${totalElapsed}s. Downloading images ..." -ForegroundColor Cyan

foreach ($r in $results) {
    if ($r.ok -and $r.url) {
        $safeName = ($r.shotName -replace '[^\w\u4e00-\u9fa5]', '_')
        $filename = "luckin-$safeName-$($r.subType)-v2.png"
        $localPath = Join-Path $imagesDir $filename
        try {
            Invoke-WebRequest -Uri $r.url -OutFile $localPath -UseBasicParsing -TimeoutSec 60
            $sz = (Get-Item $localPath).Length
            $r['local_path'] = $localPath
            $r['file_size_bytes'] = $sz
            Write-Host "  Downloaded $filename ($([math]::Round($sz/1024,1)) KB)" -ForegroundColor Green
        }
        catch {
            Write-Host "  Download FAILED for $filename : $_" -ForegroundColor Red
            $r['download_error'] = $_.Exception.Message
        }
    }
}

@{
    prompt_version  = 'v0.2'
    total_elapsed_s = $totalElapsed
    successful      = ($results | Where-Object { $_.ok }).Count
    failed          = ($results | Where-Object { -not $_.ok }).Count
    results         = $results
} | ConvertTo-Json -Depth 5 | Out-File -FilePath $resultsFile -Encoding utf8

Write-Host "`nResults saved to $resultsFile" -ForegroundColor Cyan
Write-Host "Total: $totalElapsed s | Success: $(($results | Where-Object { $_.ok }).Count)/$($results.Count)" -ForegroundColor Cyan
