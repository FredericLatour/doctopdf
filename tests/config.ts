import { ConfigProvider, Effect } from 'effect'
import { RenderConfig } from '../src/app/config'

// Exercise the live config layer without reading the developer's environment.
export function testConfig(
  environment: Record<string, string | undefined> = {},
) {
  return Effect.runSync(
    RenderConfig.pipe(
      Effect.provide(RenderConfig.layer),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnvRecord(environment, {
          preserveEmptyStrings: true,
        }),
      ),
    ),
  )
}
