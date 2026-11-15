/**
 * The remote's small component library. Everything here takes plain props and knows nothing
 * about boots or the store, so each piece has stories in Storybook (`bun run storybook`).
 */

export { Button, IconButton, ClearIcon, ChevronIcon, type ButtonProps, type ButtonVariant } from "./Button";
export { Segmented, type SegmentOption, type SegmentedProps } from "./Segmented";
export { Fact, FactTable, type Tone } from "./Facts";
export { TextField, type TextFieldProps } from "./TextField";
export { Notice } from "./Notice";
export { SyncStatus, type SyncStatusProps } from "./SyncStatus";
export { PoseList, PoseRow, type PoseRowProps, type PoseStatus } from "./PoseRow";
export { AudioWaveform, formatRms, type AudioSignalStatus, type AudioWaveformProps } from "./AudioWaveform";
export { Toggle } from "./Toggle";
export { PixelSlider, STRIP_PIXELS, type PixelSliderShape, type PixelTone, type SliderWarning } from "./PixelSlider";
export { TiltStrip } from "./TiltStrip";

export { AppNavigation, type MainTab } from "./AppNavigation";
export { Sheet } from "./Sheet";
export { Icon, type IconName } from "./Icon";

export { StompHistory } from "./StompHistory";
export { AudioLevelHistory, type AudioLevelHistoryProps } from "./AudioLevelHistory";
