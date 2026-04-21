/**
 * Prompt Craft — 提示词工程单一知识源 (Single Source of Truth)
 *
 * 所有提示词公式、词库、模板、审查规则统一在此定义。
 * 角色提示词(roles/)、工具(toolQuality.ts)、技能(skills/)、系统提示词(chatStore.ts)
 * 均从此处引用，避免跨文件重复硬编码。
 *
 * 设计原则：
 * - 数据驱动：公式/词库/阈值以结构化常量定义，而非内嵌字符串
 * - 可组合：提供构建函数，按需组合出完整提示词
 * - 可扩展：新增风格/维度/规则只需修改此文件
 */

// ============================================================
// 1. 图片提示词六维优化法 (Image 6-Dimension Method)
// ============================================================

export interface PromptDimension {
  id: string
  name: string
  nameEn: string
  description: string
  template: string
  examples: string[]
}

export const IMAGE_DIMENSIONS: PromptDimension[] = [
  {
    id: 'subject',
    name: '主体精确',
    nameEn: 'Subject Precision',
    description: '每个外貌属性必须有形容词修饰，避免模糊词',
    template: '[age]-year-old [gender] with [hair: color+style+length], [eyes: color+shape], [body type], wearing [top]+[bottom]+[accessories], [distinguishing feature]',
    examples: [
      'short silver pixie-cut hair with side-swept bangs',
      'tall athletic man, 185cm, sharp jawline',
      'fitted emerald satin evening gown with V-neckline',
    ],
  },
  {
    id: 'lighting',
    name: '光影具体',
    nameEn: 'Lighting Specification',
    description: '指定光源方向 + 色温 + 强度 + 阴影特征',
    template: '[light source] from [direction], [color temperature], [intensity], [shadow type]',
    examples: [
      'golden-hour warm light from the left, long soft shadows',
      'neon glow from storefronts, cool cyan and pink, wet reflections',
      'harsh noon sun overhead, deep contrasty shadows',
    ],
  },
  {
    id: 'composition',
    name: '构图明确',
    nameEn: 'Composition',
    description: '景别 + 角度 + 焦距感 + 画面分割',
    template: '[shot type], [angle], [focal length feel], [framing]',
    examples: [
      'medium close-up, eye-level, 85mm portrait lens feel, rule of thirds',
      'extreme wide shot, high-angle bird\'s-eye, deep focus, centered subject',
      'close-up, low-angle heroic perspective, shallow DOF f/1.4 bokeh',
    ],
  },
  {
    id: 'style',
    name: '风格锁定',
    nameEn: 'Style Anchoring',
    description: '每条提示词末尾附加统一的风格标签',
    template: '[Art Style], [Quality], [Texture], [Color Grading]',
    examples: [
      'cinematic 8K, ARRI Alexa film grain, anamorphic lens flare, desaturated teal-orange color grade',
      'anime art style, cel-shaded, vibrant colors, clean linework, studio Ghibli inspired',
      'commercial photography, studio lighting, product hero shot, clean white background, 4K sharp',
    ],
  },
  {
    id: 'negative',
    name: '负面屏蔽',
    nameEn: 'Negative Constraints',
    description: '排除 AI 常见瑕疵和低质量元素',
    template: 'no [artifact type], no [anatomy issue], no [consistency issue]',
    examples: [
      'no artifacts, no deformed anatomy, no extra fingers, no blurry, no watermark',
      'no identity drift, no costume change, no hair color shift',
    ],
  },
  {
    id: 'consistency',
    name: '一致性锚',
    nameEn: 'Consistency Anchor',
    description: '关键帧之间复用相同的核心外貌描述片段',
    template: '[Character Anchor]: A [age] [gender] with [hair], [eyes], wearing [outfit], [body type], [distinguishing feature]',
    examples: [
      'A 25-year-old woman with short silver pixie-cut hair, sharp steel-blue eyes, wearing matte black leather jacket over white t-shirt, slim athletic build, silver chain necklace',
    ],
  },
]

// ============================================================
// 2. 视频提示词五段式公式 (Video 5-Section Formula)
// ============================================================

export interface VideoSection {
  id: string
  name: string
  nameEn: string
  description: string
  template: string
}

export const VIDEO_SECTIONS: VideoSection[] = [
  {
    id: 'camera',
    name: '运镜',
    nameEn: 'Camera',
    description: '镜头运动类型 + 方向 + 速度',
    template: '[movement type] [direction] [speed]',
  },
  {
    id: 'subject',
    name: '主体',
    nameEn: 'Subject',
    description: '角色外貌锚定词 + 姿态/动作 + 表情',
    template: '[character anchor words] [pose/action] [expression]',
  },
  {
    id: 'environment',
    name: '环境',
    nameEn: 'Environment',
    description: '场景环境 + 光照 + 天气/时间',
    template: '[scene setting] [lighting conditions] [weather/time of day]',
  },
  {
    id: 'quality',
    name: '品质',
    nameEn: 'Quality',
    description: '分辨率、帧率、镜头特效、色调风格',
    template: 'Cinematic 4K, 24fps, [lens effects], [color style]',
  },
  {
    id: 'negative',
    name: '负面约束',
    nameEn: 'Negative',
    description: '排除 AI 视频常见瑕疵',
    template: 'No morphing, no identity drift, no flickering, no text',
  },
]

