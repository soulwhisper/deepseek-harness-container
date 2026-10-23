#!/usr/bin/env node
// Vendored from dsh-tavern-wrongbook v1.33.0 debug/patch-test.mjs (MIT).
//
// Keeps the foreground text that was already received when a pure-API card
// test times out. The build applies it to the immutable Tavern source; the
// seeded copy lets wrongbook report the same state from user data.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

export const TARGET_REL = 'tavern-plugin/lib/domain/card-response-test.js'
export const DEFAULT_APP = '/opt/apps/dsh-tavern'

const ORIGINAL = [
  `        const round = { round: index + 1, input, selection, status: 'running', refused: null }
        record.rounds.push(round)`,
  `          const result = nativeResult((await call('native')).events, afterSeq)
          if (result.ready) {`,
  `    } catch (error) {
      Object.assign(record, { status: controller.signal.aborted ? 'cancelled' : 'error', refused: null, evidence: signal.aborted && !controller.signal.aborted ? '测试超时' : String(error.message || error) })`,
]

const PATCHED = [
  `        const round = { round: index + 1, input, selection, status: 'running', refused: null }
        // 轮询期间留一份最新的前台正文。MVU 卡的后台结算在纯 API 下必然挂起
        // （执行器在浏览器侧），收尾判据永远不成立；但前台生成是成功的，
        // 超时时不该把已经拿到的正文丢掉。
        round._lastText = ''
        record.rounds.push(round)`,
  `          const result = nativeResult((await call('native')).events, afterSeq)
          if (result.ready && result.text) round._lastText = result.text
          if (result.ready) {`,
  `    } catch (error) {
      const timedOut = signal.aborted && !controller.signal.aborted
      // 超时时把已经收到的正文落进那一轮：前台是成功的，证据不该只剩一句超时。
      const running = record.rounds.filter((r) => r.status === 'running')
      for (const r of running) {
        if (r._lastText) Object.assign(r, { text: r._lastText, textNote: '测试超时，但前台正文已收到' })
      }
      Object.assign(record, { status: controller.signal.aborted ? 'cancelled' : 'error', refused: null, evidence: timedOut ? '测试超时（后台结算在纯 API 下不会完成；前台正文见 rounds[].text）' : String(error.message || error) })`,
]

export function targetFor(app = DEFAULT_APP) {
  return path.join(app, TARGET_REL)
}

export function stateOf(text) {
  if (PATCHED.every(value => text.includes(value))) return 'patched'
  if (ORIGINAL.every(value => text.includes(value))) return 'original'
  return 'unknown'
}

function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from)
  if (first === -1 || text.indexOf(from, first + from.length) !== -1) {
    throw new Error(`${label} anchor is missing or not unique; refusing to write`)
  }
  return text.slice(0, first) + to + text.slice(first + from.length)
}

export function applyText(text) {
  if (stateOf(text) === 'patched') return text
  if (stateOf(text) !== 'original') throw new Error('timeout-body anchors changed; refusing to write')
  let next = text
  for (const [index, from] of ORIGINAL.entries()) next = replaceOnce(next, from, PATCHED[index], `timeout-body #${index + 1}`)
  return next
}

export function revertText(text) {
  if (stateOf(text) !== 'patched') return text
  let next = text
  for (const [index, from] of PATCHED.entries()) next = replaceOnce(next, from, ORIGINAL[index], `timeout-body revert #${index + 1}`)
  return next
}

export function stateFile(app = DEFAULT_APP) {
  const target = targetFor(app)
  if (!existsSync(target)) return { state: 'missing', target }
  return { state: stateOf(readFileSync(target, 'utf8')), target }
}

export function applyFile({ app = DEFAULT_APP, backup = true } = {}) {
  const target = targetFor(app)
  const before = readFileSync(target, 'utf8')
  const state = stateOf(before)
  if (state === 'patched') return { state, target, changed: false }
  if (state !== 'original') throw new Error(`timeout-body anchors changed: ${target}`)
  if (backup) copyFileSync(target, `${target}.bak-wrongbook-timeout-body`)
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
  console.log(`目标：${result.target}`)
  const label = result.state === 'patched'
    ? '已打补丁'
    : result.state === 'original'
      ? '未打补丁（锚点齐全，可应用）'
      : '⭐ 锚点没匹配上 —— 宿主可能改过这段代码，需要人工确认'
  console.log(`  状态：${label}`)
  if (result.state === 'patched') console.log('  → 超时记录里会带上前台正文。')
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
