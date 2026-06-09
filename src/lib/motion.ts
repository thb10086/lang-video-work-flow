/**
 * Motion design tokens — single source of truth for animation timing.
 *
 * Used by both framer-motion components and pure CSS keyframes so the
 * visual rhythm of the app stays consistent. Adjust here, not at call sites.
 *
 * Performance contract: all animations referencing these tokens MUST animate
 * `transform` / `opacity` / filter only — no layout-triggering properties.
 */

export const MOTION_DURATION = {
  /** 0.18s — micro feedback (hover, button press) */
  fast: 0.18,
  /** 0.22s — most UI transitions (modal, drawer, dialog) */
  normal: 0.22,
  /** 0.32s — node mount/unmount, page transition */
  slow: 0.32,
  /** 0.42s — error shake + status flash */
  emphasis: 0.42,
  /** 1.2s — looping pulse / breathing highlight */
  pulse: 1.2,
} as const

export const MOTION_SPRING = {
  /** Default spring for node mount and modal entry. */
  default: { type: 'spring' as const, stiffness: 280, damping: 22 },
  /** Bouncy spring used for success-flash bumps. */
  bouncy: { type: 'spring' as const, stiffness: 360, damping: 14 },
  /** Soft spring for drawer / panel slides. */
  soft: { type: 'spring' as const, stiffness: 220, damping: 28 },
} as const

export const MOTION_EASE = {
  /** Standard ease for fade-in/out. */
  standard: [0.4, 0.0, 0.2, 1] as const,
  /** Ease-in for exit transitions. */
  exit: [0.4, 0.0, 1, 1] as const,
  /** Linear — used for streaming text/progress. */
  linear: [0, 0, 1, 1] as const,
} as const

/**
 * Motion presets — ready-to-spread variant objects for framer-motion.
 *
 * Usage:
 *   import { MOTION_VARIANTS } from '@/lib/motion'
 *   <motion.div variants={MOTION_VARIANTS.nodeMount} initial="initial" animate="animate" exit="exit" />
 */
export const MOTION_VARIANTS = {
  nodeMount: {
    initial: { opacity: 0, scale: 0.6 },
    animate: { opacity: 1, scale: 1, transition: MOTION_SPRING.default },
    exit: {
      opacity: 0,
      scale: 0.92,
      transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.exit },
    },
  },
  successFlash: {
    initial: { scale: 1 },
    animate: {
      scale: [1, 1.04, 1],
      transition: { duration: MOTION_DURATION.emphasis, times: [0, 0.4, 1] },
    },
  },
  errorShake: {
    initial: { x: 0 },
    animate: {
      x: [0, -4, 4, -4, 4, 0],
      transition: { duration: MOTION_DURATION.emphasis, times: [0, 0.2, 0.4, 0.6, 0.8, 1] },
    },
  },
  pulseRing: {
    initial: { scale: 1, opacity: 0.6 },
    animate: {
      scale: [1, 1.02, 1],
      opacity: [0.6, 1, 0.6],
      transition: {
        duration: MOTION_DURATION.pulse,
        repeat: Infinity,
        ease: MOTION_EASE.standard,
      },
    },
  },
  toolBubbleEntry: {
    initial: { y: 8, opacity: 0 },
    animate: { y: 0, opacity: 1, transition: { duration: MOTION_DURATION.normal } },
    exit: { y: -4, opacity: 0, transition: { duration: MOTION_DURATION.fast } },
  },
  dialogBackdrop: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: MOTION_DURATION.fast } },
    exit: { opacity: 0, transition: { duration: MOTION_DURATION.fast } },
  },
  dialogPanel: {
    initial: { opacity: 0, scale: 0.94 },
    animate: { opacity: 1, scale: 1, transition: MOTION_SPRING.default },
    exit: {
      opacity: 0,
      scale: 0.96,
      transition: { duration: MOTION_DURATION.fast, ease: MOTION_EASE.exit },
    },
  },
} as const

export type MotionVariantName = keyof typeof MOTION_VARIANTS