// ============================================================
// 3. 风格预设词库 (Style Presets)
// ============================================================

export interface StylePreset {
  id: string
  name: string
  nameZh: string
  keywords: string
}

export const STYLE_PRESETS: StylePreset[] = [
  { id: 'cinematic', name: 'Cinematic', nameZh: '电影质感', keywords: 'cinematic 8K, ARRI Alexa film grain, anamorphic lens flare, desaturated teal-orange color grade' },
  { id: 'anime', name: 'Anime', nameZh: '动漫风格', keywords: 'anime art style, cel-shaded, vibrant colors, clean linework, studio Ghibli inspired' },
  { id: 'realistic', name: 'Realistic', nameZh: '写实广告', keywords: 'commercial photography, studio lighting, product hero shot, clean white background, 4K sharp' },
  { id: 'cyberpunk', name: 'Cyberpunk', nameZh: '赛博朋克', keywords: 'cyberpunk aesthetic, neon-lit, rain-slicked streets, volumetric fog, holographic UI elements' },
  { id: 'watercolor', name: 'Watercolor', nameZh: '水彩画', keywords: 'watercolor painting, soft washes of color, paper texture, loose brushstrokes, translucent layers' },
  { id: 'noir', name: 'Film Noir', nameZh: '黑色电影', keywords: 'film noir, high contrast black and white, deep shadows, Venetian blind light, moody atmosphere' },
  { id: 'fantasy', name: 'Fantasy', nameZh: '奇幻史诗', keywords: 'epic fantasy art, magical atmosphere, rich saturated colors, dramatic lighting, otherworldly glow' },
  { id: 'minimalist', name: 'Minimalist', nameZh: '极简风', keywords: 'minimalist clean design, negative space, muted palette, geometric composition, subtle gradients' },
]

// ============================================================
// 4. 负面词预设 (Negative Presets)
// ============================================================

export const NEGATIVE_PRESETS = {
  image: 'no artifacts, no deformed anatomy, no extra fingers, no blurry, no watermark, no text overlay',
  consistency: 'no identity drift, no costume change, no hair color shift, no age variation',
  video: 'no morphing, no flickering, no temporal inconsistency, no identity drift, no text',
} as const

// ============================================================
// 5. 光照词库 (Lighting Library)
// ============================================================

export const LIGHTING_LIBRARY = {
  natural: ['golden-hour warm light', 'overcast diffused daylight', 'harsh noon sun', 'blue-hour twilight', 'moonlit silver glow'],
  artificial: ['neon glow', 'fluorescent overhead', 'candlelight flicker', 'spotlight from above', 'LED panel soft light'],
  mixed: ['practical lights mixed with moonlight', 'rim light + ambient fill', 'neon signs + wet street reflections'],
  shadow: ['deep noir shadows', 'soft ambient occlusion', 'dappled light through leaves', 'long dramatic shadows'],
} as const

// ============================================================
// 6. 色调情绪映射 (Color-Mood Mapping)
// ============================================================

export interface ColorMood {
  nameZh: string
  mood: string
  keywords: string
}

export const COLOR_MOODS: ColorMood[] = [
  { nameZh: '暖橙金', mood: '温馨/怀旧/希望', keywords: 'warm golden tones, amber highlights' },
  { nameZh: '冷蓝青', mood: '孤独/科技/冷静', keywords: 'cool blue-teal palette, icy undertones' },
  { nameZh: '高饱和', mood: '活力/青春/快乐', keywords: 'vibrant saturated colors, pop art palette' },
  { nameZh: '低饱和', mood: '沉重/高级/文艺', keywords: 'muted desaturated tones, washed-out pastels' },
  { nameZh: '红黑', mood: '危险/激情/紧张', keywords: 'crimson and black, blood-red accents' },
  { nameZh: '绿调', mood: '自然/恐怖/有机', keywords: 'emerald green, forest palette' },
  { nameZh: '紫调', mood: '神秘/梦幻/奢华', keywords: 'purple haze, amethyst glow, lavender mist' },
]

// ============================================================
// 7. 审查规则配置 (Review Rules — 数据驱动，非硬编码)
// ============================================================

