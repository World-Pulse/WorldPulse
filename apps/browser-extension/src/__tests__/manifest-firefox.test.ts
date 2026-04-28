/**
 * Firefox manifest validation tests.
 * Ensures manifest.firefox.json meets Firefox MV3 requirements for AMO submission.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load both manifests for cross-validation
const chromePath = resolve(__dirname, '../../manifest.json');
const firefoxPath = resolve(__dirname, '../../manifest.firefox.json');

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const chromeManifest = JSON.parse(readFileSync(chromePath, 'utf-8'));
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const firefoxManifest = JSON.parse(readFileSync(firefoxPath, 'utf-8'));

describe('Firefox manifest (manifest.firefox.json)', () => {
  it('uses manifest_version 3', () => {
    expect(firefoxManifest.manifest_version).toBe(3);
  });

  it('has browser_specific_settings.gecko with an addon id', () => {
    expect(firefoxManifest.browser_specific_settings?.gecko?.id).toMatch(
      /@worldpulse/,
    );
  });

  it('specifies strict_min_version >= 109.0 for MV3 support', () => {
    const minVersion: string = firefoxManifest.browser_specific_settings?.gecko?.strict_min_version ?? '0';
    const major = parseInt(minVersion.split('.')[0] ?? '0', 10);
    expect(major).toBeGreaterThanOrEqual(109);
  });

  it('uses background.scripts array (not service_worker) — Firefox MV3 event page', () => {
    expect(firefoxManifest.background?.scripts).toBeInstanceOf(Array);
    expect(firefoxManifest.background?.scripts).toContain('background.js');
    // Must NOT have service_worker key
    expect(firefoxManifest.background?.service_worker).toBeUndefined();
  });

  it('includes storage and tabs permissions', () => {
    expect(firefoxManifest.permissions).toContain('storage');
    expect(firefoxManifest.permissions).toContain('tabs');
  });

  it('has host_permissions for https and http', () => {
    expect(firefoxManifest.host_permissions).toContain('https://*/*');
    expect(firefoxManifest.host_permissions).toContain('http://*/*');
  });

  it('has action.default_popup set to popup.html', () => {
    expect(firefoxManifest.action?.default_popup).toBe('popup.html');
  });

  it('includes content_scripts with correct matches', () => {
    const cs = firefoxManifest.content_scripts?.[0];
    expect(cs).toBeDefined();
    expect(cs.matches).toContain('https://*/*');
    expect(cs.js).toContain('content.js');
    expect(cs.css).toContain('content.css');
  });
});

describe('Firefox vs Chrome manifest parity', () => {
  it('both have the same extension name', () => {
    expect(firefoxManifest.name).toBe(chromeManifest.name);
  });

  it('both have the same version', () => {
    expect(firefoxManifest.version).toBe(chromeManifest.version);
  });

  it('both have the same content_scripts entry point', () => {
    const chromeCs = chromeManifest.content_scripts?.[0];
    const ffCs = firefoxManifest.content_scripts?.[0];
    expect(ffCs.js).toEqual(chromeCs.js);
    expect(ffCs.css).toEqual(chromeCs.css);
    expect(ffCs.run_at).toEqual(chromeCs.run_at);
  });

  it('both have the same default_popup', () => {
    expect(firefoxManifest.action?.default_popup).toBe(
      chromeManifest.action?.default_popup,
    );
  });

  it('Firefox does NOT have service_worker (Chrome-only API)', () => {
    expect(firefoxManifest.background?.service_worker).toBeUndefined();
  });

  it('Chrome does NOT have browser_specific_settings (Firefox-only field)', () => {
    expect(chromeManifest.browser_specific_settings).toBeUndefined();
  });

  it('Chrome does NOT have background.scripts (uses service_worker)', () => {
    expect(chromeManifest.background?.scripts).toBeUndefined();
    expect(chromeManifest.background?.service_worker).toBe('background.js');
  });
});
