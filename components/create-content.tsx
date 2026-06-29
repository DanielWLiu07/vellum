"use client";

import * as React from "react";

import { DeckEditor } from "./deck-editor";
import { UploadForm } from "./upload-form";

type ContentType = "document" | "flashcards";

export function CreateContent() {
  const [type, setType] = React.useState<ContentType>("document");

  // Allow ?type=flashcards to preselect the tab (e.g. from the dashboard).
  React.useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("type");
    if (t === "flashcards" || t === "document") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setType(t);
    }
  }, []);

  return (
    <div className="create-wrap">
      <div className="type-select" role="tablist" aria-label="Content type">
        <span className="role-switch-label">What are you adding?</span>
        <button
          type="button"
          role="tab"
          aria-selected={type === "document"}
          className={`type-tab${type === "document" ? " is-active" : ""}`}
          onClick={() => setType("document")}
        >
          Document <span className="type-tab-sub">PDF or image</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={type === "flashcards"}
          className={`type-tab${type === "flashcards" ? " is-active" : ""}`}
          onClick={() => setType("flashcards")}
        >
          Flashcards <span className="type-tab-sub">create or import</span>
        </button>
      </div>
      {type === "document" ? <UploadForm /> : <DeckEditor />}
    </div>
  );
}
