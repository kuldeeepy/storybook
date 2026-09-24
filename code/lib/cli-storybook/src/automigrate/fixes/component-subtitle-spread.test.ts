import { describe, expect, it } from 'vitest';

import { transformPreviewSource, transformStorySource } from './component-subtitle.ts';

describe.each([
  { name: 'preview', transform: transformPreviewSource },
  { name: 'meta', transform: transformStorySource },
])('component-subtitle spreads in $name', ({ transform }) => {
  it('migrates an explicit subtitle after a parameters spread', () => {
    const source = `
      export default {
        parameters: {
          ...parameters,
          componentSubtitle: 'Legacy'
        }
      };
    `;
    expect(() => transform(source)).not.toThrow();
  });

  it('migrates a subtitle declared through a local parameters spread', () => {
    const source = `
      const legacyParameters = { componentSubtitle: 'Legacy' };
      export default {
        parameters: { ...legacyParameters }
      };
    `;
    expect(() => transform(source)).not.toThrow();
  });
});
