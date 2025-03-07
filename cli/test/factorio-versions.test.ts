import { expect, test } from "bun:test"
import { createTestScript } from "./test-utils.ts"
import {
  findFactorioMatchingVersion,
  tryGetFactorioVersion,
} from "../src/factorio-versions.ts"

test("tryGetFactorioVersion", async () => {
  const fakeFactorio = await createTestScript(`
  #!/usr/bin/env sh
echo Version: 1.3.2
echo 64
  `)
  const version = await tryGetFactorioVersion(fakeFactorio)
  expect(version).toEqual("1.3.2")
})

test("findFactorioVersion", async () => {
  const f1 = await createTestScript(
    `
#!/usr/bin/env sh
echo Version: 1.0.1
`,
    "factorio1",
  )
  const f2 = await createTestScript(
    `
#!/usr/bin/env sh
echo Version: 1.0.2
`,
    "factorio2",
  )

  const path = await findFactorioMatchingVersion([f1, f2], false, "1.0.2")
  expect(path).toEqual(f2)
})
