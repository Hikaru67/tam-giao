import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import {
  collectFlowRefs,
  collectOutputRefs,
  collectTestIds,
  selectorMatchesTestId,
  type FlowRefs,
} from './flow-lint.js';
import { HELPER_STEPS, isHelperStep } from './helper/steps.js';

const E2E_DIR = fileURLToPath(new URL('.', import.meta.url));
const MOBILE_DIR = resolve(E2E_DIR, '..');
const FLOWS_DIR = join(E2E_DIR, 'flows');
const FULL_FLOW = join(FLOWS_DIR, 'full-journey.yaml');
const SUBFLOWS_DIR = join(FLOWS_DIR, 'subflows');

function walkFiles(dir: string, predicate: (fullPath: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(fullPath, predicate));
    } else if (entry.isFile() && predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

const listYamlFiles = (dir: string): string[] => walkFiles(dir, (p) => p.endsWith('.yaml')).sort();

function loadAppTestIds(): string[] {
  const testUtilsDir = `${join(MOBILE_DIR, 'src', 'test-utils')}${sep}`;
  const roots = [join(MOBILE_DIR, 'src'), join(MOBILE_DIR, 'app')];
  const ids = new Set<string>();
  for (const root of roots) {
    const files = walkFiles(
      root,
      (p) => p.endsWith('.tsx') && !p.endsWith('.native-test.tsx') && !p.startsWith(testUtilsDir),
    );
    for (const file of files) {
      for (const id of collectTestIds(readFileSync(file, 'utf8'))) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

function readExpectedAppId(): string {
  const configText = readFileSync(join(MOBILE_DIR, 'app.config.ts'), 'utf8');
  const match = /package:\s*'([^']+)'/.exec(configText);
  if (!match?.[1]) throw new Error('không tìm thấy android.package trong apps/mobile/app.config.ts');
  return match[1];
}

interface ParsedFlow {
  readonly path: string;
  readonly relPath: string;
  readonly text: string;
  readonly refs: FlowRefs;
}

function loadParsedFlows(files: readonly string[]): ParsedFlow[] {
  return files.map((filePath) => {
    const text = readFileSync(filePath, 'utf8');
    const docs = parseAllDocuments(text);
    const commands = docs[1]?.toJS() as unknown;
    return {
      path: filePath,
      relPath: relative(E2E_DIR, filePath),
      text,
      refs: collectFlowRefs(commands),
    };
  });
}

describe('flow-lint helpers', () => {
  it('collectTestIds trích được cả 4 dạng thuộc tính JSX (kể cả template literal)', () => {
    const source = `
      <View testID="plain-double" />
      <View testID='plain-single' />
      <View testID={"expr-double"} />
      <View testID={'expr-single'} />
      <View testID={\`kyc-capture-\${slot}\`} />
    `;
    expect(collectTestIds(source)).toEqual([
      'plain-double',
      'plain-single',
      'expr-double',
      'expr-single',
      'kyc-capture-${slot}',
    ]);
  });

  it('selectorMatchesTestId khớp đúng selector tĩnh, động, regex và nhánh |', () => {
    expect(selectorMatchesTestId('chat-send', ['chat-send'])).toBe(true);
    expect(selectorMatchesTestId('kyc-capture-SELFIE', ['kyc-capture-${slot}'])).toBe(true);
    expect(selectorMatchesTestId('date-partner-${output.partnerId}', ['date-partner-${partner.id}'])).toBe(
      true,
    );
    expect(selectorMatchesTestId('date-day-.*', ['date-day-${day.dayKey}'])).toBe(true);
    expect(
      selectorMatchesTestId('match-phase-DATING|chat-input', ['match-phase-${match.phase}', 'chat-input']),
    ).toBe(true);
    expect(selectorMatchesTestId('missing-id', ['chat-send'])).toBe(false);
    expect(
      selectorMatchesTestId('match-phase-DATING|nope', ['match-phase-${match.phase}', 'chat-input']),
    ).toBe(false);
  });

  it('collectFlowRefs duyệt đệ quy repeat.commands, runFlow.when và runScript', () => {
    const refs = collectFlowRefs([
      {
        runScript: {
          file: '../scripts/helper-step.js',
          env: { STEP: 'start' },
        },
      },
      {
        runFlow: {
          file: 'subflows/01-login.yaml',
          when: { visible: { id: 'login-submit' } },
        },
      },
      {
        repeat: {
          while: { visible: { id: 'loading-spinner' } },
          commands: [{ tapOn: { id: 'retry-btn' } }, { runScript: '../scripts/other.js' }],
        },
      },
    ]);
    expect(refs).toEqual({
      ids: ['login-submit', 'loading-spinner', 'retry-btn'],
      runFlows: ['subflows/01-login.yaml'],
      scripts: [
        { file: '../scripts/helper-step.js', step: 'start' },
        { file: '../scripts/other.js', step: undefined },
      ],
    });
  });

  it('collectOutputRefs trích đúng tên key trong ${output.<key>}', () => {
    const text = 'inputText: ${output.phone}\nassertVisible: ${output.replyText}\nother: ${FOO}';
    expect(collectOutputRefs(text)).toEqual(['phone', 'replyText']);
  });
});

describe('Maestro flows (apps/mobile/e2e/flows)', () => {
  const flowFiles = listYamlFiles(FLOWS_DIR);
  const expectedAppId = readExpectedAppId();

  it('có ít nhất 1 file .yaml và full-journey.yaml tồn tại', () => {
    expect(existsSync(FULL_FLOW)).toBe(true);
    expect(flowFiles.length).toBeGreaterThan(0);
  });

  if (flowFiles.length > 0) {
    it.each(flowFiles.map((filePath) => [relative(E2E_DIR, filePath), filePath]))(
      '%s hợp lệ cấu trúc YAML 2 document của Maestro',
      (_relPath, filePath) => {
        const docs = parseAllDocuments(readFileSync(filePath, 'utf8'));
        for (const doc of docs) {
          expect(doc.errors).toEqual([]);
        }
        expect(docs).toHaveLength(2);
        const header = docs[0]?.toJS() as unknown;
        expect(header).toMatchObject({ appId: expectedAppId });
        const commands = docs[1]?.toJS() as unknown;
        expect(Array.isArray(commands)).toBe(true);
        if (Array.isArray(commands)) {
          expect(commands.length).toBeGreaterThan(0);
        }
      },
    );
  }

  it('mọi selector id đều khớp testID trong src/ và app/', () => {
    const testIds = loadAppTestIds();
    const parsedFlows = loadParsedFlows(flowFiles);
    const missing: string[] = [];
    for (const flow of parsedFlows) {
      for (const id of flow.refs.ids) {
        if (!selectorMatchesTestId(id, testIds)) {
          missing.push(`${flow.relPath}: ${id}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('mọi runFlow và runScript đều trỏ tới file tồn tại', () => {
    const parsedFlows = loadParsedFlows(flowFiles);
    const missingTargets: string[] = [];
    for (const flow of parsedFlows) {
      const dir = dirname(flow.path);
      for (const target of flow.refs.runFlows) {
        if (!existsSync(resolve(dir, target))) {
          missingTargets.push(`${flow.relPath}: runFlow -> ${target}`);
        }
      }
      for (const script of flow.refs.scripts) {
        if (!existsSync(resolve(dir, script.file))) {
          missingTargets.push(`${flow.relPath}: runScript -> ${script.file}`);
        }
      }
    }
    expect(missingTargets).toEqual([]);
  });

  it('mọi runScript đều dùng STEP hợp lệ và helper-step.js luôn có STEP', () => {
    const helperScriptPath = resolve(E2E_DIR, 'scripts', 'helper-step.js');
    const parsedFlows = loadParsedFlows(flowFiles);
    const errors: string[] = [];
    for (const flow of parsedFlows) {
      const dir = dirname(flow.path);
      for (const script of flow.refs.scripts) {
        if (resolve(dir, script.file) === helperScriptPath && script.step === undefined) {
          errors.push(`${flow.relPath}: helper-step.js thiếu env.STEP`);
        }
        if (script.step !== undefined && !isHelperStep(script.step)) {
          errors.push(`${flow.relPath}: STEP không hợp lệ "${script.step}"`);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it('mọi ${output.k} trong flow đều nằm trong HELPER_STEPS', () => {
    const validKeys = new Set<string>(Object.values(HELPER_STEPS).flat());
    const parsedFlows = loadParsedFlows(flowFiles);
    const unknown: string[] = [];
    for (const flow of parsedFlows) {
      for (const key of collectOutputRefs(flow.text)) {
        if (!validKeys.has(key)) {
          unknown.push(`${flow.relPath}: output.${key}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it('full-journey.yaml tham chiếu mọi subflow đúng 1 lần theo thứ tự tăng dần', () => {
    const subflowFiles = listYamlFiles(SUBFLOWS_DIR);
    expect(subflowFiles.length).toBeGreaterThan(0);

    const [fullFlow] = loadParsedFlows([FULL_FLOW]);
    if (fullFlow === undefined) throw new Error('không đọc được full-journey.yaml');

    const fullDir = dirname(FULL_FLOW);
    const referencedSubflows = fullFlow.refs.runFlows
      .map((target) => resolve(fullDir, target))
      .filter((resolved) => resolved.startsWith(`${SUBFLOWS_DIR}${sep}`));

    expect(referencedSubflows).toEqual(subflowFiles);
  });
});
