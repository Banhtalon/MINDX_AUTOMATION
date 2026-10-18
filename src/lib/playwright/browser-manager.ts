import path from "node:path";
import fs from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { config } from "../config";

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private context: BrowserContext | null = null;
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
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  /**
   * Initializes or returns the existing persistent browser context.
   * Uses Promise Locking (Mutex) to completely prevent race conditions
   * when concurrent calls occur.
   */
  public async getContext(): Promise<BrowserContext> {
    // If context is already healthy, return it
    if (this.context) {
      try {
        const pages = this.context.pages();
        if (pages.length > 0 && !pages[0].isClosed()) {
          return this.context;
        }
        // If context is alive but has 0 pages, create a page rather than killing the context
        const newPage = await this.context.newPage();
        this.activePage = newPage;
        return this.context;
      } catch {
        this.context = null;
        this.activePage = null;
      }
    }

    // If an initialization is already in flight, reuse the same promise
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        const ctx = await chromium.launchPersistentContext(this.profileDir, {
          headless: config.headlessMode,
          viewport: { width: 1400, height: 900 },
          downloadsPath: this.downloadDir,
          acceptDownloads: true,
          args: [
            "--disable-blink-features=AutomationControlled",
            "--start-maximized",
          ],
        });

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
