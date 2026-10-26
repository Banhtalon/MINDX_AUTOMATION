import path from "node:path";
import fs from "node:fs";
import dns from "node:dns/promises";
import { chromium, type BrowserContext, type Page } from "playwright";
import { config } from "../config";

const DEFAULT_MINDX_LMS_IP = "103.109.43.92";
const DEFAULT_MINDX_RESOURCES_IP = "45.117.83.246";
const CURRENT_HOST_RULES_VERSION = 3;
// MindX authoritative Viettel IDC nameservers (since ns4/5/6.bizflycloud.vn return REFUSED and cause SERVFAIL on 1.1.1.1/8.8.8.8)
const MINDX_AUTH_NAMESERVERS = ["115.84.177.33", "115.84.182.199"];

async function resolveMindxHostIps(): Promise<{ lmsIp: string; resourcesIp: string }> {
  let lmsIp = DEFAULT_MINDX_LMS_IP;
  let resourcesIp = DEFAULT_MINDX_RESOURCES_IP;
  try {
    const resolver = new dns.Resolver({ timeout: 2000, tries: 1 });
    resolver.setServers(MINDX_AUTH_NAMESERVERS);
    const [lmsIps, resIps] = await Promise.all([
      resolver.resolve4("lms.mindx.edu.vn").catch(() => []),
      resolver.resolve4("resources.mindx.edu.vn").catch(() => []),
    ]);
    if (lmsIps.length > 0 && /^\d+\.\d+\.\d+\.\d+$/.test(lmsIps[0])) {
      lmsIp = lmsIps[0];
    }
    if (resIps.length > 0 && /^\d+\.\d+\.\d+\.\d+$/.test(resIps[0])) {
      resourcesIp = resIps[0];
    }
  } catch {
    // Fallback to known MindX IPs if direct authoritative UDP 53 query fails
  }
  return { lmsIp, resourcesIp };
}

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  public readonly hostRulesVersion = CURRENT_HOST_RULES_VERSION;
  private context: BrowserContext | null = null;
  private legacyContextToClose: BrowserContext | null = null;
  private activePage: Page | null = null;
  private initPromise: Promise<BrowserContext> | null = null;
  private readonly profileDir: string;
  private readonly downloadDir: string;

  private constructor() {
    this.profileDir = path.resolve(process.cwd(), "playwright-auth");
    this.downloadDir = path.resolve(process.cwd(), "temp_submissions");

    if (!fs.existsSync(this.profileDir)) {
      fs.mkdirSync(this.profileDir, { recursive: true });
    }
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  public static getInstance(): BrowserManager {
    const g = globalThis as any;
    if (
      !BrowserManager.instance ||
      BrowserManager.instance.hostRulesVersion !== CURRENT_HOST_RULES_VERSION
    ) {
      if (
        g.__mindxBrowserManager &&
        g.__mindxBrowserManager.hostRulesVersion === CURRENT_HOST_RULES_VERSION
      ) {
        BrowserManager.instance = g.__mindxBrowserManager;
      } else {
        const nextInstance = new BrowserManager();
        if (g.__mindxBrowserManager?.context) {
          nextInstance.legacyContextToClose = g.__mindxBrowserManager.context;
          g.__mindxBrowserManager.context = null;
        }
        BrowserManager.instance = nextInstance;
        g.__mindxBrowserManager = nextInstance;
      }
    }
    return BrowserManager.instance!;
  }

  /**
   * Initializes or returns the existing persistent browser context.
   * Uses Promise Locking (Mutex) to completely prevent race conditions
   * when concurrent calls occur.
   */
  public async getContext(): Promise<BrowserContext> {
    // If an initialization or tab restoration is already in flight, reuse the same promise
    if (this.initPromise) {
      return this.initPromise;
    }

    // If context is already healthy with open pages and up-to-date host rules, return it immediately
    if (this.context && (this.context as any).__mindxHostRulesV3 === true) {
      try {
        const pages = this.context.pages().filter((p) => !p.isClosed());
        if (pages.length > 0) {
          this.activePage = pages[0];
          return this.context;
        }

        // Context is alive but has 0 open pages: lock tab recovery under initPromise
        this.initPromise = (async () => {
          try {
            const pagesAfterLock = this.context?.pages().filter((p) => !p.isClosed()) || [];
            if (pagesAfterLock.length > 0) {
              this.activePage = pagesAfterLock[0];
              return this.context!;
            }
            const newPage = await this.context!.newPage();
            this.activePage = newPage;
            return this.context!;
          } finally {
            this.initPromise = null;
          }
        })();
        return this.initPromise;
      } catch {
        this.context = null;
        this.activePage = null;
      }
    }

    // Launch a fresh persistent context
    this.initPromise = (async () => {
      try {
        if (this.legacyContextToClose) {
          const oldCtx = this.legacyContextToClose;
          this.legacyContextToClose = null;
          await oldCtx.close().catch(() => {});
        }
        if (this.context) {
          const oldCtx = this.context;
          this.context = null;
          this.activePage = null;
          await oldCtx.close().catch(() => {});
        }

        const { lmsIp, resourcesIp } = await resolveMindxHostIps();
        const ctx = await chromium.launchPersistentContext(this.profileDir, {
          headless: config.headlessMode,
          viewport: { width: 1400, height: 900 },
          downloadsPath: this.downloadDir,
          acceptDownloads: true,
          ignoreDefaultArgs: ["--enable-automation"],
          args: [
            "--disable-blink-features=AutomationControlled",
            "--start-maximized",
            `--host-resolver-rules=MAP resources.mindx.edu.vn ${resourcesIp}, MAP *.mindx.edu.vn ${lmsIp}, MAP mindx.edu.vn ${lmsIp}`,
          ],
        });
        (ctx as any).__mindxHostRulesV3 = true;

        ctx.on("close", () => {
          this.context = null;
          this.activePage = null;
        });

        this.context = ctx;
        return ctx;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Returns an active Page from the context.
   */
  public async getPage(): Promise<Page> {
    const context = await this.getContext();
    const pages = context.pages();

    if (this.activePage && !this.activePage.isClosed()) {
      return this.activePage;
    }

    if (pages.length > 0 && !pages[0].isClosed()) {
      this.activePage = pages[0];
      return this.activePage;
    }

    this.activePage = await context.newPage();
    return this.activePage;
  }

  /**
   * Closes the browser context cleanly.
   */
  public async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch (err) {
        console.warn("[BrowserManager] Warning while closing context:", err);
      } finally {
        this.context = null;
        this.activePage = null;
        this.initPromise = null;
      }
    }
  }

  /**
   * Checks if the browser context is alive.
   */
  public isAlive(): boolean {
    return this.context !== null && this.context.pages().length > 0;
  }

  public getDownloadDir(): string {
    return this.downloadDir;
  }
}

export const browserManager = BrowserManager.getInstance();
