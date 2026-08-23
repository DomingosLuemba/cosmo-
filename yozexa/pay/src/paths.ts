import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locate the migrations directory.
 *
 * Compiled output lives at `dist/src/` and `dist/test/`, while `migrations/`
 * stays at the package root, so a fixed relative path would be correct for one
 * and wrong for the other. Walking up until the directory is found is right for
 * both, and for running the TypeScript directly.
 */
export function migrationsDir(fromUrl: string = import.meta.url): string {
  let dir = dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "migrations");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("could not locate the migrations directory");
}
