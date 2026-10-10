import { preloadAuthenticatedViews } from '@/router';

let viewsScheduled = false;

function whenIdle(task: () => void, timeout: number): void {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(task, { timeout });
    return;
  }
  globalThis.setTimeout(task, Math.min(timeout, 800));
}

/** 首屏完成后分两批预取登录区页面；开启节省流量时尊重浏览器设置。 */
export function scheduleAppPreload(warmSharedData: () => Promise<void>): void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return;
  const preloadViews = !viewsScheduled;
  viewsScheduled = true;

  whenIdle(() => {
    const tasks: Promise<unknown>[] = [warmSharedData()];
    if (preloadViews) tasks.push(preloadAuthenticatedViews('primary'));
    void Promise.allSettled(tasks).then(() => {
      if (preloadViews) whenIdle(() => { void preloadAuthenticatedViews('secondary'); }, 4_000);
    });
  }, 2_000);
}
