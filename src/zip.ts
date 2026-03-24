import { posix as pathPosix } from 'node:path';
import yauzl from 'yauzl';

export interface ZipExtractResult {
  files: Map<string, Buffer>;
}

export async function extractZipFiles(
  archive: Buffer,
  wantedFiles: string[],
): Promise<ZipExtractResult> {
  const wanted = normalizeWanted(wantedFiles);

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(archive, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('Failed to open zip archive'));
        return;
      }

      const files = new Map<string, Buffer>();
      let pendingReads = 0;
      let ended = false;

      const finalize = () => {
        if (!ended || pendingReads > 0) {
          return;
        }
        resolve({ files });
      };

      const fail = (error: Error) => {
        try {
          zipfile.close();
        } catch {
          // ignore cleanup errors
        }
        reject(error);
      };

      zipfile.on('error', (error) => fail(error));
      zipfile.on('end', () => {
        ended = true;
        finalize();
      });

      zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) {
          zipfile.readEntry();
          return;
        }

        const normalized = normalizeZipPath(entry.fileName);
        if (!normalized) {
          fail(new Error(`Invalid zip entry path: ${entry.fileName}`));
          return;
        }

        if (!wanted.has(normalized)) {
          zipfile.readEntry();
          return;
        }

        pendingReads += 1;
        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            fail(streamErr ?? new Error(`Failed to read zip entry ${entry.fileName}`));
            return;
          }

          const chunks: Buffer[] = [];
          stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          stream.on('error', (error) => fail(error));
          stream.on('end', () => {
            files.set(normalized, Buffer.concat(chunks));
            pendingReads -= 1;
            zipfile.readEntry();
            finalize();
          });
        });
      });
    });
  });
}

function normalizeWanted(files: string[]): Set<string> {
  const set = new Set<string>();
  for (const file of files) {
    const normalized = normalizeZipPath(file);
    if (!normalized) {
      throw new Error(`Invalid file path in manifest: ${file}`);
    }
    set.add(normalized);
  }
  return set;
}

export function normalizeZipPath(value: string): string | null {
  const normalized = pathPosix.normalize(value).replace(/^\.\//, '');
  if (normalized.startsWith('/') || normalized.includes('..')) {
    return null;
  }
  return normalized;
}
