import { readFile, writeFile } from 'node:fs/promises';

import picocolors from 'picocolors';

import type { CheckOptions, Fix } from '../types.ts';
import {
  ComponentSubtitleMigrationError,
  previewSubtitleInheritance,
  transformAnnotationSource,
} from './component-subtitle-transform.ts';

export { transformPreviewSource, transformStorySource } from './component-subtitle-transform.ts';

interface ComponentSubtitleOptions {
  filesToChange: string[];
  errors: Array<{ file: string; message: string }>;
}

const checkFiles = async ({
  previewConfigPath,
  storiesPaths,
}: Pick<CheckOptions, 'previewConfigPath' | 'storiesPaths'>) => {
  const filesToChange: string[] = [];
  const errors: Array<{ file: string; message: string }> = [];
  let applicable = false;
  const files = previewConfigPath ? [previewConfigPath, ...storiesPaths] : storiesPaths;
  let inheritance = { subtitleCanWin: false };

  for (const file of files) {
    try {
      const source = await readFile(file, 'utf-8');
      if (file === previewConfigPath) {
        inheritance = previewSubtitleInheritance(source);
      }
      const transformed = transformAnnotationSource(
        source,
        file === previewConfigPath ? 'preview' : 'stories',
        inheritance
      );
      if (transformed) {
        applicable = true;
        filesToChange.push(file);
      }
    } catch (error) {
      applicable ||= error instanceof ComponentSubtitleMigrationError;
      errors.push({ file, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return applicable ? { filesToChange, errors } : null;
};

export const componentSubtitle: Fix<ComponentSubtitleOptions> = {
  id: 'component-subtitle',
  link: 'https://github.com/storybookjs/storybook/blob/next/MIGRATION.md#parameterscomponentsubtitle-removed',

  check: checkFiles,

  prompt() {
    return `Move deprecated ${picocolors.cyan('parameters.componentSubtitle')} values to ${picocolors.cyan('parameters.docs.subtitle')}`;
  },

  async run(options) {
    const { dryRun, previewConfigPath } = options;
    const result =
      options.result.errors.length > 0 || dryRun ? options.result : await checkFiles(options);
    if (!result) {
      return;
    }
    const { filesToChange, errors } = result;
    if (errors.length > 0) {
      throw new ComponentSubtitleMigrationError(
        `Could not migrate parameters.componentSubtitle automatically:\n${errors
          .map(({ file, message }) => `- ${file}: ${message}`)
          .join('\n')}\nMove each value to parameters.docs.subtitle manually.`
      );
    }

    if (dryRun) {
      return;
    }

    const inheritance = previewConfigPath
      ? previewSubtitleInheritance(await readFile(previewConfigPath, 'utf-8'))
      : { subtitleCanWin: false };
    for (const file of filesToChange) {
      const source = await readFile(file, 'utf-8');
      const transformed = transformAnnotationSource(
        source,
        file === previewConfigPath ? 'preview' : 'stories',
        inheritance
      );
      if (transformed) {
        await writeFile(file, transformed);
      }
    }
  },
};
