'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLatestRecognition, abortableDelay } = require('../recognition-task.cjs');

test('新尺码请求中止旧请求，旧finally不会清空新任务，后续识别仍正常', async () => {
  const run = createLatestRecognition();
  const signals = [];
  const pending = controller => {
    signals.push(controller.signal);
    return abortableDelay(10000, controller.signal);
  };
  const first = run(pending);
  const firstCanceled = assert.rejects(first, error => error.code === 'SIZE_REPLACED');
  await new Promise(resolve => setImmediate(resolve));
  const second = run(pending);
  const secondCanceled = assert.rejects(second, error => error.code === 'SIZE_REPLACED');
  await firstCanceled;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(signals[0].aborted, true);
  const third = run(async () => '最新的六行七列结果');
  assert.equal(await third, '最新的六行七列结果');
  await secondCanceled;
  assert.equal(signals[1].aborted, true);
  assert.equal(await run(async () => '下一次识别'), '下一次识别');
});

test('受控mock延迟会随取消终止，不再等完整三秒', async () => {
  const controller = new AbortController();
  const waiting = abortableDelay(3000, controller.signal);
  controller.abort(new Error('项目切换'));
  await assert.rejects(waiting, /项目切换/);
  await abortableDelay(1);
});
