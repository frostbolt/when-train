import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ArrivalsResponse } from "../types.js";
import { fetchArrivals, fetchBusArrivals } from "../api.js";
import "./station-section.js";

const REFRESH_SECS = 30;

type Tab = "trains" | "buses";

@customElement("when-train-app")
export class WhenTrainApp extends LitElement {
  @state() private tab: Tab = "trains";

  @state() private trainData: ArrivalsResponse | null = null;
  @state() private trainLoading = true;
  @state() private trainError: string | null = null;

  @state() private busData: ArrivalsResponse | null = null;
  @state() private busLoading = false;
  @state() private busError: string | null = null;
  @state() private busLoaded = false; // true once bus data fetched at least once

  @state() private countdown = REFRESH_SECS;
  @state() private updatedAt = "";
  @state() private needsLocation = false;

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
    .tabs {
      display: flex;
      gap: 6px;
      background: #1c1c1e;
      border-radius: 10px;
      padding: 3px;
      border: 1px solid #2c2c2e;
    }
    .tab-btn {
      flex: 1;
      background: none;
      border: none;
      border-radius: 7px;
      color: #6e6e73;
      font-size: 14px;
      font-weight: 600;
      font-family: inherit;
      padding: 7px 0;
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      -webkit-font-smoothing: antialiased;
    }
    .tab-btn.active {
      background: #2c2c2e;
      color: #f5f5f5;
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
      await this.loadTrains();
    } else {
      await this.geolocate();
    }

    this.startTimers();
  }

  private geolocate(): Promise<void> {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        this.needsLocation = true;
        this.trainLoading = false;
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
          await this.loadTrains();
          resolve();
        },
        () => {
          this.needsLocation = true;
          this.trainLoading = false;
          resolve();
        },
        { timeout: 8000 }
      );
    });
  }

  private async loadTrains() {
    if (this.userLat === null || this.userLng === null) return;
    this.trainLoading = !this.trainData;
    this.trainError = null;
    try {
      this.trainData = await fetchArrivals(this.userLat, this.userLng);
      this.updatedAt = new Date().toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
      });
      this.countdown = REFRESH_SECS;
    } catch (e) {
      this.trainError = e instanceof Error ? e.message : "Failed to load arrivals";
    } finally {
      this.trainLoading = false;
    }
  }

  private async loadBuses() {
    if (this.userLat === null || this.userLng === null) return;
    this.busLoading = !this.busData;
    this.busError = null;
    try {
      this.busData = await fetchBusArrivals(this.userLat, this.userLng);
      this.busLoaded = true;
      this.updatedAt = new Date().toLocaleTimeString("en-US", {
        hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true,
      });
      this.countdown = REFRESH_SECS;
    } catch (e) {
      this.busError = e instanceof Error ? e.message : "Failed to load bus arrivals";
    } finally {
      this.busLoading = false;
    }
  }

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
        () => resolve(),
        { timeout: 5000, maximumAge: 30_000 }
      );
    });
    if (this.tab === "trains") {
      await this.loadTrains();
    } else {
      await this.loadBuses();
    }
  }

  private startTimers() {
    this.refreshTimer = setInterval(() => this.refreshWithGeo(), REFRESH_SECS * 1000);
    this.countdownTimer = setInterval(() => {
      this.countdown = Math.max(0, this.countdown - 1);
    }, 1000);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) this.refreshWithGeo();
    });
  }

  private selectTab(tab: Tab) {
    this.tab = tab;
    // Lazily load bus data the first time the bus tab is opened
    if (tab === "buses" && !this.busLoaded && !this.busLoading) {
      this.loadBuses();
    }
  }

  private renderContent() {
    if (this.tab === "trains") {
      if (this.trainLoading) return html`<div class="center">Locating\u2026</div>`;
      if (this.needsLocation) return html`<div class="center">📍 Share your location to see nearby trains</div>`;
      if (this.trainError && !this.trainData) return html`<div class="center error">${this.trainError}</div>`;
      if (!this.trainData) return html``;
      return html`${this.trainData.stations.map(
        (s) => html`<station-section .station=${s} mode="train"></station-section>`
      )}`;
    } else {
      if (this.busLoading) return html`<div class="center">Loading buses\u2026</div>`;
      if (this.needsLocation) return html`<div class="center">📍 Share your location to see nearby buses</div>`;
      if (this.busError && !this.busData) return html`<div class="center error">${this.busError}</div>`;
      if (!this.busData) return html``;
      if (this.busData.stations.length === 0) return html`<div class="center">🚌 No bus stops within 10 min walk</div>`;
      return html`${this.busData.stations.map(
        (s) => html`<station-section .station=${s} mode="bus"></station-section>`
      )}`;
    }
  }

  render() {
    return html`
      <div class="tabs">
        <button
          class="tab-btn ${this.tab === "trains" ? "active" : ""}"
          @click=${() => this.selectTab("trains")}
        >Trains</button>
        <button
          class="tab-btn ${this.tab === "buses" ? "active" : ""}"
          @click=${() => this.selectTab("buses")}
        >Buses</button>
      </div>
      ${this.renderContent()}
      <div class="footer">
        <span><span class="dot"></span>${this.updatedAt}</span>
        <span>↻ ${this.countdown}s</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "when-train-app": WhenTrainApp;
  }
}
