import path from "node:path"
import {
  getEnabledMods,
  launchFactorio,
  setupDataDirWithSave,
} from "./factorio-process.ts"
import { mkDirIfNotExists } from "./utils.ts"
import fs, { type FileHandle } from "node:fs/promises"
import type LineEmitter from "./LineEmitter.ts"
import os from "node:os"
import { Command } from "@commander-js/extra-typings"
import { findFactorioMatchingVersion } from "./factorio-versions.ts"
import JSZip from "jszip"
import {
  freeplayCtrlLua,
  getReplayVersion,
  type SaveInfo,
} from "./replay-file.ts"
import type { WriteStream } from "node:fs"
import packageJson from "../package.json" assert { type: "json" }

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

async function cliMain(
  factorioExecutables: string[],
  includeDefaultFactorioPaths: boolean,
  outputDir: string,
  logFileName: string | undefined,
  saveFileName: string,
  factorioArgs: string[] | undefined = [],
  allowAnyMods: boolean,
  allowNotFreeplay: boolean,
) {
  const saveFile: JSZip = await JSZip.loadAsync(fs.readFile(saveFileName))
  const factorioVersion = await getReplayVersion(saveFile)
  console.log("Factorio version:", factorioVersion)

  const factorioPath = await findFactorioMatchingVersion(
    factorioExecutables,
    includeDefaultFactorioPaths,
    factorioVersion,
  )
  const factorioDataDir = path.join(outputDir, "instances", factorioVersion)
  const saveInfo = await setupDataDirWithSave(factorioDataDir, saveFile)

  if (!allowNotFreeplay) {
    checkIsFreeplay(saveInfo)
  }

  await syncMods(factorioArgs, saveFileName, factorioPath, factorioDataDir)

  if (!allowAnyMods) {
    await checkModsAllowed(factorioDataDir)
  }

  await using outputFile = await setupOutputFile(
    outputDir,
    logFileName,
    saveFileName,
  )

  await launchFactorioReplay(
    factorioPath,
    factorioDataDir,
    factorioArgs,
    outputFile,
  )

  console.log("Done!")
}

function checkIsFreeplay(saveInfo: SaveInfo) {
  if (saveInfo.originalControlLua.trim() !== freeplayCtrlLua.trim()) {
    throw new Error(
      "Save did not use the freeplay scenario! Use --allow-not-freeplay to override this.",
    )
  }
}

async function syncMods(
  factorioArgs: string[] | undefined,
  saveFile: string,
  factorioPath: string,
  factorioDataDir: string,
) {
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
}

const allowedModSets = [
  new Set(["base"]),
  new Set(["base", "space-age", "quality", "elevated-rails"]),
]

async function checkModsAllowed(factorioDataDir: string) {
  const enabledMods = await getEnabledMods(factorioDataDir)
  const valid = allowedModSets.some(
    (set) =>
      set.size === enabledMods.length && enabledMods.every((i) => set.has(i)),
  )
  if (!valid) {
    throw new Error(`
Invalid set of mods enabled!
Enabled mods: ${enabledMods.join(", ")}
Use --allow-any-mods to override this check.
      `)
  }
}

async function setupOutputFile(
  outputDir: string,
  logFileName: string | undefined,
  saveFile: string,
) {
  const logOutputFile = path.join(
    outputDir,
    "output",
    logFileName ?? path.basename(saveFile, ".zip") + "-replay.log",
  )
  console.log("Log output file:", logOutputFile)
  await mkDirIfNotExists(path.dirname(logOutputFile))
  return await fs.open(logOutputFile, "w")
}

async function launchFactorioReplay(
  factorioPath: string,
  factorioDataDir: string,
  factorioArgs: string[],
  outputFile: FileHandle,
) {
  const factorio = launchFactorio(
    factorioPath,
    factorioDataDir,
    factorioArgs,
    true,
  )
  factorio.lineEmitter.on("line", console.log)

  const outStream = outputFile.createWriteStream()
  recordReplayLinesToFile(factorio.lineEmitter, outStream, "REPLAY_SCRIPT:")

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

  const exitCode = await factorio.waitForExit()
  outStream.write("Factorio exited with code: " + exitCode + os.EOL)
  outStream.close()
  if (exitCode !== 0) {
    throw new Error(`Factorio exited with code ${exitCode}`)
  }
}

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
