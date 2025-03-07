import child_process from "node:child_process"
import * as async from "async"

export async function tryGetFactorioVersion(
  executable: string,
): Promise<string | undefined> {
  // run with --version
  try {
    const output = child_process.spawnSync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 1000,
      shell: true,
    }).stdout
    const match = output.match(/Version: (\d+\.\d+\.\d+)/)
    if (match && match[1]) {
      return match[1]
    }
  } catch (e) {
    // console.debug(e)
    return undefined
  }
}

export function defaultFactorioLookupPaths(
  osPlatform: NodeJS.Platform = process.platform,
): string[] {
  if (osPlatform === "linux" || osPlatform === "darwin") {
    return [
      "factorio",
      "~/.local/share/Steam/steamapps/common/Factorio/bin/x64/factorio",
      "~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio",
      "~/.factorio/bin/x64/factorio",
      "/Applications/factorio.app/Contents/MacOS/factorio",
      "/usr/share/factorio/bin/x64/factorio",
      "/usr/share/games/factorio/bin/x64/factorio",
    ]
  } else if (osPlatform === "win32") {
    return [
      "factorio.exe",
      process.env["ProgramFiles(x86)"] +
        "\\Steam\\steamapps\\common\\Factorio\\bin\\x64\\factorio.exe",
      process.env["ProgramFiles"] + "\\Factorio\\bin\\x64\\factorio.exe",
    ]
  }
  // weird platform?
  return []
}

export async function findFactorioMatchingVersion(
  userProvidedExecutables: string[],
  includeDefault: boolean,
  version: string,
): Promise<string> {
  if (includeDefault) {
    userProvidedExecutables = userProvidedExecutables.concat(
      defaultFactorioLookupPaths(),
    )
  }
  const result: string | undefined = await async.findSeries(
    userProvidedExecutables,
    async (e) => (await tryGetFactorioVersion(e)) === version,
  )
  if (result == undefined) {
    throw new Error(
      `Could not find Factorio executable with version ${version}. Tried:\n${userProvidedExecutables.join("\n")}`,
    )
  }
  return result
}
