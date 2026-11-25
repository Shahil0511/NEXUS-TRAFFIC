import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Panel } from './Panel';
import { ReportSheet, ReportSubsection } from './ReportSheet';

describe('ReportSheet', () => {
  it('orders facts → wide chart → around | who → wide second row → after', () => {
    const { container } = render(
      <ReportSheet
        headlineFacts={<p>the facts</p>}
        chart={{ title: 'Views over time', description: 'per hour', content: <p>chart</p> }}
        around={{ title: 'What happens around it', content: <p>around</p> }}
        who={<Panel title="Who uses it">who</Panel>}
        second={{ title: 'Used with', content: <p>second</p> }}
        after={<p>after</p>}
      />,
    );
    const headings = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(headings).toEqual([
      'Views over time',
      'What happens around it',
      'Who uses it',
      'Used with',
    ]);
    const text = container.textContent ?? '';
    const order = ['the facts', 'chart', 'around', 'who', 'second', 'after'].map((part) =>
      text.indexOf(part),
    );
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getByText('per hour')).toBeInTheDocument();
  });

  it('puts the two middle panels in a grid that stacks below lg', () => {
    const { container } = render(
      <ReportSheet
        chart={{ title: 'Uses over time', content: null }}
        around={{ title: 'How it is used', content: null }}
        who={<Panel title="Who uses it">who</Panel>}
        second={{ title: 'Used with', content: null }}
      />,
    );
    const columns = container.querySelector('[data-slot="report-columns"]');
    expect(columns).toHaveClass('grid', 'lg:grid-cols-2', 'min-w-0');
    expect(container.querySelector('[data-slot="report-facts"]')).toBeNull();
  });
});

describe('ReportSubsection', () => {
  it('is a region named by its own h3, with an optional description', () => {
    render(
      <>
        <ReportSubsection title="Came from" description="The page just before, by visits">
          <p>list</p>
        </ReportSubsection>
        <ReportSubsection title="Went to">
          <p>list</p>
        </ReportSubsection>
      </>,
    );
    expect(screen.getByRole('region', { name: 'Came from' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Went to' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(2);
    expect(screen.getByText('The page just before, by visits')).toBeInTheDocument();
  });
});
