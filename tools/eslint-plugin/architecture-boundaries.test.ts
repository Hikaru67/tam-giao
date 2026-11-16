import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import { tamgiaoPlugin } from './index.js';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2023, sourceType: 'module' },
});

const rule = tamgiaoPlugin.rules['architecture-boundaries'];
const mod = (module: string, layer: string, file = 'x.ts') =>
  `/repo/packages/modules/${module}/src/${layer}/${file}`;

ruleTester.run('architecture-boundaries', rule, {
  valid: [
    // domain → domain cùng module, kernel, constants
    { filename: mod('matching', 'domain'), code: "import { Result } from '@tamgiao/kernel';" },
    {
      filename: mod('matching', 'domain'),
      code: "import { OFFER_TTL_HOURS } from '@tamgiao/contracts/constants';",
    },
    {
      filename: mod('matching', 'domain', 'match.ts'),
      code: "import { MatchState } from './match-state.js';",
    },
    // application → domain, facade module khác
    {
      filename: mod('matching', 'application/use-cases'),
      code: "import { Match } from '../../domain/match.js';",
    },
    {
      filename: mod('matching', 'application'),
      code: "import type { VerificationFacade } from '@tamgiao/module-verification/facade';",
    },
    // infrastructure → application, domain, thư viện ngoài
    { filename: mod('matching', 'infrastructure'), code: "import { eq } from 'drizzle-orm';" },
    {
      filename: mod('matching', 'infrastructure'),
      code: "import type { MatchRepository } from '../application/ports/match-repository.js';",
    },
    // presentation → application, thư viện ngoài
    { filename: mod('matching', 'presentation'), code: "import { Hono } from 'hono';" },
    {
      filename: mod('matching', 'presentation'),
      code: "import { AcceptOffer } from '../application/use-cases/accept-offer.js';",
    },
    // file ngoài module không bị ràng buộc
    {
      filename: '/repo/apps/api/src/main.ts',
      code: "import { x } from '@tamgiao/module-matching/infrastructure';",
    },
    // file gốc của module (index.ts) không thuộc lớp nào
    {
      filename: '/repo/packages/modules/matching/src/index.ts',
      code: "import { y } from './infrastructure/repo.js';",
    },
  ],
  invalid: [
    // A1: domain import framework
    {
      filename: mod('matching', 'domain'),
      code: "import { pgTable } from 'drizzle-orm/pg-core';",
      errors: [{ messageId: 'pureExternal' }],
    },
    {
      filename: mod('matching', 'domain'),
      code: "import { Hono } from 'hono';",
      errors: [{ messageId: 'pureExternal' }],
    },
    {
      filename: mod('matching', 'domain'),
      code: "import { z } from 'zod';",
      errors: [{ messageId: 'pureExternal' }],
    },
    {
      filename: mod('matching', 'domain'),
      code: "import { x } from '@tamgiao/contracts';",
      errors: [{ messageId: 'pureExternal' }],
    },
    // A1: application import framework (kể cả import type)
    {
      filename: mod('matching', 'application'),
      code: "import type { PgDatabase } from 'drizzle-orm/pg-core';",
      errors: [{ messageId: 'pureExternal' }],
    },
    // A1: hướng phụ thuộc sai giữa các lớp
    {
      filename: mod('matching', 'domain'),
      code: "import { X } from '../infrastructure/repo.js';",
      errors: [{ messageId: 'layer' }],
    },
    {
      filename: mod('matching', 'domain'),
      code: "import { X } from '../application/port.js';",
      errors: [{ messageId: 'layer' }],
    },
    {
      filename: mod('matching', 'application'),
      code: "import { X } from '../infrastructure/repo.js';",
      errors: [{ messageId: 'layer' }],
    },
    {
      filename: mod('matching', 'presentation'),
      code: "import { X } from '../infrastructure/repo.js';",
      errors: [{ messageId: 'layer' }],
    },
    {
      filename: mod('matching', 'infrastructure'),
      code: "export { routes } from '../presentation/routes.js';",
      errors: [{ messageId: 'layer' }],
    },
    {
      filename: mod('matching', 'domain'),
      code: "const m = await import('../infrastructure/repo.js');",
      errors: [{ messageId: 'layer' }],
    },
    // A3: import tương đối sang module khác
    {
      filename: mod('matching', 'infrastructure'),
      code: "import { vouchers } from '../../../billing/src/infrastructure/schema.js';",
      errors: [{ messageId: 'crossModuleRelative' }],
    },
    // A3: import sâu qua package module khác
    {
      filename: mod('matching', 'application'),
      code: "import { Voucher } from '@tamgiao/module-billing/domain/voucher';",
      errors: [{ messageId: 'crossModuleDeep' }],
    },
    {
      filename: mod('matching', 'infrastructure'),
      code: "export * from '@tamgiao/module-billing';",
      errors: [{ messageId: 'crossModuleDeep' }],
    },
    // A3: domain phụ thuộc facade module khác
    {
      filename: mod('matching', 'domain'),
      code: "import type { VerificationFacade } from '@tamgiao/module-verification/facade';",
      errors: [{ messageId: 'crossModuleFromDomain' }],
    },
  ],
});
