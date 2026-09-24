import { readFile, writeFile } from 'node:fs/promises';

import type { AnnotationFileKind, CsfObject, CsfObjectTarget } from 'storybook/internal/csf-tools';
import { loadAnnotationFile } from 'storybook/internal/csf-tools';

export type AnnotationTransformContext<Inheritance> = {
  kind: AnnotationFileKind;
  target: CsfObjectTarget;
  inherited: Inheritance;
};

export type AnnotationObjectTransform<Inheritance> = (
  object: CsfObject,
  context: AnnotationTransformContext<Inheritance>
) => Inheritance;

type AnnotationTransformOptions<Inheritance> = {
  previewConfigPath?: string;
  storiesPaths: string[];
  initialInheritance: Inheritance;
  shouldTransform?: (source: string, kind: AnnotationFileKind, inherited: Inheritance) => boolean;
  transform: AnnotationObjectTransform<Inheritance>;
};

type AnnotationTransformResult = {
  filesToChange: string[];
  errors: Array<{ file: string; message: string }>;
};

type PlannedAnnotationWrite = { file: string; code: string };

const messageFor = (error: Error | string) => (typeof error === 'string' ? error : error.message);

const pathsFor = (previewConfigPath: string | undefined, storiesPaths: string[]) => [
  ...new Set(previewConfigPath ? [previewConfigPath, ...storiesPaths] : storiesPaths),
];

export const transformAnnotationSource = <Inheritance>(
  source: string,
  kind: AnnotationFileKind,
  initialInheritance: Inheritance,
  transform: AnnotationObjectTransform<Inheritance>
) => {
  const file = loadAnnotationFile(source, kind);
  let inheritance = initialInheritance;
  const objects = file.objects;
  const root = objects.find(
    (object) => object.target.kind === 'meta' || object.target.kind === 'config'
  );
  for (const object of root
    ? [root, ...objects.filter((candidate) => candidate !== root)]
    : objects) {
    inheritance = transform(object, { kind, target: object.target, inherited: inheritance });
  }
  const [diagnostic] = file.mutationDiagnostics;
  if (diagnostic) {
    throw new Error(diagnostic.message);
  }
  return { code: file.changed ? file.print() : null, inheritance };
};

/** Apply one object transform consistently to a preview config and its story files. */
export const createAnnotationTransformRunner = <Inheritance>(
  options: AnnotationTransformOptions<Inheritance>
) => {
  const paths = pathsFor(options.previewConfigPath, options.storiesPaths);

  const plan = async (): Promise<{
    result: AnnotationTransformResult;
    writes: PlannedAnnotationWrite[];
  }> => {
    const writes: PlannedAnnotationWrite[] = [];
    const errors: AnnotationTransformResult['errors'] = [];
    let previewInheritance = options.initialInheritance;

    for (const file of paths) {
      try {
        const kind: AnnotationFileKind = file === options.previewConfigPath ? 'preview' : 'stories';
        const source = await readFile(file, 'utf-8');
        if (!options.shouldTransform?.(source, kind, previewInheritance)) {
          continue;
        }
        const transformed = transformAnnotationSource(
          source,
          kind,
          previewInheritance,
          options.transform
        );
        if (kind === 'preview') {
          previewInheritance = transformed.inheritance;
        }
        if (transformed.code) {
          writes.push({ file, code: transformed.code });
        }
      } catch (error) {
        errors.push({ file, message: messageFor(error instanceof Error ? error : String(error)) });
      }
    }
    return { result: { filesToChange: writes.map(({ file }) => file), errors }, writes };
  };

  return {
    async check() {
      const { result } = await plan();
      return result.filesToChange.length > 0 || result.errors.length > 0 ? result : null;
    },
    async run(dryRun = false) {
      const { result, writes } = await plan();
      if (result.errors.length > 0) {
        return result;
      }
      if (!dryRun) {
        for (const { file, code } of writes) {
          await writeFile(file, code);
        }
      }
      return result;
    },
  };
};
