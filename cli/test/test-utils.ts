import path from "node:path"
import fs from "node:fs/promises"

export const tmpDir = path.resolve(__dirname, "../tmp")
export const dataDir = path.resolve(tmpDir, "factorio-data")
export async function createTestScript(
  script: string,
  name: string = "fake-factorio",
): Promise<string> {
  const filePath = path.resolve(tmpDir, name)
  await fs.writeFile(filePath, script.trim(), {
    mode: 0o755,
  })
  return filePath
}

export async function createTestFile(
  content: string,
  filename: string,
): Promise<string> {
  const filePath = path.resolve(tmpDir, filename)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content.trim())
  return filePath
}
