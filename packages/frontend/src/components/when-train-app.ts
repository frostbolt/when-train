import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ArrivalsResponse } from "../types.js";
import { fetchArrivals } from "../api.js";
import "./station-section.js";

const REFRESH_SECS = 30;
const FEATURE_BUSES = import.meta.env.VITE_FEATURE_BUSES === "true";

type Tab = "trains" | "buses";

@customElement("when-train-app")
export class WhenTrainApp extends LitElement {
  @state() private data: ArrivalsResponse | null = null;
  @state() private loading = true;
  @state() private error: string | null = null;
  @state() private countdown = REFRESH_SECS;
  @state() private updatedAt = "";
  @state() private needsLocation = false;
  @state() private activeTab: Tab = "trains";

  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private userLat: number | null = null;
  private userLng: number | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      padding:
        max(env(safe-area-inset-top), 28px)
        16px
        max(env(safe-area-inset-bottom), 20px);
      gap: 10px;
      background: #111;
      color: #f5f5f5;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display",
        "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
      box-sizing: border-box;
    }
    .center {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #6e6e73;
      font-size: 16px;
    }
    .error { color: #ff453a; }
    .footer {
      margin-top: auto;
      padding-top: 12px;
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #6e6e73;
    }
    .dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #30d158;
      margin-right: 5px;
      vertical-align: middle;
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.25; }
    }
    .tab-bar {
      display: flex;
      gap: 4px;
      background: #1c1c1e;
      border-radius: 10px;
      padding: 3px;
    }
    .tab {
      flex: 1;
      padding: 7px 0;
      border: none;
      border-radius: 8px;
      background: transparent;
      color: #6e6e73;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .tab.active {
      background: #2c2c2e;
      color: #f5f5f5;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.init();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.clearTimers();
  }

  private clearTimers() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
  }

  private async init() {
    const params = new URLSearchParams(location.search);
    const latP = params.get("lat");
    const lngP = params.get("lng");

    if (latP && lngP) {
      this.userLat = parseFloat(latP);
      this.userLng = parseFloat(lngP);
      await this.load();
    } else {
      await this.geolocate();
    }

    this.startTimers();
  }

  private geolocate(): Promise<void> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        this.needsLocation = true;
        this.loading = false;
        resolve();
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          this.userLat = pos.coords.latitude;
          this.userLng = pos.coords.longitude;
          this.needsLocation = false;
          history.replaceState(
            null,
            "",
            `/?lat=${this.userLat}&lng=${this.userLng}`
          );
          await this.load();
          resolve();
        },
        () => {
          this.needsLocation = true;
          this.loading = false;
          resolve();
        },
        { timeout: 8000 }
      );
    });
  }

  private async load() {
    if (this.userLat === null || this.userLng === null) return;
    this.loading = !this.data; // show spinner only on first load
    this.error = null;
    try {
      this.data = await fetchArrivals(this.userLat, this.userLng);
      this.updatedAt = new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
      this.countdown = REFRESH_SECS;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "Failed to load arrivals";
    } finally {
      this.loading = false;
    }
  }

  /** Silently try to update position, then fetch. If location is still unavailable, stays on the prompt screen. */
  private async refreshWithGeo() {
    await new Promise<void>((resolve) => {
      if (!navigator.geolocation) { resolve(); return; }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.userLat = pos.coords.latitude;
          this.userLng = pos.coords.longitude;
          this.needsLocation = false;
          history.replaceState(null, "", `/?lat=${this.userLat}&lng=${this.userLng}`);
          resolve();
        },
        () => resolve(), // permission denied or timeout — keep existing state
        { timeout: 5000, maximumAge: 30_000 }
      );
    });
    await this.load();
  }

  private startTimers() {
    this.refreshTimer = setInterval(() => this.refreshWithGeo(), REFRESH_SECS * 1000);
    this.countdownTimer = setInterval(() => {
      this.countdown = Math.max(0, this.countdown - 1);
    }, 1000);

    // Also refresh (with geo update) when tab becomes visible again
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.refreshWithGeo();
    });
  }

  private renderTabBar() {
    return html`
      <div class="tab-bar">
        <button
          class="tab ${this.activeTab === "trains" ? "active" : ""}"
          @click=${() => { this.activeTab = "trains"; }}
        >Trains</button>
        <button
          class="tab ${this.activeTab === "buses" ? "active" : ""}"
          @click=${() => { this.activeTab = "buses"; }}
        >Buses</button>
      </div>
    `;
  }

  private renderBuses() {
    return html`<div class="center">🚌 Bus arrivals coming soon</div>`;
  }

  render() {
    if (this.loading) {
      return html`<div class="center">Locating…</div>`;
    }
    if (this.needsLocation) {
      return html`<div class="center">📍 Share your location to see nearby trains</div>`;
    }
    if (this.error && !this.data) {
      return html`<div class="center error">${this.error}</div>`;
    }
    if (!this.data) return html``;

    return html`
      ${FEATURE_BUSES ? this.renderTabBar() : ""}
      ${FEATURE_BUSES && this.activeTab === "buses"
        ? this.renderBuses()
        : html`
            ${this.data.stations.map(
              (s) => html`<station-section .station=${s}></station-section>`
            )}
            <div class="footer">
              <span><span class="dot"></span>${this.updatedAt}</span>
              <span>↻ ${this.countdown}s</span>
            </div>
          `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "when-train-app": WhenTrainApp;
  }
}
