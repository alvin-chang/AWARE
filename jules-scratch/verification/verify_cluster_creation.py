import time
from playwright.sync_api import sync_playwright, Page, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        time.sleep(60)
        page.goto("http://localhost:3001")

        # Login
        page.get_by_label("Username").fill("admin")
        page.get_by_label("Password").fill("password")
        page.get_by_role("button", name="Login").click()

        # Navigate to cluster creation
        page.get_by_role("button", name="Create New Cluster").click()

        # Step 1: Select Cluster Type
        page.get_by_text("Web Tier").click()
        page.get_by_role("button", name="Next").click()

        # Step 2: Configuration
        page.get_by_label("Cluster Name").fill("test-cluster")
        page.get_by_label("CPU per Node").fill("2 cores")
        page.get_by_label("Memory per Node").fill("8GB")
        page.get_by_label("Storage per Node").fill("100GB")
        page.get_by_role("button", name="Next").click()

        # Step 3: Review
        expect(page.get_by_text("CPU: 2 cores")).to_be_visible()
        expect(page.get_by_text("Memory: 8GB")).to_be_visible()
        expect(page.get_by_text("Storage: 100GB")).to_be_visible()

        page.screenshot(path="jules-scratch/verification/verification.png")

    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)