const { withGradleProperties } = require("@expo/config-plugins");
const os = require("os");

/**
 * Config plugin to optimize Gradle build settings dynamically based on system memory and CPU cores.
 *
 * On lower-RAM environments (e.g. <= 8GB), it limits parallel builds to prevent Out Of Memory (OOM) kills.
 * On high-spec environments (e.g. 64GB RAM, 8+ cores), it enables parallel building, raises Gradle JVM heap,
 * and scales up workers to fully utilize available resources for maximum build speed.
 */
module.exports = function withOptimizedGradle(config) {
  return withGradleProperties(config, (config) => {
    // Default to low-memory settings (safer default for smaller machines and CI)
    let heapSize = "2048m";
    let metaspaceSize = "512m";
    let parallel = "false";
    let workers = "1";
    let nativeCompilationParallelism = "1";

    // Opt-in to hardware-optimized settings via environment variable
    if (process.env.HIGH_PERFORMANCE_BUILD === "true") {
      const totalMemGb = os.totalmem() / (1024 * 1024 * 1024);
      const cpuCores = os.cpus() ? os.cpus().length : 1;

      if (totalMemGb > 30) {
        // High-spec machine (e.g. 64GB RAM, 8+ cores)
        heapSize = "8192m";
        metaspaceSize = "1024m";
        parallel = "true";
        // Save 2 cores for OS/Metro Packager, but use at least 4
        workers = String(Math.max(4, cpuCores - 2));
        nativeCompilationParallelism = String(Math.max(4, cpuCores - 2));
      } else if (totalMemGb > 14) {
        // Mid-spec machine (e.g. 16GB RAM)
        heapSize = "4096m";
        metaspaceSize = "512m";
        parallel = "true";
        workers = String(Math.max(2, Math.floor(cpuCores / 2)));
        nativeCompilationParallelism = String(Math.max(2, Math.floor(cpuCores / 2)));
      }
    }

    const propertiesToSet = {
      "org.gradle.jvmargs": `-Xmx${heapSize} -XX:MaxMetaspaceSize=${metaspaceSize} -XX:+UseG1GC`,
      "org.gradle.parallel": parallel,
      "org.gradle.workers.max": workers,
      "android.nativeCompilationParallelism": nativeCompilationParallelism,
      "org.gradle.caching": "true",
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
