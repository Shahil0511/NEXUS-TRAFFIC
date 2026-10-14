import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

import { InfoTip } from './InfoTip';

const TEXT = '95 % of calls were faster than this.';

describe('InfoTip', () => {
  it('is a labelled button that opens its definition on keyboard focus', async () => {
    const user = userEvent.setup();
    render(<InfoTip label="p95" text={TEXT} />);
    const button = screen.getByRole('button', { name: 'What is p95?' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    await user.tab();
    expect(button).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TEXT);
    expect(button).toHaveAccessibleDescription(TEXT);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
  });

  it('opens on hover', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <InfoTip label="error rate" text={TEXT} />
      </TooltipProvider>,
    );
    await user.hover(screen.getByRole('button', { name: 'What is error rate?' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TEXT);
  });

  it('opens on click / tap (no hover on touch screens)', async () => {
    const user = userEvent.setup();
    render(<InfoTip label="linked %" text={TEXT} />);
    await user.click(screen.getByRole('button', { name: 'What is linked %?' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent(TEXT);
  });
});
