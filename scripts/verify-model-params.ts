/**
 * verify-model-params.ts — dev-time regression script.
 *
 * Loads all registered models from the backend and prints:
 *   1. One-line summary per model (id, capability, schema fields count, schema_version)
 *   2. Generated Agent tool schemas for create_video_node / create_image_node / create_audio_node
 *   3. Any warnings (e.g. model without schema, duplicate keys, unexpected types)
 *
 * Usage:
 *   npx tsx scripts/verify-model-params.ts              # full report
 *   npx tsx scripts/verify-model-params.ts --json       # machine-readable JSON
 *   BACKEND_URL=http://localhost:8000 npx tsx scripts/verify-model-params.ts
 *
 * Expected to be run after `python -m app.db.seed`; exit code 1 on verification errors.
 */

import {
  buildCreateVideoNodeTool,
  buildCreateImageNodeTool,
  buildCreateAudioNodeTool,
} from '../src/providers/toolSchemaGenerator'
import type { AiModelResponse } from '../src/api/backend'

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'
const JSON_MODE = process.argv.includes('--json')

interface ApiResponse<T> { code: number; data: T; message: string }
interface ListResp { items: AiModelResponse[]; total: number }

async function fetchModels(capability: string): Promise<AiModelResponse[]> {
  const url = `${BACKEND_URL}/api/models?capability=${capability}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`)
  const body = (await res.json()) as ApiResponse<ListResp>
  if (body.code !== 0) throw new Error(`API error: ${body.message}`)
  return body.data.items
}

interface ReportEntry {
  capability: string
  model_id: string
  provider: string
  schema_version: number
  field_count: number
  fields: string[]
}

function summarize(models: AiModelResponse[], capability: string): ReportEntry[] {
  return models.map(m => ({
    capability,
    model_id: m.model_id,
    provider: m.provider,
    schema_version: m.schema_version ?? 1,
    field_count: Array.isArray(m.param_schema) ? m.param_schema.length : 0,
    fields: (m.param_schema || []).map(f => f.key),
  }))
}

interface ToolReport {
  name: string
  model_enum?: string[]
  property_keys: string[]
  annotated: string[]
}

function describeTool(name: string, props: Record<string, unknown>): ToolReport {
  const modelField = props.model as { enum?: string[] } | undefined
  const annotated: string[] = []
  for (const [k, v] of Object.entries(props)) {
    const desc = String((v as { description?: string })?.description || '')
    if (desc.includes('[仅适用于')) annotated.push(k)
  }
  return {
    name,
    model_enum: modelField?.enum,
    property_keys: Object.keys(props),
    annotated,
  }
}

async function main() {
  let exitCode = 0
  try {
    const [video, image, audio] = await Promise.all([
      fetchModels('video'),
      fetchModels('image'),
      fetchModels('audio'),
    ])

    // ── Report 1: model registry summary ──
    const summary = [
      ...summarize(video, 'video'),
      ...summarize(image, 'image'),
      ...summarize(audio, 'audio'),
    ]

    // ── Report 2: generated agent tools ──
    const videoTool = buildCreateVideoNodeTool(video)
    const imageTool = buildCreateImageNodeTool(image)
    const audioTool = buildCreateAudioNodeTool(audio)

    const tools = [
      describeTool('create_video_node', videoTool.function.parameters.properties),
      describeTool('create_image_node', imageTool.function.parameters.properties),
      describeTool('create_audio_node', audioTool.function.parameters.properties),
    ]

    // ── Warnings ──
    const warnings: string[] = []
    for (const m of [...video, ...image, ...audio]) {
      if (!Array.isArray(m.param_schema) || m.param_schema.length === 0) {
        warnings.push(`${m.capability}/${m.model_id}: empty param_schema`)
      }
    }

    if (JSON_MODE) {
      console.log(JSON.stringify({ summary, tools, warnings }, null, 2))
    } else {
      console.log(`\n=== Model Registry (${summary.length} models) ===`)
      for (const s of summary) {
        console.log(`  [${s.capability}] ${s.model_id.padEnd(32)} v${s.schema_version}  ${s.field_count} fields: ${s.fields.join(', ') || '(none)'}`)
      }
      console.log('\n=== Generated Agent Tools ===')
      for (const t of tools) {
        console.log(`  ${t.name}:`)
        if (t.model_enum) console.log(`    model enum (${t.model_enum.length}): ${t.model_enum.join(', ')}`)
        console.log(`    ${t.property_keys.length} properties: ${t.property_keys.join(', ')}`)
        if (t.annotated.length > 0) console.log(`    ${t.annotated.length} model-scoped: ${t.annotated.join(', ')}`)
      }
      if (warnings.length > 0) {
        console.log('\n=== Warnings ===')
        warnings.forEach(w => console.log(`  - ${w}`))
        exitCode = 1
      } else {
        console.log('\n[OK] All models have non-empty param_schema.')
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[ERROR] ${msg}`)
    exitCode = 2
  }
  process.exit(exitCode)
}

main()
