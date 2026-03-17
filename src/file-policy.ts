import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { appConfig } from "./config.js";

let rootsCache: string[] | null = null;

async function allowedRoots(): Promise<string[]> {
  if (rootsCache) return rootsCache;
  rootsCache = await Promise.all(appConfig.allowedRoots.map((root) => realpath(root)));
  return rootsCache;
}

export async function resolveSafePath(inputPath: string): Promise<string> {
  const candidate = path.resolve(inputPath);
  const finalPath = await realpath(candidate).catch(() => candidate);
  const roots = await allowedRoots();
  if (!roots.some((root) => finalPath === root || finalPath.startsWith(`${root}${path.sep}`))) {
    throw new Error("path_not_allowed");
  }
  return finalPath;
}

export async function ensureSafeDirectory(inputPath: string): Promise<string> {
  const safe = await resolveSafePath(inputPath);
  const s = await stat(safe);
  if (!s.isDirectory()) throw new Error("not_a_directory");
  return safe;
}
