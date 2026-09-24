import { ErrorCollector, sanitizeError } from 'storybook/internal/telemetry';

import type { AutomigrationCheckResult } from '../multi-project.ts';
import type { FixId } from '../types.ts';

export const runFixesAcrossProjects = async (
  selectedAutomigrations: AutomigrationCheckResult[],
  options: { dryRun?: boolean; yes?: boolean; skipInstall?: boolean }
) => {
  const failures = new Map<FixId, string>();
  const completed = new Set<FixId>();
  for (const selected of selectedAutomigrations) {
    if (!selected.fix.runAcrossProjects) {
      continue;
    }
    const runOptions = selected.reports
      .filter(({ status }) => status === 'check_succeeded')
      .map(({ project, result }) => ({
        packageManager: project.packageManager,
        result,
        dryRun: options.dryRun,
        mainConfigPath: project.mainConfigPath,
        previewConfigPath: project.previewConfigPath,
        mainConfig: project.mainConfig,
        configDir: project.configDir,
        skipInstall: options.skipInstall,
        storybookVersion: project.storybookVersion,
        storiesPaths: project.storiesPaths,
        yes: options.yes,
      }));
    try {
      await selected.fix.runAcrossProjects(runOptions);
      completed.add(selected.fix.id);
    } catch (error) {
      failures.set(selected.fix.id, sanitizeError(error as Error));
      ErrorCollector.addError(error);
    }
  }
  return { completed, failures };
};
