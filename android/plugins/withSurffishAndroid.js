/**
 * Android config for Surffish (runs on every `expo prebuild`):
 * - registers as a browser: VIEW http/https (so it can be the default browser), SEND text/plain
 *   (share a link/text to Surffish), WEB_SEARCH
 * - Mozilla's maven repo for GeckoView
 * - pins androidx.core to 1.18 (GeckoView 158's POM asks for 1.19, which needs compileSdk 37 / AGP 9.1;
 *   GeckoView only uses long-standing core APIs)
 * - arm64-v8a only (GeckoView AAR is per-ABI; arm64 covers current phones)
 */
const { withAndroidManifest, withProjectBuildGradle, withGradleProperties, AndroidConfig } = require('expo/config-plugins')

function addIntentFilters(manifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest)
  activity['intent-filter'] = activity['intent-filter'] ?? []
  const filters = activity['intent-filter']
  const has = (marker) => filters.some((f) => JSON.stringify(f).includes(marker))
  if (!has('"android:scheme":"https"')) {
    filters.push({
      $: { 'android:autoVerify': 'false' },
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      category: [
        { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        { $: { 'android:name': 'android.intent.category.BROWSABLE' } }
      ],
      data: [{ $: { 'android:scheme': 'http' } }, { $: { 'android:scheme': 'https' } }]
    })
  }
  if (!has('android.intent.action.SEND"')) {
    filters.push({
      action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: [{ $: { 'android:mimeType': 'text/plain' } }]
    })
  }
  if (!has('android.intent.action.WEB_SEARCH')) {
    filters.push({
      action: [{ $: { 'android:name': 'android.intent.action.WEB_SEARCH' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }]
    })
  }
  // Browsers: the app should keep one task, new links arrive through onNewIntent.
  activity.$['android:launchMode'] = 'singleTask'
  activity.$['android:windowSoftInputMode'] = 'adjustResize'
  return manifest
}

const GRADLE_MARKER = '// surffish: geckoview repo + androidx.core pin'
const GRADLE_BLOCK = `
${GRADLE_MARKER}
allprojects {
  repositories {
    maven { url 'https://maven.mozilla.org/maven2/' }
  }
  configurations.all {
    resolutionStrategy.eachDependency { details ->
      if (details.requested.group == 'androidx.core' && (details.requested.name == 'core' || details.requested.name == 'core-ktx')) {
        def v = details.requested.version
        if (v != null && (v.startsWith('1.19') || v.startsWith('1.2'))) {
          details.useVersion '1.18.0'
          details.because 'GeckoView asks for 1.19 (needs compileSdk 37 / AGP 9.1); RN 0.86 is on AGP 8.12'
        }
      }
    }
  }
}
`

module.exports = function withSurffishAndroid(config) {
  config = withAndroidManifest(config, (c) => {
    c.modResults = addIntentFilters(c.modResults)
    return c
  })
  config = withProjectBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(GRADLE_MARKER)) c.modResults.contents += GRADLE_BLOCK
    return c
  })
  config = withGradleProperties(config, (c) => {
    const set = (key, value) => {
      const existing = c.modResults.find((p) => p.type === 'property' && p.key === key)
      if (existing) existing.value = value
      else c.modResults.push({ type: 'property', key, value })
    }
    set('reactNativeArchitectures', 'arm64-v8a')
    set('org.gradle.jvmargs', '-Xmx4g -XX:MaxMetaspaceSize=1g -Dfile.encoding=UTF-8')
    return c
  })
  return config
}
