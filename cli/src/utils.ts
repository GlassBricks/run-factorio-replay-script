import fs from "node:fs/promises"

export async function mkDirIfNotExists(dir: string) {
  if (!(await fs.exists(dir))) {
    await fs.mkdir(dir, { recursive: true })
  }
}
