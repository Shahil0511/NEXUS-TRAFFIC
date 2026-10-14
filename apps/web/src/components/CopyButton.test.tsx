import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CopyableText, CopyButton, copyToClipboard } from './CopyButton';

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

const REQUEST_ID = 'req-7f3a9c1d-2b4e-4f60-9a8b-1c2d3e4f5a6b';

function mockClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

/** jsdom has no execCommand; install a controllable one. */
function mockExecCommand(result: boolean) {
  const execCommand = vi.fn().mockReturnValue(result);
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
  return execCommand;
}

describe('CopyButton', () => {
  let log: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    toastSuccess.mockReset();
    toastError.mockReset();
    log = vi.spyOn(console, 'log');
  });
  afterEach(() => {
    for (const call of log.mock.calls) expect(JSON.stringify(call)).not.toContain(REQUEST_ID);
    log.mockRestore();
  });

  it('copies the value, turns into a check and toasts "Copied"', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<CopyButton value={REQUEST_ID} label="request id" />);

    await user.click(screen.getByRole('button', { name: 'Copy request id' }));

    expect(writeText).toHaveBeenCalledWith(REQUEST_ID);
    expect(await screen.findByRole('button', { name: 'Copied request id' })).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith('Copied');
    // The value is never put in the DOM by the button itself.
    expect(document.body.innerHTML).not.toContain(REQUEST_ID);
  });

  it('falls back to a textarea + execCommand when the Clipboard API refuses', async () => {
    const user = userEvent.setup();
    mockClipboard(vi.fn().mockRejectedValue(new Error('NotAllowedError')));
    const execCommand = mockExecCommand(true);
    const onCopyResult = vi.fn();
    render(<CopyButton value={REQUEST_ID} label="request id" onCopyResult={onCopyResult} />);

    await user.click(screen.getByRole('button', { name: 'Copy request id' }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(onCopyResult).toHaveBeenCalledWith(true);
    expect(document.querySelector('textarea')).toBeNull(); // cleaned up
    expect(toastSuccess).toHaveBeenCalledWith('Copied');
  });

  it('reports a blocked clipboard without claiming success', async () => {
    const user = userEvent.setup();
    mockClipboard(vi.fn().mockRejectedValue(new Error('NotAllowedError')));
    mockExecCommand(false);
    const onCopyResult = vi.fn();
    render(<CopyButton value={REQUEST_ID} label="key" showText onCopyResult={onCopyResult} />);

    await user.click(screen.getByRole('button', { name: 'Copy key' }));

    expect(onCopyResult).toHaveBeenCalledWith(false);
    expect(toastError).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy key' })).toHaveTextContent('Copy');
  });

  it('does not let the click reach a clickable parent row', async () => {
    const user = userEvent.setup();
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <CopyButton value={REQUEST_ID} label="request id" />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Copy request id' }));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

describe('copyToClipboard', () => {
  it('resolves false when neither path works', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    mockExecCommand(false);
    await expect(copyToClipboard('x')).resolves.toBe(false);
  });
});

describe('CopyableText', () => {
  it('shows the (optionally shortened) text with the full value as tooltip, and copies it', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(
      <CopyableText value="7c1d2e3f-4a5b-4c6d-8e7f-001122334455" label="session id">
        7c1d2e3f
      </CopyableText>,
    );
    expect(screen.getByText('7c1d2e3f')).toHaveAttribute(
      'title',
      '7c1d2e3f-4a5b-4c6d-8e7f-001122334455',
    );
    await user.click(screen.getByRole('button', { name: 'Copy session id' }));
    expect(writeText).toHaveBeenCalledWith('7c1d2e3f-4a5b-4c6d-8e7f-001122334455');
  });
});
