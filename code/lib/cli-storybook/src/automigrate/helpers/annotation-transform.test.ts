import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CsfObject } from 'storybook/internal/csf-tools';

import { fs, vol } from 'memfs';

import { createAnnotationTransformRunner } from './annotation-transform.ts';

vi.mock('node:fs/promises', { spy: true });

const previewPath = resolve('.storybook/preview.ts');
const primaryStoryPath = resolve('Primary.stories.ts');
const secondaryStoryPath = resolve('Secondary.stories.ts');
const stagingPath = resolve('.annotation-transform-staging');

const createRunner = (
  transform = (object: CsfObject) => object.rename(['parameters', 'old'], 'new')
) =>
  createAnnotationTransformRunner({
    previewConfigPath: previewPath,
    storiesPaths: [primaryStoryPath, primaryStoryPath, secondaryStoryPath],
    initialInheritance: false,
    shouldTransform: (source) => source.includes('old'),
    transform: (object, context) => {
      transform(object);
      return context.inherited || context.target.kind === 'config';
    },
  });

describe('annotation transform runner', () => {
  beforeEach(() => {
    vol.reset();
    vi.mocked(readFile).mockImplementation(async (file) =>
      (await fs.promises.readFile(file.toString(), 'utf8')).toString()
    );
    vi.mocked(writeFile).mockImplementation(async (file, data) => {
      await fs.promises.mkdir(dirname(file.toString()), { recursive: true });
      await fs.promises.writeFile(file.toString(), data.toString());
    });
    vi.mocked(rm).mockImplementation(async (path, options) => {
      await fs.promises.rm(path.toString(), options);
    });
    vi.mocked(mkdtemp).mockResolvedValue(stagingPath);
    vol.fromJSON({
      [previewPath]: "export default { parameters: { old: 'preview' } };",
      [primaryStoryPath]: "export default { parameters: { old: 'primary' } };",
      [secondaryStoryPath]: "export default { parameters: { old: 'secondary' } };",
    });
  });

  afterEach(() => {
    vi.mocked(readFile).mockRestore();
    vi.mocked(mkdtemp).mockRestore();
    vi.mocked(rm).mockRestore();
    vi.mocked(writeFile).mockRestore();
  });

  it('plans and transforms preview and deduplicated story files in inheritance order', async () => {
    const inherited: boolean[] = [];
    const runner = createAnnotationTransformRunner({
      previewConfigPath: previewPath,
      storiesPaths: [primaryStoryPath, primaryStoryPath],
      initialInheritance: false,
      shouldTransform: (source) => source.includes('old'),
      transform: (object, context) => {
        inherited.push(context.inherited);
        object.rename(['parameters', 'old'], 'new');
        return context.target.kind === 'config';
      },
    });

    expect(await runner.check()).toEqual({
      filesToChange: [previewPath, primaryStoryPath],
      errors: [],
    });
    expect(inherited).toEqual([false, true]);
    await runner.run();
    expect(fs.readFileSync(previewPath, 'utf8')).toContain('new');
    expect(fs.readFileSync(primaryStoryPath, 'utf8')).toContain('new');
  });

  it('supports absent previews, no-op files, and dry runs', async () => {
    const runner = createAnnotationTransformRunner({
      storiesPaths: [primaryStoryPath],
      initialInheritance: false,
      shouldTransform: (source) => source.includes('old'),
      transform: (object) => {
        object.rename(['parameters', 'old'], 'new');
        return false;
      },
    });
    const before = vol.toJSON();

    expect(await runner.check()).toEqual({ filesToChange: [primaryStoryPath], errors: [] });
    await runner.run(true);
    expect(vol.toJSON()).toEqual(before);
    fs.writeFileSync(primaryStoryPath, "export default { parameters: { current: 'value' } };");
    expect(await runner.check()).toBeNull();
  });

  it('transforms files when no predicate is supplied', async () => {
    const runner = createAnnotationTransformRunner({
      storiesPaths: [primaryStoryPath],
      initialInheritance: false,
      transform: (object) => {
        object.rename(['parameters', 'old'], 'new');
        return false;
      },
    });

    expect(await runner.check()).toEqual({ filesToChange: [primaryStoryPath], errors: [] });
  });

  it('aggregates file failures and does not write a partial plan', async () => {
    const runner = createAnnotationTransformRunner({
      previewConfigPath: previewPath,
      storiesPaths: [primaryStoryPath, secondaryStoryPath],
      initialInheritance: false,
      shouldTransform: (source) => source.includes('old'),
      transform: (object, { kind }) => {
        if (kind === 'stories') {
          throw new Error('unsafe story');
        }
        object.rename(['parameters', 'old'], 'new');
        return false;
      },
    });
    const before = vol.toJSON();

    expect(await runner.run()).toEqual({
      filesToChange: [previewPath],
      errors: [
        { file: primaryStoryPath, message: 'unsafe story' },
        { file: secondaryStoryPath, message: 'unsafe story' },
      ],
    });
    expect(vol.toJSON()).toEqual(before);
  });

  it('replans from current files when run follows check', async () => {
    const runner = createRunner();

    await runner.check();
    fs.writeFileSync(primaryStoryPath, "export default { parameters: { old: 'updated' } };");
    await runner.run();
    expect(fs.readFileSync(primaryStoryPath, 'utf8')).toMatch(/new.*updated/);
  });
});
