#!/usr/bin/env node
/**
 * 安装后自动构建 @itemlife/shared。
 * Docker 依赖层只拷贝了各 package.json，源码尚未就位，此时跳过（镜像内会显式构建）。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const sharedDir = resolve(process.cwd(), 'packages/shared');

if (!existsSync(resolve(sharedDir, 'src/index.ts'))) {
  console.log('[postinstall] 跳过 @itemlife/shared 构建：源码尚未就位');
  process.exit(0);
}

const tscBin = resolve(
  sharedDir,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc',
);

if (!existsSync(tscBin)) {
  console.error('[postinstall] 未找到 tsc，请先执行 pnpm install');
  process.exit(1);
}

const result = spawnSync(tscBin, ['-p', 'tsconfig.json'], {
  cwd: sharedDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.status !== 0) {
  console.error('[postinstall] @itemlife/shared 构建失败');
  process.exit(result.status ?? 1);
}

console.log('[postinstall] @itemlife/shared 构建完成');
