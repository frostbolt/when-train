import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ArrivalTime } from "../types.js";

const ROUTE_COLORS: Record<string, string> = {
  "1": "#EE352E", "2": "#EE352E", "3": "#EE352E",
  "4": "#00933C", "5": "#00933C", "6": "#00933C",
  "7": "#B933AD",
  A: "#0039A6", C: "#0039A6", E: "#0039A6",
  B: "#FF6319", D: "#FF6319", F: "#FF6319", M: "#FF6319",
  G: "#6CBE45",
  J: "#996633", Z: "#996633",
  L: "#A7A9AC",
  N: "#FCCC0A", Q: "#FCCC0A", R: "#FCCC0A", W: "#FCCC0A",
  SI: "#0039A6",
};
const LIGHT_ROUTES = new Set(["N", "Q", "R", "W", "G", "L"]);

function busRouteColor(routeId: string): string {
  const id = routeId.toUpperCase();
  if (id.endsWith("+") || id.includes("SBS")) return "#0039A6"; // SBS – blue
  if (/^(BM|QM|BXM|X)\d/.test(id)) return "#EE352E";           // express – red
  return "#00933C";                                              // local – green
}

const TRAIN_EMPTY_MSGS: Record<"N" | "S", string> = {
  N: "🌚 Nothing heading up",
  S: "🦗 No trains south",
};
const BUS_EMPTY_MSGS: Record<"N" | "S", string> = {
  N: "🚌 No buses this way",
  S: "🚌 No buses this way",
};

@customElement("arrival-card")
export class ArrivalCard extends LitElement {
  @property({ type: Array }) arrivals: ArrivalTime[] = [];
  @property() direction: "N" | "S" = "N";
  @property() mode: "train" | "bus" = "train";

  static styles = css`
    :host {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background: #1c1c1e;
      border-radius: 12px;
      padding: 10px 10px;
      border: 1px solid #2c2c2e;
      min-width: 0;
      box-sizing: border-box;
    }
    .bullet {
      width: 44px;
      height: 44px;
      min-width: 44px;
      min-height: 44px;
      border-radius: 50%;
      font-weight: 800;
      font-size: 20px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .bullet.empty {
      background: #2c2c2e !important;
      color: #3a3a3c !important;
    }
    .info {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
      flex: 1;
    }
    .dest {
      font-size: 9px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: #6e6e73;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .time {
      font-size: 22px;
      font-weight: 700;
      line-height: 1.05;
      letter-spacing: -0.5px;
      font-variant-numeric: tabular-nums;
      color: #f5f5f5;
    }
    .time.urgent { color: #ff453a; }
    .time.empty {
      font-size: 11px;
      font-weight: 500;
      color: #3a3a3c;
      letter-spacing: 0;
      padding-top: 2px;
    }
    .then {
      font-size: 10px;
      font-weight: 500;
      color: #6e6e73;
      font-variant-numeric: tabular-nums;
      line-height: 1.4;
    }
  `;

  private get next(): ArrivalTime | undefined { return this.arrivals[0]; }
  private get rest(): ArrivalTime[] { return this.arrivals.slice(1, 4); }

  private get routeId(): string { return this.next?.routeId ?? ""; }

  private get bulletStyle(): string {
    if (this.mode === "bus") {
      return `background:${busRouteColor(this.routeId)};color:#fff`;
    }
    const bg = ROUTE_COLORS[this.routeId] ?? "#808183";
    const fg = LIGHT_ROUTES.has(this.routeId) ? "#000" : "#fff";
    return `background:${bg};color:${fg}`;
  }

  private get bulletLabel(): string {
    return this.routeId || (this.direction === "N" ? "↑" : "↓");
  }

  private get headsign(): string {
    return this.next?.headsign ?? "";
  }

  private get nextLabel(): string {
    if (!this.next) return "—";
    if (this.next.minutes <= 0) return "Now";
    return `${this.next.minutes} min`;
  }

  private get thenLabel(): string {
    if (!this.rest.length) return "";
    return "Also in " + this.rest.map((a) => String(a.minutes)).join(", ") + " min";
  }

  render() {
    const empty = !this.next;
    const emptyMsgs = this.mode === "bus" ? BUS_EMPTY_MSGS : TRAIN_EMPTY_MSGS;
    return html`
      <div class="bullet ${empty ? "empty" : ""}" style=${empty ? "" : this.bulletStyle}>
        ${empty ? "?" : this.bulletLabel}
      </div>
      <div class="info">
        ${empty
          ? html`<div class="time empty">${emptyMsgs[this.direction]}</div>`
          : html`
              <div class="dest">${this.headsign}</div>
              <div class="time ${this.next?.urgent ? "urgent" : ""}">${this.nextLabel}</div>
              ${this.thenLabel ? html`<div class="then">${this.thenLabel}</div>` : ""}
            `}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "arrival-card": ArrivalCard;
  }
}
