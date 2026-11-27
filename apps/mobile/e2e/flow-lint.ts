/** Tập hợp các tham chiếu trích được từ cây lệnh YAML của Maestro. */
export interface FlowRefs {
  ids: string[];
  runFlows: string[];
  scripts: { file: string; step: string | undefined }[];
}

const TEST_ID_RE = /testID=(?:"([^"]+)"|'([^']+)'|\{\s*(?:"([^"]+)"|'([^']+)'|`([^`]+)`)\s*\})/g;
const DYNAMIC_BRANCH_RE = /\$\{|[.*+?[\](){}^$\\]/;
const TEMPLATE_EXPR_RE = /\$\{[^}]+\}/g;
const OUTPUT_REF_RE = /\$\{output\.([A-Za-z0-9_-]+)\}/g;

/** Trích toàn bộ giá trị `testID` từ mã nguồn TSX (giữ nguyên chuỗi template gồm `${...}`). */
export function collectTestIds(source: string): string[] {
  const ids: string[] = [];
  for (const match of source.matchAll(TEST_ID_RE)) {
    const id = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function regexFromDynamicTestId(testId: string): RegExp {
  let pattern = '^';
  let cursor = 0;
  for (const match of testId.matchAll(TEMPLATE_EXPR_RE)) {
    const index = match.index ?? 0;
    pattern += escapeRegExp(testId.slice(cursor, index)) + '.+';
    cursor = index + match[0].length;
  }
  pattern += escapeRegExp(testId.slice(cursor)) + '$';
  return new RegExp(pattern);
}

function branchMatchesTestId(branch: string, testId: string): boolean {
  const branchDynIdx = branch.search(DYNAMIC_BRANCH_RE);
  const testIdDynIdx = testId.indexOf('${');
  const branchDynamic = branchDynIdx >= 0;
  const testIdDynamic = testIdDynIdx >= 0;

  if (!branchDynamic && !testIdDynamic) {
    return branch === testId;
  }

  if (branchDynamic && !testIdDynamic) {
    const pattern = `^${branch.replace(TEMPLATE_EXPR_RE, '.+')}$`;
    try {
      return new RegExp(pattern).test(testId);
    } catch {
      return false;
    }
  }

  if (!branchDynamic && testIdDynamic) {
    return regexFromDynamicTestId(testId).test(branch);
  }

  const branchPrefix = branch.slice(0, branchDynIdx);
  const testIdPrefix = testId.slice(0, testIdDynIdx);
  return (
    branchPrefix.length > 0 &&
    testIdPrefix.length > 0 &&
    (branchPrefix.startsWith(testIdPrefix) || testIdPrefix.startsWith(branchPrefix))
  );
}

/** Kiểm tra selector `id` của Maestro (có thể chứa nhánh `|`, regex hoặc `${...}`) có khớp `testIds` hay không. */
export function selectorMatchesTestId(selector: string, testIds: readonly string[]): boolean {
  if (selector.length === 0) return false;
  const branches = selector.split('|');
  return branches.every(
    (branch) => branch.length > 0 && testIds.some((testId) => branchMatchesTestId(branch, testId)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Duyệt đệ quy cây lệnh Maestro để gom mọi `id`, `runFlow` và `runScript`. */
export function collectFlowRefs(commands: unknown): FlowRefs {
  const refs: FlowRefs = { ids: [], runFlows: [], scripts: [] };

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;

    for (const [key, value] of Object.entries(node)) {
      if (key === 'id' && typeof value === 'string') {
        refs.ids.push(value);
        continue;
      }
      if (key === 'runFlow') {
        if (typeof value === 'string') {
          refs.runFlows.push(value);
        } else if (isRecord(value)) {
          if (typeof value.file === 'string') refs.runFlows.push(value.file);
          visit(value);
        }
        continue;
      }
      if (key === 'runScript') {
        if (typeof value === 'string') {
          refs.scripts.push({ file: value, step: undefined });
        } else if (isRecord(value)) {
          if (typeof value.file === 'string') {
            const step =
              isRecord(value.env) && typeof value.env.STEP === 'string' ? value.env.STEP : undefined;
            refs.scripts.push({ file: value.file, step });
          }
          visit(value);
        }
        continue;
      }
      visit(value);
    }
  };

  visit(commands);
  return refs;
}

/** Trích mọi tên key `<key>` trong các biểu thức `${output.<key>}`. */
export function collectOutputRefs(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(OUTPUT_REF_RE)) {
    const key = match[1];
    if (key !== undefined) keys.push(key);
  }
  return keys;
}
