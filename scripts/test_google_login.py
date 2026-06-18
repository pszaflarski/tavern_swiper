import os
import sys
from playwright.sync_api import sync_playwright

def run():
    print("Starting Playwright...")
    with sync_playwright() as p:
        # Launch Chromium headful using the active display :11.0
        browser = p.chromium.launch(
            headless=False,
            args=["--no-sandbox", "--disable-setuid-sandbox"]
        )
        context = browser.new_context()
        page = context.new_page()
        
        # Capture console messages
        def console_msg(msg):
            print(f"[BROWSER CONSOLE] {msg.type}: {msg.text}")
            
        page.on("console", console_msg)
        
        # Navigate
        print("Navigating to http://localhost:8081...")
        try:
            page.goto("http://localhost:8081", timeout=30000)
        except Exception as e:
            print(f"Error navigating: {e}")
            browser.close()
            return
            
        print("Waiting for page load...")
        page.wait_for_timeout(5000)
        
        # Click Google Sign-in button
        print("Locating Google button...")
        google_btn = page.locator("[data-testid='auth-google-button']")
        if google_btn.count() > 0:
            print("Clicking Google button...")
            try:
                with context.expect_page(timeout=15000) as popup_info:
                    google_btn.click()
                popup = popup_info.value
                popup.wait_for_load_state()
                print(f"Popup URL: {popup.url}")
                popup.wait_for_timeout(5000)
            except Exception as e:
                print(f"Error clicking/waiting for popup: {e}")
        else:
            # Fallback text search
            google_btn_text = page.locator("text='Continue with Google'")
            if google_btn_text.count() > 0:
                print("Clicking Google button (text)...")
                try:
                    with context.expect_page(timeout=15000) as popup_info:
                        google_btn_text.click()
                    popup = popup_info.value
                    popup.wait_for_load_state()
                    print(f"Popup URL: {popup.url}")
                    popup.wait_for_timeout(5000)
                except Exception as e:
                    print(f"Error clicking/waiting for popup (text): {e}")
            else:
                print("Google button not found on screen.")
                
        print("Waiting 5 seconds to capture final console output...")
        page.wait_for_timeout(5000)
        browser.close()

if __name__ == "__main__":
    # Ensure DISPLAY is set (defaulting to :11.0 if not specified)
    if "DISPLAY" not in os.environ:
        os.environ["DISPLAY"] = ":11.0"
    run()
