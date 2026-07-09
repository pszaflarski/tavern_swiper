const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Config plugin to fix modular headers for Google Sign-In's Swift dependencies.
 *
 * The Swift pod `AppCheckCore` depends on `GoogleUtilities` and `RecaptchaInterop`,
 * which don't define modules. This plugin enables modular headers for those pods
 * so they can be imported from Swift when building as static libraries.
 */
module.exports = function withGoogleSignInModularHeaders(config) {
  return withDangerousMod(config, [
    "ios",
    async (config) => {
      const podfilePath = path.join(
        config.modRequest.platformProjectRoot,
        "Podfile"
      );
      let podfile = fs.readFileSync(podfilePath, "utf-8");

      // Add modular headers for the pods that need them
      const marker = "use_expo_modules!";
      const markerIndex = podfile.indexOf(marker);

      if (markerIndex !== -1) {
        const insertPoint = podfile.indexOf("\n", markerIndex) + 1;
        const addition = [
          "",
          "  # Fix: Enable modular headers for Google Sign-In Swift dependencies",
          "  pod 'GoogleUtilities', :modular_headers => true",
          "  pod 'RecaptchaInterop', :modular_headers => true",
          "",
        ].join("\n");
        podfile =
          podfile.slice(0, insertPoint) +
          addition +
          podfile.slice(insertPoint);
        fs.writeFileSync(podfilePath, podfile);
      }

      return config;
    },
  ]);
};
