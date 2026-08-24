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
  // ?exam=1 additionally starts the quiz form in exam mode — how Examinations'
  // "+ Create exam" differs from Quizzes' "+ Create quiz". Read here rather
  // than in the editor so the URL contract lives with the other one.
  const [examDefault, setExamDefault] = React.useState(false);

  // Allow ?type=flashcards|quiz to preselect the tab (e.g. from the dashboard).
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("type");
    /* eslint-disable react-hooks/set-state-in-effect */
    if (t === "flashcards" || t === "document" || t === "quiz") {
      setType(t);
    }
    if (params.get("exam") === "1") setExamDefault(true);
    /* eslint-enable react-hooks/set-state-in-effect */
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
          : <QuizEditor backHref={backHref ?? RETURN_BY_TYPE.quiz} examDefault={examDefault} />}
    </div>
  );
}
