import path from "node:path";
import fs from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";
import { config } from "../config";

export class BrowserManager {
  private static instance: BrowserManager | null = null;
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;
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
   * Auto-recovers if the context was closed manually.
   */
  public async getContext(): Promise<BrowserContext> {
    if (this.context) {
      // Check if context is still alive
      try {
        const pages = this.context.pages();
        if (pages.length > 0) {
          return this.context;
        }
      } catch {
        this.context = null;
        this.activePage = null;
      }
    }

    // Launch a fresh persistent context
    this.context = await chromium.launchPersistentContext(this.profileDir, {
      headless: config.headlessMode,
      viewport: { width: 1400, height: 900 },
      downloadsPath: this.downloadDir,
      acceptDownloads: true,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--start-maximized",
      ],
    });

    this.context.on("close", () => {
      this.context = null;
      this.activePage = null;
    });

    return this.context;
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
