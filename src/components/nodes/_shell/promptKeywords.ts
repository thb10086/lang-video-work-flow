/**
 * Helpers to toggle / replace keyword phrases inside a prompt.
 *
 * Used by VideoGenNode / ImageGenNode / etc. when the user picks a style,
 * camera move, shot size, etc. Each picker associates with a `keyword` string
 * (e.g. "cyberpunk, neon lights, rain"); clicking the preset should add that
 * keyword to the prompt or remove it if already present.
 *
 * The keyword matching is case-insensitive and strips surrounding commas so
 * the prompt doesn't end up with `, , ` clutter after toggles.
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True if `prompt` contains `keyword` (case-insensitive). */
export function promptContainsKeyword(prompt: string, keyword: string): boolean {
  return prompt.toLowerCase().includes(keyword.toLowerCase())
}

/**
 * Toggle a keyword in the prompt:
 *   - If present → remove it (and any surrounding commas).
 *   - If absent  → append it (comma-separated).
 */
export function togglePromptKeyword(prompt: string, keyword: string): string {
  const kw = keyword.trim()
  if (!kw) return prompt
  const current = prompt.trim()

  if (promptContainsKeyword(current, kw)) {
    // Remove the keyword + any leading/trailing comma & whitespace
    const re = new RegExp(
      `(?:\\s*,\\s*${escapeRegex(kw)})|(?:${escapeRegex(kw)}\\s*,\\s*)|(?:${escapeRegex(kw)})`,
      'gi',
    )
    return current
      .replace(re, '')
      .replace(/\s*,\s*,\s*/g, ', ')
      .replace(/^\s*,\s*|\s*,\s*$/g, '')
      .trim()
  }

  return current ? `${current}, ${kw}` : kw
}

/**
 * Replace any of the "mutually-exclusive" keywords with `next` (or remove `next`
 * if it was already present). Useful for single-select pickers like ShotPicker
 * where only one shot-size keyword should live in the prompt at a time.
 */
export function replacePromptKeyword(
  prompt: string,
  allKeywords: string[],
  next: string,
): string {
  // Remove every candidate keyword first (case-insensitive)
  let out = prompt
  for (const kw of allKeywords) {
    if (!kw) continue
    const re = new RegExp(
      `(?:\\s*,\\s*${escapeRegex(kw)})|(?:${escapeRegex(kw)}\\s*,\\s*)|(?:${escapeRegex(kw)})`,
      'gi',
    )
    out = out.replace(re, '')
  }
  out = out.replace(/\s*,\s*,\s*/g, ', ').replace(/^\s*,\s*|\s*,\s*$/g, '').trim()

  // Only append `next` if the caller wants a new selection
  if (!next) return out
  if (promptContainsKeyword(out, next)) return out
  return out ? `${out}, ${next}` : next
}
