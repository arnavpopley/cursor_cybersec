#!/usr/bin/env python3
"""Timed Keyring demo driver (~105s) for video recording."""
from __future__ import annotations

import time
from playwright.sync_api import sync_playwright

TARGET = "http://localhost:3000/?demo=1"
TOTAL_TARGET = 105.0


def wait(label: str, seconds: float, t0: float) -> None:
    print(f"[{time.time() - t0:6.1f}s] wait {seconds:.0f}s — {label}", flush=True)
    time.sleep(seconds)


def main() -> None:
    t0 = time.time()
    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.new_page()
        for pg in context.pages:
            if "localhost:3000" in (pg.url or ""):
                page = pg
                break

        page.bring_to_front()
        page.set_viewport_size({"width": 1600, "height": 1000})
        print(f"[{0.0:6.1f}s] goto {TARGET}", flush=True)
        page.goto(TARGET, wait_until="networkidle", timeout=60000)
        page.wait_for_selector("text=Findings", timeout=30000)
        # Wait for analyze to finish (findings count or file name)
        page.wait_for_timeout(2500)
        wait("brand + loaded findings", 8, t0)

        # Expand CRITICAL
        crit = page.get_by_text("CRITICAL", exact=False).first
        crit.click()
        wait("CRITICAL group open", 5, t0)

        # First finding under critical — click first expandable finding title-ish
        # Findings use collapsible triggers; open the first finding row after CRITICAL
        finding_btns = page.locator("button, [data-slot='collapsible-trigger']").filter(
            has_text="escalat"
        )
        if finding_btns.count() == 0:
            finding_btns = page.locator("[class*='CollapsibleTrigger'], button").filter(
                has_text="Privilege"
            )
        if finding_btns.count() == 0:
            # fallback: any finding apply sibling's parent trigger
            finding_btns = page.get_by_role("button").filter(has_text="Apply").locator(
                "xpath=ancestor::*[contains(@class,'border')][1]//button[1]"
            )
        # Prefer text from CRITICAL findings panel
        opened = False
        for text in [
            "Privilege escalation",
            "escalat",
            "Trusted profile",
            "iam-groups",
            "Legacy",
        ]:
            loc = page.get_by_text(text, exact=False).first
            try:
                if loc.is_visible(timeout=1000):
                    loc.click()
                    opened = True
                    break
            except Exception:
                continue
        if not opened:
            print("WARN: could not open CRITICAL finding detail", flush=True)
        wait("CRITICAL finding detail visible", 10, t0)

        # Ask
        ask_btn = page.get_by_role("button", name="Ask")
        if not ask_btn.is_enabled():
            # wait for load
            page.wait_for_timeout(3000)
        ask_btn.click()
        wait("Ask running / answer appear", 4, t0)
        # Wait for answer card
        try:
            page.wait_for_selector("text=Q ·", timeout=20000)
        except Exception:
            print("WARN: Q card not seen", flush=True)
        wait("read Ask answer", 8, t0)

        how = page.get_by_text("How did we get this", exact=False)
        if how.count():
            how.first.click()
            wait("citations / toolCalled open", 7, t0)
        else:
            wait("no how-block; hold on answer", 7, t0)

        # Expand HIGH and Apply
        high = page.get_by_text("HIGH", exact=True)
        if high.count() == 0:
            high = page.get_by_text("HIGH", exact=False)
        high.first.click()
        wait("HIGH group open", 4, t0)

        # Prefer non-dual Apply (1 NFC tap)
        apply = page.get_by_role("button", name="Apply (1 NFC tap)")
        if apply.count() == 0:
            apply = page.get_by_role("button", name="Apply")
        # Expand a HIGH finding first if Apply not visible
        if apply.count() == 0 or not apply.first.is_visible():
            for text in ["Account-wide", "Standing Administrator", "API key", "MFA", "pol-17"]:
                loc = page.get_by_text(text, exact=False).first
                try:
                    if loc.is_visible(timeout=800):
                        loc.click()
                        page.wait_for_timeout(800)
                        break
                except Exception:
                    continue
            apply = page.get_by_role("button", name="Apply (1 NFC tap)")
            if apply.count() == 0:
                apply = page.get_by_role("button", name="Apply")

        apply.first.click()
        wait("NFC banner visible", 7, t0)

        # Demo approve
        page.bring_to_front()
        page.keyboard.press("Control+Shift+A")
        wait("after NFC approve / audit", 9, t0)

        # Voice — may 404 if no pending; create pending only if needed
        voice = page.get_by_role("button", name="Voice: explain pending")
        if voice.count():
            voice.first.click()
            wait("voice call / status", 6, t0)
        else:
            wait("hold audit strip", 6, t0)

        # Final brand hold
        page.evaluate("window.scrollTo(0,0)")
        elapsed = time.time() - t0
        remaining = max(8.0, TOTAL_TARGET - elapsed)
        wait(f"final brand hold ({remaining:.0f}s to hit ~105)", remaining, t0)

        print(f"DONE total={time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    main()
