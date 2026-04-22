import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { StationResult } from "../types.js";
import "./arrival-card.js";

@customElement("station-section")
export class StationSection extends LitElement {
  @property({ type: Object }) station!: StationResult;

  static styles = css`
    :host { display: block; }
    .header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding: 0 2px 6px;
    }
    .name {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: -0.1px;
      color: #f5f5f5;
    }
    .meta {
      font-size: 11px;
      font-weight: 500;
      color: #6e6e73;
    }
    .cards {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
  `;

  private get walkLabel(): string {
    const m = this.station.walkMinutes;
    return m <= 0 ? "Here" : `${m} min walk`;
  }

  render() {
    return html`
      <div class="header">
        <span class="name">${this.station.name}</span>
        <span class="meta">${this.walkLabel}</span>
      </div>
      <div class="cards">
        <arrival-card
          .arrivals=${this.station.northbound.arrivals}
          direction="N"
        ></arrival-card>
        <arrival-card
          .arrivals=${this.station.southbound.arrivals}
          direction="S"
        ></arrival-card>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "station-section": StationSection;
  }
}