export const REVIEW_RULES = {
  /** 提示词最短长度（低于此值报警） */
  minPromptLength: 20,
  /** 提示词推荐最短长度（建议文案） */
  recommendedMinLength: 50,
  /** 中文字符占比上限（图片/视频提示词应使用英文） */
  maxChineseRatio: 0.3,
  /** 视频时长推荐范围 */
  videoDuration: { min: 4, max: 15 },
  /** 运镜关键词检测正则 */
  cameraKeywords: /camera|dolly|pan|tilt|crane|orbit|tracking|static|handheld|zoom|aerial|slider|push|pull/i,
  /** 负面约束检测正则 */
  negativeKeywords: /no morphing|no flickering|no identity drift|negative|no text|no watermark/i,
  /** 光照关键词检测正则 */
  lightingKeywords: /light|shadow|glow|illuminat|backlit|rim.?light|sun|moon|neon|ambient|golden.?hour|overcast|spotlight/i,
  /** 构图关键词检测正则 */
  compositionKeywords: /wide shot|close-up|medium shot|extreme|full body|portrait|angle|bird|worm|eye.?level/i,
  /** 风格关键词检测正则 */
  styleKeywords: /cinematic|anime|realistic|film grain|4k|8k|bokeh|depth of field|color grad/i,
} as const

// ============================================================
// 8. 提示词构建器 (Prompt Builders)
// ============================================================

/** 生成图片优化 LLM 系统提示词 */
export function buildImageOptimizationSystemPrompt(opts: {
  style?: string
  keepOriginalIntent?: boolean
}): string {
  const dims = IMAGE_DIMENSIONS.map((d, i) =>
    `${i + 1}. ${d.nameEn}: ${d.description}`
  ).join('\n')

  return `You are a professional image prompt engineer. Optimize the given image prompt using the 6-dimension method:
${dims}

Rules:
- Output ONLY the optimized English prompt, no explanations
- Keep the original creative intent${opts.keepOriginalIntent !== false ? ' — do not change the core subject' : ''}
- Include all character anchor descriptions provided
${opts.style ? `- Style direction: ${opts.style}` : '- Maintain the existing style direction'}
- Must be in English`
}

/** 生成视频优化 LLM 系统提示词 */
export function buildVideoOptimizationSystemPrompt(opts: {
  style?: string
  keepOriginalIntent?: boolean
}): string {
  const sections = VIDEO_SECTIONS.map(s =>
    `[${s.nameEn}]: ${s.template}.`
  ).join('\n')

  return `You are a professional video prompt engineer. Optimize the given video prompt using the 5-section formula:
${sections}

Rules:
- Output ONLY the optimized English prompt, no explanations
- Keep the original creative intent${opts.keepOriginalIntent !== false ? ' — do not change the core subject or action' : ''}
- Include all character anchor descriptions provided
${opts.style ? `- Style direction: ${opts.style}` : '- Maintain the existing style direction'}
- Must be in English`
}

/** 查找风格预设，返回关键词字符串 */
export function getStyleKeywords(styleId: string): string {
  return STYLE_PRESETS.find(s => s.id === styleId)?.keywords
    ?? STYLE_PRESETS[0].keywords
}

/**
 * 生成图片六维公式的 Markdown 文本（用于角色提示词/SKILL 注入）
 * compact=true 时只输出单行摘要
 */
export function renderImageFormula(compact = false): string {
  if (compact) {
    return IMAGE_DIMENSIONS.map(d => `${d.nameEn}`).join(' → ')
  }
  return IMAGE_DIMENSIONS.map(d =>
    `### ${d.name} (${d.nameEn})\n${d.description}\n模板: \`${d.template}\``
  ).join('\n\n')
}

/**
 * 生成视频五段式公式的 Markdown 文本
 */
export function renderVideoFormula(compact = false): string {
  if (compact) {
    return VIDEO_SECTIONS.map(s => `[${s.nameEn}]`).join(' + ')
  }
  return VIDEO_SECTIONS.map(s =>
    `**[${s.nameEn}]**: ${s.description}\n模板: \`${s.template}\``
  ).join('\n')
}

/**
 * 生成负面词预设文本
 */
export function renderNegativePresets(): string {
  return Object.entries(NEGATIVE_PRESETS)
    .map(([k, v]) => `- **${k}**: \`${v}\``)
    .join('\n')
}

/**
 * 生成角色锚定模板文本
 */
export function renderCharacterAnchorTemplate(): string {
  const anchor = IMAGE_DIMENSIONS.find(d => d.id === 'consistency')
  return anchor?.template ?? ''
}

/**
 * 生成提示词工程速查文本（用于系统提示词注入）
 * 精简版，约 600 字符，避免过度占用 token
 */
export function renderPromptEngineeringQuickRef(): string {
  return `## 提示词工程规范

**图片关键帧**（英文, 六维法）：\`${renderImageFormula(true)}\`
结构：[Character Features] + [Pose/Action] + [Environment] + [Lighting] + [Art Style] + [Quality]

**视频提示词**（英文, 五段式）：\`${renderVideoFormula(true)}\`
格式：[Camera movement]. [Character anchor + Action]. [Environment/Atmosphere]. [Quality specs]. [Negative constraints].
**关键**：角色核心特征（发色/服装）必须出现在视频 prompt 中，否则模型会改变外貌。

**角色描述**（英文, 特征密集）：发型发色 + 五官 + 体型 + 标志性服装 + 配饰 + 气质
**场景描述**（英文, 三层次）：前景 + 中景主体 + 远景背景 + 光照来源 + 天气氛围`
}
