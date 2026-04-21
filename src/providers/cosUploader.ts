/**
 * Tencent Cloud COS Upload Service
 * 
 * 将 base64 图片上传到 COS 获取公网 URL，
 * 供 APIMart 视频模型的 image_urls 参数使用。
 * 
 * 设计原则：
 * - 单例模式，全局共享
 * - 自动缓存已上传的图片（base64 hash → URL）
 * - 支持运行时切换配置
 */

import COS from 'cos-js-sdk-v5'

// ============================================================
// COS 配置接口
// ============================================================

export interface COSConfig {
  secretId: string
  secretKey: string
  region: string
  bucket: string
}

// ============================================================
// COSUploader 单例
// ============================================================

export type COSHealthStatus = 'unchecked' | 'ok' | 'cors-error' | 'auth-error' | 'unknown-error'

class COSUploader {
  private cos: COS | null = null
  private config: COSConfig | null = null
  private uploadCache = new Map<string, string>()  // hash → url

  /** CORS 健康状态（供 UI 展示） */
  corsStatus: COSHealthStatus = 'unchecked'
  corsErrorMessage = ''

  /** 初始化或重新配置 */
  initialize(config: COSConfig): void {
    if (!config.secretId || !config.secretKey) {
      console.warn('[COSUploader] Missing credentials, upload disabled')
      this.cos = null
      this.config = null
      return
    }
    this.config = config
    this.cos = new COS({
      SecretId: config.secretId,
      SecretKey: config.secretKey,
    })
    console.log(`[COSUploader] Initialized: ${config.bucket} @ ${config.region}`)
    // 异步检测 CORS 配置（不阻塞初始化）
    void this.checkCORSHealth()
  }

  /** 是否已就绪 */
  get ready(): boolean {
    return this.cos !== null && this.config !== null
  }

  /**
   * 检测 COS Bucket 的 CORS 是否正确配置。
   * 上传一个 1 字节的测试文件，若 CORS 不通则记录详细说明。
   *
   * 根本原因：浏览器 CORS 策略要求 COS Bucket 配置 CORS 规则，
   * 否则 OPTIONS 预检请求返回 403 → 浏览器阻止上传。
   * 无法通过代码绕过，必须在 COS 控制台配置一次。
   */
  async checkCORSHealth(): Promise<COSHealthStatus> {
    if (!this.cos || !this.config) return 'unchecked'

    const testKey = `_cors_test_${Date.now()}.txt`
    const testBlob = new Blob(['1'], { type: 'text/plain' })

    try {
      await new Promise<void>((resolve, reject) => {
        this.cos!.putObject(
          {
            Bucket: this.config!.bucket,
            Region: this.config!.region,
            Key: testKey,
            Body: testBlob,
          },
          (err) => {
            if (err) reject(new Error(err.message || String(err)))
            else resolve()
          }
        )
      })
      // 上传成功后清除测试文件（不等待）
      this.cos.deleteObject({
        Bucket: this.config.bucket,
        Region: this.config.region,
        Key: testKey,
      }, () => {})
      this.corsStatus = 'ok'
      console.log('[COSUploader] CORS check passed ✓')
      return 'ok'
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isCors = /CORS|cors|cross.?origin|XHR|network|failed to fetch/i.test(msg)
      const isAuth = /403|SignatureDoesNotMatch|InvalidSecurity|AuthFailure/i.test(msg)

      if (isCors) {
        this.corsStatus = 'cors-error'
        this.corsErrorMessage = msg
        this.printCORSSetupInstructions()
      } else if (isAuth) {
        this.corsStatus = 'auth-error'
        this.corsErrorMessage = msg
        console.error(`[COSUploader] 认证失败（检查 SecretId/SecretKey 是否正确）: ${msg}`)
      } else {
        this.corsStatus = 'unknown-error'
        this.corsErrorMessage = msg
        console.warn(`[COSUploader] 健康检查失败（非 CORS 错误）: ${msg}`)
      }
      return this.corsStatus
    }
  }

