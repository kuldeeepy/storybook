import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JsPackageManager } from 'storybook/internal/common';

import { fs, vol } from 'memfs';

import {
  componentSubtitle,
  transformPreviewSource,
  transformStorySource,
} from './component-subtitle.ts';

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

vi.mock('node:fs/promises', { spy: true });

describe('component-subtitle file processing', () => {
  afterEach(() => {
    vi.mocked(readFile).mockRestore();
    vi.mocked(writeFile).mockRestore();
  });
  const previewConfigPath = resolve('.storybook/preview.ts');
  const storyPath = resolve('Button.stories.ts');
  const options = {
    packageManager: vi.mocked(JsPackageManager.prototype),
    mainConfig: { stories: [] },
    mainConfigPath: resolve('.storybook/main.ts'),
    configDir: resolve('.storybook'),
    storybookVersion: '11.0.0',
    hasCsfFactoryPreview: false,
    previewConfigPath,
    storiesPaths: [storyPath],
  };

  beforeEach(() => {
    vol.reset();
    let activeOperations = 0;
    vi.mocked(readFile).mockImplementation(async (file) => {
      expect(++activeOperations).toBe(1);
      try {
        return (await fs.promises.readFile(file.toString(), 'utf8')).toString();
      } finally {
        activeOperations--;
      }
    });
    vi.mocked(writeFile).mockImplementation(async (file, data) => {
      expect(++activeOperations).toBe(1);
      try {
        await fs.promises.writeFile(file.toString(), data.toString());
      } finally {
        activeOperations--;
      }
    });
    vol.fromJSON({
      [previewConfigPath]: "export default { parameters: { componentSubtitle: 'Preview' } };",
      [storyPath]: "export default { parameters: { componentSubtitle: 'Story' } };",
    });
  });

  it('retains paths only and migrates current contents with sequential reads and writes', async () => {
    const result = await componentSubtitle.check(options);
    expect(result).toEqual({ filesToChange: [previewConfigPath, storyPath], errors: [] });
    assert(result && componentSubtitle.run);
    fs.writeFileSync(storyPath, "export default { parameters: { componentSubtitle: 'Edited' } };");
    await componentSubtitle.run({ ...options, result });
    expect(fs.readFileSync(previewConfigPath, 'utf8')).toMatchInlineSnapshot(`
      "export default { parameters: { docs: {
        subtitle: 'Preview'
      } } };"
    `);
    expect(fs.readFileSync(storyPath, 'utf8')).toMatchInlineSnapshot(`
      "export default { parameters: { docs: {
        subtitle: 'Edited'
      } } };"
    `);
  });

  it('leaves files unchanged for dry runs and check errors', async () => {
    const before = vol.toJSON();
    const result = await componentSubtitle.check(options);
    assert(result && componentSubtitle.run);
    await componentSubtitle.run({ ...options, result, dryRun: true });
    expect(vol.toJSON()).toEqual(before);
    fs.writeFileSync(
      storyPath,
      "export default { parameters: { ...shared, componentSubtitle: 'Story' } };"
    );
    const unsafe = vol.toJSON();
    const unsafeResult = await componentSubtitle.check(options);
    assert(unsafeResult);
    await expect(componentSubtitle.run({ ...options, result: unsafeResult })).rejects.toThrow(
      'Could not migrate parameters.componentSubtitle automatically'
    );
    expect(vol.toJSON()).toEqual(unsafe);
  });

  it('skips files already migrated between check and run without requiring a preview', async () => {
    const storyOptions = { ...options, previewConfigPath: undefined };
    const result = await componentSubtitle.check(storyOptions);
    assert(result && componentSubtitle.run);
    fs.writeFileSync(
      storyPath,
      "export default { parameters: { docs: { subtitle: 'Updated' } } };"
    );
    const before = vol.toJSON();
    await componentSubtitle.run({ ...storyOptions, result });
    expect(vol.toJSON()).toEqual(before);
  });

  it('ignores unrelated dynamic docs config without a legacy subtitle', async () => {
    fs.writeFileSync(
      storyPath,
      "import docs from './docs'; export default { parameters: { docs } };"
    );
    expect(await componentSubtitle.check({ ...options, previewConfigPath: undefined })).toBeNull();
  });

  it('uses current preview inheritance before writing either file', async () => {
    const result = await componentSubtitle.check(options);
    assert(result && componentSubtitle.run);
    fs.writeFileSync(
      previewConfigPath,
      "export default { parameters: { docs: { subtitle: 'Current' } } };"
    );
    const before = vol.toJSON();
    await expect(componentSubtitle.run({ ...options, result })).rejects.toThrow(
      'An inherited parameters.docs.subtitle value can take precedence'
    );
    expect(vol.toJSON()).toEqual(before);
  });

  it('writes nothing when a later file becomes unsafe after check', async () => {
    const result = await componentSubtitle.check(options);
    assert(result && componentSubtitle.run);
    fs.writeFileSync(
      storyPath,
      "export default { parameters: { ...shared, componentSubtitle: 'Story' } };"
    );
    const before = vol.toJSON();
    await expect(componentSubtitle.run({ ...options, result })).rejects.toThrow();
    expect(vol.toJSON()).toEqual(before);
  });

  it('checks descendant subtitles in files without a legacy token', async () => {
    fs.writeFileSync(storyPath, "export default { parameters: { docs: { subtitle: '' } } };");
    const before = vol.toJSON();
    const result = await componentSubtitle.check(options);
    assert(result && componentSubtitle.run);
    await expect(componentSubtitle.run({ ...options, result })).rejects.toThrow();
    expect(vol.toJSON()).toEqual(before);
  });

  it('uses the preview transformer when rereading a preview file', async () => {
    fs.writeFileSync(
      previewConfigPath,
      "export const parameters = { componentSubtitle: 'Preview' };"
    );
    const result = await componentSubtitle.check(options);
    assert(result && componentSubtitle.run);
    await componentSubtitle.run({ ...options, result });
    expect(fs.readFileSync(previewConfigPath, 'utf8')).toMatchInlineSnapshot(`
      "export const parameters = { docs: {
        subtitle: 'Preview'
      } };"
    `);
  });
});
