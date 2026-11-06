import { describe, expect, it } from "vitest";
import {
  captchaGate,
  captchaReducer,
  captchaTokenFrom,
  initialCaptcha,
  type CaptchaEvent,
  type CaptchaState,
} from "@/lib/auth/captcha";

const run = (start: CaptchaState, ...events: CaptchaEvent[]) =>
  events.reduce(captchaReducer, start);

describe("anti-robot check of a form", () => {
  it("without a site key (local, preview), nothing is asked and nothing changes", () => {
    const off = initialCaptcha(undefined);
    expect(captchaGate(off)).toEqual({ blocked: false, notice: null });
    expect(run(off, { type: "error" }, { type: "timeout" }, { type: "expired" })).toEqual(off);
  });

  it("with a site key, the button waits for the token, then is enabled", () => {
    const start = initialCaptcha("1x00000000000000000000AA");
    expect(captchaGate(start)).toEqual({ blocked: true, notice: "checking" });
    const ready = run(start, { type: "token", token: "XXXX.DUMMY.TOKEN.XXXX" });
    expect(ready).toEqual({ status: "ready", token: "XXXX.DUMMY.TOKEN.XXXX" });
    expect(captchaGate(ready)).toEqual({ blocked: false, notice: null });
  });

  it("an empty token is no token", () => {
    const start = initialCaptcha("key");
    expect(captchaGate(run(start, { type: "token", token: "" }))).toEqual({
      blocked: true,
      notice: "checking",
    });
  });

  it("an expired token disables the button again until Turnstile renews it", () => {
    const expired = run(initialCaptcha("key"), { type: "token", token: "a" }, { type: "expired" });
    expect(captchaGate(expired)).toEqual({ blocked: true, notice: "checking" });
    expect(captchaGate(run(expired, { type: "token", token: "b" }))).toEqual({
      blocked: false,
      notice: null,
    });
  });

  it("an error, or a script that never loads, says so; « Réessayer » starts again", () => {
    const failed = run(initialCaptcha("key"), { type: "error" });
    expect(captchaGate(failed)).toEqual({ blocked: true, notice: "unavailable" });
    const timedOut = run(initialCaptcha("key"), { type: "timeout" });
    expect(captchaGate(timedOut)).toEqual({ blocked: true, notice: "unavailable" });
    const retried = run(failed, { type: "retry" });
    expect(captchaGate(retried)).toEqual({ blocked: true, notice: "checking" });
    expect(captchaGate(run(retried, { type: "token", token: "c" })).blocked).toBe(false);
  });

  it("the load timeout never cancels a token already given", () => {
    const ready = run(initialCaptcha("key"), { type: "token", token: "a" }, { type: "timeout" });
    expect(captchaGate(ready)).toEqual({ blocked: false, notice: null });
  });

  it("after a submission (token used), the button waits for a new token", () => {
    const used = run(initialCaptcha("key"), { type: "token", token: "a" }, { type: "retry" });
    expect(used).toEqual({ status: "loading", token: null });
    expect(captchaGate(used).blocked).toBe(true);
  });
});

describe("captchaTokenFrom", () => {
  it("reads the token Turnstile put in the form, or nothing", () => {
    const form = new FormData();
    expect(captchaTokenFrom(form)).toBeUndefined();
    form.set("cf-turnstile-response", "");
    expect(captchaTokenFrom(form)).toBeUndefined();
    form.set("cf-turnstile-response", "XXXX.DUMMY.TOKEN.XXXX");
    expect(captchaTokenFrom(form)).toBe("XXXX.DUMMY.TOKEN.XXXX");
    form.set("cf-turnstile-response", "x".repeat(5000));
    expect(captchaTokenFrom(form)).toBeUndefined();
  });
});
