/**
 * Shared SkillDefinition type.
 *
 * Extracted to a standalone file so new SKILL modules (e.g. videoWorkflowRecipe,
 * multimodalInput) can import the type without creating a circular dependency
 * with skills/index.ts (which also consumes these modules).
 */

export interface SkillDefinition {
  /** 模块唯一标识 */
  id: string
  /** 模块中文名 */
  name: string
  /** 模块能力概述（1-2 句话） */
  summary: string
  /** 详细描述：包含可用工具、参数、流程 */
  details: string
  /** 该模块涉及的工具名列表 */
  tools: string[]
  /** 该模块涉及的节点类型 */
  nodeTypes: string[]
}
