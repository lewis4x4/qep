import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { sendConciergeChat, type ConciergeMessage } from "../lib/deal-room-api";

interface ConciergeChatProps {
  token: string;
  repName: string | null;
  repEmail: string | null;
  repPhone: string | null;
}

export function ConciergeChat({ token, repName, repEmail, repPhone }: ConciergeChatProps) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ConciergeMessage[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

  const sendMutation = useMutation({
    mutationFn: (prompt: string) => sendConciergeChat(token, prompt, messages),
    onSuccess: (data, prompt) => {
      setMessages((cur) => [
        ...cur,
        { role: "user", content: prompt },
        { role: "assistant", content: data.reply },
      ]);
    },
  });

  useEffect(() => {
    if (open) {
      // Scroll the transcript to the bottom on each new exchange so the
      // latest answer is visible without the customer hunting for it.
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, open]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || sendMutation.isPending) return;
    setInput("");
    sendMutation.mutate(trimmed);
  };

  return (
    <>
      {/* Floating action button bottom-right. Conservative copy — "Ask a
          question" reads less marketing-y than "Chat now". */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-slate-800"
          aria-label="Open concierge chat"
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-[#E87722] text-[10px] font-bold">AI</span>
          Ask a question
        </button>
      )}

      {/* Drawer: pinned bottom-right, responsive on small screens. */}
      {open && (
        <div
          role="dialog"
          aria-label="Deal room concierge"
          className="fixed inset-x-0 bottom-0 z-40 flex h-[min(88vh,640px)] flex-col rounded-t-2xl bg-white shadow-2xl sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[600px] sm:w-[400px] sm:rounded-2xl border border-slate-200"
        >
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="grid h-5 w-5 place-items-center rounded-full bg-[#E87722] text-[10px] font-bold text-white">AI</span>
                <span className="text-sm font-bold text-slate-900">QEP Concierge</span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                Specs, logistics, timing. Rep still calls the shots.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100"
              aria-label="Close concierge chat"
            >
              ✕
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
            {messages.length === 0 && !sendMutation.isPending && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
                Hi — ask anything about this proposal. Common ones: <em>What's the operating weight? Will it fit on a 20' trailer? What are the maintenance intervals?</em>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === "user"
                  ? "ml-8 rounded-lg bg-[#fff7ed] px-3 py-2 text-slate-900"
                  : "mr-8 rounded-lg bg-slate-100 px-3 py-2 text-slate-900"}
              >
                {m.content}
              </div>
            ))}
            {sendMutation.isPending && (
              <div className="mr-8 rounded-lg bg-slate-100 px-3 py-2 text-slate-500 italic">
                Thinking…
              </div>
            )}
            {sendMutation.isError && (
              <div className="rounded-lg bg-rose-50 px-3 py-2 text-[13px] text-rose-700">
                {sendMutation.error instanceof Error ? sendMutation.error.message : "Chat failed. Try again or reach your rep."}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <footer className="border-t border-slate-200 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                placeholder="Ask about specs, logistics, timing…"
                className="flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#E87722] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || sendMutation.isPending}
                className="rounded-md bg-[#E87722] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                Send
              </button>
            </div>
            {(repEmail || repPhone) && (
              <div className="mt-2 text-[11px] text-slate-500">
                For anything I can't answer, {repName ? `${repName}` : "your rep"}
                {repPhone && <> · <a className="text-[#E87722]" href={`tel:${repPhone}`}>{repPhone}</a></>}
                {repEmail && <> · <a className="text-[#E87722]" href={`mailto:${repEmail}`}>{repEmail}</a></>}
              </div>
            )}
          </footer>
        </div>
      )}
    </>
  );
}
