import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { HandledError } from 'storybook/internal/common';
import type { AnnotationFileKind, CsfObject, CsfObjectTarget } from 'storybook/internal/csf-tools';
import { loadAnnotationFile } from 'storybook/internal/csf-tools';

type AnnotationTransformContext<Inheritance> = {
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

type PlannedAnnotationWrite = { file: string; stagedFile: string; digest: string };

class AnnotationTransformError extends HandledError {}

export type PreparedAnnotationTransform = {
  result: AnnotationTransformResult;
  writes: PlannedAnnotationWrite[];
  cleanUp: () => Promise<void>;
};

const messageFor = (error: Error | string) => (typeof error === 'string' ? error : error.message);

const pathsFor = (previewConfigPath: string | undefined, storiesPaths: string[]) =>
  previewConfigPath ? [previewConfigPath, ...storiesPaths] : storiesPaths;

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
    throw new AnnotationTransformError(diagnostic.message);
  }
  return { code: file.changed ? file.print() : null, inheritance };
};

export const commitAnnotationTransformPlans = async (
  plans: PreparedAnnotationTransform[],
  dryRun = false
) => {
  const writes = new Map<string, PlannedAnnotationWrite>();
  for (const plan of plans) {
    for (const write of plan.writes) {
      const existing = writes.get(write.file);
      if (existing && existing.digest !== write.digest) {
        throw new AnnotationTransformError(
          `Projects produced incompatible transforms for ${write.file}`
        );
      }
      writes.set(write.file, write);
    }
  }
  if (!dryRun) {
    for (const { file, stagedFile } of writes.values()) {
      await writeFile(file, await readFile(stagedFile, 'utf-8'));
    }
  }
};

export const createAnnotationTransformRunner = <Inheritance>(
  options: AnnotationTransformOptions<Inheritance>
) => {
  const paths = pathsFor(options.previewConfigPath, options.storiesPaths);

  const plan = async (
    stageOutput = false
  ): Promise<{
    result: AnnotationTransformResult;
    writes: PlannedAnnotationWrite[];
    cleanUp: () => Promise<void>;
  }> => {
    const writes: PlannedAnnotationWrite[] = [];
    const errors: AnnotationTransformResult['errors'] = [];
    let previewInheritance = options.initialInheritance;
    let stagingDirectory: string | undefined;

    const cleanUp = async () => {
      if (stagingDirectory) {
        await rm(stagingDirectory, { force: true, recursive: true });
      }
    };

    const seen = new Set<string>();
    for (const inputFile of paths) {
      try {
        const file = await realpath(inputFile);
        if (seen.has(file)) {
          continue;
        }
        seen.add(file);
        const kind: AnnotationFileKind =
          inputFile === options.previewConfigPath ? 'preview' : 'stories';
        const source = await readFile(file, 'utf-8');
        if (options.shouldTransform && !options.shouldTransform(source, kind, previewInheritance)) {
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
          if (stageOutput) {
            stagingDirectory ||= await mkdtemp(join(tmpdir(), 'storybook-automigrate-'));
            const stagedFile = join(stagingDirectory, String(writes.length));
            await writeFile(stagedFile, transformed.code);
            writes.push({
              file,
              stagedFile,
              digest: createHash('sha256').update(transformed.code).digest('hex'),
            });
          } else {
            writes.push({ file, stagedFile: '', digest: '' });
          }
        }
      } catch (error) {
        errors.push({
          file: inputFile,
          message: messageFor(error instanceof Error ? error : String(error)),
        });
      }
    }
    if (errors.length > 0) {
      await cleanUp();
    }
    return { result: { filesToChange: writes.map(({ file }) => file), errors }, writes, cleanUp };
  };

  return {
    async check() {
      const { result } = await plan();
      return result.filesToChange.length > 0 || result.errors.length > 0 ? result : null;
    },
    async prepare(): Promise<PreparedAnnotationTransform> {
      return plan(true);
    },
    async run(dryRun = false) {
      const prepared = await plan(true);
      try {
        if (prepared.result.errors.length > 0) {
          return prepared.result;
        }
        await commitAnnotationTransformPlans([prepared], dryRun);
        return prepared.result;
      } finally {
        await prepared.cleanUp();
      }
    },
  };
};
