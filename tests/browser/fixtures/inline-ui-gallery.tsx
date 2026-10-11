import { useState } from "react";
import { createRoot } from "react-dom/client";
import { UiRenderer } from "../../../src/shared/ui/inlineUi/UiRenderer";
import { ThemeProvider } from "../../../src/shell/context/ThemeProvider";

import "../../../src/index.css";
import "./inline-ui-gallery.css";

// The dev server serves /skills as raw resources, not module imports.
const [dashboard, planner] = await Promise.all(
  ["dashboard", "planner"].map(async (name) => {
    const response = await fetch(`/skills/studio/inline-ui/references/examples/${name}.json`);
    if (!response.ok) throw new Error(`Example ${name} could not be loaded`);
    return response.json();
  }),
);

function Gallery() {
  const [status, setStatus] = useState("");
  return (
    <main className="showcase">
      <header className="showcase-header">
        <div className="showcase-eyebrow">
          <span className="showcase-mark">W</span> WINGMAN <span className="showcase-pill">INTERFACE STUDIES · 01</span>
        </div>
        <div className="showcase-intro">
          <div>
            <p className="showcase-kicker">FROM CONVERSATION TO INTERACTION</p>
            <h1>
              Answers you can
              <br />
              <em>work with.</em>
            </h1>
          </div>
          <div className="showcase-deck">
            <p>
              Explore the numbers.
              <br />
              Shape the plan.
              <br />
              Keep the conversation moving.
            </p>
            <span>A2UI BASIC CATALOG + WINGMAN EXTENSIONS</span>
          </div>
        </div>
        <div className="showcase-rule">
          <span>Native components. Shared data. Live feedback.</span>
          <span>INLINE UI / A2UI v1.0</span>
        </div>
      </header>
      <div className="showcase-grid">
        <section className="showcase-example">
          <div className="showcase-caption">
            <span>01 / BUSINESS INTELLIGENCE</span>
            <span className="showcase-dot">LIVE DATA VIEW</span>
          </div>
          <div className="showcase-surface">
            <UiRenderer source={JSON.stringify(dashboard)} />
          </div>
          <p className="showcase-note">Explore a period, compare a target, sort a segment. One connected data model.</p>
        </section>
        <section className="showcase-example">
          <div className="showcase-caption">
            <span>02 / A PLAN THAT RESPONDS</span>
            <span className="showcase-dot">TWO-WAY BINDINGS</span>
          </div>
          <div className="showcase-surface">
            <UiRenderer
              source={JSON.stringify(planner)}
              onSendMessage={(source) => {
                const value = JSON.parse(source);
                setStatus(`Shared: ${value.message.action.context.selection.title}`);
              }}
            />
          </div>
          <p className="showcase-note">
            Edit the details and watch the preview change. Share the final plan as a structured action.
          </p>
          {status && <p role="status">{status}</p>}
        </section>
      </div>
      <footer className="showcase-footer">
        <div>
          <h2>
            Two catalogs.
            <br />
            One coherent interface.
          </h2>
          <p>
            Standard A2UI layout and inputs, extended with Wingman’s
            <br />
            charts, tables, metrics and planning controls.
          </p>
        </div>
        <div className="showcase-legend">
          <div>
            <span className="showcase-label">A2UI BASIC</span>
            <p>
              Row · Column · Card · Tabs · Text · Icon
              <br />
              TextField · DateTimeInput · ChoicePicker · CheckBox
            </p>
          </div>
          <div>
            <span className="showcase-label">WINGMAN</span>
            <p>
              Chart · Table · Metric · Grid · Form · Timeline
              <br />
              Stepper · Select · Toggle · Segmented · Progress
            </p>
          </div>
        </div>
      </footer>
      <div className="showcase-colophon">
        <span>Rendered with real Inline UI components · Illustrative data</span>
        <span>WINGMAN / OCTOBER 2026</span>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <Gallery />
  </ThemeProvider>,
);
