import { HandledError } from 'storybook/internal/common';
import type { AnnotationFileKind, CsfObject } from 'storybook/internal/csf-tools';

import {
  transformAnnotationSource as transformSource,
  type AnnotationObjectTransform,
} from '../helpers/annotation-transform.ts';

const legacyPath = ['parameters', 'componentSubtitle'];
const subtitlePath = ['parameters', 'docs', 'subtitle'];

export class ComponentSubtitleMigrationError extends HandledError {}

type Inheritance = { subtitleCanWin: boolean; legacyCanBeInherited?: boolean };
const noInheritance: Inheritance = { subtitleCanWin: false };

const migrate = (object: CsfObject, inherited: Inheritance) => {
  const legacy = object.get(legacyPath);
  const subtitle = object.get(subtitlePath);
  if (!legacy) {
    if (inherited.legacyCanBeInherited && subtitle && !object.getValue(subtitlePath)) {
      throw new ComponentSubtitleMigrationError(
        'A descendant parameters.docs.subtitle can hide an inherited componentSubtitle fallback'
      );
    }
    return;
  }

  if (subtitle) {
    const subtitleValue = object.getValue(subtitlePath);
    object.getValue(legacyPath);
    if (!subtitleValue) {
      object.set(subtitlePath, legacy);
    }
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

export const transformComponentSubtitleObject: AnnotationObjectTransform<Inheritance> = (
  object,
  { kind, target, inherited }
) => {
  const root = target.kind === 'meta' || target.kind === 'config';
  const objectInheritance = root
    ? {
        subtitleCanWin: Boolean(object.get(subtitlePath)) || inherited.subtitleCanWin,
        legacyCanBeInherited: Boolean(object.get(legacyPath)) || inherited.legacyCanBeInherited,
      }
    : inherited;
  migrate(object, root && kind === 'preview' ? noInheritance : inherited);
  return objectInheritance;
};

const transformAnnotationSource = (
  source: string,
  kind: AnnotationFileKind,
  inherited: Inheritance = noInheritance
) => {
  if (!source.includes('componentSubtitle') && !inherited.legacyCanBeInherited) {
    return null;
  }
  try {
    return transformSource(source, kind, inherited, transformComponentSubtitleObject).code;
  } catch (error) {
    throw new ComponentSubtitleMigrationError(
      error instanceof Error ? error.message : String(error)
    );
  }
};

export const transformPreviewSource = (source: string) =>
  transformAnnotationSource(source, 'preview');

export const transformStorySource = (source: string, inherited: Inheritance = noInheritance) =>
  transformAnnotationSource(source, 'stories', inherited);
