// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    // server/ (Cloudflare Worker) 와 firmware/ (ESP32) 는 앱 lint 대상이 아니다.
    // Worker 는 자체 런타임/규칙을 가지며, firmware 는 C/C++ 이다.
    ignores: ["dist/*", "server/**", "firmware/**", "scripts/**"],
  }
]);
