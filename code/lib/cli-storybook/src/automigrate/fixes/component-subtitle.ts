import picocolors from 'picocolors';

import type { CheckOptions, Fix } from '../types.ts';
import {
  ComponentSubtitleMigrationError,
  transformComponentSubtitleObject,
} from './component-subtitle-transform.ts';
import { createAnnotationTransformRunner } from '../helpers/annotation-transform.ts';

export { transformPreviewSource, transformStorySource } from './component-subtitle-transform.ts';

interface ComponentSubtitleOptions {
  filesToChange: string[];
  errors: Array<{ file: string; message: string }>;
}

const checkFiles = async ({
  previewConfigPath,
  storiesPaths,
}: Pick<CheckOptions, 'previewConfigPath' | 'storiesPaths'>) => {
  return createAnnotationTransformRunner({
    previewConfigPath,
    storiesPaths,
    initialInheritance: { subtitleCanWin: false },
    shouldTransform: (source, kind, inherited) =>
      source.includes('componentSubtitle') ||
      (kind === 'preview' && source.includes('subtitle')) ||
      inherited.legacyCanBeInherited === true,
    transform: transformComponentSubtitleObject,
  }).check();
};

export const componentSubtitle: Fix<ComponentSubtitleOptions> = {
  id: 'component-subtitle',
  link: 'https://github.com/storybookjs/storybook/blob/next/MIGRATION.md#parameterscomponentsubtitle-removed',

  check: checkFiles,

  prompt() {
    return `Move deprecated ${picocolors.cyan('parameters.componentSubtitle')} values to ${picocolors.cyan('parameters.docs.subtitle')}`;
  },

  async run(options) {
    const freshResult = await createAnnotationTransformRunner({
      previewConfigPath: options.previewConfigPath,
      storiesPaths: options.storiesPaths,
      initialInheritance: { subtitleCanWin: false },
      shouldTransform: (source, kind, inherited) =>
        source.includes('componentSubtitle') ||
        (kind === 'preview' && source.includes('subtitle')) ||
        inherited.legacyCanBeInherited === true,
      transform: transformComponentSubtitleObject,
    }).run(options.dryRun);
    if (freshResult.errors.length > 0) {
      throw new ComponentSubtitleMigrationError(
        `Could not migrate parameters.componentSubtitle automatically:\n${freshResult.errors
          .map(({ file, message }) => `- ${file}: ${message}`)
          .join('\n')}\nMove each value to parameters.docs.subtitle manually.`
      );
    }
  },
};