  /**
   * 打印 COS 控制台 CORS 配置步骤和 JSON。
   * 这是解决「COS upload failed: CORS blocked」的唯一根本方法。
   */
  private printCORSSetupInstructions(): void {
    const { bucket, region } = this.config!
    const corsRulesJson = JSON.stringify([
      {
        AllowedOrigin: ['*'],
        AllowedMethod: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
        AllowedHeader: ['*'],
        ExposeHeader: ['ETag', 'Content-Length', 'x-cos-request-id'],
        MaxAgeSeconds: 3600,
      },
    ], null, 2)

    console.group(
      '%c[COSUploader] ❌ COS Bucket CORS 未配置 — 视频首帧功能将不可用',
      'color: #ff4444; font-weight: bold;'
    )
    console.log(
      '%c根本原因：浏览器不允许跨域 PUT 请求到 COS，必须在 COS 控制台为 Bucket 配置 CORS 规则。\n这是一次性操作，配置完成后首帧引导功能即可正常使用。',
      'color: #ffaa00;'
    )
    console.log(
      `%c修复步骤（约 2 分钟）：\n` +
      `1. 打开 → https://console.cloud.tencent.com/cos/bucket\n` +
      `2. 找到 Bucket: ${bucket} (区域: ${region})\n` +
      `3. 左侧菜单 → 「安全管理」→「跨域访问 CORS 设置」\n` +
      `4. 点击「添加规则」，填入以下配置：\n` +
      `   - 允许 Origin: *\n` +
      `   - 允许 Methods: GET, PUT, POST, DELETE, HEAD\n` +
      `   - 允许 Headers: *\n` +
      `   - 暴露 Headers: ETag\n` +
      `5. 保存，刷新本页，即可使用首帧引导功能`,
      'color: #44aaff;'
    )
    console.log('%cCORS 规则 JSON（可在控制台 API 模式下直接导入）：', 'color: #aaaaaa;')
    console.log(corsRulesJson)
    console.groupEnd()
  }

  /**
   * 上传 base64 图片到 COS
   * @param base64Data - 纯 base64 字符串（不含 data:... 前缀）或完整 data URL
   * @param fileName - 可选文件名，默认自动生成
   * @returns 公网访问 URL
   */
  async upload(base64Data: string, fileName?: string): Promise<string> {
    if (!this.cos || !this.config) {
      throw new Error('COS 未配置，请在设置中填写 COS 凭证')
    }

    // Strip data URL prefix if present
    let raw = base64Data
    let mimeType = 'image/png'
    if (raw.startsWith('data:')) {
      const match = raw.match(/^data:(image\/\w+);base64,(.+)$/)
      if (match) {
        mimeType = match[1]
        raw = match[2]
      } else {
        raw = raw.split(',')[1] || raw
      }
    }

    // Check cache by short hash
    const hash = this.quickHash(raw)
    const cached = this.uploadCache.get(hash)
    if (cached) return cached

    // Convert base64 to Blob
    const byteChars = atob(raw)
    const byteArray = new Uint8Array(byteChars.length)
    for (let i = 0; i < byteChars.length; i++) {
      byteArray[i] = byteChars.charCodeAt(i)
    }
    const blob = new Blob([byteArray], { type: mimeType })

    // Generate file path
    const ext = mimeType.split('/')[1] || 'png'
    const key = fileName || `workflow/${Date.now()}_${hash.slice(0, 8)}.${ext}`

    // Upload
    const url = await new Promise<string>((resolve, reject) => {
      this.cos!.putObject(
        {
          Bucket: this.config!.bucket,
          Region: this.config!.region,
          Key: key,
          Body: blob,
        },
        (err, data) => {
          if (err) {
            reject(new Error(`COS upload failed: ${err.message}`))
          } else {
            const publicUrl = `https://${data.Location}`
            resolve(publicUrl)
          }
        }
      )
    })

    // Cache and return
    this.uploadCache.set(hash, url)
    console.log(`[COSUploader] Uploaded: ${key} → ${url}`)
    return url
  }

  /**
   * 批量上传，返回 URL 数组（保持顺序）
   */
  async uploadAll(images: string[]): Promise<string[]> {
    return Promise.all(images.map(img => this.upload(img)))
  }

  /**
   * 如果输入是 base64/data URL，上传并返回公网 URL。
   * 如果已是 http(s) URL，直接返回。
   */
  async ensureUrl(imageData: string): Promise<string> {
    if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
      return imageData
    }
    return this.upload(imageData)
  }

  /** 清除上传缓存 */
  clearCache(): void {
    this.uploadCache.clear()
  }

  /** 快速 hash（取 base64 前后各 32 字符拼接） */
  private quickHash(base64: string): string {
    const head = base64.slice(0, 32)
    const tail = base64.slice(-32)
    const len = base64.length.toString(36)
    return `${head}${tail}${len}`
  }
}

/** 全局单例 */
export const cosUploader = new COSUploader()
