/**
 * LibTV-style node shell & primitives — barrel export.
 *
 * Consumers import everything from '@/components/nodes/_shell':
 *
 *   import {
 *     NodeShell, PreviewArea, ModeTabs, ActionChips,
 *     NodeToolbar, SubmitButton, ParamPopover,
 *     AspectRatioPicker, SegmentedPicker, DurationSlider,
 *     DEFAULT_VIDEO_RATIOS, DEFAULT_IMAGE_RATIOS,
 *   } from '@/components/nodes/_shell'
 */

export { default as NodeShell } from './NodeShell'
export type { NodeShellProps } from './NodeShell'

export { default as PreviewArea } from './PreviewArea'
export type { PreviewAreaProps, PreviewSuggestion } from './PreviewArea'

export { default as ModeTabs } from './ModeTabs'
export type { ModeTabsProps, ModeTabItem } from './ModeTabs'

export { default as ActionChips } from './ActionChips'
export type { ActionChipsProps, ActionChipItem } from './ActionChips'

export { default as NodeToolbar } from './NodeToolbar'
export type { NodeToolbarProps } from './NodeToolbar'

export { default as SubmitButton } from './SubmitButton'
export type { SubmitButtonProps } from './SubmitButton'

export { default as ParamPopover } from './ParamPopover'
export type { ParamPopoverProps, ParamPopoverTriggerArgs } from './ParamPopover'

export { default as AspectRatioPicker, DEFAULT_VIDEO_RATIOS, DEFAULT_IMAGE_RATIOS } from './pickers/AspectRatioPicker'
export type { AspectRatioPickerProps, AspectRatio } from './pickers/AspectRatioPicker'

export { default as SegmentedPicker } from './pickers/SegmentedPicker'
export type { SegmentedPickerProps, SegmentOption } from './pickers/SegmentedPicker'

export { default as DurationSlider } from './pickers/DurationSlider'
export type { DurationSliderProps } from './pickers/DurationSlider'

export { default as StylePicker, DEFAULT_STYLE_PRESETS } from './pickers/StylePicker'
export type { StylePickerProps, StylePreset } from './pickers/StylePicker'

export { default as CameraPicker, CAMERA_MOVEMENTS, CAMERA_ANGLES } from './pickers/CameraPicker'
export type { CameraPickerProps, CameraPreset, CameraCategory } from './pickers/CameraPicker'

export { default as ShotPicker, DEFAULT_SHOTS } from './pickers/ShotPicker'
export type { ShotPickerProps, ShotPreset } from './pickers/ShotPicker'

export { default as CharacterPicker } from './pickers/CharacterPicker'
export type { CharacterPickerProps, CharacterRef } from './pickers/CharacterPicker'
