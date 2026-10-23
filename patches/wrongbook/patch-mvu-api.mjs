#!/usr/bin/env node
// Vendored from dsh-tavern-wrongbook v1.33.0 debug/patch.mjs (MIT).
//
// The wrongbook plugin expects its host-patch runner at
// <tavern data>/tools/mvu-api-test/patch-all.mjs and invokes it with
// --apply at startup. This distribution applies the same host patches at
// image-build time because /opt/apps/dsh-tavern is immutable at runtime.
// The script remains runnable from the seeded data copy so the wrongbook
// panel can report the real state.
import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const TARGET_REL = 'tavern-plugin/lib/domain/tavern-helper-scripts.js'
export const DEFAULT_APP = '/opt/apps/dsh-tavern'

const ORIGINAL = `  return chat.mvu?.enabled === true || projectTavernHelperScripts(helperScripts).scripts.length > 0`
const PATCHED = `  // MVU 的运行时在宿主侧（lib/vendor/magvarupdate），纯 API 也能跑；真正需要浏览器的是
  // 卡内的 Tavern Helper 脚本。原先两者并列，把 MVU 卡一并挡掉了。
  return projectTavernHelperScripts(helperScripts).scripts.length > 0`

export function targetFor(app = DEFAULT_APP) {
  return path.join(app, TARGET_REL)
}

export function stateOf(text) {
  if (text.includes(PATCHED)) return 'patched'
  if (text.includes(ORIGINAL)) return 'original'
  return 'unknown'
}

export function applyText(text) {
  if (text.includes(PATCHED)) return text
  if (!text.includes(ORIGINAL)) throw new Error('MVU API anchor changed; refusing to write')
  return text.replace(ORIGINAL, PATCHED)
}

export function revertText(text) {
  if (!text.includes(PATCHED)) throw new Error('MVU API patch marker is missing; refusing to write')
  return text.replace(PATCHED, ORIGINAL)
}

export function stateFile(app = DEFAULT_APP) {
  const target = targetFor(app)
  if (!existsSync(target)) return { state: 'missing', target }
  return { state: stateOf(readFileSync(target, 'utf8')), target, mtime: statSync(target).mtime }
}

export function applyFile({ app = DEFAULT_APP, backup = true } = {}) {
  const target = targetFor(app)
  const before = readFileSync(target, 'utf8')
  const state = stateOf(before)
  if (state === 'patched') return { state, target, changed: false }
  if (state !== 'original') throw new Error(`MVU API anchor changed: ${target}`)
  if (backup) copyFileSync(target, `${target}.bak-wrongbook-mvu-api`)
  writeFileSync(target, applyText(before), 'utf8')
  return { state: 'patched', target, changed: true }
}

export function revertFile({ app = DEFAULT_APP } = {}) {
  const target = targetFor(app)
  const before = readFileSync(target, 'utf8')
  if (stateOf(before) !== 'patched') return { state: stateOf(before), target, changed: false }
  writeFileSync(target, revertText(before), 'utf8')
  return { state: 'original', target, changed: true }
}

function statusLine(result) {
  if (result.state === 'missing') {
    console.log(`找不到宿主文件：${result.target}`)
    return 1
  }
  console.log(`宿主文件：${result.target}`)
  console.log(`  修改时间：${result.mtime.toLocaleString()}`)
  const label = result.state === 'patched'
    ? '已打补丁'
    : result.state === 'original'
      ? '未打补丁（锚点齐全，可应用）'
      : '⭐ 锚点没匹配上 —— 宿主可能改过这段代码，需要人工确认'
  console.log(`  状态：${label}`)
  if (result.state === 'patched') console.log('  → MVU 卡（卡内无脚本的）现在可以进行纯 API 测试。')
  return result.state === 'unknown' ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const mode = args.includes('--apply') ? 'apply' : args.includes('--revert') ? 'revert' : 'status'
  const app = process.env.TAVERN_APP || DEFAULT_APP
  try {
    if (mode === 'apply') {
      const result = applyFile({ app, backup: !args.includes('--no-backup') })
      console.log(result.changed ? '已应用。' : '已打补丁，无需重复应用。')
    } else if (mode === 'revert') {
      const result = revertFile({ app })
      console.log(result.changed ? '已还原。' : '未打补丁，无需还原。')
    } else {
      process.exitCode = statusLine(stateFile(app))
    }
  } catch (error) {
    console.error(String(error?.message ?? error))
    process.exitCode = 1
  }
}
