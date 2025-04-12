import * as fsp from "node:fs/promises"
import * as fs from "node:fs"
import * as path from "node:path"
import { installReplayScript, writeZip } from "./replay-file.ts"
import JSZip from "jszip"
import * as child_process from "node:child_process"
import type { Readable } from "stream"
import LineEmitter from "./LineEmitter.ts"
import TheReplayScript from "replay-script/control.lua" with { type: "text" }
import { mkDirIfNotExists } from "./utils.ts"

export async function setupFactorioDataDir(dir: string) {
  dir = path.resolve(dir)
  await mkDirIfNotExists(dir)

  const configFile = path.resolve(dir, "config.ini")
  if (!(await fsp.exists(configFile))) {
    const configFileContent = `; version=12
; Automatically generated
[path]
read-data=__PATH__executable__/../../data
write-data=${path.resolve(dir)}
[general]
locale=auto
[other]
check-updates=false
[interface]
[input]
[controls]
[controller]
[sound]
[map-view]
[debug]
[multiplayer-lobby]
[graphics]
cache-sprite-atlas-count=2
cache-sprite-atlas=true
compress-sprite-atlas-cache=true
graphics-quality=medium
show-smoke=false
show-clouds=false
show-fog=false
show-space-dust=false
show-decoratives=false
show-particles=false
show-item-shadows=false
show-inserter-shadows=false
show-animated-water=false
show-animated-ghosts=false
show-tree-distortion=false
additional-terrain-effects=false
light-occlusion=false
v-sync=false
high-quality-animations=false
show-game-simulations-in-background=false
texture-compression-level=low-quality
`
    await fsp.writeFile(path.resolve(dir, "config.ini"), configFileContent)
  } else {
    // replace ^write-data=.*$ with write-data=${path.resolve(dir)}
    const content = await fsp.readFile(configFile, "utf8")
    const newContent = content.replace(
      /^write-data=.*$/m,
      `write-data=${path.resolve(dir)}`,
    )
    if (content !== newContent) await fsp.writeFile(configFile, newContent)
  }
}

export async function setupDataDirWithSave(
  dataDirPath: string,
  saveFile: JSZip,
  script: string = TheReplayScript,
) {
  const saveInfo = await installReplayScript(saveFile, script)
  await setupFactorioDataDir(dataDirPath)
  // clear saves dir
  const savesDir = path.resolve(dataDirPath, "saves")
  await fs.promises.rm(savesDir, {
    recursive: true,
    force: true,
  })
  await mkDirIfNotExists(savesDir)
  await writeZip(saveFile, path.resolve(savesDir, saveInfo.saveName + ".zip"), {
    // readonly
    mode: 0o444,
  })
  return saveInfo
}

export class FactorioProcess implements AsyncDisposable {
  lineEmitter: LineEmitter
  private exited = false
  private exitResolve!: (code: number) => void
  private exitedPromise: Promise<number> = new Promise<number>(
    (resolve) => (this.exitResolve = resolve),
  )

  constructor(
    readonly process: child_process.ChildProcessByStdio<null, Readable, null>,
  ) {
    this.lineEmitter = new LineEmitter(process.stdout)

    this.process.on("exit", (exitCode, signal) => {
      if (this.exited) return
      this.exited = true
      this.exitResolve(exitCode || 0)
    })
  }

  kill(signal?: NodeJS.Signals | number) {
    this.process.kill(signal)
  }

  waitForExit(): Promise<number> {
    return this.exitedPromise
  }

  closeOnScenarioFinished(): void {
    const closeEvent =
      / *\d+\.\d+ +Info AppManager.cpp:\d+: Deleting active scenario\./
    this.lineEmitter.on("line", (line: string) => {
      if (closeEvent.test(line)) {
        this.kill("SIGTERM")
      }
    })
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.exited) {
      this.process.kill()
      await this.waitForExit()
    }
  }
}

export function launchFactorioChildProcess(
  factorioPath: string,
  dataDirPath: string,
  launchArgs: string[],
  shell: boolean,
) {
  launchArgs = launchArgs.concat([
    "-c",
    path.resolve(dataDirPath, "config.ini"),
  ])
  console.log("Launching factorio with args", ...launchArgs)
  return child_process.spawn(factorioPath, launchArgs, {
    shell,
    stdio: ["inherit", "pipe", "inherit"],
  })
}

export function launchFactorio(
  factorioPath: string,
  dataDirPath: string,
  launchArgs: string[],
  shell: boolean = false,
): FactorioProcess {
  const child = launchFactorioChildProcess(
    factorioPath,
    dataDirPath,
    launchArgs,
    shell,
  )
  return new FactorioProcess(child)
}

interface ModOption {
  name: string
  enabled: boolean
  version: string
}

interface ModListJson {
  mods: ModOption[]
}

function getEnabledModsFromJson(modList: ModListJson): string[] {
  const activeMods: string[] = []
  for (const mod of modList.mods || []) {
    // noinspection SuspiciousTypeOfGuard
    if (mod.enabled && typeof mod.name === "string") {
      activeMods.push(mod.name)
    }
  }
  return activeMods
}

async function readModListJson(dataDirPath: string) {
  const modListPath = path.join(dataDirPath, "mods", "mod-list.json")
  const modList: ModListJson = JSON.parse(
    await fs.promises.readFile(modListPath, "utf8"),
  )
  return modList
}
export async function getEnabledMods(dataDirPath: string): Promise<string[]> {
  const modList = await readModListJson(dataDirPath)
  return getEnabledModsFromJson(modList)
}
