// Dedicated-worker timers for the chat poll.
//
// Browsers heavily throttle main-thread timers in background tabs (Chrome
// wakes chained timers only about once a minute after a tab has been hidden
// for five minutes). Timers inside a dedicated worker keep their cadence, so
// new-chat alerts still arrive promptly while the dashboard is in the
// background. The worker only counts time; all requests stay on the page.
const timers = new Map();

self.addEventListener("message", (event) => {
  const { type, id, delay } = event.data || {};

  if (type === "set") {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        self.postMessage({ type: "fire", id });
      }, Math.max(0, Number(delay) || 0))
    );
    return;
  }

  if (type === "clear") {
    clearTimeout(timers.get(id));
    timers.delete(id);
  }
});
