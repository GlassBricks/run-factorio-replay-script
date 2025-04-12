import { beforeEach, expect, test } from "bun:test"
import * as path from "node:path"
import JSZip from "jszip"
import * as fs from "node:fs/promises"
import {
  freeplayCtrlLua,
  getReplayVersion,
  installReplayScript,
  writeZip,
} from "../src/replay-file.ts"
import { loadFixture } from "./fixtures"

let testZip: JSZip
const testZipName = "TEST"
beforeEach(async () => {
  testZip = await loadFixture(testZipName)
})

test("getReplayVersion", async () => {
  const version = await getReplayVersion(testZip)
  expect(version).toEqual("2.0.39")
})

test("installReplayScript", async () => {
  const info = await installReplayScript(testZip, "-- example replay!")
  expect(info).toEqual({
    saveName: "TEST",
    originalControlLua: freeplayCtrlLua,
  })
  const controlLua = testZip.file(`TEST/control.lua`)!
  expect(controlLua).toBeTruthy()

  const controlLuaContent = await controlLua.async("string")
  expect(controlLuaContent).toContain("\n-- example replay!")
})

test("writeZip", async () => {
  // await installReplayScript(testZip, "-- example replay!")
  const outPath = path.resolve(__dirname, "../tmp", "TEST-installed.zip")
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await writeZip(testZip, outPath)
  // just check exists
  await fs.access(outPath)
  await fs.rm(outPath)
})
