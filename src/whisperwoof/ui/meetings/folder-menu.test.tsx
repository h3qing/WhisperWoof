/**
 * The Meetings tab's folder capsule with its menu open (the dropdown is
 * replaced by plain markup so it renders to HTML), and which folder the tab
 * opens on.
 */
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import type { FolderItem } from "../../../types/electron";

vi.mock("../../../components/ui/dropdown-menu", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: Pass,
    DropdownMenuContent: Pass,
    DropdownMenuSeparator: () => <hr />,
    DropdownMenuItem: ({ children }: { children?: ReactNode }) => (
      <div role="menuitem">{children}</div>
    ),
  };
});

const { FolderFilter } = await import("./FolderFilter");
const { findMeetingsFolder } = await import("../../../components/notes/shared");

const folders = [
  { id: 1, name: "Personal", is_default: 1 },
  { id: 2, name: "Meetings", is_default: 1 },
  { id: 3, name: "Client calls", is_default: 0 },
] as unknown as FolderItem[];

const render = (activeFolderId: number | null) =>
  renderToStaticMarkup(
    <FolderFilter
      folders={folders}
      counts={{ 1: 3, 2: 5, 3: 2 }}
      activeFolderId={activeFolderId}
      onSelect={() => {}}
      onNewFolder={() => {}}
      onRename={() => {}}
      onDelete={() => {}}
    />
  );

describe("FolderFilter menu", () => {
  it("lists every folder and New folder", () => {
    const html = render(2);
    for (const name of ["Personal", "Meetings", "Client calls"]) expect(html).toContain(name);
    expect(html).toContain("notes.context.newFolder");
  });

  it("can't rename or delete a built-in folder", () => {
    const html = render(2);
    expect(html).not.toContain("notes.context.rename");
    expect(html).not.toContain("notes.context.delete");
  });

  it("renames or deletes the user's own folder being shown", () => {
    const html = render(3);
    expect(html).toContain("notes.context.rename");
    expect(html).toContain("notes.context.delete");
  });

  it("says Folders when no folder is shown", () => {
    expect(render(null)).toContain("notes.folders.title");
  });
});

describe("findMeetingsFolder", () => {
  it("picks the built-in Meetings folder, never a folder the user named Meetings", () => {
    const mine = { id: 9, name: "Meetings", is_default: 0 } as unknown as FolderItem;
    expect(findMeetingsFolder([mine, ...folders])?.id).toBe(2);
    expect(findMeetingsFolder([mine])).toBeUndefined();
  });
});
