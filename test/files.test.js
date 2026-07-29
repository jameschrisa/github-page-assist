import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fromFileList, fileToBase64, formatBytes } from '../js/files.js';

function fileWithRelPath(relPath, content = 'x') {
  const name = relPath.split('/').pop();
  const file = new File([content], name);
  Object.defineProperty(file, 'webkitRelativePath', { value: relPath });
  return file;
}

describe('fromFileList: root stripping', () => {
  test('strips a single shared leading directory from webkitRelativePath', () => {
    const list = [
      fileWithRelPath('my-site/index.html'),
      fileWithRelPath('my-site/css/style.css'),
      fileWithRelPath('my-site/js/app.js'),
    ];
    const out = fromFileList(list);
    assert.deepEqual(
      out.map((e) => e.path),
      ['css/style.css', 'index.html', 'js/app.js']
    );
  });

  test('does not strip when files do not share a common root', () => {
    const list = [fileWithRelPath('site-a/index.html'), fileWithRelPath('site-b/about.html')];
    const out = fromFileList(list);
    assert.deepEqual(
      out.map((e) => e.path),
      ['site-a/index.html', 'site-b/about.html']
    );
  });

  test('flat file list (no directories) is left untouched', () => {
    const list = [fileWithRelPath('index.html'), fileWithRelPath('style.css')];
    const out = fromFileList(list);
    assert.deepEqual(
      out.map((e) => e.path),
      ['index.html', 'style.css']
    );
  });

  test('falls back to file.name when webkitRelativePath is empty', () => {
    const file = new File(['x'], 'solo.html');
    // webkitRelativePath defaults to '' for plain <input type=file multiple>
    const out = fromFileList([file]);
    assert.deepEqual(out, [{ path: 'solo.html', file }]);
  });
});

describe('fromFileList: ignored entries', () => {
  test('filters .git directory contents', () => {
    const list = [fileWithRelPath('site/index.html'), fileWithRelPath('site/.git/config')];
    const out = fromFileList(list);
    assert.deepEqual(
      out.map((e) => e.path),
      ['index.html']
    );
  });

  test('filters node_modules directory contents', () => {
    const list = [
      fileWithRelPath('site/index.html'),
      fileWithRelPath('site/node_modules/pkg/index.js'),
    ];
    const out = fromFileList(list);
    assert.deepEqual(
      out.map((e) => e.path),
      ['index.html']
    );
  });

  test('filters .DS_Store files anywhere in the tree', () => {
    const list = [
      fileWithRelPath('site/index.html'),
      fileWithRelPath('site/.DS_Store'),
      fileWithRelPath('site/assets/.DS_Store'),
    ];
    const out = fromFileList(list);
    assert.deepEqual(
      out.map((e) => e.path),
      ['index.html']
    );
  });

  test('sorts the resulting entries by path', () => {
    const list = [fileWithRelPath('site/b.html'), fileWithRelPath('site/a.html')];
    const out = fromFileList(list);
    assert.deepEqual(
      out.map((e) => e.path),
      ['a.html', 'b.html']
    );
  });
});

describe('fileToBase64', () => {
  test('matches Buffer base64 encoding for arbitrary binary content', async () => {
    const bytes = new Uint8Array(256);
    for (let i = 0; i < 256; i += 1) bytes[i] = i;
    const file = new File([bytes], 'blob.bin');
    const expected = Buffer.from(bytes).toString('base64');
    const actual = await fileToBase64(file);
    assert.equal(actual, expected);
  });

  test('matches Buffer base64 encoding for content larger than the chunk size', async () => {
    // fileToBase64 chunks at 0x8000 (32768) bytes; exercise the multi-chunk path.
    const size = 0x8000 * 3 + 123;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) bytes[i] = i % 256;
    const file = new File([bytes], 'big.bin');
    const expected = Buffer.from(bytes).toString('base64');
    const actual = await fileToBase64(file);
    assert.equal(actual, expected);
  });

  test('encodes empty file content as empty string', async () => {
    const file = new File([], 'empty.bin');
    const actual = await fileToBase64(file);
    assert.equal(actual, '');
  });
});

describe('formatBytes boundaries', () => {
  test('bytes below 1024 render as whole-number B', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1), '1 B');
    assert.equal(formatBytes(1023), '1023 B');
  });

  test('1024 bytes and above render as KB with one decimal', () => {
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(1536), '1.5 KB');
  });

  test('1 MiB and above render as MB with one decimal', () => {
    assert.equal(formatBytes(1024 * 1024), '1.0 MB');
    assert.equal(formatBytes(1.5 * 1024 * 1024), '1.5 MB');
  });

  test('1 GiB and above render as GB with two decimals', () => {
    assert.equal(formatBytes(1024 * 1024 * 1024), '1.00 GB');
    assert.equal(formatBytes(2.5 * 1024 * 1024 * 1024), '2.50 GB');
  });
});
