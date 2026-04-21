import type { PromptTemplate } from '../promptEngine'

export const characterSheetTemplate: PromptTemplate = {
  id: 'character-sheet-3x3',
  name: '角色九宫图',
  category: 'character',
  description: '生成单张 3×3 角色参考图，包含多视角和表情',
  template: `Character design reference sheet for "{{character_name}}", displayed as a single composite image with 9 panels arranged in a 3x3 grid layout. Each panel is separated by thin light-gray lines. All panels share a clean white or very light gray background.

CHARACTER: {{character_description}}
STYLE: {{art_style}}

PANEL LAYOUT (left to right, top to bottom):
Row 1 - Portrait close-ups: [1A] Front-facing head and shoulders | [1B] Left 3/4 angle head and shoulders | [1C] Right 3/4 angle head and shoulders
Row 2 - Expressions (waist up, front-facing): [2A] Neutral calm expression | [2B] Confident smiling expression | [2C] Serious determined expression
Row 3 - Full body poses: [3A] Full body standing front view, arms relaxed | [3B] Full body standing side view (left profile) | [3C] Full body action pose

CONSISTENCY RULES - all 9 panels must show the SAME character:
- Identical hair color, length, and style
- Identical eye color and shape
- Identical skin tone
- Identical signature outfit and accessories
- Consistent proportions and body type
- Same art style and line quality throughout

TECHNICAL: Flat even lighting in all panels, no dramatic shadows, no backgrounds except neutral solid color, no text labels, no watermarks, no extra characters, high detail professional illustration quality.`,
  variables: [
    {
      key: 'character_name',
      label: '角色名称',
      type: 'string',
      default: '新角色',
    },
    {
      key: 'character_description',
      label: '角色描述',
      type: 'string',
      default: 'A young woman with short black hair, wearing a white shirt and jeans',
    },
    {
      key: 'art_style',
      label: '画风',
      type: 'select',
      default: 'anime',
      options: ['anime', 'realistic', 'cartoon', 'watercolor', 'pixel art', 'comic book', '3D render'],
    },
  ],
}
