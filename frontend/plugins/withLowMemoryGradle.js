const { withGradleProperties } = require("@expo/config-plugins");

/**
 * Config plugin to optimize Gradle build settings for low-memory environments.
 *
 * On machines with ≤8GB RAM, the default parallel Gradle execution with multiple
 * CMake workers causes OOM kills during native module compilation (react-native-worklets,
 * react-native-screens, expo-modules-core).
 *
 * This plugin patches android/gradle.properties after prebuild to:
 * - Disable parallel Gradle execution
 * - Limit Gradle workers to 1
 * - Cap JVM heap at 2GB
 * - Enable configure-on-demand for faster configuration phase
 */
module.exports = function withLowMemoryGradle(config) {
  return withGradleProperties(config, (config) => {
    const propertiesToSet = {
      "org.gradle.jvmargs": "-Xmx2048m -XX:MaxMetaspaceSize=512m",
      "org.gradle.parallel": "false",
      "org.gradle.workers.max": "1",
      "android.nativeCompilationParallelism": "1",
    };

    for (const [key, value] of Object.entries(propertiesToSet)) {
      // Remove existing entry if present
      config.modResults = config.modResults.filter(
        (item) => !(item.type === "property" && item.key === key)
      );
      // Add the new entry
      config.modResults.push({
        type: "property",
        key,
        value,
      });
    }

    return config;
  });
};
