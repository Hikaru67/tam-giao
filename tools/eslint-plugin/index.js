// ESLint plugin nội bộ: ép luật kiến trúc A1 (dependency rule) và A3 (ranh giới module) trong AGENTS.md.
import path from 'node:path';

const MODULE_SRC_RE =
  /(?:^|\/)packages\/modules\/([^/]+)\/src\/(domain|application|infrastructure|presentation)(?:\/|$)/;
const MODULE_ROOT_RE = /(?:^|\/)packages\/modules\/([^/]+)(?:\/|$)/;
const MODULE_PKG_RE = /^@tamgiao\/module-([^/]+)(?:\/(.+))?$/;

/** Lớp nào được import lớp nào (trong cùng module). */
const ALLOWED_LAYER_DEPS = {
  domain: ['domain'],
  application: ['domain', 'application'],
  infrastructure: ['domain', 'application', 'infrastructure'],
  presentation: ['application', 'presentation'],
};

/** Package ngoài được phép trong lớp "thuần" (domain/application). */
const PURE_LAYER_EXTERNALS = new Set(['@tamgiao/kernel', '@tamgiao/contracts/constants']);
const PURE_LAYERS = new Set(['domain', 'application']);

/** Subpath duy nhất của module khác được phép import (A3). */
const CROSS_MODULE_PUBLIC_SUBPATH = 'facade';

const toPosix = (p) => p.split(path.sep).join('/');

/** @returns {{ module: string, layer: string | null } | null} */
function locate(posixPath) {
  const src = MODULE_SRC_RE.exec(posixPath);
  if (src) return { module: src[1], layer: src[2] };
  const root = MODULE_ROOT_RE.exec(posixPath);
  if (root) return { module: root[1], layer: null };
  return null;
}

/** @type {import('eslint').Rule.RuleModule} */
const architectureBoundaries = {
  meta: {
    type: 'problem',
    docs: { description: 'Ép dependency rule (A1) và ranh giới module (A3) của Tâm Giao.' },
    schema: [],
    messages: {
      layer: '[A1] Lớp "{{from}}" không được import lớp "{{to}}" của cùng module. Được phép: {{allowed}}.',
      pureExternal:
        '[A1] Lớp "{{from}}" chỉ được import @tamgiao/kernel, @tamgiao/contracts/constants (và facade module khác với application). Không được import "{{source}}".',
      crossModuleRelative:
        '[A3] Không import tương đối sang module "{{target}}". Dùng "@tamgiao/module-{{target}}/facade" hoặc domain event.',
      crossModuleDeep:
        '[A3] Chỉ được import "@tamgiao/module-{{target}}/facade" từ module khác, không phải "{{source}}".',
      crossModuleFromDomain: '[A3] Domain không được phụ thuộc module khác ("{{source}}").',
    },
  },
  create(context) {
    const filename = toPosix(context.filename ?? context.getFilename());
    const importer = locate(filename);
    if (!importer || importer.layer === null) return {};

    function check(node, source) {
      if (typeof source !== 'string') return;

      if (source.startsWith('.')) {
        const target = locate(toPosix(path.resolve(path.dirname(filename), source)));
        if (!target) return;
        if (target.module !== importer.module) {
          context.report({ node, messageId: 'crossModuleRelative', data: { target: target.module } });
          return;
        }
        if (target.layer && !ALLOWED_LAYER_DEPS[importer.layer].includes(target.layer)) {
          context.report({
            node,
            messageId: 'layer',
            data: {
              from: importer.layer,
              to: target.layer,
              allowed: ALLOWED_LAYER_DEPS[importer.layer].join(', '),
            },
          });
        }
        return;
      }

      const pkg = MODULE_PKG_RE.exec(source);
      if (pkg && pkg[1] !== importer.module) {
        if (importer.layer === 'domain') {
          context.report({ node, messageId: 'crossModuleFromDomain', data: { source } });
        } else if (pkg[2] !== CROSS_MODULE_PUBLIC_SUBPATH) {
          context.report({ node, messageId: 'crossModuleDeep', data: { target: pkg[1], source } });
        }
        return;
      }

      if (PURE_LAYERS.has(importer.layer) && !PURE_LAYER_EXTERNALS.has(source) && !pkg) {
        context.report({ node, messageId: 'pureExternal', data: { from: importer.layer, source } });
      }
    }

    const fromSource = (node) => check(node.source, node.source?.value);
    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: (node) => node.source && fromSource(node),
      ExportAllDeclaration: fromSource,
      ImportExpression: (node) => {
        if (node.source.type === 'Literal') check(node.source, node.source.value);
      },
    };
  },
};

export const tamgiaoPlugin = {
  meta: { name: 'eslint-plugin-tamgiao' },
  rules: { 'architecture-boundaries': architectureBoundaries },
};
