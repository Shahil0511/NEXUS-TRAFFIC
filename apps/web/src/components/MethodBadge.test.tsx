import { HTTP_METHOD_VALUES } from '@nexus/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MethodBadge } from './MethodBadge';

describe('MethodBadge', () => {
  it.each(HTTP_METHOD_VALUES)('shows %s as text (colour is never the only signal)', (method) => {
    render(<MethodBadge method={method} />);
    expect(screen.getByText(method)).toHaveClass('text-2xs');
  });

  it('colours the common verbs from the --method-* tokens, not hard-coded palette classes', () => {
    const { container } = render(
      <>
        <MethodBadge method="GET" />
        <MethodBadge method="POST" />
        <MethodBadge method="PUT" />
        <MethodBadge method="PATCH" />
        <MethodBadge method="DELETE" />
      </>,
    );
    expect(screen.getByText('GET')).toHaveClass('text-method-get', 'bg-method-get/10');
    expect(screen.getByText('DELETE')).toHaveClass('text-method-delete');
    expect(container.innerHTML).not.toMatch(/(sky|emerald|amber|violet|rose)-\d00/);
  });

  it('keeps the rare verbs neutral', () => {
    render(<MethodBadge method="OPTIONS" />);
    expect(screen.getByText('OPTIONS')).toHaveClass('text-muted-foreground');
  });
});
