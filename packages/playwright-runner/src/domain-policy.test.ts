import { describe, expect, it } from 'vitest';
import { isUrlAllowed } from './domain-policy';

describe('runner domain policy', () => {
  it('matches exact hosts and rejects sibling, subdomain, and malformed URLs', () => {
    expect(isUrlAllowed('https://forms.example.com/a', ['forms.example.com'])).toBe(true);
    expect(isUrlAllowed('https://evil.forms.example.com/a', ['forms.example.com'])).toBe(false);
    expect(isUrlAllowed('https://example.com/a', ['forms.example.com'])).toBe(false);
    expect(isUrlAllowed('not-a-url', ['forms.example.com'])).toBe(false);
    expect(isUrlAllowed('https://forms.example.com', ['%%%'])).toBe(false);
  });
});

