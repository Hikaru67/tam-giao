/* global http, json, output, HELPER_URL, STEP */
// Gọi một bước của helper e2e mobile (apps/mobile/e2e/helper/server.ts) rồi chép kết quả vào `output` cho flow Maestro.
// HELPER_URL truyền bằng `maestro test -e HELPER_URL=...` (run.sh); STEP truyền qua `runScript.env`.
var response = http.post(HELPER_URL + '/steps/' + STEP, {
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
});
if (!response.ok) {
  throw new Error('helper step ' + STEP + ' failed: HTTP ' + response.status + ' ' + response.body);
}
var data = json(response.body);
for (var key in data) {
  output[key] = data[key];
}
