#!/usr/bin/env node
// Image-managed subset of dsh-tavern-wrongbook v1.33.0 debug/patch-all.mjs.
//
// The upstream runner expects a writable desktop Tavern checkout. This
// distribution owns an immutable /opt/apps/dsh-tavern and applies the patches
// during the image build. Only anchors that still match the pinned Tavern
// source are kept; the rest are reported as not applicable instead of being
// attempted at runtime.
//
// Usage:
//   node patch-all.mjs                 # status
//   node patch-all.mjs --apply         # apply missing patches (no-op when clean)
//   node patch-all.mjs --apply --strict --no-backup   # image build gate
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const TOOLS = path.dirname(fileURLToPath(import.meta.url))
const APP = process.env.TAVERN_APP || '/opt/apps/dsh-tavern'
const args = process.argv.slice(2)
const apply = args.includes('--apply')
const strict = args.includes('--strict')
const noBackup = args.includes('--no-backup')

const PATCHES = [
  {
    id: 'mvu-api',
    title: 'MVU 卡纯 API 测试',
    module: './patch-mvu-api.mjs',
    note: '改 lib/domain/tavern-helper-scripts.js',
  },
  {
    id: 'timeout-body',
    title: '超时保留前台正文',
    module: './patch-timeout-body.mjs',
    note: '改 lib/domain/card-response-test.js',
  },
]

// Kept visible so the wrongbook panel can explain why a patch is absent
// instead of reporting a vague unknown state. Porting one of these requires
// re-deriving its anchors against the pinned Tavern source and adding it to
// PATCHES above.
const UNSUPPORTED = [
  {
    title: '源码补丁（九处 + 三处包装归一化）',
    reason: 'upstream targets the pre-3.1.3 src/client/main.js layout; not bundled',
  },
  {
    title: '思考通道轮次的界面标注',
    reason: 'upstream targets the pre-3.1.3 src/client/main.js renderer; not bundled',
  },
  {
    title: '思考通道兜底（正文为空时用思考内容续走）',
    reason: 'upstream targets the pre-3.1.3 lib/index.js turn lifecycle; not bundled',
  },
  {
    title: '卡内 generate 兜底（龙娘回廊）',
    reason: 'card data is user-owned and is never image content; not bundled',
  },
]

function load(patch) {
  return import(pathToFileURL(path.join(TOOLS, patch.module)).href)
}

function mark(state) {
  return state === 'patched' ? 'ok' : state === 'original' ? '需要' : '??'
}

async function main() {
  console.log('DSH Tavern wrongbook 宿主补丁状态（镜像构建时应用）')
  console.log(`宿主：${APP}`)
  console.log('')

  const need = []
  const unknown = []
  for (const patch of PATCHES) {
    const mod = await load(patch)
    const { state, target } = mod.stateFile(APP)
    console.log(`  [${mark(state)}] ${patch.title}`)
    console.log(`         ${patch.note} · ${target}`)
    if (state === 'original') need.push({ patch, mod })
    if (state === 'unknown' || state === 'missing') unknown.push(patch.title)
  }

  for (const patch of UNSUPPORTED) {
    console.log(`  [ -- ] ${patch.title}`)
    console.log(`         (${patch.reason})`)
  }
  console.log('')

  if (!apply) {
    if (need.length) console.log(`有 ${need.length} 个需要重打。跑 --apply 处理。`)
    else if (unknown.length) console.log(`有 ${unknown.length} 个锚点不匹配，需要人工确认。`)
    else console.log('全部就位。')
    if (strict && (need.length || unknown.length)) process.exitCode = 1
    return
  }

  if (!need.length) {
    console.log('没有需要重打的。')
    if (strict && unknown.length) process.exitCode = 1
    return
  }

  console.log('开始重打…')
  console.log('')
  for (const { patch, mod } of need) {
    console.log(`· ${patch.title}`)
    try {
      const result = mod.applyFile({ app: APP, backup: !noBackup })
      console.log(`   ${result.changed ? '已应用' : '已就位'} · ${result.target}`)
    } catch (error) {
      console.error(`   失败：${String(error?.message ?? error)}`)
      process.exitCode = 1
    }
    console.log('')
  }

  let bad = 0
  console.log('复查：')
  for (const patch of PATCHES) {
    const mod = await load(patch)
    const { state } = mod.stateFile(APP)
    if (state !== 'patched') bad += 1
    console.log(`  [${mark(state)}] ${patch.title}`)
  }
  for (const title of unknown) console.log(`  [??] ${title}`)
  console.log('')

  if (bad) {
    console.error(`仍有 ${bad} 个已支持的补丁未就位。`)
    process.exitCode = 1
  } else if (strict && unknown.length) {
    console.error(`仍有 ${unknown.length} 个补丁锚点不匹配；更新锚点或从 PATCHES 移除后再构建。`)
    process.exitCode = 1
  } else {
    console.log('全部就位。**重启 DSH 才生效。**')
  }
}

await main()
