import JSZip from "jszip"
import * as path from "node:path"
import * as fs from "node:fs/promises"

export function loadFixture(name: string = "TEST"): Promise<JSZip> {
  if (!name.endsWith(".zip")) name += ".zip"
  const dir = path.resolve(__dirname, name)
  return JSZip.loadAsync(fs.readFile(dir))
}
