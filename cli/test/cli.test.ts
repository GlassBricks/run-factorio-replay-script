import { expect, test } from "bun:test"
import LineEmitter from "../src/LineEmitter.ts"
import { PassThrough } from "stream"
import fs from "node:fs/promises"
import { tmpDir } from "./test-utils.ts"
import path from "node:path"
import { recordReplayLinesToFile } from "../src/cli.ts"
import { mkDirIfNotExists } from "../src/utils.ts"

test("recordReplayLinesToFile", async () => {
  const str = new PassThrough()
  const lineEmitter = new LineEmitter(str)
  const tmpFilePath = path.join(tmpDir, "test.txt")
  await mkDirIfNotExists(path.dirname(tmpFilePath))
  {
    await using tmpFile = await fs.open(tmpFilePath, "w")
    const stream = recordReplayLinesToFile(lineEmitter, tmpFile, "prefix:")

    str.emit("data", "prefix:One\n")
    str.emit("dat", "whatever")
    str.emit("data", "prefix:Two\n")
    str.emit("close")

    stream.close()
  }

  const fileContent = await fs.readFile(tmpFilePath, "utf8")
  expect(fileContent).toBe("One\nTwo\n")
})
