import path from "node:path"
import {
  getEnabledMods,
  launchFactorio,
  setupDataDirWithSave,
} from "./factorio-process.ts"
import { mkDirIfNotExists } from "./utils.ts"
import fs from "node:fs/promises"
import type LineEmitter from "./LineEmitter.ts"
import os from "node:os"
import { Command } from "@commander-js/extra-typings"
import { findFactorioMatchingVersion } from "./factorio-versions.ts"
import JSZip from "jszip"
import { freeplayCtrlLua, getReplayVersion } from "./replay-file.ts"
import type { WriteStream } from "node:fs"

export function recordReplayLinesToFile(
  lineEmitter: LineEmitter,
  stream: WriteStream,
  prefix: string,
) {
  lineEmitter.on("line", (line) => {
    if (line.startsWith(prefix)) {
      stream.write(line.substring(prefix.length) + os.EOL)
    }
  })
}

const allowedModSets = [
  new Set(["base"]),
  new Set(["base", "space-age", "quality", "elevated-rails"]),
]

function setEquals<T>(a: Set<T>, b: Set<T>) {
  if (a.size !== b.size) return false
  for (const item of a) {
    if (!b.has(item)) return false
  }
  return true
}

export async function cliMain(
  factorioExecutables: string[],
  includeDefaultFactorioPaths: boolean,
  outputDir: string,
  outFileName: string | undefined,
  saveFile: string,
  factorioArgs: string[] | undefined = [],
  allowAnyMods: boolean,
  allowNotFreeplay: boolean,
) {
  const saveZip = await JSZip.loadAsync(fs.readFile(saveFile))
  const factorioVersion = await getReplayVersion(saveZip)
  console.log("Factorio version:", factorioVersion)

  const factorioPath = await findFactorioMatchingVersion(
    factorioExecutables,
    includeDefaultFactorioPaths,
    factorioVersion,
  )
  const factorioDataDir = path.join(outputDir, "instances", factorioVersion)
  const logOutputFile = path.join(
    outputDir,
    "output",
    outFileName ?? path.basename(saveFile, ".zip") + "-replay.log",
  )
  await mkDirIfNotExists(path.dirname(logOutputFile))
  const saveInfo = await setupDataDirWithSave(factorioDataDir, saveZip)

  if (!allowNotFreeplay) {
    if (saveInfo.originalControlLua.trim() !== freeplayCtrlLua.trim()) {
      throw new Error(
        "Save did not use the freeplay scenario! Use --allow-not-freeplay to override this.",
      )
    }
  }

  const syncModsFactorioArgs = (factorioArgs || []).concat(
    "--sync-mods",
    saveFile,
  )

  const syncModsProcess = launchFactorio(
    factorioPath,
    factorioDataDir,
    syncModsFactorioArgs,
    true,
  )

  syncModsProcess.lineEmitter.on("line", console.log)
  const exitCode = await syncModsProcess.waitForExit()
  if (exitCode !== 0) {
    throw new Error(`Failed to sync mods with save! Exit code: ${exitCode}`)
  }

  if (!allowAnyMods) {
    const enabledMods = await getEnabledMods(factorioDataDir)
    const enabledModsSet = new Set(enabledMods)
    const valid = allowedModSets.some((set) => setEquals(enabledModsSet, set))
    if (!valid) {
      throw new Error(`
Invalid set of mods enabled!
Enabled mods: ${enabledMods.join(", ")}
Use --allow-any-mods to override this check.
      `)
    }
  }

  console.log("Log output file:", logOutputFile)
  await using outputFile = await fs.open(logOutputFile, "w")

  const factorio = launchFactorio(
    factorioPath,
    factorioDataDir,
    factorioArgs,
    true,
  )
  factorio.lineEmitter.on("line", console.log)
  const stream = outputFile.createWriteStream()
  recordReplayLinesToFile(factorio.lineEmitter, stream, "REPLAY_SCRIPT:")
  const maybeCloseOnScenarioFinished = (line: string) => {
    if (
      line.startsWith("REPLAY_SCRIPT:") &&
      line.includes("Started replay script")
    ) {
      factorio.closeOnScenarioFinished()
      factorio.lineEmitter.removeListener("line", maybeCloseOnScenarioFinished)
    }
  }
  factorio.lineEmitter.on("line", maybeCloseOnScenarioFinished)
  stream.close()

  const exitCode2 = await factorio.waitForExit()
  stream.write("Factorio exited with code: " + exitCode2 + os.EOL)
  console.log("Done!")
}

export const cliCommand = new Command()
  .argument("<save-file>", "Path to the replay file")
  .option(
    "-o, --out <name>",
    "Output file name for the log file. Defaults to same as zip name + -replay.log",
  )
  .option(
    "-d, --directory <dir>",
    "directory to use for outputs. Will create /outputs for log outputs, and /instances for Factorio instances/data directories",
    ".",
  )
  .option(
    "-f, --factorio <path>",
    "Path to a Factorio executable. Can be specified multiple times for multiple factorio versions. " +
      "The first factorio a matching version will be used. Takes precedence over autodetected versions if applicable.",
    (value: string, previous: string[]) => previous.concat(value),
  )
  .option("--no-autodetect", "Do try to autodetect Factorio executables")
  .option("--allow-any-mods", "Don't check for valid enabled mods", false)
  .option("--allow-not-freeplay", "Allow non-freeplay scenario saves", false)
  .argument("[factorio args...]")
  .passThroughOptions()
  .action((saveFile, factorioArgs, options) =>
    cliMain(
      options.factorio ?? [],
      options.autodetect,
      path.resolve(options.directory),
      options.out,
      path.resolve(saveFile),
      factorioArgs,
      options.allowAnyMods,
      options.allowNotFreeplay,
    ),
  )
