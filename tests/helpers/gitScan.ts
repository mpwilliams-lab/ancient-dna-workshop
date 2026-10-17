// Reads what a push would publish straight from git: the blobs of the HEAD commit, the lines the not-yet-pushed commits add,
// and commit messages. It never reads the working tree: a file edited after its commit is not what gets pushed.
// Used by tests/privacy.test.ts, which also runs it on a throw-away repository to prove where it reads from.
import { execFileSync } from 'node:child_process';

/** One file of the HEAD tree: its text, decoded as latin1 when it is a binary file and as UTF-8 otherwise. */
export interface Blob { path: string; binary: boolean; text: string }
/** The added lines of one file in one commit (`text` has no "+" prefix), with the file's `path` as git prints it. */
export interface AddedChunk { commit: string; path: string; text: string }

/** Files read as bytes, not text. */
export const BINARY = /\.(jpe?g|png|gif|webp|ico|woff2?|ttf|otf|pdf)$/i;

const MAX_BUFFER = 512 * 1024 * 1024;

/** A git command that must work: a failure throws, so it fails the test instead of looking like a clean repository. */
function git(cwd: string, args: string[], input?: string): Buffer {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, input, maxBuffer: MAX_BUFFER, stdio: ['pipe', 'pipe', 'pipe'] });
}

/** Every file of the HEAD tree, read from the commit's own blobs. */
export function headBlobs(cwd: string): Blob[] {
  const entries = git(cwd, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'])
    .toString('utf8')
    .split('\0')
    .filter((e) => e !== '')
    .map((e) => {
      const tab = e.indexOf('\t');
      const [, type, sha] = e.slice(0, tab).split(' ');
      return { type: type!, sha: sha!, path: e.slice(tab + 1) };
    })
    .filter((e) => e.type === 'blob');
  const shas = [...new Set(entries.map((e) => e.sha))];
  if (shas.length === 0) return [];
  // One process for every blob. Its answer is "<sha> <type> <size>\n<size bytes>\n", once per sha, in the order asked.
  const out = git(cwd, ['cat-file', '--batch'], `${shas.join('\n')}\n`);
  const bytes = new Map<string, Buffer>();
  let pos = 0;
  for (const sha of shas) {
    const nl = out.indexOf(0x0a, pos);
    const [, type, size] = out.toString('latin1', pos, nl).split(' ');
    if (type !== 'blob') throw new Error(`git cat-file: ${sha} is not a blob`);
    const start = nl + 1;
    const end = start + Number(size);
    bytes.set(sha, out.subarray(start, end));
    pos = end + 1;
  }
  return entries.map((e) => {
    const binary = BINARY.test(e.path);
    return { path: e.path, binary, text: bytes.get(e.sha)!.toString(binary ? 'latin1' : 'utf8') };
  });
}

/** "origin/main..HEAD" (the commits a push would publish), or null where origin/main does not exist. */
export function unpushedRange(cwd: string, remote = 'origin/main'): string | null {
  try {
    git(cwd, ['rev-parse', '--verify', '--quiet', `${remote}^{commit}`]);
  } catch {
    return null;
  }
  return `${remote}..HEAD`;
}

/**
 * The lines every commit in `range` adds, file by file (`git log -p -U0`). A line that a later commit removes again is still
 * here, because the push publishes every commit. Binary files carry no text; HEAD's own blobs cover their final content.
 */
export function addedChunks(cwd: string, range: string): AddedChunk[] {
  const log = git(cwd, ['log', '-p', '-U0', '--no-color', '--no-ext-diff', '--format=%x01%H', range]).toString('utf8');
  const chunks: AddedChunk[] = [];
  let commit = '';
  let current: AddedChunk | null = null;
  let inHunk = false;
  for (const line of log.split('\n')) {
    if (line.startsWith('\u0001')) {
      commit = line.slice(1, 8);
      current = null;
      inHunk = false;
    } else if (line.startsWith('diff --git ')) {
      // "diff --git a/<path> b/<path>": the path as the new side names it (the same text for a file that is not renamed).
      const named = /^diff --git a\/.* b\/(.*)$/.exec(line);
      current = { commit, path: named ? named[1]! : line.slice('diff --git '.length), text: '' };
      chunks.push(current);
      inHunk = false;
    } else if (line.startsWith('@@')) {
      inHunk = true;
    } else if (inHunk && current !== null && line.startsWith('+')) {
      current.text += `${line.slice(1)}\n`;
    }
  }
  return chunks;
}

/** The messages of the commits in `range`, or of every commit on every branch and tag with '--all'. */
export function commitMessages(cwd: string, range: string): string {
  return git(cwd, ['log', '--format=%B%x00', range]).toString('utf8');
}
