import { contextBridge, ipcRenderer } from "electron";
import type {
  BrowserSiteSettings,
  BrowserSettingsTarget,
  BramblePopupAnchor,
  BrambleExtensionState,
  BrowserBounds,
  BrowserChromeMetrics,
  BrowserChromeState,
  BrowserFindState,
  BrowserPreferencesSnapshot,
  BrowserProxySettings,
  BrowserProxyTestResult,
  BrowserState,
  BrowserUiFont,
  BrowserTabSummary,
  BrowsingHistoryEntry,
  DefaultBrowserStatus,
  NewTabBackground,
  NewTabBackgroundRefreshResult,
  NewTabPageId,
  NewTabPreferences,
  NewTabWeatherSnapshot,
  WeatherKeyStatus,
  WeatherPlace,
  WeatherProviderId,
  OpenMeteoModelId,
  WeatherResult,
  PinnedSite,
  NetworkRequestDetails,
  NetworkRequestSummary,
  NetworkResponseBody,
  SearchEngineId,
  TabSleepMinutes,
  WebStoreExtensionsState,
} from "../shared/types";
import type {
  NetworkHelperStatus,
  NetworkHelperUsage,
} from "../shared/network-helper";
import type { DownloadEntry } from "../shared/downloads";
import type {
  BrambleQuickUnlockEnrolInput,
  BrambleQuickUnlockRequireMasterInput,
  BrambleQuickUnlockState,
  QuickUnlockResult,
} from "../shared/bramble-quick-unlock";
import type { NavigateResult } from "../shared/navigation-errors";
import type { SpellcheckSettings } from "../shared/spellcheck";
import type { ProxyGuardStatus } from "../shared/proxy-guard";
import type {
  ClearBrowsingDataOptions,
  ClearBrowsingDataResult,
  CookieSiteSummary,
  SiteDataSummary,
} from "../shared/browsing-data";

interface SpellcheckState {
  settings: SpellcheckSettings;
  available: string[];
  active: string[];
  osManagedLanguages: boolean;
}
interface HttpsOnlyState {
  enabled: boolean;
  exceptions: string[];
}
import type { UpdateSettingsResult, UpdateState } from "../shared/update-feed";
import type {
  CommandPaletteOpenRequest,
  CommandPaletteSettings,
  CommandPaletteSnapshot,
} from "../shared/command-palette";
import type {
  CustomSearchEngine,
  CustomSearchEnginesResult,
} from "../shared/search-keywords";
import type { DiagnosticsPayload } from "../shared/diagnostics";

type DiagnosticsUpdate = DiagnosticsPayload | null;
import { bookmarksApi } from "./bookmarks";
import { tabArchiveApi } from "./tab-archive";
import { memorySaverApi } from "./memory-saver";
import { preconnectApi } from "./preconnect";
import { wakeSnapshotApi } from "./wake-snapshot";
import { networkToolsApi, proxyRoutingApi } from "./network-tools";
import { splitViewApi } from "./split-view";
import { spacesApi } from "./spaces";
import { sidebarBackdropApi } from "./sidebar-backdrop";
import { tabGroupsApi } from "./tab-groups";
import { tabSelectionApi } from "./tab-selection";
import { watchersApi } from "./watchers";
import { feedsApi } from "./feeds";
import { readingListApi } from "./reading-list";
import { adblockApi } from "./adblock";
import { glanceApi } from "./glance-settings";
import { miniWindowApi } from "./mini-window-settings";
import { localAIApi } from "./local-ai-settings";
import { readAloudApi } from "./read-aloud";
import { castApi } from "./cast";
import { onTabsChange } from "./tab-sync";
import { POPOVER_DISMISS_CHANNEL } from "../shared/popover-dismiss";
import type { SiteCertificateInfo } from "../shared/certificates";
import type {
  BrowserNavHistoryMenu,
  NavHistoryDirection,
  NavHistoryOpenDisposition,
} from "../shared/nav-history-menu";

