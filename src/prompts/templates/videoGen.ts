import type { PromptTemplate } from '../promptEngine'

export const videoGenTemplate: PromptTemplate = {
  id: 'video-gen-cinematic',
  name: '视频生成提示词',
  category: 'video',
  description: '生成电影级视频的结构化提示词',
  template: `[Camera]: {{camera_movement}}.
[Subject]: {{subject_action}}.
[Atmosphere]: {{mood_lighting}}.
[Quality]: Cinematic 4K, shallow depth of field, 24fps film grain, professional color grading, smooth motion, natural physics.
[Negative]: No sudden cuts, no morphing faces, no extra limbs, no identity drift, no flickering, no text or watermarks, no abrupt camera jumps.`,
  variables: [
    {
      key: 'camera_movement',
      label: '镜头运动',
      type: 'select',
      default: 'slow dolly forward',
      options: [
        'slow dolly forward',
        'static wide shot',
        'tracking left to right',
        'crane shot rising',
        'handheld follow',
        'orbit around subject',
        'zoom in slowly',
        'pull back reveal',
      ],
    },
    {
      key: 'subject_action',
      label: '主体动作',
      type: 'string',
      default: 'character walks toward camera with confident stride',
    },
    {
      key: 'mood_lighting',
      label: '氛围光影',
      type: 'select',
      default: 'warm golden hour, soft shadows',
      options: [
        'warm golden hour, soft shadows',
        'dramatic noir, high contrast',
        'cool blue moonlight, mysterious',
        'bright daylight, clean and fresh',
        'neon city lights, cyberpunk glow',
        'candlelit, intimate warmth',
        'overcast, moody and atmospheric',
      ],
    },
  ],
}
