import { describe, expect, it } from 'vitest';

import { transformPreviewSource, transformStorySource } from './component-subtitle.ts';

describe('component-subtitle', () => {
  it('migrates local fallbacks consistently across meta and stories', () => {
    const transformed = transformStorySource(`
      export default { parameters: { componentSubtitle: 'Meta' } };
      export const Primary = { parameters: { componentSubtitle: 'Story' } };
    `);
    expect(transformed).toMatchInlineSnapshot(`
      "
            export default { parameters: { docs: {
                  subtitle: 'Meta'
            } } };
            export const Primary = { parameters: { docs: {
                  subtitle: 'Story'
            } } };
          "
    `);
  });

  it('rejects conflicting parameters inherited from a CSF factory story', () => {
    expect(() =>
      transformStorySource(`
      import preview from './preview';
      const meta = preview.meta({});
      export const Base = meta.story({ parameters: { docs: { subtitle: 'Inherited' } } });
      export const Extended = Base.extend({ parameters: { componentSubtitle: 'Legacy' } });
    `)
    ).toThrow('Story inheritance changes parameters');
  });

  it('rejects a falsy subtitle that would hide a migrated base story fallback', () => {
    expect(() =>
      transformStorySource(`
      import preview from './preview';
      const meta = preview.meta({});
      export const Base = meta.story({ parameters: { componentSubtitle: 'Inherited' } });
      export const Extended = Base.extend({ parameters: { docs: { subtitle: '' } } });
    `)
    ).toThrow('Story inheritance changes parameters');
  });

  it('moves a meta componentSubtitle value to docs.subtitle', () => {
    const transformed = transformStorySource(`
        export default {
          component: Button,
          parameters: { componentSubtitle: subtitle }
        };
      `);
    expect(transformed).toMatchInlineSnapshot(`
      "
              export default {
                component: Button,
                parameters: { docs: {
                  subtitle: subtitle
                } }
              };
            "
    `);
  });

  it('moves a componentSubtitle value from an identifier meta', () => {
    const transformed = transformStorySource(`
      const meta = {
        component: Button,
        parameters: { componentSubtitle: 'Legacy' }
      } satisfies Meta;
      export default meta;
    `);

    expect(transformed).toMatchInlineSnapshot(`
      "
            const meta = {
              component: Button,
              parameters: { docs: {
                subtitle: 'Legacy'
              } }
            } satisfies Meta;
            export default meta;
          "
    `);
  });

  it('migrates a separately exported story through CSF discovery', () => {
    expect(
      transformStorySource(`
        export default { component: Button };
        const Primary = { parameters: { componentSubtitle: 'Legacy' } };
        export { Primary };
      `)
    ).toMatchInlineSnapshot(`
      "
              export default { component: Button };
              const Primary = { parameters: { docs: {
                      subtitle: 'Legacy'
              } } };
              export { Primary };
            "
    `);
  });

  it('adds subtitle to an existing docs object in a story', () => {
    expect(
      transformStorySource(`
        export default { component: Button };
        export const Primary = {
          parameters: {
            componentSubtitle: 'Legacy',
            docs: { source: { type: 'code' } }
          }
        };
      `)
    ).toMatchInlineSnapshot(`
      "
              export default { component: Button };
              export const Primary = {
                parameters: {
                  docs: {
                    subtitle: 'Legacy',
                    source: { type: 'code' }
                  }
                }
              };
            "
    `);
  });

  it('migrates CSF2 story annotations', () => {
    const transformed = transformStorySource(`
        export default { component: Button };
        export const Primary = () => null;
        Primary.parameters = {
          componentSubtitle: 'Legacy'
        };
      `);

    expect(transformed).toMatchInlineSnapshot(`
      "
              export default { component: Button };
              export const Primary = () => null;
              Primary.parameters = {
                docs: {
                  subtitle: 'Legacy'
                }
              };
            "
    `);
  });

  it('migrates CSF4 story objects', () => {
    const transformed = transformStorySource(`
        import preview from './preview';
        const meta = preview.meta({ component: Button });
        export const Primary = meta.story({
          parameters: { componentSubtitle: 'Legacy' }
        });
      `);

    expect(transformed).toMatchInlineSnapshot(`
      "
              import preview from './preview';
              const meta = preview.meta({ component: Button });
              export const Primary = meta.story({
                parameters: { docs: {
                  subtitle: 'Legacy'
                } }
              });
            "
    `);
  });

  it('preserves an existing docs.subtitle', () => {
    expect(
      transformStorySource(`export default { parameters: {
      componentSubtitle: 'Legacy', docs: { subtitle: 'Current' }
    } };`)
    ).toMatchInlineSnapshot(`
      "export default { parameters: {
        docs: { subtitle: 'Current' }
      } };"
    `);
  });

  it('migrates preview parameters', () => {
    expect(
      transformPreviewSource(`
        export default {
          parameters: { componentSubtitle: 'Preview subtitle' }
        };
      `)
    ).toMatchInlineSnapshot(`
      "
              export default {
                parameters: { docs: {
                  subtitle: 'Preview subtitle'
                } }
              };
            "
    `);
  });

  it('migrates static computed keys without creating duplicate docs fields', () => {
    const transformed = transformStorySource(`
      export default {
        parameters: {
          ['componentSubtitle']: 'Legacy',
          ['docs']: { ['subtitle']: 'Current' }
        }
      };
    `);

    expect(transformed).toMatchInlineSnapshot(`
      "
            export default {
              parameters: {
                ['docs']: { ['subtitle']: 'Current' }
              }
            };
          "
    `);
  });

  it('ignores componentSubtitle text in a preview comment', () => {
    expect(
      transformPreviewSource(`
        // parameters.componentSubtitle was removed
        export default { parameters: {} };
      `)
    ).toBeNull();
  });

  it('migrates a uniquely referenced parameters object', () => {
    expect(
      transformStorySource(`
        const parameters = { componentSubtitle: 'Legacy' };
        export default { parameters };
      `)
    ).toMatchInlineSnapshot(`
      "
              const parameters = { docs: {
                      subtitle: 'Legacy'
              } };
              export default { parameters };
            "
    `);
  });
});
