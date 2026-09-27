import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Loader2 } from "lucide-react";
import { Button } from "../ui/button";
import { useToast } from "../ui/Toast";
import NoteListItem from "./NoteListItem";
import NoteEditor from "./NoteEditor";
import ActionPicker from "./ActionPicker";
import ActionManagerDialog from "./ActionManagerDialog";
import AddNotesToFolderDialog from "./AddNotesToFolderDialog";
import { useActionProcessing } from "../../hooks/useActionProcessing";
import { useSettingsStore, selectIsCloudReasoningMode } from "../../stores/settingsStore";
import { useFolderManagement } from "../../hooks/useFolderManagement";
import { useUpcomingEvents } from "../../hooks/useUpcomingEvents";
import { formatDateGroup } from "../../utils/dateFormatting";
import type { CalendarEvent } from "../../types/calendar";
import { ComingUpToday } from "../../whisperwoof/ui/meetings/ComingUpToday";
import { FolderFilter } from "../../whisperwoof/ui/meetings/FolderFilter";
import { groupByDay } from "../../whisperwoof/ui/meetings/meetings-list";
import { cn } from "../lib/utils";
import logger from "../../utils/logger";
import { parseTranscriptSegments } from "../../utils/parseTranscriptSegments";
import {
  useNotes,
  useActiveNoteId,
  useActiveFolderId,
  initializeNotes,
  setActiveNoteId,
  setActiveFolderId,
} from "../../stores/noteStore";
import { useMeetingRecording } from "./useMeetingRecording";
import { useNotesOnboarding } from "../../hooks/useNotesOnboarding";
import NotesOnboarding from "./NotesOnboarding";

const FOLDER_INPUT_CLASS =
  "w-full h-6 bg-foreground/5 rounded px-2 text-xs text-foreground outline-none border border-primary/30 focus:border-primary/50";

function makeContentHash(content: string): string {
  return String(content.length) + "-" + content.slice(0, 50);
}

interface PersonalNotesViewProps {
  onOpenSettings?: (section: string) => void;
  meetingRecordingRequest?: { noteId: number; folderId: number; event: any } | null;
  onMeetingRecordingRequestHandled?: () => void;
  isMeetingMode?: boolean;
}

const NO_SEGMENTS: ReturnType<typeof useMeetingRecording>["segments"] = [];

