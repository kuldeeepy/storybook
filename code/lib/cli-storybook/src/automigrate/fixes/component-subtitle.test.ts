import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

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
    vi.mocked(mkdtemp).mockRestore();
    vi.mocked(readFile).mockRestore();
    vi.mocked(realpath).mockRestore();
    vi.mocked(rm).mockRestore();
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
    vi.mocked(realpath).mockImplementation(async (file) => file.toString());
    vi.mocked(writeFile).mockImplementation(async (file, data) => {
      expect(++activeOperations).toBe(1);
      try {
        await fs.promises.mkdir(dirname(file.toString()), { recursive: true });
        await fs.promises.writeFile(file.toString(), data.toString());
      } finally {
        activeOperations--;
      }
    });
    vi.mocked(mkdtemp).mockResolvedValue(resolve('.annotation-transform-staging'));
    vi.mocked(rm).mockImplementation(async (path, options) => {
      await fs.promises.rm(path.toString(), options);
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

  it('schedules the migration only when an upgrade crosses SB11', async () => {
    expect(
      await componentSubtitle.check({
        ...options,
        isUpgrade: true,
        beforeVersion: '10.6.0',
      })
    ).toEqual({ filesToChange: [previewConfigPath, storyPath], errors: [] });
    expect(
      await componentSubtitle.check({
        ...options,
        isUpgrade: true,
        beforeVersion: '11.0.0',
      })
    ).toBeNull();
  });

  it.each(['0.0.0-pr-36129-sha-d9438e2', 'portal:', 'workspace:*'])(
    'schedules the migration for an SB11 upgrade target %s',
    async (storybookVersion) => {
      expect(
        await componentSubtitle.check({
          ...options,
          isUpgrade: true,
          beforeVersion: '10.6.0',
          storybookVersion,
        })
      ).toEqual({ filesToChange: [previewConfigPath, storyPath], errors: [] });
    }
  );

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

  it('plans shared stories for every project before writing any project', async () => {
    const secondPreviewConfigPath = resolve('second/.storybook/preview.ts');
    fs.mkdirSync(dirname(secondPreviewConfigPath), { recursive: true });
    fs.writeFileSync(
      secondPreviewConfigPath,
      "export default { parameters: { docs: { subtitle: 'Second preview' } } };"
    );
    vi.mocked(mkdtemp)
      .mockResolvedValueOnce(resolve('.annotation-transform-staging-first'))
      .mockResolvedValueOnce(resolve('.annotation-transform-staging-second'));
    const before = vol.toJSON();
    assert(componentSubtitle.runAcrossProjects);

    await expect(
      componentSubtitle.runAcrossProjects([
        { ...options, result: { filesToChange: [], errors: [] } },
        {
          ...options,
          configDir: resolve('second/.storybook'),
          previewConfigPath: secondPreviewConfigPath,
          result: { filesToChange: [], errors: [] },
        },
      ])
    ).rejects.toThrow('An inherited parameters.docs.subtitle value can take precedence');
    expect(vol.toJSON()).toEqual(before);
  });

  it.each([false, true])(
    'commits compatible shared project plans with dryRun=%s',
    async (dryRun) => {
      const secondPreviewConfigPath = resolve('second/.storybook/preview.ts');
      fs.mkdirSync(dirname(secondPreviewConfigPath), { recursive: true });
      fs.writeFileSync(
        secondPreviewConfigPath,
        "export default { parameters: { componentSubtitle: 'Second preview' } };"
      );
      vi.mocked(mkdtemp)
        .mockResolvedValueOnce(resolve('.annotation-transform-staging-first'))
        .mockResolvedValueOnce(resolve('.annotation-transform-staging-second'));
      const before = vol.toJSON();
      assert(componentSubtitle.runAcrossProjects);

      await componentSubtitle.runAcrossProjects([
        { ...options, dryRun, result: { filesToChange: [], errors: [] } },
        {
          ...options,
          configDir: resolve('second/.storybook'),
          previewConfigPath: secondPreviewConfigPath,
          dryRun,
          result: { filesToChange: [], errors: [] },
        },
      ]);

      if (dryRun) {
        expect(vol.toJSON()).toEqual(before);
      } else {
        expect(fs.readFileSync(storyPath, 'utf8')).toContain('docs');
        expect(fs.readFileSync(storyPath, 'utf8')).not.toContain('componentSubtitle');
      }
    }
  );

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

  it('does not migrate stories when preview parameters cannot be inspected', async () => {
    fs.writeFileSync(
      previewConfigPath,
      "import parameters from './parameters'; export default { parameters };"
    );
    const before = vol.toJSON();
    const result = await componentSubtitle.check(options);

    expect(result?.errors).toEqual([expect.objectContaining({ file: previewConfigPath })]);
    assert(result && componentSubtitle.run);
    await expect(componentSubtitle.run({ ...options, result })).rejects.toThrow();
    expect(vol.toJSON()).toEqual(before);
  });

  it('ignores an uninspectable preview when no subtitle migration is needed', async () => {
    fs.writeFileSync(
      previewConfigPath,
      "import parameters from './parameters'; export default { parameters };"
    );
    fs.writeFileSync(storyPath, 'export default { parameters: { docs: {} } };');

    expect(await componentSubtitle.check(options)).toBeNull();
  });

  it('reports an unsafe preview legacy subtitle', async () => {
    fs.writeFileSync(
      previewConfigPath,
      "export default { parameters: { ...shared, componentSubtitle: 'Legacy' } };"
    );
    fs.writeFileSync(storyPath, 'export default { parameters: { docs: {} } };');

    expect(await componentSubtitle.check(options)).toEqual({
      filesToChange: [],
      errors: [expect.objectContaining({ file: previewConfigPath })],
    });
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
