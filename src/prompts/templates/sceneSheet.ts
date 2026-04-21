import type { PromptTemplate } from '../promptEngine'

export const sceneSheetTemplate: PromptTemplate = {
  id: 'scene-sheet-3x3',
  name: '场景九宫图',
  category: 'scene',
  description: '生成单张 3×3 场景参考图，包含不同景别、时间和天气',
  template: `Scene environment reference sheet for "{{scene_name}}", displayed as a single composite image with 9 panels arranged in a 3x3 grid layout. Thin light-gray dividing lines separate each panel.

SCENE: {{scene_description}}
STYLE: {{style}}
MOOD: {{mood}}

PANEL LAYOUT:
Row 1 - Camera Angles: [1A] Wide establishing shot showing full environment | [1B] Medium shot at eye level | [1C] Close-up detail shot of a key environmental element
Row 2 - Time of Day: [2A] Midday - bright natural light, sharp shadows | [2B] Golden hour - warm amber light, long shadows | [2C] Night - artificial lights, deep shadows, atmospheric glow
Row 3 - Weather Conditions: [3A] Clear sky, optimal visibility | [3B] Overcast or rainy, moody reflections | [3C] Fog or mist, atmospheric depth

CONSISTENCY RULES - all 9 panels show the SAME location:
- Identical architectural structures, landmarks, and spatial layout
- Consistent foreground, midground, and background elements
- Only the specified dimension (angle/time/weather) changes between panels
- Same overall scale and proportions throughout

TECHNICAL: Cinematic aspect ratio per panel, professional color grading appropriate to each lighting condition, film-grade composition, high detail, no text overlays, no watermarks, no people unless core to the scene description.`,
  variables: [
    {
      key: 'scene_name',
      label: '场景名称',
      type: 'string',
      default: '新场景',
    },
    {
      key: 'scene_description',
      label: '场景描述',
      type: 'string',
      default: 'A futuristic cyberpunk city street with neon signs and flying cars',
    },
    {
      key: 'style',
      label: '风格',
      type: 'select',
      default: 'cinematic',
      options: ['cinematic', 'anime', 'realistic', 'painterly', 'noir', 'fantasy'],
    },
    {
      key: 'mood',
      label: '情绪',
      type: 'select',
      default: 'dramatic',
      options: ['dramatic', 'peaceful', 'tense', 'romantic', 'mysterious', 'epic'],
    },
  ],
}