export default function PersonalNotesView({
  onOpenSettings,
  meetingRecordingRequest,
  onMeetingRecordingRequestHandled,
  isMeetingMode,
}: PersonalNotesViewProps) {
  const { t } = useTranslation();
  const notes = useNotes();
  const activeNoteId = useActiveNoteId();
  const activeFolderId = useActiveFolderId();
  const [isSaving, setIsSaving] = useState(false);
  const [localTitle, setLocalTitle] = useState("");
  const [localContent, setLocalContent] = useState("");
  const [localEnhancedContent, setLocalEnhancedContent] = useState<string | null>(null);
  const [showActionManager, setShowActionManager] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const enhancedSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeNoteRef = useRef<number | null>(null);
  const localContentRef = useRef(localContent);
  localContentRef.current = localContent;
  const localTitleRef = useRef(localTitle);
  localTitleRef.current = localTitle;
  const { toast } = useToast();
  const isCloudMode = useSettingsStore(selectIsCloudReasoningMode);
  const effectiveModelId = useSettingsStore((s) => s.reasoningModel);
  const { isComplete: isOnboardingComplete, complete: completeOnboarding } = useNotesOnboarding();

  // Recordings live in MeetingTranscriptionProvider (ControlPanel), so they keep
  // going when this view closes and save to their note when they stop.
  const {
    isRecording: isTranscribing,
    transcript: realtimeTranscript,
    segments: realtimeSegments,
    micPartial: micPartial,
    systemPartial: systemPartial,
    prepareTranscription,
    stopTranscription,
    recording,
    startRecording: startRecordingInto,
  } = useMeetingRecording();

  const {
    folders,
    folderCounts,
    isLoading,
    isCreatingFolder,
    newFolderName,
    renamingFolderId,
    renameValue,
    showAddNotesDialog,
    newFolderInputRef,
    renameInputRef,
    setIsCreatingFolder,
    setNewFolderName,
    setRenamingFolderId,
    setRenameValue,
    setShowAddNotesDialog,
    loadFolders,
    handleCreateFolder,
    handleConfirmRename,
    handleDeleteFolder,
  } = useFolderManagement();

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;
  // The recording's live transcript belongs to the note it records into, not
  // to whichever note is open (it stays in the provider after it stops).
  const isRecordingNote = recording?.noteId === activeNoteId;
  const recordedTranscript = isRecordingNote ? realtimeTranscript : "";
  const recordedSegments = isRecordingNote ? realtimeSegments : NO_SEGMENTS;

  // Note recording uses the same meeting transcription pipeline, saving into the
  // note that was open when it started.
  const startRecording = useCallback(async () => {
    await startRecordingInto({
      noteId: activeNoteRef.current,
      noteTitle: localTitleRef.current || null,
      isMeeting: false,
    });
  }, [startRecordingInto]);

  const stopRecording = useCallback(async () => {
    await stopTranscription();
  }, [stopTranscription]);

  useEffect(() => {
    if (activeNote && activeNote.id !== activeNoteRef.current) {
      activeNoteRef.current = activeNote.id;
      setLocalTitle(activeNote.title);
      setLocalContent(activeNote.content);
      setLocalEnhancedContent(activeNote.enhanced_content ?? null);
    }
    if (!activeNote) {
      activeNoteRef.current = null;
    }
  }, [activeNote]);

  const debouncedSave = useCallback((noteId: number, title: string, content: string) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);
      try {
        await window.electronAPI.updateNote(noteId, { title, content });
      } catch (err) {
        logger.warn("Failed to save note", { error: (err as Error).message }, "notes");
      } finally {
        setIsSaving(false);
      }
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (enhancedSaveTimeoutRef.current) clearTimeout(enhancedSaveTimeoutRef.current);
    };
  }, []);

  const handleTitleChange = useCallback(
    (title: string) => {
      setLocalTitle(title);
      if (activeNoteId) debouncedSave(activeNoteId, title, localContent);
    },
    [activeNoteId, localContent, debouncedSave]
  );

  const handleContentChange = useCallback(
    (content: string) => {
      setLocalContent(content);
      if (activeNoteId) debouncedSave(activeNoteId, localTitle, content);
    },
    [activeNoteId, localTitle, debouncedSave]
  );

  const handleEnhancedContentChange = useCallback(
    (content: string) => {
      setLocalEnhancedContent(content);
      if (!activeNoteId) return;
      if (enhancedSaveTimeoutRef.current) clearTimeout(enhancedSaveTimeoutRef.current);
      enhancedSaveTimeoutRef.current = setTimeout(async () => {
        setIsSaving(true);
        try {
          await window.electronAPI.updateNote(activeNoteId, { enhanced_content: content });
        } finally {
          setIsSaving(false);
        }
      }, 1000);
    },
    [activeNoteId]
  );

  const handleNewNote = useCallback(async () => {
    if (!activeFolderId) return;
    const result = await window.electronAPI.saveNote(
      t("notes.list.untitledNote"),
      "",
      "personal",
      null,
      null,
      activeFolderId
    );
    if (result.success && result.note) {
      setActiveNoteId(result.note.id);
      loadFolders();
    }
  }, [activeFolderId, loadFolders]);

  const handleNotesAdded = useCallback(async () => {
    if (activeFolderId) {
      await initializeNotes(null, 50, activeFolderId);
    }
    loadFolders();
  }, [activeFolderId, loadFolders]);

  const handleDelete = useCallback(
    async (id: number) => {
      await window.electronAPI.deleteNote(id);
      if (activeNoteId === id) {
        const remaining = notes.filter((n) => n.id !== id);
        setActiveNoteId(remaining.length > 0 ? remaining[0].id : null);
      }
      loadFolders();
    },
    [activeNoteId, notes, loadFolders]
  );

  const handleMoveToFolder = useCallback(
    async (noteId: number, folderId: number) => {
      await window.electronAPI.updateNote(noteId, { folder_id: folderId });
      if (activeFolderId) await initializeNotes(null, 50, activeFolderId);
      loadFolders();
    },
    [activeFolderId, loadFolders]
  );

  // The Meetings tab's list: a divider per day, newest first.
  const noteGroups = useMemo(
    () => groupByDay(notes, (day) => formatDateGroup(day, t)),
    [notes, t]
  );

  const { events: upcomingEvents } = useUpcomingEvents();
  const handleRecordEvent = useCallback(
    async (event: CalendarEvent) => {
      const result = await window.electronAPI?.startNewMeeting?.({
        title: event.summary ?? undefined,
      });
      if (result && !result.success) {
        toast({
          title: "The meeting didn't start",
          description: result.error,
          variant: "destructive",
        });
      }
    },
    [toast]
  );

  const handleCreateFolderAndMove = useCallback(
    async (noteId: number, folderName: string) => {
      const result = await window.electronAPI.createFolder(folderName);
      if (result.success && result.folder) {
        await window.electronAPI.updateNote(noteId, { folder_id: result.folder.id });
        if (activeFolderId) await initializeNotes(null, 50, activeFolderId);
        await loadFolders();
      } else if (result.error) {
        toast({
          title: t("notes.folders.couldNotCreate"),
          description: result.error,
          variant: "destructive",
        });
      }
    },
    [activeFolderId, loadFolders, toast, t]
  );

  const handleApplyEnhancement = useCallback(
    async (enhancedContent: string, prompt: string, title?: string) => {
      if (!activeNoteId) return;
      setLocalEnhancedContent(enhancedContent);
      const hash = makeContentHash(localContentRef.current);
      const updates: Record<string, string> = {
        enhanced_content: enhancedContent,
        enhancement_prompt: prompt,
        enhanced_at_content_hash: hash,
      };
      if (title) {
        updates.title = title;
        setLocalTitle(title);
      }
      setIsSaving(true);
      try {
        await window.electronAPI.updateNote(activeNoteId, updates);
      } finally {
        setIsSaving(false);
      }
    },
    [activeNoteId]
  );

  const {
    state: actionProcessingState,
    actionName,
    runAction,
    cancel: cancelAction,
  } = useActionProcessing({
    onSuccess: useCallback(
      (enhancedContent: string, prompt: string, title?: string) => {
        handleApplyEnhancement(enhancedContent, prompt, title);
      },
      [handleApplyEnhancement]
    ),
    onError: useCallback(
      (errorMessage: string) => {
        toast({
          title: t("notes.enhance.title"),
          description: errorMessage,
          variant: "destructive",
        });
      },
      [toast, t]
    ),
  });

  useEffect(() => {
    return () => cancelAction();
  }, [activeNoteId, cancelAction]);

  const isEnhancementStale = useMemo(() => {
    if (!activeNote?.enhanced_content || !activeNote?.enhanced_at_content_hash) return false;
    const currentHash = makeContentHash(localContent);
    return currentHash !== activeNote.enhanced_at_content_hash;
  }, [activeNote?.enhanced_content, activeNote?.enhanced_at_content_hash, localContent]);

  const handleExportNote = useCallback(
    async (format: "md" | "txt") => {
      if (!activeNoteId) return;
      await window.electronAPI.exportNote(activeNoteId, format);
    },
    [activeNoteId]
  );

  // Pre-warm WebSocket when entering meeting mode (before user hits record)
  useEffect(() => {
    if (isMeetingMode) {
      prepareTranscription();
    }
  }, [isMeetingMode, prepareTranscription]);

  useEffect(() => {
    if (!meetingRecordingRequest || activeNoteId !== meetingRecordingRequest.noteId) return;
    startRecordingInto({
      noteId: meetingRecordingRequest.noteId,
      noteTitle: activeNote?.title || null,
      isMeeting: true,
    });
    onMeetingRecordingRequestHandled?.();
  }, [
    meetingRecordingRequest,
    activeNoteId,
    activeNote?.title,
    startRecordingInto,
    onMeetingRecordingRequestHandled,
  ]);

  const editorNote = activeNote
    ? { ...activeNote, title: localTitle, content: localContent }
    : null;

  if (!isOnboardingComplete) {
    return <NotesOnboarding onComplete={completeOnboarding} />;
  }

  return (
    <div className="flex h-full">
      <div
        className="shrink-0 overflow-hidden transition-[width] duration-300 ease-out"
        style={{ width: isMeetingMode ? 0 : "18.5rem" }}
      >
        <div className="w-[18rem] pt-2 h-[calc(100%-0.5rem)] shrink-0 rounded-[var(--radius-sheet)] glass-thick overflow-hidden flex flex-col">
          <ComingUpToday
            events={upcomingEvents}
            recordingDisabled={isTranscribing}
            onRecord={handleRecordEvent}
          />
          <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-1">
            <FolderFilter
              folders={folders}
              counts={folderCounts}
              activeFolderId={activeFolderId}
              onSelect={setActiveFolderId}
              onNewFolder={() => setIsCreatingFolder(true)}
              onRename={(folder) => {
                setRenamingFolderId(folder.id);
                setRenameValue(folder.name);
              }}
              onDelete={(folder) => handleDeleteFolder(folder.id)}
            />
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              onClick={handleNewNote}
              aria-label={t("notes.list.newNote")}
              className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
            >
              <Plus size={15} />
            </Button>
          </div>
          {isCreatingFolder && (
            <div className="px-3 pb-1">
              <input
                ref={newFolderInputRef}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                  if (e.key === "Escape") {
                    setIsCreatingFolder(false);
                    setNewFolderName("");
                  }
                }}
                onBlur={handleCreateFolder}
                placeholder={t("notes.folders.folderName")}
                className={cn(FOLDER_INPUT_CLASS, "placeholder:text-foreground/20")}
              />
            </div>
          )}
          {renamingFolderId !== null && (
            <div className="px-3 pb-1">
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirmRename();
                  if (e.key === "Escape") {
                    setRenamingFolderId(null);
                    setRenameValue("");
                  }
                }}
                onBlur={handleConfirmRename}
                className={FOLDER_INPUT_CLASS}
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={12} className="animate-spin text-foreground/15" />
              </div>
            ) : notes.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 px-4">
                <svg
                  className="text-foreground mb-3"
                  width="40"
                  height="36"
                  viewBox="0 0 40 36"
                  fill="none"
                >
                  <rect
                    x="12"
                    y="1"
                    width="20"
                    height="26"
                    rx="2"
                    transform="rotate(5 22 14)"
                    fill="currentColor"
                    fillOpacity={0.025}
                    stroke="currentColor"
                    strokeOpacity={0.06}
                  />
                  <rect
                    x="8"
                    y="3"
                    width="20"
                    height="26"
                    rx="2"
                    fill="currentColor"
                    fillOpacity={0.04}
                    stroke="currentColor"
                    strokeOpacity={0.08}
                  />
                  <rect
                    x="12"
                    y="9"
                    width="10"
                    height="1.5"
                    rx="0.75"
                    fill="currentColor"
                    fillOpacity={0.07}
                  />
                  <rect
                    x="12"
                    y="13"
                    width="12"
                    height="1.5"
                    rx="0.75"
                    fill="currentColor"
                    fillOpacity={0.05}
                  />
                  <rect
                    x="12"
                    y="17"
                    width="8"
                    height="1.5"
                    rx="0.75"
                    fill="currentColor"
                    fillOpacity={0.04}
                  />
                </svg>
                <p className="text-xs text-foreground/50 mb-3">
                  {t("notes.empty.emptyFolder")}
                </p>
                <div className="flex flex-col gap-1.5 w-full max-w-36">
                  <button
                    onClick={handleNewNote}
                    className="flex items-center justify-center gap-1.5 h-6 rounded-md bg-primary/15 border border-primary/20 text-xs font-medium text-foreground hover:bg-primary/25 hover:text-primary hover:border-primary/20 transition-colors"
                  >
                    <Plus size={10} />
                    {t("notes.empty.createNote")}
                  </button>
                  <button
                    onClick={() => setShowAddNotesDialog(true)}
                    className="flex items-center justify-center gap-1.5 h-6 rounded-md border border-foreground/8 text-xs text-foreground/40 hover:text-foreground/60 hover:border-foreground/15 hover:bg-foreground/3 transition-colors"
                  >
                    {t("notes.addToFolder.addExisting")}
                  </button>
                </div>
              </div>
            ) : (
              noteGroups.map((group) => (
                <div key={group.label || "undated"}>
                  <div className="flex items-center gap-2.5 px-3 pt-3 pb-1">
                    <span className="text-xs font-bold text-muted-foreground">{group.label}</span>
                    <span className="flex-1 h-px bg-border" />
                  </div>
                  {group.notes.map((note) => (
                    <NoteListItem
                      key={note.id}
                      note={note}
                      isActive={note.id === activeNoteId}
                      onClick={() => setActiveNoteId(note.id)}
                      onDelete={handleDelete}
                      folders={folders}
                      currentFolderId={activeFolderId}
                      onMoveToFolder={handleMoveToFolder}
                      onCreateFolderAndMove={handleCreateFolderAndMove}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div
        className={cn(
          "flex-1 flex flex-col min-w-0 min-h-0 mr-2 mb-2 rounded-lg bg-card shadow-card overflow-hidden",
          isMeetingMode && "ml-2"
        )}
      >
        {editorNote ? (
          <>
            <NoteEditor
              note={editorNote}
              onTitleChange={handleTitleChange}
              onContentChange={handleContentChange}
              isSaving={isSaving}
              isRecording={isTranscribing}
              isProcessing={false}
              onStartRecording={startRecording}
              onStopRecording={stopRecording}
              onExportNote={handleExportNote}
              enhancement={
                localEnhancedContent
                  ? {
                      content: localEnhancedContent,
                      isStale: isEnhancementStale,
                      onChange: handleEnhancedContentChange,
                    }
                  : undefined
              }
              isMeetingRecording={isRecordingNote && isTranscribing && !!recording?.isMeeting}
              meetingTranscript={recordedTranscript}
              meetingSegments={recordedSegments}
              meetingMicPartial={isRecordingNote ? micPartial : ""}
              meetingSystemPartial={isRecordingNote ? systemPartial : ""}
              onStopMeetingRecording={stopTranscription}
              liveTranscript={isTranscribing ? recordedTranscript : ""}
              actionProcessingState={actionProcessingState}
              actionName={actionName}
              actionPicker={
                <ActionPicker
                  onRunAction={(action) => {
                    const rawTranscript = recordedTranscript || activeNote?.transcript;
                    const hasNotes = !!localContent.trim();
                    if (!hasNotes && !rawTranscript) return;

                    let formattedTranscript = "";
                    let isMeetingNote = false;
                    if (rawTranscript) {
                      const segments = parseTranscriptSegments(rawTranscript);
                      if (segments.length > 0) {
                        isMeetingNote = true;
                        formattedTranscript = segments
                          .map(
                            (s) =>
                              `${s.source === "mic" ? t("notes.speaker.you") : t("notes.speaker.them")}: ${s.text}`
                          )
                          .join("\n");
                      }
                      if (!formattedTranscript) {
                        formattedTranscript = rawTranscript;
                      }
                    }

                    const parts = [
                      hasNotes ? localContent : "",
                      formattedTranscript ? `## Meeting Transcript\n${formattedTranscript}` : "",
                    ]
                      .filter(Boolean)
                      .join("\n\n");
                    runAction(action, parts, {
                      isCloudMode,
                      modelId: effectiveModelId,
                      isMeetingNote,
                    });
                  }}
                  onManageActions={() => setShowActionManager(true)}
                  disabled={
                    (!localContent.trim() && !recordedTranscript && !activeNote?.transcript) ||
                    actionProcessingState === "processing"
                  }
                />
              }
            />
            <ActionManagerDialog open={showActionManager} onOpenChange={setShowActionManager} />
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center -mt-6">
            <svg
              className="text-foreground mb-5"
              width="72"
              height="64"
              viewBox="0 0 72 64"
              fill="none"
            >
              <rect
                x="22"
                y="2"
                width="32"
                height="42"
                rx="3"
                transform="rotate(6 38 23)"
                fill="currentColor"
                fillOpacity={0.025}
                stroke="currentColor"
                strokeOpacity={0.06}
              />
              <rect
                x="18"
                y="5"
                width="32"
                height="42"
                rx="3"
                transform="rotate(3 34 26)"
                fill="currentColor"
                fillOpacity={0.04}
                stroke="currentColor"
                strokeOpacity={0.08}
              />
              <rect
                x="14"
                y="8"
                width="32"
                height="42"
                rx="3"
                fill="currentColor"
                fillOpacity={0.05}
                stroke="currentColor"
                strokeOpacity={0.1}
              />
              <rect
                x="20"
                y="16"
                width="16"
                height="2"
                rx="1"
                fill="currentColor"
                fillOpacity={0.08}
              />
              <rect
                x="20"
                y="21"
                width="20"
                height="2"
                rx="1"
                fill="currentColor"
                fillOpacity={0.06}
              />
              <rect
                x="20"
                y="26"
                width="12"
                height="2"
                rx="1"
                fill="currentColor"
                fillOpacity={0.05}
              />
              <rect
                x="20"
                y="31"
                width="18"
                height="2"
                rx="1"
                fill="currentColor"
                fillOpacity={0.04}
              />
              <circle
                cx="54"
                cy="50"
                r="5"
                fill="currentColor"
                fillOpacity={0.03}
                stroke="currentColor"
                strokeOpacity={0.06}
              />
              <path
                d="M51.5 50L53 51.5L56.5 48"
                stroke="currentColor"
                strokeOpacity={0.12}
                strokeWidth={1.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {notes.length === 0 ? (
              <>
                <h3 className="text-xs font-semibold text-foreground/60 mb-1">
                  {t("notes.empty.title")}
                </h3>
                <p className="text-xs text-foreground/50 text-center max-w-55 mb-4">
                  {t("notes.empty.description")}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleNewNote}
                    className="flex items-center gap-1.5 px-4 h-7 rounded-md bg-primary/15 border border-primary/20 text-xs font-medium text-foreground hover:bg-primary/25 hover:text-primary hover:border-primary/20 transition-colors"
                  >
                    <Plus size={11} />
                    {t("notes.empty.createNote")}
                  </button>
                  <button
                    onClick={() => setShowAddNotesDialog(true)}
                    className="flex items-center gap-1.5 px-4 h-7 rounded-md border border-foreground/8 text-xs text-foreground/40 hover:text-foreground/60 hover:border-foreground/15 hover:bg-foreground/3 transition-colors"
                  >
                    {t("notes.addToFolder.addExisting")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-xs font-semibold text-foreground/60 mb-1">
                  {t("notes.empty.selectTitle")}
                </h3>
                <p className="text-xs text-foreground/50 text-center max-w-50">
                  {t("notes.empty.selectDescription")}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {activeFolderId && (
        <AddNotesToFolderDialog
          open={showAddNotesDialog}
          onOpenChange={setShowAddNotesDialog}
          targetFolderId={activeFolderId}
          onNotesAdded={handleNotesAdded}
        />
      )}
    </div>
  );
}
