import { createWriteStream, rmSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { extractAssets } from 'markmap-common';
import { Transformer } from 'markmap-lib';
import { baseJsPaths } from 'markmap-render';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { ASSETS_PREFIX, localProvider, toolbarAssets } from './util';

const providerName = 'local-hook';

async function fetchAssets(assetsDir: string) {
  const transformer = new Transformer();
  transformer.urlBuilder.providers[providerName] = localProvider;
  transformer.urlBuilder.provider = providerName;
  const assets = transformer.getAssets();
  delete transformer.urlBuilder.providers[providerName];
  const pluginPaths = extractAssets(assets)
    .filter((url) => url.startsWith(ASSETS_PREFIX))
    .map((url) => url.slice(ASSETS_PREFIX.length));
  const resources = transformer.plugins.flatMap(
    (plugin) => plugin.config?.resources || [],
  );
  const paths = [
    ...baseJsPaths,
    ...pluginPaths,
    ...resources,
    ...extractAssets(toolbarAssets),
  ];
  const missing = paths.filter((path) => !isFile(resolve(assetsDir, path)));
  if (!missing.length) {
    console.log('[postbuild] all assets present, skip downloading');
    return;
  }
  const providers = Object.keys(transformer.urlBuilder.providers);
  let failed = 0;
  await Promise.all(
    missing.map(async (path) => {
      for (const provider of providers) {
        const ok = await downloadAsset(
          resolve(assetsDir, path),
          transformer.urlBuilder.getFullUrl(path, provider),
        );
        if (ok) return;
      }
      failed += 1;
    }),
  );
  if (failed) {
    console.warn(
      `[postbuild] ${failed} asset(s) failed to download, the preview may miss some features`,
    );
  }
}

function isFile(fullPath: string) {
  try {
    return Boolean(statSync(fullPath).isFile());
  } catch {
    return false;
  }
}

async function downloadAsset(fullPath: string, url: string) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok || !res.body) return false;
    await mkdir(dirname(fullPath), { recursive: true });
    await pipeline(res.body, createWriteStream(fullPath));
    const expected = Number(res.headers.get('content-length'));
    if (expected && statSync(fullPath).size !== expected) {
      rmSync(fullPath, { force: true });
      return false;
    }
    console.log(`${url} -> ${fullPath}`);
    return true;
  } catch {
    return false;
  }
}

fetchAssets(ASSETS_PREFIX).catch((err) => {
  console.error(err);
});
