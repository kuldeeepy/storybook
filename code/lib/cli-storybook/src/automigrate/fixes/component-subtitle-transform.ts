import { HandledError } from 'storybook/internal/common';
import type { AnnotationFileKind, CsfObject } from 'storybook/internal/csf-tools';
import { loadAnnotationFile } from 'storybook/internal/csf-tools';

const legacyPath = ['parameters', 'componentSubtitle'];
const subtitlePath = ['parameters', 'docs', 'subtitle'];

export class ComponentSubtitleMigrationError extends HandledError {}

type Inheritance = { subtitleCanWin: boolean };
const noInheritance: Inheritance = { subtitleCanWin: false };

const checkDiagnostics = (file: ReturnType<typeof loadAnnotationFile>) => {
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
  const file = loadAnnotationFile(source, 'preview');
  const subtitle = file.objects[0]?.get(subtitlePath);
  return {
    subtitleCanWin: Boolean(subtitle) || file.mutationDiagnostics.length > 0,
  };
};

export const transformAnnotationSource = (
  source: string,
  kind: AnnotationFileKind,
  inherited: Inheritance = noInheritance
) => {
  if (!source.includes('componentSubtitle')) {
    return null;
  }
  const file = loadAnnotationFile(source, kind);
  const root = file.objects.find(
    (object) => object.target.kind === 'meta' || object.target.kind === 'config'
  );
  const rootSubtitle = root?.get(subtitlePath);
  const storyInheritance = {
    subtitleCanWin: Boolean(rootSubtitle) || inherited.subtitleCanWin,
  };
  if (root) {
    migrate(root, kind === 'preview' ? noInheritance : inherited);
  }
  for (const object of file.objects) {
    if (object !== root) {
      migrate(object, storyInheritance);
    }
  }
  checkDiagnostics(file);
  return file.changed ? file.print() : null;
};

export const transformPreviewSource = (source: string) =>
  transformAnnotationSource(source, 'preview');

export const transformStorySource = (source: string, inherited: Inheritance = noInheritance) =>
  transformAnnotationSource(source, 'stories', inherited);
