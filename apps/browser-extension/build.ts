import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync, writeFileSync } from 'fs';

type Target = 'chrome' | 'firefox' | 'all';

const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const targetArg = args.find((a) => a.startsWith('--target='))?.split('=')[1] as Target | undefined;
const target: Target = targetArg ?? 'all';

async function buildForBrowser(browser: 'chrome' | 'firefox'): Promise<void> {
  const outDir = `dist/${browser}`;
  mkdirSync(`${outDir}/icons`, { recursive: true });

  const sharedConfig: esbuild.BuildOptions = {
    bundle: true,
    minify: !isDev,
    sourcemap: isDev ? 'inline' : false,
    target: browser === 'chrome' ? ['chrome120'] : ['firefox120'],
    platform: 'browser',
  };

  // Firefox MV3 background scripts run as event pages (not service workers) —
  // they must be IIFE (not ESM) for compatibility back to Firefox 109.
  // Chrome MV3 service workers support ESM via "type": "module".
  const backgroundFormat: esbuild.Format = browser === 'firefox' ? 'iife' : 'esm';

  await Promise.all([
    esbuild.build({
      ...sharedConfig,
      entryPoints: ['src/background.ts'],
      outfile: `${outDir}/background.js`,
      format: backgroundFormat,
    }),
    esbuild.build({
      ...sharedConfig,
      entryPoints: ['src/content.ts'],
      outfile: `${outDir}/content.js`,
      format: 'iife',
    }),
    esbuild.build({
      ...sharedConfig,
      entryPoints: ['src/popup.ts'],
      outfile: `${outDir}/popup.js`,
      format: 'iife',
    }),
  ]);

  const manifestSrc = browser === 'firefox' ? 'manifest.firefox.json' : 'manifest.json';
  copyFileSync(manifestSrc, `${outDir}/manifest.json`);
  copyFileSync('popup.html', `${outDir}/popup.html`);
  copyFileSync('src/content.css', `${outDir}/content.css`);

  for (const size of [16, 48, 128]) {
    const src = `public/icons/icon${size}.svg`;
    if (existsSync(src)) {
      copyFileSync(src, `${outDir}/icons/icon${size}.svg`);
    }
  }

  console.log(`[${browser}] Build complete (${isDev ? 'dev' : 'production'}): ./${outDir}/`);
}

void (async () => {
  const browsers: Array<'chrome' | 'firefox'> =
    target === 'all' ? ['chrome', 'firefox'] : [target];

  await Promise.all(browsers.map((b) => buildForBrowser(b)));

  // Write a convenience build-info.json summarising what was built
  writeFileSync(
    'dist/build-info.json',
    JSON.stringify(
      {
        built: browsers,
        mode: isDev ? 'development' : 'production',
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(`\nAll builds complete. Targets: ${browsers.join(', ')}`);
})();
