import { HandledError } from 'storybook/internal/common';
import type { ConfigFile, CsfFile, CsfObject } from 'storybook/internal/csf-tools';
import {
  formatConfig,
  loadConfig,
  loadCsf,
  printCsf,
  resolveBindingMembers,
  sourceOf,
} from 'storybook/internal/csf-tools';

const legacyPath = ['parameters', 'componentSubtitle'];
const subtitlePath = ['parameters', 'docs', 'subtitle'];

export class ComponentSubtitleMigrationError extends HandledError {}

type Inheritance = { subtitleCanWin: boolean };
const noInheritance: Inheritance = { subtitleCanWin: false };

const checkDiagnostics = (file: ConfigFile | CsfFile) => {
  const [diagnostic] = file.mutationDiagnostics;
  if (diagnostic) {
    throw new ComponentSubtitleMigrationError(diagnostic.message);
  }
};

const migrate = (object: CsfObject, inherited: Inheritance) => {
  const legacy = object.get(legacyPath);
  const subtitle = object.get(subtitlePath);
  if (!legacy) {
    return;
  }

  if (subtitle) {
    object.getValue(legacyPath);
    object.remove(legacyPath);
  } else {
    if (inherited.subtitleCanWin) {
      throw new ComponentSubtitleMigrationError(
        'An inherited parameters.docs.subtitle value can take precedence'
      );
    }
    object.group(['parameters', 'docs'], ['componentSubtitle']);
    object.rename(['parameters', 'docs', 'componentSubtitle'], 'subtitle');
  }
};

export const previewSubtitleInheritance = (source: string): Inheritance => {
  const preview = loadConfig(source).parse();
  const subtitle = preview.get(subtitlePath);
  return {
    subtitleCanWin: Boolean(subtitle) || preview.mutationDiagnostics.length > 0,
  };
};

export const transformPreviewSource = (source: string) => {
  if (!source.includes('componentSubtitle')) {
    return null;
  }
  const config = loadConfig(source).parse();
  migrate(config, noInheritance);
  checkDiagnostics(config);
  return config.changed ? formatConfig(config) : null;
};

export const transformStorySource = (source: string, inherited: Inheritance = noInheritance) => {
  if (!source.includes('componentSubtitle')) {
    return null;
  }
  const csf = loadCsf(source, { makeTitle: (title) => title || 'default' }).parse();
  const objects = csf.objects();
  for (const object of objects) {
    if (object.target.kind !== 'story') {
      continue;
    }
    const resolved = resolveBindingMembers(
      { program: csf._file.path, filePath: '' },
      object.target.localName
    );
    const ownParameters = object.get(['parameters']);
    const effectiveParameters = resolved?.properties.parameters;
    if (
      effectiveParameters &&
      ownParameters &&
      sourceOf(effectiveParameters) !== sourceOf(ownParameters)
    ) {
      throw new ComponentSubtitleMigrationError(
        'Story inheritance changes parameters; migrate componentSubtitle and its inherited docs.subtitle together manually'
      );
    }
  }
  const meta = objects.find((object) => object.target.kind === 'meta');
  const metaSubtitle = meta?.get(subtitlePath);
  const storyInheritance = {
    subtitleCanWin: metaSubtitle ? Boolean(metaSubtitle) : inherited.subtitleCanWin,
  };
  if (meta) {
    migrate(meta, inherited);
  }
  for (const object of objects) {
    if (object !== meta) {
      migrate(object, storyInheritance);
    }
  }
  checkDiagnostics(csf);
  return csf.changed ? printCsf(csf).code : null;
};
