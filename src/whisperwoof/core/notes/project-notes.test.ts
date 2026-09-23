/**
 * fn+P saves a note into the default project. The user can change the
 * default; with no projects at all, an "Inbox" is created the first time.
 */
import { describe, it, expect } from "vitest";
import { pickDefaultProject, INBOX_NAME } from "../../bridge/project-notes-pure.js";

const reno = { id: "p-reno", name: "Kitchen reno" };
const inbox = { id: "p-inbox", name: "Inbox" };

describe("pickDefaultProject", () => {
  it("uses the saved default while it still exists", () => {
    expect(pickDefaultProject([reno, inbox], "p-reno")).toEqual({ project: reno, create: null });
  });

  it("falls back to an existing Inbox when the saved default was deleted", () => {
    expect(pickDefaultProject([reno, inbox], "p-gone")).toEqual({ project: inbox, create: null });
  });

  it("asks to create the Inbox when there's nothing to fall back to", () => {
    expect(pickDefaultProject([], null)).toEqual({ project: null, create: INBOX_NAME });
    expect(pickDefaultProject([reno], null)).toEqual({ project: null, create: INBOX_NAME });
  });
});
