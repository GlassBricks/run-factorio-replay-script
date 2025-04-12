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
import packageJson from "../package.json" assert { type: "json" }

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
  logFileName: string | undefined,
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
    logFileName ?? path.basename(saveFile, ".zip") + "-replay.log",
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
  console.log("Log file is at", logOutputFile)
}

export const cliCommand = new Command()
  .addHelpText(
    "before",
    "Runs and analyzes a Factorio replay for speedrun.com admin stuff. This will install a script into a replay file that logs interesting events.\n" +
      "Running this will launch Factorio in a isolated instance; YOU WILL THEN NEED TO MANUALLY START the replay (and not continue the save)!\n" +
      "A log file then be outputted to (by default) ./output/<file-name>-replay.log\n",
  )
  .version(packageJson.version)
  .argument("<save-file>", "Path to the save file")
  .option(
    "-l, --log-name <name>",
    'Output log file name. Defaults to save file name + "-replay.log"',
  )
  .option(
    "-o, --out <dir>",
    "Output directory. Will create subdirectories /output for log files, and /instances for Factorio data directories",
    ".",
  )
  .option(
    "-f, --factorio <path>",
    "Path to a Factorio executable. Can be specified multiple times for multiple factorio versions. " +
      "The first executable with a version matching the save file will be used. This takes precedence over autodetected versions.",
    (value: string, previous: string[]) => previous.concat(value),
  )
  .option("--no-autodetect", "Do not try to autodetect Factorio executables")
  .option("--allow-any-mods", "Allow any set of mods enabled in save", false)
  .option("--allow-not-freeplay", "Allow non-freeplay scenario", false)
  .argument("[factorio args...]", "Additional arguments to pass to factorio")
  .passThroughOptions()
  .showHelpAfterError()
  .showSuggestionAfterError()
  .action((saveFile, factorioArgs, options) =>
    cliMain(
      options.factorio ?? [],
      options.autodetect,
      path.resolve(options.out),
      options.logName,
      path.resolve(saveFile),
      factorioArgs,
      options.allowAnyMods,
      options.allowNotFreeplay,
    ),
  )
