import { expect, test, beforeEach } from "bun:test";
import { render, fireEvent, screen, waitFor } from "@testing-library/react";
import { useRetainedDraft } from "./useRetainedDraft";

function Editor({ actor = "one", version = "v1", text = "saved" }) {
  const draft = useRetainedDraft(`test-draft:${actor}:workspace:record`, { text }, version);
  return <><input aria-label="Draft" value={draft.value.text} onChange={(e) => draft.setValue({ text: e.target.value })} />
    <span>{draft.conflict ? "Conflict" : draft.dirty ? "Pending" : "Saved"}</span>
    <button onClick={draft.acceptServer}>Load latest</button>
    <button onClick={draft.retainAgainstLatest}>Keep draft</button></>;
}
beforeEach(() => localStorage.clear());
test("changed-record refetch retains edits and requires conflict resolution", async () => {
  const view = render(<Editor />);
  await waitFor(() => expect(screen.getByDisplayValue("saved")).toBeTruthy());
  fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "unsaved assessment" } });
  view.rerender(<Editor version="v2" text="other manager edit" />);
  await waitFor(() => expect(screen.getByText("Conflict")).toBeTruthy());
  expect(screen.getByLabelText("Draft").getAttribute("value")).toBe("unsaved assessment");
  fireEvent.click(screen.getByText("Load latest"));
  await waitFor(() => expect(screen.getByDisplayValue("other manager edit")).toBeTruthy());
});
test("draft survives remount but is not exposed to another actor", async () => {
  const view = render(<Editor />);
  fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "private draft" } });
  await waitFor(() => expect(localStorage.getItem("test-draft:one:workspace:record")).toContain("private draft"));
  view.rerender(<Editor actor="two" />);
  await waitFor(() => expect(screen.getByDisplayValue("saved")).toBeTruthy());
  view.rerender(<Editor />);
  await waitFor(() => expect(screen.getByDisplayValue("private draft")).toBeTruthy());
  view.unmount();
  render(<Editor />);
  await waitFor(() => expect(screen.getByDisplayValue("private draft")).toBeTruthy());
});
