/**
 * AssetDetailModal — create / edit an asset.
 *
 * Fields: name (required), nameEn (optional), appearance (required, rich
 * textarea), reference images (upload + URL paste), variations (name +
 * appearance pairs).
 *
 * On save:
 *  - If `asset` prop is present → call `assetStore.update` with patch
 *  - Else → call `assetStore.create` with new asset body
 *
 * Validation is intentionally light: we rely on backend Pydantic validation
 * and surface errors in a toast-style banner.
 */

import { useState, useEffect, useCallback } from 'react'
import { X, Plus, Trash2, Image as ImageIcon, Upload } from 'lucide-react'
import type { AssetDTO, AssetKind, VariationInput } from '@/api/backend'
import { useAssetStore } from '@/store/assetStore'
import { backendApi } from '@/api/backend'

interface AssetDetailModalProps {
  open: boolean
  kind: AssetKind
  /** When present → edit mode; else → create. */
  asset?: AssetDTO | null
  onClose: () => void
}

interface FormState {
  name: string
  nameEn: string
  appearance: string
  referenceImages: string[]
  variations: VariationInput[]
}

const EMPTY: FormState = {
  name: '',
  nameEn: '',
  appearance: '',
  referenceImages: [],
  variations: [],
}

function AssetDetailModal({ open, kind, asset, onClose }: AssetDetailModalProps) {
  const create = useAssetStore(s => s.create)
  const update = useAssetStore(s => s.update)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [urlInput, setUrlInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (asset) {
      setForm({
        name: asset.name || '',
        nameEn: asset.name_en || '',
        appearance: asset.appearance || asset.environment || asset.guide || '',
        referenceImages: [...(asset.reference_images || [])],
        variations: (asset.variations || []).map(v => ({
          id: v.id,
          label: v.label,
          appearance_delta: v.appearance_delta,
          reference_images: v.reference_images,
        })),
      })
    } else {
      setForm(EMPTY)
    }
    setError(null)
    setUrlInput('')
  }, [open, asset])

  const addReferenceUrl = () => {
    const u = urlInput.trim()
    if (!u) return
    setForm(f => ({ ...f, referenceImages: [...f.referenceImages, u] }))
    setUrlInput('')
  }

  const removeReferenceAt = (idx: number) => {
    setForm(f => ({ ...f, referenceImages: f.referenceImages.filter((_, i) => i !== idx) }))
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    for (const file of files) {
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const res = await backendApi.uploadImage(base64, file.name)
        setForm(f => ({ ...f, referenceImages: [...f.referenceImages, res.url] }))
      } catch (err) {
        const msg = err instanceof Error ? err.message : '上传失败'
        setError(`上传 ${file.name} 失败: ${msg}`)
      }
    }
    e.target.value = ''
  }

  const addVariation = () => {
    setForm(f => ({
      ...f,
      variations: [...f.variations, { label: 'new_variation', appearance_delta: '' }],
    }))
  }

  const updateVariation = (idx: number, patch: Partial<VariationInput>) => {
    setForm(f => ({
      ...f,
      variations: f.variations.map((v, i) => (i === idx ? { ...v, ...patch } : v)),
    }))
  }

  const removeVariation = (idx: number) => {
    setForm(f => ({ ...f, variations: f.variations.filter((_, i) => i !== idx) }))
  }

  const handleSave = useCallback(async () => {
    setError(null)
    if (!form.name.trim()) { setError('名称不能为空'); return }
    if (!form.appearance.trim()) { setError('外貌描述不能为空'); return }
    setSaving(true)
    try {
      const contentField: 'appearance' | 'environment' | 'guide' =
        kind === 'character' ? 'appearance' : kind === 'scene' ? 'environment' : 'guide'
      if (asset) {
        await update(asset.asset_id, {
          name: form.name,
          name_en: form.nameEn || undefined,
          [contentField]: form.appearance,
          reference_images: form.referenceImages,
          variations: form.variations,
        })
      } else {
        await create({
          kind,
          name: form.name,
          name_en: form.nameEn || undefined,
          [contentField]: form.appearance,
          reference_images: form.referenceImages,
          variations: form.variations,
        })
      }
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }, [asset, form, kind, update, create, onClose])

  if (!open) return null

  const kindLabel = kind === 'character' ? '角色' : kind === 'scene' ? '场景' : '风格'
  const title = asset ? `编辑${kindLabel}：${asset.name}` : `新建${kindLabel}`

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded-md">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="px-3 py-2 bg-red-500/10 border border-red-300 text-red-700 text-xs rounded-md">
              {error}
            </div>
          )}

          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">名称 *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full mt-1 px-2.5 py-1.5 text-xs border border-border rounded-md bg-background focus:border-primary focus:outline-none"
                placeholder="e.g. Sarah"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground">英文名</label>
              <input
                type="text"
                value={form.nameEn}
                onChange={(e) => setForm(f => ({ ...f, nameEn: e.target.value }))}
                className="w-full mt-1 px-2.5 py-1.5 text-xs border border-border rounded-md bg-background focus:border-primary focus:outline-none"
                placeholder="可选"
              />
            </div>
          </div>

          {/* Appearance */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">外貌描述 *</label>
            <textarea
              value={form.appearance}
              onChange={(e) => setForm(f => ({ ...f, appearance: e.target.value }))}
              rows={4}
              className="w-full mt-1 px-2.5 py-1.5 text-xs border border-border rounded-md bg-background focus:border-primary focus:outline-none resize-none"
              placeholder="详细描述，会注入到 prompt 中..."
            />
          </div>

          {/* Reference images */}
          <div>
            <label className="text-[11px] font-medium text-muted-foreground">
              参考图 <span className="opacity-60">({form.referenceImages.length})</span>
            </label>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {form.referenceImages.map((url, idx) => (
                <div key={idx} className="relative group aspect-square bg-muted rounded-md overflow-hidden border border-border">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeReferenceAt(idx)}
                    className="absolute top-1 right-1 p-0.5 bg-black/70 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
              <label className="aspect-square border border-dashed border-border rounded-md flex items-center justify-center cursor-pointer hover:border-primary/60 hover:bg-muted/30 transition-colors">
                <input type="file" accept="image/*" multiple onChange={handleUpload} className="hidden" />
                <div className="flex flex-col items-center gap-1 text-muted-foreground text-[10px]">
                  <Upload className="w-4 h-4" />
                  上传
                </div>
              </label>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addReferenceUrl() } }}
                placeholder="或粘贴图片 URL"
                className="flex-1 px-2.5 py-1.5 text-xs border border-border rounded-md bg-background focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                onClick={addReferenceUrl}
                className="px-2 py-1.5 text-xs border border-border rounded-md hover:bg-muted"
              >
                添加
              </button>
            </div>
          </div>

          {/* Variations */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-muted-foreground">
                变体 <span className="opacity-60">({form.variations.length})</span>
              </label>
              <button
                type="button"
                onClick={addVariation}
                className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" /> 添加变体
              </button>
            </div>
            <div className="mt-2 space-y-2">
              {form.variations.length === 0 ? (
                <div className="text-[10px] text-muted-foreground italic px-2">
                  变体（如「@sarah:smiling」）用于同一角色的不同表情/姿态
                </div>
              ) : (
                form.variations.map((v, idx) => (
                  <div key={idx} className="flex gap-2 p-2 bg-muted/30 rounded-md">
                    <input
                      type="text"
                      value={v.label}
                      onChange={(e) => updateVariation(idx, { label: e.target.value })}
                      placeholder="名称"
                      className="w-24 px-2 py-1 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
                    />
                    <input
                      type="text"
                      value={v.appearance_delta || ''}
                      onChange={(e) => updateVariation(idx, { appearance_delta: e.target.value })}
                      placeholder="外貌变化"
                      className="flex-1 px-2 py-1 text-xs border border-border rounded bg-background focus:border-primary focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeVariation(idx)}
                      className="p-1 hover:bg-red-500/10 text-red-500 rounded"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs border border-border rounded-md hover:bg-muted"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
          >
            {saving ? '保存中...' : asset ? '保存修改' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default AssetDetailModal