const api = {
  platform: process.platform,
  browser: {
    quit: (): Promise<void> => ipcRenderer.invoke("app:quit"),
    windowControl: (
      action: "close" | "minimize" | "toggle-zoom",
    ): Promise<boolean> => ipcRenderer.invoke("app:window-control", action),
    translation: {
      getTarget: (): Promise<string> =>
        ipcRenderer.invoke("browser:translation:get-target"),
      setTarget: (target: string): Promise<string> =>
        ipcRenderer.invoke("browser:translation:set-target", target),
      page: (target?: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:translation:page", target),
      text: (text: string, target?: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:translation:text", text, target),
      onTargetChange: (callback: (target: string) => void): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          target: string,
        ): void => callback(target);
        ipcRenderer.on("browser:translation-target-changed", listener);
        return () =>
          ipcRenderer.removeListener(
            "browser:translation-target-changed",
            listener,
          );
      },
    },
    state: (): Promise<BrowserState> => ipcRenderer.invoke("browser:state"),
    preferences: {
      get: (): Promise<BrowserPreferencesSnapshot> =>
        ipcRenderer.invoke("browser:preferences:get"),
      onChange: (
        callback: (preferences: BrowserPreferencesSnapshot) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          preferences: BrowserPreferencesSnapshot,
        ): void => callback(preferences);
        ipcRenderer.on("browser:preferences-changed", listener);
        return () =>
          ipcRenderer.removeListener("browser:preferences-changed", listener);
      },
    },
    siteIcons: {
      get: (origins: string[]): Promise<Record<string, string>> =>
        ipcRenderer.invoke("browser:site-icons:get", origins),
      onChange: (
        callback: (payload: { origin: string; faviconUrl: string }) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          payload: { origin: string; faviconUrl: string },
        ): void => callback(payload);
        ipcRenderer.on("browser:site-icon:changed", listener);
        return () =>
          ipcRenderer.removeListener("browser:site-icon:changed", listener);
      },
    },
    uiFont: {
      set: (font: BrowserUiFont): Promise<BrowserUiFont | null> =>
        ipcRenderer.invoke("browser:ui-font:set", font),
    },
    sidebarWidth: {
      set: (width: number): Promise<number> =>
        ipcRenderer.invoke("browser:sidebar-width:set", width),
    },
    chrome: {
      get: (): Promise<BrowserChromeState> =>
        ipcRenderer.invoke("browser:chrome:get"),
      set: (state: Partial<BrowserChromeState>): Promise<BrowserChromeState> =>
        ipcRenderer.invoke("browser:chrome:set", state),
      reportMetrics: (
        metrics: BrowserChromeMetrics,
      ): Promise<BrowserChromeMetrics> =>
        ipcRenderer.invoke("browser:chrome:metrics", metrics),
      onChange: (
        callback: (state: BrowserChromeState) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          state: BrowserChromeState,
        ): void => callback(state);
        ipcRenderer.on("browser:chrome-state", listener);
        return () =>
          ipcRenderer.removeListener("browser:chrome-state", listener);
      },
    },
    navigate: (
      input: string,
      engine?: SearchEngineId,
    ): Promise<NavigateResult> =>
      ipcRenderer.invoke("browser:navigate", input, engine),
    setSearchEngine: (engine: SearchEngineId): Promise<void> =>
      ipcRenderer.invoke("browser:search-engine:set", engine),
    getSearchEngine: (): Promise<SearchEngineId> =>
      ipcRenderer.invoke("browser:search-engine:get"),
    defaultBrowser: {
      get: (): Promise<DefaultBrowserStatus> =>
        ipcRenderer.invoke("browser:default-browser:get"),
      set: (): Promise<DefaultBrowserStatus> =>
        ipcRenderer.invoke("browser:default-browser:set"),
    },
    updates: {
      get: (): Promise<UpdateState> =>
        ipcRenderer.invoke("browser:updates:get"),
      check: (): Promise<UpdateState> =>
        ipcRenderer.invoke("browser:updates:check"),
      skip: (version: string): Promise<UpdateState> =>
        ipcRenderer.invoke("browser:updates:skip", version),
      remindLater: (): Promise<UpdateState> =>
        ipcRenderer.invoke("browser:updates:remind-later"),
      setSettings: (settings: {
        feedUrl?: string;
        betaChannel?: boolean;
      }): Promise<UpdateSettingsResult> =>
        ipcRenderer.invoke("browser:updates:settings:set", settings),
      download: (): Promise<UpdateState> =>
        ipcRenderer.invoke("browser:updates:download"),
      openInstaller: (): Promise<boolean> =>
        ipcRenderer.invoke("browser:updates:open-installer"),
      revealDownload: (): Promise<boolean> =>
        ipcRenderer.invoke("browser:updates:reveal-download"),
      revealSettings: (): Promise<void> =>
        ipcRenderer.invoke("browser:updates:reveal-settings"),
      onChange: (callback: (state: UpdateState) => void): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          state: UpdateState,
        ): void => callback(state);
        ipcRenderer.on("browser:updates:changed", listener);
        return () =>
          ipcRenderer.removeListener("browser:updates:changed", listener);
      },
      onReveal: (callback: () => void): (() => void) => {
        const listener = (): void => callback();
        ipcRenderer.on("browser:updates:reveal", listener);
        return () =>
          ipcRenderer.removeListener("browser:updates:reveal", listener);
      },
    },
    setTabSleepMinutes: (
      minutes: TabSleepMinutes,
    ): Promise<TabSleepMinutes | null> =>
      ipcRenderer.invoke("browser:tab-sleep:set", minutes),
    newTabPage: {
      set: (page: NewTabPageId): Promise<NewTabPageId | null> =>
        ipcRenderer.invoke("browser:new-tab-page:set", page),
    },
    newTabPreferences: {
      set: (
        preferences: NewTabPreferences,
      ): Promise<NewTabPreferences | null> =>
        ipcRenderer.invoke("browser:new-tab-preferences:set", preferences),
    },
    newTabWeather: {
      get: (request: {
        provider: WeatherProviderId;
        model?: OpenMeteoModelId;
        place: WeatherPlace | null;
        location: string;
        daily?: boolean;
      }): Promise<WeatherResult<NewTabWeatherSnapshot>> =>
        ipcRenderer.invoke("browser:new-tab-weather:get", request),
      search: (query: string): Promise<WeatherResult<WeatherPlace[]>> =>
        ipcRenderer.invoke("browser:new-tab-weather:search", query),
      locate: (): Promise<WeatherResult<WeatherPlace>> =>
        ipcRenderer.invoke("browser:new-tab-weather:locate"),
      keys: (): Promise<WeatherKeyStatus> =>
        ipcRenderer.invoke("browser:new-tab-weather:keys:get"),
      setKey: (
        provider: WeatherProviderId,
        key: string,
      ): Promise<WeatherResult<WeatherKeyStatus>> =>
        ipcRenderer.invoke("browser:new-tab-weather:keys:set", provider, key),
    },
    newTabBackgrounds: {
      get: (): Promise<NewTabBackground[]> =>
        ipcRenderer.invoke("browser:new-tab-backgrounds:get"),
      refresh: (): Promise<NewTabBackgroundRefreshResult> =>
        ipcRenderer.invoke("browser:new-tab-backgrounds:refresh"),
      onChange: (
        callback: (backgrounds: NewTabBackground[]) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          backgrounds: NewTabBackground[],
        ): void => callback(backgrounds);
        ipcRenderer.on("browser:new-tab-backgrounds:changed", listener);
        return () =>
          ipcRenderer.removeListener(
            "browser:new-tab-backgrounds:changed",
            listener,
          );
      },
    },
    pinnedSites: {
      get: (): Promise<PinnedSite[]> =>
        ipcRenderer.invoke("browser:pinned-sites:get"),
      set: (sites: PinnedSite[]): Promise<PinnedSite[]> =>
        ipcRenderer.invoke("browser:pinned-sites:set", sites),
    },
    bookmarks: bookmarksApi,
    tabArchive: tabArchiveApi,
    memorySaver: memorySaverApi,
    preconnect: preconnectApi,
    wakeSnapshot: wakeSnapshotApi,
    watchers: watchersApi,
    feeds: feedsApi,
    readingList: readingListApi,
    adblock: adblockApi,
    glance: glanceApi,
    miniWindow: miniWindowApi,
    localAI: localAIApi,
    readAloud: readAloudApi,
    cast: castApi,
    siteSettings: {
      get: (origin: string): Promise<BrowserSiteSettings | null> =>
        ipcRenderer.invoke("browser:site-settings:get", origin),
      set: (
        origin: string,
        settings: BrowserSiteSettings,
      ): Promise<BrowserSiteSettings | null> =>
        ipcRenderer.invoke("browser:site-settings:set", origin, settings),
      /** Sites with saved overrides (Settings → Sites), most recently changed last. */
      list: (): Promise<BrowserSiteSettings[]> =>
        ipcRenderer.invoke("browser:site-settings:list"),
    },
    /** Settings tab: focus or open it at a section (and, for Sites, a site). Resolves to its tab id. */
    settings: {
      open: (
        target: BrowserSettingsTarget = { section: "settings" },
      ): Promise<string | null> =>
        ipcRenderer.invoke("browser:settings:open", target),
    },
    pictureInPicture: (): Promise<boolean> =>
      ipcRenderer.invoke("browser:picture-in-picture"),
    /** Main saw a press on the page/sidebar view or the window blur: close toolbar popovers (shared/popover-dismiss.ts). */
    onDismissPopovers: (callback: (reason?: string) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        reason?: string,
      ): void => callback(reason);
      ipcRenderer.on(POPOVER_DISMISS_CHANNEL, listener);
      return () =>
        ipcRenderer.removeListener(POPOVER_DISMISS_CHANNEL, listener);
    },
    zoom: (action: "in" | "out" | "reset"): Promise<void> =>
      ipcRenderer.invoke("browser:zoom", action),
    find: {
      get: (): Promise<BrowserFindState> =>
        ipcRenderer.invoke("browser:find:get"),
      query: (text: string): Promise<void> =>
        ipcRenderer.invoke("browser:find:query", text),
      step: (forward: boolean): Promise<void> =>
        ipcRenderer.invoke("browser:find:step", forward),
      close: (): Promise<void> => ipcRenderer.invoke("browser:find:close"),
      onChange: (callback: (state: BrowserFindState) => void): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          state: BrowserFindState,
        ): void => callback(state);
        ipcRenderer.on("browser:find", listener);
        return () => ipcRenderer.removeListener("browser:find", listener);
      },
      onFocus: (callback: () => void): (() => void) => {
        const listener = (): void => callback();
        ipcRenderer.on("browser:find:focus", listener);
        return () => ipcRenderer.removeListener("browser:find:focus", listener);
      },
    },
    back: (): Promise<void> => ipcRenderer.invoke("browser:back"),
    dismissLoadError: (): Promise<boolean> =>
      ipcRenderer.invoke("browser:load-error:dismiss"),
    certificate: {
      info: (): Promise<SiteCertificateInfo | null> =>
        ipcRenderer.invoke("browser:certificate:info"),
      proceed: (): Promise<boolean> =>
        ipcRenderer.invoke("browser:certificate:proceed"),
      showNative: (): Promise<boolean> =>
        ipcRenderer.invoke("browser:certificate:show-native"),
    },
    forward: (): Promise<void> => ipcRenderer.invoke("browser:forward"),
    /** The Back/Forward press-and-hold menu: the active tab's history entries in one direction, and going to one. */
    navHistory: {
      list: (direction: NavHistoryDirection): Promise<BrowserNavHistoryMenu> =>
        ipcRenderer.invoke("browser:nav-history:list", direction),
      go: (
        index: number,
        disposition: NavHistoryOpenDisposition = "current",
      ): Promise<boolean> =>
        ipcRenderer.invoke("browser:nav-history:go", index, disposition),
    },
    reload: (): Promise<void> => ipcRenderer.invoke("browser:reload"),
    stop: (): Promise<void> => ipcRenderer.invoke("browser:stop"),
    /** Edit PDF on a PDF tab, Back to Viewer in the editor. */
    togglePdfEditor: (): Promise<boolean> =>
      ipcRenderer.invoke("browser:pdf-editor:toggle"),
    toggleReader: (): Promise<boolean> =>
      ipcRenderer.invoke("browser:reader:toggle"),
    setBounds: (bounds: BrowserBounds): Promise<void> =>
      ipcRenderer.invoke("browser:set-bounds", bounds),
    tabs: {
      get: (): Promise<BrowserTabSummary[]> =>
        ipcRenderer.invoke("browser:tabs:get"),
      create: (
        input?: string,
        engine?: SearchEngineId,
      ): Promise<string | null> =>
        ipcRenderer.invoke("browser:tabs:new", input, engine),
      createPrivate: (input?: string): Promise<string | null> =>
        ipcRenderer.invoke("browser:tabs:new-private", input),
      activate: (id: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:tabs:activate", id),
      close: (id: string): Promise<void> =>
        ipcRenderer.invoke("browser:tabs:close", id),
      move: (id: string, beforeId: string | null): Promise<boolean> =>
        ipcRenderer.invoke("browser:tabs:move", id, beforeId),
      /** A sidebar drag ended outside the list: main moves the tab to the window under the pointer, or a new one. */
      dropOutside: (id: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:tabs:drop-outside", id),
      /** A sidebar drag is outside the window (id) or no longer is (null): mini windows under the pointer show a drop slot. */
      dragOutside: (id: string | null): void =>
        ipcRenderer.send("browser:tabs:drag-outside", id),
      /** Another window's tab (a mini window chip) is dragged over this sidebar: where it would land (null: no hint). */
      onExternalDrop: (
        callback: (hint: { beforeId: string | null } | null) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          hint: { beforeId: string | null } | null,
        ) => callback(hint);
        ipcRenderer.on("browser:tabs:external-drop", listener);
        return () =>
          ipcRenderer.removeListener("browser:tabs:external-drop", listener);
      },
      moveToNewWindow: (id: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:tabs:move-to-new-window", id),
      newWindow: (isPrivate = false): Promise<boolean> =>
        ipcRenderer.invoke("browser:windows:new", isPrivate),
      setMuted: (id: string, muted: boolean): Promise<boolean> =>
        ipcRenderer.invoke("browser:tabs:mute", id, muted),
      /** Tab volume 0..1 (remembered for the tab's site). */
      setVolume: (id: string, volume: number): Promise<boolean> =>
        ipcRenderer.invoke("browser:tabs:volume", id, volume),
      onChange: (callback: (tabs: BrowserTabSummary[]) => void): (() => void) =>
        onTabsChange(callback),
    },
    /** Settings → Privacy → Tab volume: levels remembered per site. */
    siteVolume: {
      list: (): Promise<Array<{ origin: string; volume: number }>> =>
        ipcRenderer.invoke("browser:site-volume:list"),
      /** Forget one site's level (null = every site); open tabs there go back to 100%. */
      reset: (
        origin: string | null,
      ): Promise<Array<{ origin: string; volume: number }>> =>
        ipcRenderer.invoke("browser:site-volume:reset", origin),
    },
    split: splitViewApi,
    spaces: spacesApi,
    sidebarBackdrop: sidebarBackdropApi,
    tabGroups: tabGroupsApi,
    tabSelection: tabSelectionApi,
    session: {
      clear: (): Promise<boolean> =>
        ipcRenderer.invoke("browser:session:clear"),
    },
    history: {
      get: (): Promise<BrowsingHistoryEntry[]> =>
        ipcRenderer.invoke("browser:history:get"),
      clear: (): Promise<void> => ipcRenderer.invoke("browser:history:clear"),
      onChange: (callback: () => void): (() => void) => {
        const listener = (): void => callback();
        ipcRenderer.on("browser:history-changed", listener);
        return () =>
          ipcRenderer.removeListener("browser:history-changed", listener);
      },
    },
    onState: (callback: (state: BrowserState) => void): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        state: BrowserState,
      ): void => callback(state);
      ipcRenderer.on("browser:state", listener);
      return () => ipcRenderer.removeListener("browser:state", listener);
    },
    onFocusAddress: (callback: () => void): (() => void) => {
      const listener = (): void => callback();
      ipcRenderer.on("browser:focus-address", listener);
      return () =>
        ipcRenderer.removeListener("browser:focus-address", listener);
    },
    /** Safety pack: tab recovery, spellcheck, privacy / site data, HTTPS-only, proxy kill switch. */
    safety: {
      tabRecovery: (
        action: "reload" | "wait" | "kill" | "continue-http" | "back",
      ): Promise<boolean> => ipcRenderer.invoke("browser:tab-recovery", action),
      spellcheck: {
        get: (): Promise<SpellcheckState> =>
          ipcRenderer.invoke("browser:spellcheck:get"),
        set: (settings: SpellcheckSettings): Promise<SpellcheckState> =>
          ipcRenderer.invoke("browser:spellcheck:set", settings),
      },
      httpsOnly: {
        get: (): Promise<HttpsOnlyState> =>
          ipcRenderer.invoke("browser:https-only:get"),
        set: (enabled: boolean): Promise<HttpsOnlyState> =>
          ipcRenderer.invoke("browser:https-only:set", enabled),
        removeException: (host: string): Promise<HttpsOnlyState> =>
          ipcRenderer.invoke("browser:https-only:remove-exception", host),
      },
      proxyGuard: {
        get: (): Promise<ProxyGuardStatus> =>
          ipcRenderer.invoke("browser:proxy-guard:get"),
        set: (killSwitch: boolean): Promise<ProxyGuardStatus> =>
          ipcRenderer.invoke("browser:proxy-guard:set", killSwitch),
        check: (): Promise<ProxyGuardStatus> =>
          ipcRenderer.invoke("browser:proxy-guard:check"),
        onChange: (
          callback: (status: ProxyGuardStatus) => void,
        ): (() => void) => {
          const listener = (
            _event: Electron.IpcRendererEvent,
            status: ProxyGuardStatus,
          ): void => callback(status);
          ipcRenderer.on("browser:proxy-guard:changed", listener);
          return () =>
            ipcRenderer.removeListener("browser:proxy-guard:changed", listener);
        },
      },
      privacy: {
        clear: (
          options: ClearBrowsingDataOptions,
        ): Promise<ClearBrowsingDataResult> =>
          ipcRenderer.invoke("browser:privacy:clear", options),
        cookieSites: (): Promise<CookieSiteSummary[]> =>
          ipcRenderer.invoke("browser:privacy:cookie-sites"),
        deleteCookieSite: (site: string): Promise<CookieSiteSummary[]> =>
          ipcRenderer.invoke("browser:privacy:delete-cookie-site", site),
      },
      siteData: {
        get: (origin: string): Promise<SiteDataSummary | null> =>
          ipcRenderer.invoke("browser:site-data:get", origin),
        forget: (
          origin: string,
          includeHistory: boolean,
        ): Promise<SiteDataSummary | null> =>
          ipcRenderer.invoke(
            "browser:site-data:forget",
            origin,
            includeHistory,
          ),
      },
    },
    proxy: {
      get: (): Promise<BrowserProxySettings> =>
        ipcRenderer.invoke("browser:proxy:get"),
      set: (settings: BrowserProxySettings): Promise<BrowserProxySettings> =>
        ipcRenderer.invoke("browser:proxy:set", settings),
      test: (settings: BrowserProxySettings): Promise<BrowserProxyTestResult> =>
        ipcRenderer.invoke("browser:proxy:test", settings),
      sshHostAliases: (): Promise<string[]> =>
        ipcRenderer.invoke("browser:proxy:ssh-hosts"),
      helper: (): Promise<NetworkHelperStatus> =>
        ipcRenderer.invoke("browser:proxy:helper"),
      helperUsage: (): Promise<NetworkHelperUsage> =>
        ipcRenderer.invoke("browser:proxy:helper-usage"),
      ...proxyRoutingApi,
    },
    downloads: {
      get: (): Promise<DownloadEntry[]> =>
        ipcRenderer.invoke("browser:downloads:get"),
      pause: (id: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:downloads:pause", id),
      resume: (id: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:downloads:resume", id),
      cancel: (id: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:downloads:cancel", id),
      remove: (id: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:downloads:remove", id),
      open: (id: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:downloads:open", id),
      reveal: (id: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:downloads:reveal", id),
      clear: (): Promise<boolean> =>
        ipcRenderer.invoke("browser:downloads:clear"),
      openFolder: (): Promise<boolean> =>
        ipcRenderer.invoke("browser:downloads:open-folder"),
      onChange: (
        callback: (downloads: DownloadEntry[]) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          downloads: DownloadEntry[],
        ): void => callback(downloads);
        ipcRenderer.on("browser:downloads:changed", listener);
        return () =>
          ipcRenderer.removeListener("browser:downloads:changed", listener);
      },
    },
    bramble: {
      get: (): Promise<BrambleExtensionState> =>
        ipcRenderer.invoke("browser:bramble:get"),
      checkForUpdates: (): Promise<BrambleExtensionState> =>
        ipcRenderer.invoke("browser:bramble:check-for-updates"),
      installLatest: (): Promise<BrambleExtensionState> =>
        ipcRenderer.invoke("browser:bramble:install-latest"),
      open: (anchor?: BramblePopupAnchor): Promise<BrambleExtensionState> =>
        ipcRenderer.invoke("browser:bramble:open", anchor),
      /** Where the toolbar's Bramble button sits, so popups Bramble opens itself attach to it. */
      setAnchor: (anchor: BramblePopupAnchor | null): void =>
        ipcRenderer.send("browser:bramble:anchor", anchor),
      setup: (): Promise<BrambleExtensionState> =>
        ipcRenderer.invoke("browser:bramble:setup"),
      onChange: (
        callback: (state: BrambleExtensionState) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          state: BrambleExtensionState,
        ): void => callback(state);
        ipcRenderer.on("browser:bramble:changed", listener);
        return () =>
          ipcRenderer.removeListener("browser:bramble:changed", listener);
      },
      /** Surffish's PIN / Touch ID quick unlock for Bramble (Settings → Integrations). */
      quickUnlock: {
        get: (): Promise<BrambleQuickUnlockState> =>
          ipcRenderer.invoke("browser:bramble:quick-unlock:get"),
        enrol: (
          input: BrambleQuickUnlockEnrolInput,
        ): Promise<QuickUnlockResult> =>
          ipcRenderer.invoke("browser:bramble:quick-unlock:enrol", input),
        disable: (): Promise<QuickUnlockResult> =>
          ipcRenderer.invoke("browser:bramble:quick-unlock:disable"),
        setTouchId: (enabled: boolean): Promise<QuickUnlockResult> =>
          ipcRenderer.invoke(
            "browser:bramble:quick-unlock:set-touch-id",
            enabled,
          ),
        setRequireMaster: (
          input: BrambleQuickUnlockRequireMasterInput,
        ): Promise<QuickUnlockResult> =>
          ipcRenderer.invoke(
            "browser:bramble:quick-unlock:set-require-master",
            input,
          ),
        onChange: (
          callback: (state: BrambleQuickUnlockState) => void,
        ): (() => void) => {
          const listener = (
            _event: Electron.IpcRendererEvent,
            state: BrambleQuickUnlockState,
          ): void => callback(state);
          ipcRenderer.on("browser:bramble:quick-unlock:changed", listener);
          return () =>
            ipcRenderer.removeListener(
              "browser:bramble:quick-unlock:changed",
              listener,
            );
        },
      },
    },
    extensions: {
      get: (): Promise<WebStoreExtensionsState> =>
        ipcRenderer.invoke("browser:extensions:get"),
      install: (input: string): Promise<WebStoreExtensionsState> =>
        ipcRenderer.invoke("browser:extensions:install", input),
      setEnabled: (
        id: string,
        enabled: boolean,
      ): Promise<WebStoreExtensionsState> =>
        ipcRenderer.invoke("browser:extensions:set-enabled", id, enabled),
      uninstall: (id: string): Promise<WebStoreExtensionsState> =>
        ipcRenderer.invoke("browser:extensions:uninstall", id),
      checkForUpdate: (id: string): Promise<WebStoreExtensionsState> =>
        ipcRenderer.invoke("browser:extensions:check-update", id),
      openPopup: (
        id: string,
        anchor?: BramblePopupAnchor,
      ): Promise<WebStoreExtensionsState> =>
        ipcRenderer.invoke("browser:extensions:open-popup", id, anchor),
      openOptions: (id: string): Promise<WebStoreExtensionsState> =>
        ipcRenderer.invoke("browser:extensions:open-options", id),
      onChange: (
        callback: (state: WebStoreExtensionsState) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          state: WebStoreExtensionsState,
        ): void => callback(state);
        ipcRenderer.on("browser:extensions:changed", listener);
        return () =>
          ipcRenderer.removeListener("browser:extensions:changed", listener);
      },
    },
    commands: {
      list: (): Promise<CommandPaletteSnapshot> =>
        ipcRenderer.invoke("browser:commands:list"),
      run: (id: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:commands:run", id),
    },
    commandPalette: {
      /** Tell main the palette closed; `refocusPage` hands the keyboard back to the page. */
      closed: (refocusPage: boolean): Promise<void> =>
        ipcRenderer.invoke("browser:command-palette:closed", refocusPage),
      getSettings: (): Promise<CommandPaletteSettings> =>
        ipcRenderer.invoke("browser:command-palette:settings:get"),
      setSettings: (
        settings: CommandPaletteSettings,
      ): Promise<CommandPaletteSettings> =>
        ipcRenderer.invoke("browser:command-palette:settings:set", settings),
      onOpen: (
        callback: (request: CommandPaletteOpenRequest) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          request: CommandPaletteOpenRequest,
        ): void => callback(request);
        ipcRenderer.on("browser:command-palette:open", listener);
        return () =>
          ipcRenderer.removeListener("browser:command-palette:open", listener);
      },
      onSettingsChange: (
        callback: (settings: CommandPaletteSettings) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          settings: CommandPaletteSettings,
        ): void => callback(settings);
        ipcRenderer.on("browser:command-palette:settings-changed", listener);
        return () =>
          ipcRenderer.removeListener(
            "browser:command-palette:settings-changed",
            listener,
          );
      },
    },
    searchKeywords: {
      get: (): Promise<CustomSearchEngine[]> =>
        ipcRenderer.invoke("browser:search-keywords:get"),
      set: (
        engines: CustomSearchEngine[],
      ): Promise<CustomSearchEnginesResult> =>
        ipcRenderer.invoke("browser:search-keywords:set", engines),
      onChange: (
        callback: (engines: CustomSearchEngine[]) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          engines: CustomSearchEngine[],
        ): void => callback(engines);
        ipcRenderer.on("browser:search-keywords:changed", listener);
        return () =>
          ipcRenderer.removeListener(
            "browser:search-keywords:changed",
            listener,
          );
      },
    },
    diagnostics: {
      /** Start (true) or stop (false) sampling; resolves with a first snapshot when starting. */
      watch: (watching: boolean): Promise<DiagnosticsUpdate> =>
        ipcRenderer.invoke("browser:diagnostics:watch", watching),
      kill: (pid: number): Promise<boolean> =>
        ipcRenderer.invoke("browser:diagnostics:kill", pid),
      reloadTab: (tabId: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:diagnostics:reload-tab", tabId),
      discardTab: (tabId: string): Promise<boolean> =>
        ipcRenderer.invoke("browser:diagnostics:discard-tab", tabId),
      /** Every 2 s while any Diagnostics view samples; null when sampling stops. */
      onChange: (
        callback: (snapshot: DiagnosticsUpdate) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          snapshot: DiagnosticsUpdate,
        ): void => callback(snapshot);
        ipcRenderer.on("browser:diagnostics", listener);
        return () =>
          ipcRenderer.removeListener("browser:diagnostics", listener);
      },
    },
    network: {
      get: (): Promise<NetworkRequestSummary[]> =>
        ipcRenderer.invoke("browser:network:get"),
      disable: (): Promise<void> =>
        ipcRenderer.invoke("browser:network:disable"),
      watch: (watching: boolean): Promise<NetworkRequestSummary[]> =>
        ipcRenderer.invoke("browser:network:watch", watching),
      details: (id: string): Promise<NetworkRequestDetails | null> =>
        ipcRenderer.invoke("browser:network:details", id),
      responseBody: (
        id: string,
      ): Promise<{ body: NetworkResponseBody | null; error: string | null }> =>
        ipcRenderer.invoke("browser:network:response-body", id),
      clear: (): Promise<void> => ipcRenderer.invoke("browser:network:clear"),
      onChange: (
        callback: (requests: NetworkRequestSummary[]) => void,
      ): (() => void) => {
        const listener = (
          _event: Electron.IpcRendererEvent,
          requests: NetworkRequestSummary[],
        ): void => callback(requests);
        ipcRenderer.on("browser:network:changed", listener);
        return () =>
          ipcRenderer.removeListener("browser:network:changed", listener);
      },
      ...networkToolsApi,
    },
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("api", api);
} else {
  window.api = api;
}
export type PreloadAPI = typeof api;
