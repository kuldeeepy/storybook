import picocolors from 'picocolors';

import type { CheckOptions, Fix } from '../types.ts';
import {
  ComponentSubtitleMigrationError,
  transformComponentSubtitleObject,
} from './component-subtitle-transform.ts';
import {
  commitAnnotationTransformPlans,
  createAnnotationTransformRunner,
  type PreparedAnnotationTransform,
} from '../helpers/annotation-transform.ts';
import { isAtOrPastVersion } from '../helpers/versionBoundary.ts';

export { transformPreviewSource, transformStorySource } from './component-subtitle-transform.ts';

interface ComponentSubtitleOptions {
  filesToChange: string[];
  errors: Array<{ file: string; message: string }>;
}

const createRunner = ({
  previewConfigPath,
  storiesPaths,
}: Pick<CheckOptions, 'previewConfigPath' | 'storiesPaths'>) => {
  let previewHasLegacySubtitle = false;
  const runner = createAnnotationTransformRunner({
    previewConfigPath,
    storiesPaths,
    initialInheritance: { subtitleCanWin: false },
    shouldTransform: (source, kind, inherited) => {
      if (kind === 'preview') {
        previewHasLegacySubtitle = source.includes('componentSubtitle');
        return true;
      }
      return source.includes('componentSubtitle') || inherited.legacyCanBeInherited === true;
    },
    transform: transformComponentSubtitleObject,
  });
  return { ...runner, previewHasLegacySubtitle: () => previewHasLegacySubtitle };
};

const migrationError = (errors: ComponentSubtitleOptions['errors']) =>
  new ComponentSubtitleMigrationError(
    `Could not migrate parameters.componentSubtitle automatically:\n${errors
      .map(({ file, message }) => `- ${file}: ${message}`)
      .join('\n')}\nMove each value to parameters.docs.subtitle manually.`
  );

export const componentSubtitle: Fix<ComponentSubtitleOptions> = {
  id: 'component-subtitle',
  link: 'https://github.com/storybookjs/storybook/blob/next/MIGRATION.md#parameterscomponentsubtitle-removed',

  async check(options) {
    if (
      options.isUpgrade &&
      (!options.beforeVersion || isAtOrPastVersion(options.beforeVersion, '11.0.0'))
    ) {
      return null;
    }
    const runner = createRunner(options);
    const result = await runner.check();
    return result?.filesToChange.length ||
      result?.errors.some(({ file }) => file !== options.previewConfigPath) ||
      runner.previewHasLegacySubtitle()
      ? result
      : null;
  },

  prompt() {
    return `Move deprecated ${picocolors.cyan('parameters.componentSubtitle')} values to ${picocolors.cyan('parameters.docs.subtitle')}`;
  },

  async run(options) {
    const freshResult = await createRunner(options).run(options.dryRun);
    if (freshResult.errors.length > 0) {
      throw migrationError(freshResult.errors);
    }
  },

  async runAcrossProjects(options) {
    const plans: PreparedAnnotationTransform[] = [];
    try {
      for (const project of options) {
        plans.push(await createRunner(project).prepare());
      }
      const errors = plans.flatMap(({ result }) => result.errors);
      if (errors.length > 0) {
        throw migrationError(errors);
      }
      await commitAnnotationTransformPlans(plans, options[0]?.dryRun);
    } finally {
      await Promise.all(plans.map(({ cleanUp }) => cleanUp()));
    }
  },
};
