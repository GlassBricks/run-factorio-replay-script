import JSZip from "jszip"
import fs from "node:fs/promises"

function findFileInReplayZip(
  zip: JSZip,
  name: string,
): JSZip.JSZipObject | undefined {
  for (const filePath in zip.files) {
    const fileName = filePath.split("/")
    if (fileName.length == 2 && fileName[1] == name) {
      return zip.files[filePath]
    }
  }
  return undefined
}

export async function installReplayScript(
  zip: JSZip,
  replayScript: string,
): Promise<string> {
  const ctrlLuaFile = findFileInReplayZip(zip, "control.lua")
  if (!ctrlLuaFile) {
    throw new Error("Could not find control.lua")
  }

  await writeReplayScript(zip, ctrlLuaFile, replayScript)
  return ctrlLuaFile.name.split("/")[0]
}

async function writeReplayScript(
  zip: JSZip,
  file: JSZip.JSZipObject,
  replayScript: string,
) {
  zip.file(
    file.name,
    (await file.async("string")) +
      `do
${replayScript}
end
`,
  )
}

export async function getReplayVersion(zip: JSZip): Promise<string> {
  const levelInit = findFileInReplayZip(zip, "level-init.dat")
  if (!levelInit) throw new Error("Could not find level-init.dat in save file")
  // read just first couple bytes form file
  const stream = levelInit.nodeStream()
  await new Promise((resolve) => stream.on("readable", resolve))
  const bytes = stream.read(6) as Buffer
  const major = bytes.readUint16LE(0)
  const minor = bytes.readUint16LE(2)
  const patch = bytes.readUint16LE(4)
  return `${major}.${minor}.${patch}`
}

export async function writeZip(zip: JSZip, path: string) {
  const buffer = await zip.generateAsync({ type: "nodebuffer" })
  await fs.writeFile(path, buffer)
}
