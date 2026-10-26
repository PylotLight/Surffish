import {
  Menu,
  type BaseWindow,
  type MenuItemConstructorOptions,
  type WebContents,
  type WebContentsView,
} from "electron";
import type {
  MiniWindowGrouping,
  MiniWindowSettings,
} from "../../shared/mini-window";

export interface MiniMenuTarget {
  readonly window: BaseWindow;
  readonly closed: boolean;
  readonly menuBar: {
    pinned: boolean;
    menuOpen: boolean;
    menuClosedAt: number;
  } | null;
  readonly header: WebContentsView | null;
  readonly mount: "window" | "panel" | null;
  readonly panel: BaseWindow | null;
}

export interface MiniWindowMenusHost {
  settings(): MiniWindowSettings;
  pageContents(window: BaseWindow): WebContents | null;
  tabCount(target: MiniMenuTarget): number;
  togglePin(target: MiniMenuTarget): void;
  leaveMenuBar(target: MiniMenuTarget, how: "float" | "edge"): void;
  sendToMenuBar(target: MiniMenuTarget): boolean;
  returnAll(target: MiniMenuTarget): boolean;
  closeTab(window: BaseWindow): void;
  openSettings(): void;
  setGrouping(grouping: MiniWindowGrouping): void;
}

const POPOUT_MENU_ESC_GRACE_MS = 250;

export function createMiniWindowMenus(host: MiniWindowMenusHost) {
  let lastPopoutMenu: {
    template: MenuItemConstructorOptions[];
    menu: Electron.Menu;
  } | null = null;

  function popoutMenuJustClosed(target: MiniMenuTarget): boolean {
    return Boolean(
      target.menuBar &&
      (target.menuBar.menuOpen ||
        Date.now() - target.menuBar.menuClosedAt < POPOUT_MENU_ESC_GRACE_MS),
    );
  }

  function popoutMenuTemplate(
    target: MiniMenuTarget,
  ): MenuItemConstructorOptions[] {
    const page = host.pageContents(target.window);
    const many = host.tabCount(target) > 1;
    const settings = host.settings();
    return [
      {
        label: "Back",
        enabled: Boolean(page?.navigationHistory.canGoBack()),
        click: () => {
          if (page && !page.isDestroyed() && page.navigationHistory.canGoBack())
            page.navigationHistory.goBack();
        },
      },
      {
        label: "Reload",
        click: () => {
          if (page && !page.isDestroyed()) page.reload();
        },
      },
      { type: "separator" },
      {
        label: "Pin",
        type: "checkbox",
        checked: target.menuBar?.pinned === true,
        click: () => host.togglePin(target),
      },
      {
        label: "Float as Mini Window",
        click: () => host.leaveMenuBar(target, "float"),
      },
      {
        label: "Move to Edge",
        enabled: settings.tuckToEdge,
        click: () => host.leaveMenuBar(target, "edge"),
      },
      {
        label: many ? "Return All to Window" : "Return to Window",
        click: () => {
          host.returnAll(target);
        },
      },
      {
        label: "Grouping",
        submenu: (
          [
            ["tabs", "Tabs"],
            ["stack", "Stack"],
            ["separate", "Separate"],
          ] as const
        ).map(([value, label]): MenuItemConstructorOptions => ({
          label,
          type: "radio",
          checked: settings.grouping === value,
          click: () => host.setGrouping(value),
        })),
      },
      { type: "separator" },
      { label: "Mini Window Settings…", click: () => host.openSettings() },
    ];
  }

  function showPopoutMenu(
    target: MiniMenuTarget,
    at: { x: number; y: number } | null,
  ): void {
    const bar = target.menuBar;
    if (!bar || target.closed || target.window.isDestroyed()) return;
    const template = popoutMenuTemplate(target);
    const menu = Menu.buildFromTemplate(template);
    lastPopoutMenu = { template, menu };
    bar.menuOpen = true;
    const closed = (): void => {
      bar.menuOpen = false;
      bar.menuClosedAt = Date.now();
      if (lastPopoutMenu?.menu === menu) lastPopoutMenu = null;
      const headerContents = target.header?.webContents;
      if (headerContents && !headerContents.isDestroyed())
        headerContents.send("mini-window:menu-closed");
    };
    menu.popup({
      window: target.window,
      ...(at ? { x: at.x, y: at.y } : {}),
      callback: closed,
    });
  }

  function showMiniMenu(
    target: MiniMenuTarget,
    contents: WebContents | null,
  ): void {
    if (target.closed || target.window.isDestroyed()) return;
    if (target.menuBar && contents) return showPopoutMenu(target, null);
    const menuBarOn = host.settings().menuBarIcon !== "never";
    const count = host.tabCount(target);
    const menu = Menu.buildFromTemplate([
      target.menuBar
        ? {
            label: "Float as Mini Window",
            click: () => host.leaveMenuBar(target, "float"),
          }
        : {
            label: "Send to Menu Bar",
            enabled: menuBarOn,
            click: () => {
              host.sendToMenuBar(target);
            },
          },
      ...(target.menuBar
        ? [
            {
              label: "Pin",
              type: "checkbox" as const,
              checked: target.menuBar.pinned,
              click: () => host.togglePin(target),
            },
            {
              label: "Move to Edge",
              enabled: host.settings().tuckToEdge,
              click: () => host.leaveMenuBar(target, "edge"),
            },
          ]
        : []),
      { type: "separator" },
      {
        label: count > 1 ? "Return All to Browser" : "Return to Browser",
        click: () => {
          host.returnAll(target);
        },
      },
      {
        label: count > 1 ? "Close Tab" : "Close",
        click: () => host.closeTab(target.window),
      },
    ]);
    const window = contents
      ? target.mount === "panel" && target.panel
        ? target.panel
        : target.window
      : undefined;
    menu.popup(window && !window.isDestroyed() ? { window } : {});
  }

  (
    globalThis as { __surffishMiniPopoutMenu?: unknown }
  ).__surffishMiniPopoutMenu = {
    open: () => lastPopoutMenu !== null,
    items: () =>
      (lastPopoutMenu?.template ?? []).map((item) => ({
        label: item.label ?? "",
        type: item.type ?? "normal",
        checked: item.checked === true,
        enabled: item.enabled !== false,
        submenu: Array.isArray(item.submenu)
          ? item.submenu.map((sub) => sub.label ?? "")
          : [],
      })),
    click: (label: string): boolean => {
      const item = lastPopoutMenu?.template.find(
        (candidate) => candidate.label === label,
      );
      const menu = lastPopoutMenu?.menu;
      if (!item?.click || item.enabled === false) return false;
      menu?.closePopup();
      Reflect.apply(item.click, undefined, []);
      return true;
    },
    close: (): void => {
      lastPopoutMenu?.menu.closePopup();
    },
  };

  return { popoutMenuJustClosed, showPopoutMenu, showMiniMenu };
}
