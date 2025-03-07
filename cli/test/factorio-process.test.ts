import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test"
import * as path from "node:path"
import * as fs from "node:fs/promises"
import {
  launchFactorio,
  launchFactorioChildProcess,
  setupDataDirWithSave,
  setupFactorioDataDir,
} from "../src/factorio-process.ts"
import { loadFixture } from "./fixtures"
import { createTestScript, dataDir, tmpDir } from "./test-utils.ts"

beforeAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})
beforeEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true })
})
afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe("setupFactorioDataDir", async () => {
  async function checkDirCorrect(dirTmp: string) {
    const files = await fs.readdir(dirTmp)
    expect(new Set(files)).toEqual(new Set(["config.ini", "saves"]))

    const configFileContent = await fs.readFile(
      path.resolve(dirTmp, "config.ini"),
      "utf8",
    )
    expect(configFileContent).toContain(`write-data=${path.resolve(dirTmp)}`)
  }
  test("create from scratch", async () => {
    await setupFactorioDataDir(dataDir)

    await checkDirCorrect(dataDir)
  })

  test("with existing config", async () => {
    const dirTmp = path.resolve(__dirname, "../tmp")
    await fs.mkdir(dirTmp, { recursive: true })
    await fs.writeFile(
      path.resolve(dirTmp, "config.ini"),
      `;hi
write-data=foo
`,
    )
    await setupFactorioDataDir(dirTmp)
    await checkDirCorrect(dirTmp)
  })
})

test("setupDataDirWithSave", async () => {
  const saveZip = await loadFixture()
  await setupDataDirWithSave(dataDir, saveZip)
  const savePath = path.resolve(dataDir, "saves", "TEST.zip")
  expect(await fs.exists(savePath)).toBe(true)
})

test("launchFactorio", async () => {
  const fakeFactorio = await createTestScript(`#!/usr/bin/env sh
echo $@
echo hi
  `)
  await using process = launchFactorioChildProcess(
    fakeFactorio,
    dataDir,
    [],
    false,
  )
  let out = ""
  process.stdout.on("data", (chunk: Buffer) => {
    out += chunk.toString()
  })
  await new Promise((resolve) => {
    process.on("close", resolve)
  })
  expect(out).toEqual(`-c ${path.resolve(dataDir, "config.ini")}\nhi\n`)
})

test("launchFactorio and log", async () => {
  const fakeFactorio = await createTestScript(`#!/usr/bin/env sh
echo $1
echo one
echo two
echo three
`)
  await using factorio = launchFactorio(fakeFactorio, dataDir, [])
  const lines: string[] = []
  factorio.lineEmitter.on("line", (line) => lines.push(line))
  await factorio.waitForExit()
  expect(lines).toEqual(["-c", "one", "two", "three"])
})

test("factorio dispose", async () => {
  const fakeFactorio = await createTestScript(`#!/usr/bin/env sh
 sleep 5
 echo "BAD!"
`)

  let waitedTooLong = false
  const handle = setTimeout(() => {
    waitedTooLong = true
  }, 1000)

  const lines: string[] = []
  {
    await using factorio = launchFactorio(fakeFactorio, dataDir, [])
    factorio.lineEmitter.on("line", (line) => lines.push(line))
  }

  clearTimeout(handle)
  expect(lines).toBeEmpty()
  expect(waitedTooLong).toBeFalse()
})

test("closeOnScenarioFinished", async () => {
  const fakeFactorio = await createTestScript(`#!/usr/bin/env sh
echo HI
echo "  27.832 Info AppManager.cpp:352: Deleting active scenario."
sleep 1
echo BAD
`)

  const factorio = launchFactorio(fakeFactorio, dataDir, [])
  const lines: string[] = []
  factorio.lineEmitter.on("line", (line) => {
    lines.push(line)
  })
  factorio.closeOnScenarioFinished()
  await factorio.waitForExit()
  // it hangs otherwise for some reason
  factorio.process.stdout.destroy()
  // ensure the process exited correctly
  expect(lines).toEqual(["HI", expect.anything()])
})
