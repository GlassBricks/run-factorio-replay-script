import path from "node:path"
import { launchFactorio, setupDataDirWithSave } from "./factorio-process.ts"
import { mkDirIfNotExists } from "./utils.ts"
import fs from "node:fs/promises"
import type LineEmitter from "./LineEmitter.ts"
import os from "node:os"
import { Command } from "@commander-js/extra-typings"
import { findFactorioMatchingVersion } from "./factorio-versions.ts"
import JSZip from "jszip"
import { getReplayVersion } from "./replay-file.ts"

export function recordReplayLinesToFile(
  lineEmitter: LineEmitter,
  outputFile: fs.FileHandle,
  prefix: string,
) {
  const writeStream = outputFile.createWriteStream()
  lineEmitter.on("line", (line) => {
    if (line.startsWith(prefix)) {
      writeStream.write(line.substring(prefix.length).trimStart() + os.EOL)
    }
  })
  return writeStream
}

export async function cliMain(
  factorioExecutables: string[],
  includeDefaultFactorioPaths: boolean,
  outputDir: string,
  outFileName: string | undefined,
  saveFile: string,
  factorioArgs: string[] | undefined,
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
  await setupDataDirWithSave(factorioDataDir, saveZip)

  console.log("Log output file:", logOutputFile)
  await using outputFile = await fs.open(logOutputFile, "w")

  const factorio = launchFactorio(
    factorioPath,
    factorioDataDir,
    factorioArgs,
    true,
  )
  factorio.lineEmitter.on("line", console.log)
  const stream = recordReplayLinesToFile(
    factorio.lineEmitter,
    outputFile,
    "REPLAY_SCRIPT:",
  )
  factorio.closeOnScenarioFinished()
  stream.close()

  await factorio.waitForExit()
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
  .argument("[factorio args...]")
  .passThroughOptions()
  .action((saveFile, args, options) =>
    cliMain(
      options.factorio ?? [],
      options.autodetect,
      path.resolve(options.directory),
      options.out,
      path.resolve(saveFile),
      args,
    ),
  )
