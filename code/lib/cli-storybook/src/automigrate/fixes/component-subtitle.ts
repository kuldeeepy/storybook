import picocolors from 'picocolors';

import type { CheckOptions, Fix } from '../types.ts';
import {
  ComponentSubtitleMigrationError,
  transformComponentSubtitleObject,
} from './component-subtitle-transform.ts';
import { createAnnotationTransformRunner } from '../helpers/annotation-transform.ts';
import { crossesVersionBoundary } from '../helpers/versionBoundary.ts';

export { transformPreviewSource, transformStorySource } from './component-subtitle-transform.ts';

interface ComponentSubtitleOptions {
  filesToChange: string[];
  errors: Array<{ file: string; message: string }>;
}

const createRunner = ({
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
  });
};

export const componentSubtitle: Fix<ComponentSubtitleOptions> = {
  id: 'component-subtitle',
  link: 'https://github.com/storybookjs/storybook/blob/next/MIGRATION.md#parameterscomponentsubtitle-removed',

  async check(options) {
    if (
      options.isUpgrade &&
      (!options.beforeVersion ||
        !crossesVersionBoundary(options.beforeVersion, options.storybookVersion, '11.0.0'))
    ) {
      return null;
    }
    return createRunner(options).check();
  },

  prompt() {
    return `Move deprecated ${picocolors.cyan('parameters.componentSubtitle')} values to ${picocolors.cyan('parameters.docs.subtitle')}`;
  },

  async run(options) {
    const freshResult = await createRunner(options).run(options.dryRun);
    if (freshResult.errors.length > 0) {
      throw new ComponentSubtitleMigrationError(
        `Could not migrate parameters.componentSubtitle automatically:\n${freshResult.errors
          .map(({ file, message }) => `- ${file}: ${message}`)
          .join('\n')}\nMove each value to parameters.docs.subtitle manually.`
      );
    }
  },
};
