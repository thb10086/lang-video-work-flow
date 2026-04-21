/**
 * Prompt Engine — 模板渲染 + 变量替换
 */

export interface PromptTemplate {
  id: string
  name: string
  category: 'character' | 'scene' | 'image' | 'video' | 'script' | 'storyboard'
  template: string
  variables: PromptVariable[]
  description?: string
}

export interface PromptVariable {
  key: string
  label: string
  type: 'string' | 'select'
  default: string
  options?: string[]
  description?: string
}

/**
 * 渲染模板：将 {{variable}} 替换为实际值
 */
export function renderTemplate(
  template: string,
  values: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return values[key] ?? `{{${key}}}`
  })
}

/**
 * 提取模板中的所有变量名
 */
export function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g)
  const vars = new Set<string>()
  for (const m of matches) {
    vars.add(m[1])
  }
  return Array.from(vars)
}
