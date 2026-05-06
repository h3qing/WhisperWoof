import { describe, it, expect, vi } from 'vitest';
import { CancelRecordingButton } from './CancelRecordingButton';

type ReactElement = ReturnType<typeof CancelRecordingButton>;

function findButton(el: ReactElement): { props: Record<string, unknown> } | null {
  if (!el || typeof el !== 'object' || !('props' in el)) return null;
  const root = el as { type: unknown; props: Record<string, unknown> };
  return root.type === 'button' ? root : null;
}

describe('CancelRecordingButton', () => {
  const baseProps = {
    onCancelRecording: vi.fn(),
    onCancelProcessing: vi.fn(),
    recordingLabel: 'Cancel recording',
    processingLabel: 'Cancel processing',
  };

  it('renders nothing when idle', () => {
    const el = CancelRecordingButton({
      ...baseProps,
      isRecording: false,
      isProcessing: false,
    });
    expect(el).toBeNull();
  });

  it('renders the button when recording', () => {
    const el = CancelRecordingButton({
      ...baseProps,
      isRecording: true,
      isProcessing: false,
    });
    const btn = findButton(el);
    expect(btn).not.toBeNull();
    expect(btn?.props['aria-label']).toBe('Cancel recording');
  });

  it('renders the button when processing', () => {
    const el = CancelRecordingButton({
      ...baseProps,
      isRecording: false,
      isProcessing: true,
    });
    const btn = findButton(el);
    expect(btn).not.toBeNull();
    expect(btn?.props['aria-label']).toBe('Cancel processing');
  });

  it('routes click to onCancelRecording when recording', () => {
    const onCancelRecording = vi.fn();
    const onCancelProcessing = vi.fn();
    const el = CancelRecordingButton({
      ...baseProps,
      onCancelRecording,
      onCancelProcessing,
      isRecording: true,
      isProcessing: false,
    });
    const btn = findButton(el);
    const onClick = btn?.props.onClick as (e: { stopPropagation: () => void }) => void;
    const stopPropagation = vi.fn();
    onClick({ stopPropagation });
    expect(onCancelRecording).toHaveBeenCalledTimes(1);
    expect(onCancelProcessing).not.toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('routes click to onCancelProcessing when processing only', () => {
    const onCancelRecording = vi.fn();
    const onCancelProcessing = vi.fn();
    const el = CancelRecordingButton({
      ...baseProps,
      onCancelRecording,
      onCancelProcessing,
      isRecording: false,
      isProcessing: true,
    });
    const btn = findButton(el);
    const onClick = btn?.props.onClick as (e: { stopPropagation: () => void }) => void;
    onClick({ stopPropagation: vi.fn() });
    expect(onCancelProcessing).toHaveBeenCalledTimes(1);
    expect(onCancelRecording).not.toHaveBeenCalled();
  });

  it('prefers onCancelRecording when both flags are set (recording wins)', () => {
    const onCancelRecording = vi.fn();
    const onCancelProcessing = vi.fn();
    const el = CancelRecordingButton({
      ...baseProps,
      onCancelRecording,
      onCancelProcessing,
      isRecording: true,
      isProcessing: true,
    });
    const btn = findButton(el);
    const onClick = btn?.props.onClick as (e: { stopPropagation: () => void }) => void;
    onClick({ stopPropagation: vi.fn() });
    expect(onCancelRecording).toHaveBeenCalledTimes(1);
    expect(onCancelProcessing).not.toHaveBeenCalled();
  });
});
