import { onActivated, onDeactivated } from 'vue';

interface CachedPageOptions {
  refresh?: () => void | Promise<void>;
  deactivate?: () => void;
}

/** KeepAlive 页面恢复滚动位置，并在重新显示时静默刷新。 */
export function useCachedPage(options: CachedPageOptions = {}): void {
  let activated = false;
  let scrollTop = 0;

  onActivated(() => {
    if (!activated) {
      activated = true;
      return;
    }
    window.requestAnimationFrame(() => window.scrollTo({ top: scrollTop }));
    void options.refresh?.();
  });

  onDeactivated(() => {
    scrollTop = window.scrollY;
    options.deactivate?.();
  });
}
