/**
 * Video Merger Service
 *
 * 使用 ffmpeg.wasm (单线程模式) 在浏览器内合并多段 MP4 视频。
 * 单线程模式无需 SharedArrayBuffer / COOP-COEP 请求头。
 *
 * 用法：mergeVideos(urlArray) → Blob (video/mp4)
 */

import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

let ffmpegInstance: FFmpeg | null = null
let loadPromise: Promise<void | boolean> | null = null

/**
 * 获取（或懒加载）FFmpeg 实例
 */
async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance

  if (!loadPromise) {
    const ff = new FFmpeg()
    ff.on('log', ({ message }) => console.log('[FFmpeg]', message))
    loadPromise = ff.load({
      coreURL: await toBlobURL('/ffmpeg-core.js', 'text/javascript'),
      wasmURL: await toBlobURL('/ffmpeg-core.wasm', 'application/wasm'),
    })
    await loadPromise
    ffmpegInstance = ff
  } else {
    await loadPromise
  }

  if (!ffmpegInstance) throw new Error('FFmpeg 加载失败')
  return ffmpegInstance
}

export interface MergeProgress {
  phase: 'loading' | 'downloading' | 'merging' | 'done'
  current: number
  total: number
}

/**
 * 合并多段视频 URL 为单个 MP4 Blob
 *
 * @param videoUrls 视频 URL 列表（按顺序）
 * @param onProgress 可选进度回调
 * @returns 合并后的 MP4 Blob
 */
export async function mergeVideos(
  videoUrls: string[],
  onProgress?: (p: MergeProgress) => void
): Promise<Blob> {
  if (videoUrls.length === 0) throw new Error('没有视频可合并')

  // 单段视频：直接下载返回
  if (videoUrls.length === 1) {
    onProgress?.({ phase: 'downloading', current: 1, total: 1 })
    const resp = await fetch(videoUrls[0])
    if (!resp.ok) throw new Error(`视频下载失败 (${resp.status}): ${videoUrls[0].slice(0, 80)}`)
    return await resp.blob()
  }

  // 加载 FFmpeg
  onProgress?.({ phase: 'loading', current: 0, total: videoUrls.length })
  const ffmpeg = await getFFmpeg()

  // 下载每段视频
  const concatLines: string[] = []
  for (let i = 0; i < videoUrls.length; i++) {
    onProgress?.({ phase: 'downloading', current: i, total: videoUrls.length })
    const filename = `clip${i}.mp4`
    try {
      const fileData = await fetchFile(videoUrls[i])
      await ffmpeg.writeFile(filename, fileData)
      concatLines.push(`file '${filename}'`)
      console.log(`[VideoMerger] Downloaded clip ${i + 1}/${videoUrls.length}`)
    } catch (err) {
      throw new Error(`视频片段 ${i + 1} 下载失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 写入 concat 列表
  onProgress?.({ phase: 'merging', current: videoUrls.length, total: videoUrls.length })
  await ffmpeg.writeFile('concat.txt', concatLines.join('\n'))

  // 执行合并（copy 模式：无需重编码，保留原画质）
  await ffmpeg.exec([
    '-f', 'concat', '-safe', '0', '-i', 'concat.txt',
    '-c', 'copy',
    '-movflags', '+faststart',
    'output.mp4',
  ])

  // 读取结果
  const outputData = await ffmpeg.readFile('output.mp4')
  const outputArr = outputData as unknown as Uint8Array
  const buf = outputArr.buffer.slice(outputArr.byteOffset, outputArr.byteOffset + outputArr.byteLength) as ArrayBuffer
  const blob = new Blob([buf], { type: 'video/mp4' })

  // 清理临时文件
  try {
    for (let i = 0; i < videoUrls.length; i++) await ffmpeg.deleteFile(`clip${i}.mp4`)
    await ffmpeg.deleteFile('concat.txt')
    await ffmpeg.deleteFile('output.mp4')
  } catch {
    // 清理失败不影响结果
  }

  onProgress?.({ phase: 'done', current: videoUrls.length, total: videoUrls.length })
  console.log(`[VideoMerger] Merged ${videoUrls.length} clips → ${(blob.size / 1024 / 1024).toFixed(1)} MB`)
  return blob
}

/**
 * 将 Blob 转为 base64 data URL
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
