import assert from 'node:assert/strict';
import { BeeOSClient } from '@beeos-ai/sdk';

const client = new BeeOSClient();
const instance = client.instance(process.env.BEEOS_INSTANCE_ID);
const mobile = instance.mobile;
const ready = await mobile.waitReady({ timeoutMs: 30_000 });
for (const action of ['screenshot', 'ui_tree', 'list_apps']) {
  assert.ok(ready.data.supportedActions.includes(action), `Unsupported capability: ${action}`);
}
const tree = await mobile.uiTree();
assert.ok(tree.data?.supported && tree.data.content?.trim(), 'UI tree is empty or unsupported');
const apps = await mobile.listApps();
assert.ok(apps.data?.apps?.length, 'App list is empty');
const screenshot = await mobile.screenshot();
assert.ok(screenshot.data?.fileId, 'Screenshot has no file ID');
const bytes = await client.files.download(screenshot.data.fileId, { maxBytes: 8 * 1024 * 1024 });
const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
const png = Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
assert.ok(bytes.length > 100 && (jpeg || png), 'Downloaded screenshot is not a PNG/JPEG');
console.log(JSON.stringify({ sdk: 'typescript', ok: true, instanceId: instance.id,
  checks: ['ready', 'ui_tree', 'list_apps', 'screenshot', 'authorized_file_download', 'image_magic'],
  appCount: apps.data.apps.length, screenshotBytes: bytes.length }, null, 2));
