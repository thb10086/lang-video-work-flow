import { directorSystemPrompt } from './director'
import { screenwriterSystemPrompt } from './screenwriter'
import { artistSystemPrompt } from './artist'
import { cinematographerSystemPrompt } from './cinematographer'

export { directorSystemPrompt, directorRoleInfo } from './director'
export { screenwriterSystemPrompt, screenwriterRoleInfo } from './screenwriter'
export { artistSystemPrompt, artistRoleInfo } from './artist'
export { cinematographerSystemPrompt, cinematographerRoleInfo } from './cinematographer'

export const defaultAssistantPrompt = `你是 AI Video Workflow Studio 的执行型 AI 助手，通过工具调用直接操控画布节点，将用户的视频创意转化为可运行的工作流。

## 触发规则（识别意图 → 立即行动）

| 用户意图 | 立即执行 |
|---------|---------|
| 描述视频项目/短片/广告创意 | \`generate_workflow\` 生成完整骨架 |
| 要求创建某类节点 | 对应 \`create_xxx\` 工具，填充专业内容 |
| 要求执行/生成某个节点 | \`execute_node\` + \`get_node_output\` 验证 |
| 要求修改某个节点 | \`get_canvas_state\` 定位 → \`canvas.update_node\` |
| 要求查看工作流状态 | \`get_canvas_state\` |
| 信息已足够，只是没有明确说"执行" | 直接执行，不等确认 |

## 执行循环

**分析**（理解任务） → **行动**（调用工具） → **验证**（\`get_node_output\`） → **报告**（3句话以内）

## 禁止行为

- 禁止在执行前输出分析段落或方案列表
- 禁止追问细节（缺失信息使用合理默认值）
- 禁止让用户选择（选最合理的直接做）
- 禁止使用 emoji
- 禁止输出"你可以……""建议你……"等被动建议句式

用中文回答，回复控制在 3-5 句以内。`

export interface RoleInfo {
  id: string
  name: string
  icon: string
  description: string
}

export const ALL_ROLES: RoleInfo[] = [
  { id: 'assistant', name: '通用助手', icon: 'bot', description: '通用AI创作助手' },
  { id: 'director', name: 'AI 导演', icon: 'clapperboard', description: '规划视觉风格、镜头语言和分镜' },
  { id: 'screenwriter', name: 'AI 编剧', icon: 'pen-line', description: '创作剧本、对话和叙事结构' },
  { id: 'artist', name: 'AI 美术', icon: 'palette', description: '优化提示词、确保风格统一' },
  { id: 'cinematographer', name: 'AI 摄影师', icon: 'camera', description: '设计运镜、优化视频提示词' },
]

export function getSystemPromptForRole(roleId: string): string {
  switch (roleId) {
    case 'director':
      return directorSystemPrompt
    case 'screenwriter':
      return screenwriterSystemPrompt
    case 'artist':
      return artistSystemPrompt
    case 'cinematographer':
      return cinematographerSystemPrompt
    default:
      return defaultAssistantPrompt
  }
}
