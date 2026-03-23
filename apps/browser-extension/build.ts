import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

void (async () => {
  const isDev = process.argv.includes('--dev');
  const dist = 'dist';
  mkdirSync(`${dist}/icons`, { recursive: true });

  const sharedConfig: esbuild.BuildOptions = {
    bundle: true,
    minify: !isDev,
    sourcemap: isDev ? 'inline' : false,
    target: ['chrome120', 'firefox120'],
    platform: 'browser',
  };

  await Promise.all([
    esbuild.build({
      ...sharedConfig,
      entryPoints: ['src/background.ts'],
      outfile: `${dist}/background.js`,
      format: 'esm',
    }),
    esbuild.build({
      ...sharedConfig,
      entryPoints: ['src/content.ts'],
      outfile: `${dist}/content.js`,
      format: 'iife',
    }),
    esbuild.build({
      ...sharedConfig,
      entryPoints: ['src/popup.ts'],
      outfile: `${dist}/popup.js`,
      format: 'iife',
    }),
  ]);

  copyFileSync('manifest.json', `${dist}/manifest.json`);
  copyFileSync('popup.html', `${dist}/popup.html`);
  copyFileSync('src/content.css', `${dist}/content.css`);

  for (const size of [16, 48, 128]) {
    const src = `public/icons/icon${size}.svg`;
    if (existsSync(src)) {
      copyFileSync(src, `${dist}/icons/icon${size}.svg`);
    }
  }

  console.log(`Build complete (${isDev ? 'dev' : 'production'}): ./${dist}/`);
})();
