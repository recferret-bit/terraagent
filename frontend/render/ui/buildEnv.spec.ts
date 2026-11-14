// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isProductionBuild, setProductionBuildOverride } from './buildEnv';
import { disposePixelDialog, initPixelDialog, togglePixelDialog } from './pixelDialog';

describe('buildEnv & playground production opt-in', () => {
  afterEach(() => {
    setProductionBuildOverride(null);
    disposePixelDialog();
    document.body.replaceChildren();
  });

  it('treats unknown non-local VITE_APP_ENV values and custom PROD build modes as production (fail-closed)', () => {
    expect(isProductionBuild('development', false, 'production')).toBe(true);
    expect(isProductionBuild('development', false, 'prod')).toBe(true);
    expect(isProductionBuild('development', false, 'staging')).toBe(true);
    expect(isProductionBuild('development', false, 'preview')).toBe(true);
    expect(isProductionBuild('staging', true, '')).toBe(true);
    expect(isProductionBuild('production', true, undefined)).toBe(true);

    expect(isProductionBuild('production', true, 'development')).toBe(false);
    expect(isProductionBuild('production', true, 'dev')).toBe(false);
    expect(isProductionBuild('production', true, 'local')).toBe(false);
    expect(isProductionBuild('production', true, 'test')).toBe(false);
    expect(isProductionBuild('development', false, '')).toBe(false);
  });

  it('disables pixelDialog by default in production builds while allowing explicit opt-in for /playground.html', () => {
    setProductionBuildOverride(true);
    initPixelDialog();
    togglePixelDialog(true);
    expect(document.getElementById('pixel-dlg')).toBeNull();

    initPixelDialog({ production: false });
    togglePixelDialog(true);
    expect(document.getElementById('pixel-dlg')).not.toBeNull();
    expect(document.getElementById('pixel-dlg')?.classList.contains('open')).toBe(true);
  });
});
