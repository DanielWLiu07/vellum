"use client";

import * as React from "react";

import { RETURN_TO } from "@/lib/return-to";

import { DeckEditor } from "./deck-editor";
import { QuizEditor } from "./quiz-editor";
import { UploadForm } from "./upload-form";

type ContentType = "document" | "flashcards" | "quiz";

/** Where each kind of new content lives, so finishing lands on its own list. */
const RETURN_BY_TYPE: Record<ContentType, string> = {
  document: RETURN_TO.resources,
  flashcards: RETURN_TO.flashcards,
  quiz: RETURN_TO.quizzes,
};

export function CreateContent({ backHref }: { backHref?: string | null }) {
  const [type, setType] = React.useState<ContentType>("document");

  // Allow ?type=flashcards|quiz to preselect the tab (e.g. from the dashboard).
  React.useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("type");
    if (t === "flashcards" || t === "document" || t === "quiz") {
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
        <button
          type="button"
          role="tab"
          aria-selected={type === "quiz"}
          className={`type-tab${type === "quiz" ? " is-active" : ""}`}
          onClick={() => setType("quiz")}
        >
          Quiz <span className="type-tab-sub">multiple choice</span>
        </button>
      </div>
      {type === "document"
        ? <UploadForm backHref={backHref ?? RETURN_BY_TYPE.document} />
        : type === "flashcards"
          ? <DeckEditor backHref={backHref ?? RETURN_BY_TYPE.flashcards} />
          : <QuizEditor backHref={backHref ?? RETURN_BY_TYPE.quiz} />}
    </div>
  );
}
