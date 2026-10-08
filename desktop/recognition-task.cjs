'use strict';

/** Call only after payload/config validation, so invalid input cannot cancel valid work. */
function createLatestRecognition() {
  let current;
  return async operation => {
    const previous = current;
    const controller = new AbortController();
    current = controller;
    if (previous) {
      const replaced = new Error('已开始新的尺码识别，旧请求已停止。');
      replaced.code = 'SIZE_REPLACED';
      previous.abort(replaced);
    }
    let onAbort;
    const canceled = new Promise((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason || new Error('尺码识别已停止。'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return operation(controller);
      }), canceled]);
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
      if (current === controller) current = undefined;
    }
  };
}

function abortableDelay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal.reason || new Error('请求已停止。')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

module.exports = { createLatestRecognition, abortableDelay };
