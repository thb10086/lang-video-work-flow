/**
 * Scenario Detection — 场景识别引擎
 *
 * 根据用户描述，通过关键词匹配 + 评分机制识别视频制作场景类型，
 * 返回推荐 Pipeline、匹配模板和制作建议。
 *
 * 6 种场景：漫剧 / 产品广告 / 探店 / 教程 / 短剧 / MV
 */

import type { ToolCallResult } from './toolHelpers'

// ── Scenario Definitions ──

interface ScenarioDef {
  id: string
  label: string
  keywords: string[]
  pipeline: string
  templateId: string | null
  tips: string
}

const SCENARIO_DEFS: ScenarioDef[] = [
  {
    id: 'comic_drama',
    label: '漫剧/动漫短剧',
    keywords: [
      '漫剧', '漫画', '动漫', '二次元', 'anime', '番剧', '连载',
      '角色', 'Q版', '卡通', '热血', '校园', '后宫', '轻小说', '同人',
    ],
    pipeline: '角色九宫图(多角色) → 角色管理器 → 分镜脚本 → 关键帧(角色参考直连) → 视频 → 合成',
    templateId: 'comic-drama-basic',
    tips: '重点: 角色一致性。先生成角色九宫图并统一登记到"角色管理器"，镜头 prompt 中用 @角色名 引用。风格推荐 anime/cartoon。',
  },
  {
    id: 'product_ad',
    label: '产品广告/电商',
    keywords: [
      '产品', '广告', '电商', '商品', '带货', '种草', '品牌', '促销',
      '15秒', '30秒', '投放', '商业', '卖点', 'Logo', '品牌宣传',
      '开箱', '测评', '好物', 'ad', 'product', 'commercial',
    ],
    pipeline: '产品图(imageGen) → 使用场景(imageGen) → 品牌风格锁定 → 视频(产品展示+场景+Logo) → 合成',
    templateId: 'ad-product',
    tips: '重点: 产品特写 + 品牌一致性。建议用户上传产品实拍图作为首帧参考。风格推荐 realistic/cinematic。',
  },
  {
    id: 'store_tour',
    label: '探店/Vlog',
    keywords: [
      '探店', 'vlog', '打卡', '美食', '餐厅', '咖啡', '旅行',
      '日常', '街拍', '逛街', '门店', '体验', '开箱',
    ],
    pipeline: '场景九宫图(多场景) → 风格锁定 → 关键帧(场景切换) → 视频(运镜丰富) → 配音 → 合成',
    templateId: 'store-tour-vlog',
    tips: '重点: 场景多样性 + 运镜变化。建议用户上传实地照片。风格推荐 realistic，多用 dolly/tracking/crane 运镜。',
  },
  {
    id: 'tutorial',
    label: '教程/解说',
    keywords: [
      '教程', '解说', '科普', '知识', '讲解', '说明', '培训',
      '课程', '演示', '步骤', '方法', 'tutorial', 'how to',
    ],
    pipeline: 'LLM脚本生成 → 分镜脚本 → 说明图(imageGen) → 配音(TTS) → 视频 → 合成',
    templateId: 'tutorial-basic',
    tips: '重点: 清晰的脚本结构 + 配音同步。建议先用 LLM 生成分段脚本，再逐段配图。风格推荐 minimalist/realistic。',
  },
  {
    id: 'short_drama',
    label: '真人短剧/微电影',
    keywords: [
      '短剧', '微电影', '剧情', '故事', '悬疑', '爱情', '喜剧',
      '真人', '表演', '对话', '反转', '甜宠', '虐恋', '都市',
      'drama', 'film', '电影', '影视',
    ],
    pipeline: '角色九宫图(写实) → 场景九宫图 → 分镜脚本(含对话) → 关键帧 → 视频 → 配音 → 合成',
    templateId: 'short-film-basic',
    tips: '重点: 角色一致性 + 分镜专业度。建议用 realistic 风格，分镜要包含对话和情绪标注。',
  },
  {
    id: 'music_video',
    label: 'MV/混剪',
    keywords: [
      'MV', '音乐', '混剪', '剪辑', '节奏', '歌曲', '歌词',
      '舞蹈', '演唱', '旋律', 'music', 'video', '翻唱', '原创',
    ],
    pipeline: '风格锁定(统一色调) → 分镜脚本(按节奏切) → 关键帧(高情绪密度) → 视频(快节奏) → 合成',
    templateId: 'music-video-montage',
    tips: '重点: 节奏感 + 视觉风格统一。建议 emotionIntensity 设为 7-10，duration 较短(4-6s)，多用快切。',
  },
]

// ── Export scenario IDs for P2-02 generate_workflow scenario param ──
export const SCENARIO_IDS = SCENARIO_DEFS.map(s => s.id)
export type ScenarioId = typeof SCENARIO_IDS[number]

// ── Handler ──

export function handleDetectScenario(args: Record<string, unknown>): ToolCallResult {
  const desc = String(args.description || '').toLowerCase()
  const hasImages = Boolean(args.userImages)

  if (!desc.trim()) {
    return { success: false, message: '请提供创作需求描述' }
  }

  // Score each scenario by keyword hits
  const scores = SCENARIO_DEFS.map(s => {
    let score = 0
    for (const kw of s.keywords) {
      if (desc.includes(kw.toLowerCase())) score += 1
    }
    return { scenario: s, score }
  })

  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]

  // If no keywords matched at all, default to short_drama (most generic)
  const detected = best.score > 0 ? best.scenario : SCENARIO_DEFS.find(s => s.id === 'short_drama')!
  const runners = scores.filter(s => s.score > 0 && s.scenario.id !== detected.id).slice(0, 2)

  const lines: string[] = [
    `识别场景: ${detected.label} (${detected.id})`,
    `推荐Pipeline: ${detected.pipeline}`,
  ]

  if (detected.templateId) {
    lines.push(`匹配模板: ${detected.templateId}`)
  }

  lines.push(`建议: ${detected.tips}`)

  if (hasImages) {
    lines.push('用户已有图片素材 — 建议优先使用 inject_user_images 将图片注入对应节点，而非重新生成。')
  }

  if (runners.length > 0) {
    lines.push(`备选场景: ${runners.map(r => r.scenario.label).join(', ')}`)
  }

  lines.push('')
  lines.push('下一步建议:')
  lines.push('1. 使用 plan_task 制定详细执行计划')
  lines.push(`2. 使用 generate_workflow 快速搭建「${detected.label}」Pipeline，或逐步创建节点`)
  lines.push('3. 填充真实内容后逐步执行')

  return { success: true, message: lines.join('\n') }
}
