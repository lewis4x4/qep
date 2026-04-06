import { assertEquals } from "jsr:@std/assert@1";
import { sendVendorEscalationEmail } from "./vendor-escalation-resend.ts";

Deno.test("sendVendorEscalationEmail — no API key returns false without fetch", async () => {
  let fetchCalls = 0;
  const ok = await sendVendorEscalationEmail(
    { to: "v@v.com", subject: "s", text: "t" },
    {
      getResendApiKey: () => undefined,
      fetch: () => {
        fetchCalls++;
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    },
  );
  assertEquals(ok, false);
  assertEquals(fetchCalls, 0);
});

Deno.test("sendVendorEscalationEmail — posts to Resend with bearer and JSON body", async () => {
  const seen: { url: string; init?: RequestInit }[] = [];
  const ok = await sendVendorEscalationEmail(
    { to: "vendor@parts.com", subject: "Subj", text: "Body line" },
    {
      getResendApiKey: () => "re_secret",
      getResendFrom: () => "From <from@test.dev>",
      fetch: (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        seen.push({ url, init });
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    },
  );
  assertEquals(ok, true);
  assertEquals(seen.length, 1);
  assertEquals(seen[0].url, "https://api.resend.com/emails");
  assertEquals(seen[0].init?.method, "POST");
  const headers = seen[0].init?.headers as Record<string, string>;
  assertEquals(headers["Authorization"], "Bearer re_secret");
  assertEquals(headers["Content-Type"], "application/json");
  const body = JSON.parse(String(seen[0].init?.body));
  assertEquals(body.from, "From <from@test.dev>");
  assertEquals(body.to, ["vendor@parts.com"]);
  assertEquals(body.subject, "Subj");
  assertEquals(body.text, "Body line");
});

Deno.test("sendVendorEscalationEmail — non-OK response returns false", async () => {
  const ok = await sendVendorEscalationEmail(
    { to: "v@v.com", subject: "s", text: "t" },
    {
      getResendApiKey: () => "re_x",
      fetch: () => Promise.resolve(new Response("err", { status: 502 })),
    },
  );
  assertEquals(ok, false);
});
