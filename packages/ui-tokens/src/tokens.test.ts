import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { colors, FONT_FAMILY, rounded, spacing, typography } from './tokens.js';

const require = createRequire(import.meta.url);
const preset = require('../tailwind-preset.cjs') as {
  theme: {
    extend: {
      colors: Record<string, string>;
      borderRadius: Record<string, string>;
      spacing: Record<string, string>;
      fontFamily: Record<string, string[]>;
      fontSize: Record<string, [string, { lineHeight: string; letterSpacing?: string; fontWeight?: string }]>;
    };
  };
};

interface DesignTypographyItem {
  fontFamily: string;
  fontSize: string;
  fontWeight: string | number;
  lineHeight: string;
  letterSpacing?: string;
}

interface DesignFrontMatter {
  name: string;
  colors: Record<string, string>;
  typography: Record<string, DesignTypographyItem>;
  rounded: Record<string, string>;
  spacing: Record<string, string>;
}

function loadDesignFrontMatter(): DesignFrontMatter {
  const designPath = fileURLToPath(
    new URL('../../../design/stitch/t_m_giao_matchmaking_system/DESIGN.md', import.meta.url),
  );
  const content = readFileSync(designPath, 'utf8');
  const parts = content.split(/^---\r?$/m);
  const frontMatterText = parts[1];
  if (!frontMatterText) {
    throw new Error('Không tìm thấy YAML front-matter trong DESIGN.md');
  }
  return parse(frontMatterText) as DesignFrontMatter;
}

const design = loadDesignFrontMatter();

describe('ui-tokens', () => {
  describe('tokens.ts khớp chính xác với DESIGN.md', () => {
    it('mọi khoá và giá trị trong colors khớp DESIGN.md', () => {
      const designColorKeys = Object.keys(design.colors).sort();
      const tokenColorKeys = Object.keys(colors).sort();
      expect(tokenColorKeys).toEqual(designColorKeys);

      for (const [key, value] of Object.entries(design.colors)) {
        expect(colors[key as keyof typeof colors]).toBe(value);
      }
    });

    it('mọi khoá và giá trị trong rounded khớp DESIGN.md', () => {
      const designRoundedKeys = Object.keys(design.rounded).sort();
      const tokenRoundedKeys = Object.keys(rounded).sort();
      expect(tokenRoundedKeys).toEqual(designRoundedKeys);

      for (const [key, value] of Object.entries(design.rounded)) {
        expect(rounded[key as keyof typeof rounded]).toBe(String(value));
      }
    });

    it('mọi khoá và giá trị trong spacing khớp DESIGN.md', () => {
      const designSpacingKeys = Object.keys(design.spacing).sort();
      const tokenSpacingKeys = Object.keys(spacing).sort();
      expect(tokenSpacingKeys).toEqual(designSpacingKeys);

      for (const [key, value] of Object.entries(design.spacing)) {
        expect(spacing[key as keyof typeof spacing]).toBe(String(value));
      }
    });

    it('mọi khoá và thuộc tính trong typography khớp DESIGN.md', () => {
      const designTypoKeys = Object.keys(design.typography).sort();
      const tokenTypoKeys = Object.keys(typography).sort();
      expect(tokenTypoKeys).toEqual(designTypoKeys);

      for (const [key, expected] of Object.entries(design.typography)) {
        const actual = typography[key as keyof typeof typography];
        expect(actual.fontFamily).toBe(expected.fontFamily);
        expect(actual.fontSize).toBe(expected.fontSize);
        expect(actual.lineHeight).toBe(expected.lineHeight);
        expect(actual.fontWeight).toBe(String(expected.fontWeight));

        if (expected.letterSpacing !== undefined) {
          // Union các kiểu typography: thu hẹp bằng `in` để đọc letterSpacing an toàn.
          expect('letterSpacing' in actual && actual.letterSpacing).toBe(expected.letterSpacing);
        } else {
          expect('letterSpacing' in actual).toBe(false);
        }
      }
    });

    it('FONT_FAMILY là Be Vietnam Pro', () => {
      expect(FONT_FAMILY).toBe('Be Vietnam Pro');
    });
  });

  describe('tailwind-preset.cjs đồng bộ với tokens và DESIGN.md', () => {
    it('preset có cùng colors với tokens.ts và DESIGN.md', () => {
      expect(Object.keys(preset.theme.extend.colors).sort()).toEqual(Object.keys(design.colors).sort());
      expect(preset.theme.extend.colors).toEqual(colors);
    });

    it('preset có cùng borderRadius với rounded trong tokens.ts', () => {
      expect(Object.keys(preset.theme.extend.borderRadius).sort()).toEqual(
        Object.keys(design.rounded).sort(),
      );
      expect(preset.theme.extend.borderRadius).toEqual(rounded);
    });

    it('preset có cùng spacing với spacing trong tokens.ts', () => {
      expect(Object.keys(preset.theme.extend.spacing).sort()).toEqual(Object.keys(design.spacing).sort());
      expect(preset.theme.extend.spacing).toEqual(spacing);
    });

    it('preset có fontFamily sans chứa Be Vietnam Pro', () => {
      expect(preset.theme.extend.fontFamily.sans).toEqual(['Be Vietnam Pro', 'system-ui', 'sans-serif']);
    });

    it('preset có fontSize khớp typography về fontSize, lineHeight và không có khoá thừa', () => {
      const designTypoKeys = Object.keys(design.typography).sort();
      const presetTypoKeys = Object.keys(preset.theme.extend.fontSize).sort();
      expect(presetTypoKeys).toEqual(designTypoKeys);

      for (const [key, expected] of Object.entries(design.typography)) {
        const tuple = preset.theme.extend.fontSize[key];
        expect(tuple).toBeDefined();
        if (!tuple) continue;

        expect(tuple[0]).toBe(expected.fontSize);
        expect(tuple[1].lineHeight).toBe(expected.lineHeight);

        if (expected.letterSpacing !== undefined) {
          expect(tuple[1].letterSpacing).toBe(expected.letterSpacing);
        } else {
          expect(tuple[1].letterSpacing).toBeUndefined();
        }

        if (expected.fontWeight !== undefined) {
          expect(tuple[1].fontWeight).toBe(String(expected.fontWeight));
        }
      }
    });
  });
});
