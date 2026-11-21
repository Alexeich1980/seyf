# Offline loyalty barcode distributions

No CDN, runtime fetch, telemetry, native barcode service or package.json change.

- ZXing JS `@zxing/library@0.21.3`, upstream `umd/index.min.js` from the npm package.
  Source: https://github.com/zxing-js/library/tree/v0.21.3
  License: Apache-2.0, full upstream LICENSE retained as ZXING-LICENSE (including upstream notices).
  Upstream SHA-256: d7cc8f69dd70bdcf3ac00c9ae572bf2acb9f4132ba379c72df842e4db918652d.
  Modification: lexical CommonJS module/exports shim and ES default export only.
  Includes ts-custom-error (MIT); license retained as TS-CUSTOM-ERROR-LICENSE.
- JsBarcode `jsbarcode@3.12.1`, upstream `dist/JsBarcode.all.min.js` from npm.
  Source: https://github.com/lindell/JsBarcode/tree/v3.12.1
  License: MIT, full upstream MIT-LICENSE.txt retained as JSBARCODE-LICENSE.
  Upstream SHA-256: 9c6d079b69a763191e38de8f3d69a252cb2413ea8f35af15478a5a870c7edfa2.
  Modification: lexical empty window shim and ES default export only; no global assignment.

ZXing draws QR and decodes all supported formats. JsBarcode encodes EAN13, EAN8,
UPC-A and Code128. loyalty.js converts encoded modules to canvas pixels with quiet
zones; exactly those pixels are decoded by the real ZXing decoder in tests.
Codes are explicit, never inferred from manually entered card numbers.

Targeted checks from mobile root:

    node --test tests/loyalty.test.mjs tests/loyalty-ui.test.mjs

UI tests use installed Edge through existing puppeteer-core. Override executable
with LOYALTY_BROWSER. Test browser uses a fresh temporary profile and synthetic cards.
Device camera quality, native brightness and installed APK are parent/device QA.
