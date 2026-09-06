import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
const onKeyDown = mock(() => undefined);
mock.module("@dnd-kit/sortable", () => ({ useSortable: () => ({ attributes: { role: "button", tabIndex: 0 }, listeners: { onKeyDown }, setNodeRef: () => {}, setActivatorNodeRef: () => {}, transform: null, transition: "", isDragging: false }) }));
mock.module("./PipelineDealCard", () => ({ PipelineDealCard: () => <article><a href="/deal">Open deal</a><button>Follow up</button></article> }));
const { DraggableDealCard } = await import("./DraggableDealCard");
test("dedicated keyboard drag and selection controls do not wrap card links/buttons", () => {
  const selected = mock(() => {});
  render(<DraggableDealCard deal={{ id: "deal-1", name: "Fixture deal" } as never} healthProfile={null} onSelectToggle={selected} onCommitPipelineFollowUp={() => {}} onSchedulePipelineRefresh={() => {}} onOpenHealthProfile={() => {}} />);
  const move = screen.getByRole("button", { name: "Move Fixture deal" });
  expect(move.contains(screen.getByRole("link", { name: "Open deal" }))).toBe(false);
  expect(screen.getByRole("button", { name: "Follow up" }).closest('[role="button"]')).toBeNull();
  fireEvent.keyDown(move, { key: " " }); expect(onKeyDown.mock.calls.length).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Select Fixture deal" })); expect(selected).toHaveBeenCalledWith("deal-1", false);
});
