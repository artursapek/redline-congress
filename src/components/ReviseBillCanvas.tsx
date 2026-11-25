import React, { useEffect, useRef } from "react";
import ReviseEditor, {
  type ReviseEditorHandle,
  type ReviseReviewState,
  type ReviseSelectionSnapshot,
  type ReviseTrackedChange,
} from "revise";
import "revise/style.css";
import type { ThemeMode } from "../lib/theme";

export type SuggestionViewMode = "all-markup" | "final" | "original";

interface ReviseBillCanvasProps {
  docKey: string;
  docxBlob: Blob;
  title: string;
  theme: ThemeMode;
  viewMode: SuggestionViewMode;
  markupStyle: "revise" | "word";
  onHandleReady: (handle: ReviseEditorHandle) => void;
  onChangesUpdated: (
    changes: ReviseTrackedChange[],
    state: ReviseReviewState,
  ) => void;
  onSelectionUpdated?: (snapshot: ReviseSelectionSnapshot) => void;
}

export const ReviseBillCanvas: React.FC<ReviseBillCanvasProps> = ({
  docKey,
  docxBlob,
  title,
  theme,
  viewMode,
  markupStyle,
  onHandleReady,
  onChangesUpdated,
  onSelectionUpdated,
}) => {
  const handleRef = useRef<ReviseEditorHandle | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const unsubSelectionRef = useRef<(() => void) | null>(null);
  const onSelectionUpdatedRef = useRef(onSelectionUpdated);
  onSelectionUpdatedRef.current = onSelectionUpdated;

  useEffect(() => {
    return () => {
      unsubRef.current?.();
      unsubRef.current = null;
      unsubSelectionRef.current?.();
      unsubSelectionRef.current = null;
    };
  }, [docKey]);

  // Keep suggestion view mode synced when user clicks All Markup / Final / Original
  useEffect(() => {
    const editor = handleRef.current;
    if (!editor) return;
    try {
      editor.review.setSuggestionViewMode(viewMode);
      editor.review.setShowRemovals(true);
    } catch {
      // Document may still be opening
    }
  }, [viewMode, docKey]);

  const canvasBg = theme === "dark" ? "#0c0f15" : "#f3f0ec";
  const pageBg = theme === "dark" ? "#11151e" : "#ffffff";
  const pageBorder = theme === "dark" ? "#1e2430" : "rgba(71, 65, 62, 0.14)";

  return (
    <div className="rc-editor-mount">
      <ReviseEditor
        key={`${docKey}:${markupStyle}:${theme}`}
        role="viewer"
        theme={theme}
        toolbarMode="none"
        showTitleBar={false}
        showTabs={false}
        defaultCommentsOpen={false}
        autoFocus={false}
        defaultZoom="fit-width"
        canvasBackground={canvasBg}
        pageBackground={pageBg}
        pageBorderColor={pageBorder}
        settings={{
          trackedChanges: {
            showRemovalsInReview: true,
            markupStyle,
          },
        }}
        initialDocuments={[
          {
            id: docKey,
            source: docxBlob,
            format: "docx",
            title,
            role: "viewer",
            defaultCommentsOpen: false,
          },
        ]}
        onReady={(editor) => {
          handleRef.current = editor;
          onHandleReady(editor);
          editor
            .whenReady(docKey)
            .then(() => {
              try {
                editor.view.setCommentsOpen(false);
                editor.review.setShowRemovals(true);
                editor.review.setSuggestionViewMode(viewMode);
                const pushChanges = (state: ReviseReviewState) => {
                  try {
                    const list = editor.review.listChanges();
                    onChangesUpdated(list, state);
                  } catch {
                    // Ignore transient reads during unmount
                  }
                };
                pushChanges(editor.review.getState());
                unsubRef.current?.();
                unsubRef.current = editor.review.subscribe(pushChanges);
                unsubSelectionRef.current?.();
                unsubSelectionRef.current = editor.selection.observe(
                  (snapshot) => {
                    onSelectionUpdatedRef.current?.(snapshot);
                  },
                );
              } catch {
                // Ignore if closed during open
              }
            })
            .catch(() => {
              // Handled by host error UI if needed
            });
        }}
      />
    </div>
  );
};
