const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withShortCMakePath(config) {
  return withAppBuildGradle(config, (mod) => {
    const marker = 'android {';
    const insertion = `android {
    // Keep generated C++ paths short enough for Windows Ninja builds.
    externalNativeBuild {
        cmake {
            buildStagingDirectory "../../.cxx"
        }
    }`;
    if (!mod.modResults.contents.includes('buildStagingDirectory "../../.cxx"')) {
      if (!mod.modResults.contents.includes(marker)) throw new Error('Android Gradle block not found');
      mod.modResults.contents = mod.modResults.contents.replace(marker, insertion);
    }
    return mod;
  });
};
