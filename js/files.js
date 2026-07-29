// Project file ingestion: drag-and-drop, <input webkitdirectory>, and the
// File System Access API directory picker. All three normalize to
// [{ path, file }] with paths relative to the project root.

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg', '__pycache__']);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export const MAX_FILE_BYTES = 100 * 1024 * 1024; // GitHub hard-blocks blobs > 100 MB
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024; // Pages sites must stay under 1 GB

function ignored(path) {
  const parts = path.split('/');
  if (parts.some((p) => IGNORED_DIRS.has(p))) return true;
  return IGNORED_FILES.has(parts[parts.length - 1]);
}

// Strip the common leading directory so "my-site/index.html" becomes "index.html".
function stripRoot(entries) {
  if (!entries.length) return entries;
  const firstSeg = (p) => p.split('/')[0];
  const root = firstSeg(entries[0].path);
  const allShareRoot =
    entries.every((e) => firstSeg(e.path) === root) &&
    entries.some((e) => e.path.includes('/'));
  if (!allShareRoot) return entries;
  return entries.map((e) => ({ ...e, path: e.path.slice(root.length + 1) })).filter((e) => e.path);
}

function finalize(entries) {
  return stripRoot(entries)
    .filter((e) => e.path && !ignored(e.path))
    .sort((a, b) => a.path.localeCompare(b.path));
}

// --- drag and drop ---

export async function fromDataTransfer(dataTransfer) {
  const items = [...dataTransfer.items].filter((i) => i.kind === 'file');
  const entries = [];
  await Promise.all(
    items.map(async (item) => {
      const entry = item.webkitGetAsEntry && item.webkitGetAsEntry();
      if (entry) {
        await walkEntry(entry, '', entries);
      } else {
        const file = item.getAsFile();
        if (file) entries.push({ path: file.name, file });
      }
    })
  );
  return finalize(entries);
}

function walkEntry(entry, prefix, out) {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file((file) => {
        out.push({ path: prefix + entry.name, file });
        resolve();
      }, reject);
    } else if (entry.isDirectory) {
      if (IGNORED_DIRS.has(entry.name)) return resolve();
      const reader = entry.createReader();
      const batch = () =>
        reader.readEntries(async (children) => {
          if (!children.length) return resolve();
          for (const child of children) {
            await walkEntry(child, `${prefix + entry.name}/`, out);
          }
          batch(); // readEntries returns at most 100 per call
        }, reject);
      batch();
    } else {
      resolve();
    }
  });
}

// --- <input type="file" webkitdirectory> or multiple files ---

export function fromFileList(fileList) {
  const entries = [...fileList].map((file) => ({
    path: file.webkitRelativePath || file.name,
    file,
  }));
  return finalize(entries);
}

// --- File System Access API ("open project folder" — closest thing a browser
// has to providing a project path) ---

export function supportsDirectoryPicker() {
  return typeof window.showDirectoryPicker === 'function';
}

export async function fromDirectoryPicker() {
  const dir = await window.showDirectoryPicker({ mode: 'read' });
  const entries = [];
  await walkHandle(dir, '', entries);
  // Paths from the handle are already root-relative; skip stripRoot.
  return entries.filter((e) => !ignored(e.path)).sort((a, b) => a.path.localeCompare(b.path));
}

async function walkHandle(dirHandle, prefix, out) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'directory') {
      if (!IGNORED_DIRS.has(name)) await walkHandle(handle, `${prefix + name}/`, out);
    } else {
      out.push({ path: prefix + name, file: await handle.getFile() });
    }
  }
}

// --- encoding helpers ---

export async function fileToBase64(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
